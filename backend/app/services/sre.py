"""Golden-signal computation, SLO maths and the synthetic load generator.

Signals come from the live ``prometheus_client`` registry. The registry only exposes
cumulative counters, so this module keeps a rolling in-process buffer of snapshots and
differentiates consecutive snapshots to obtain rate/latency series suitable for charting.

When a freshly started demo has no real traffic yet, the series is backfilled with
deterministic synthetic history (``random.Random(42)``) and the payload is flagged
``"synthetic": true`` so nobody mistakes it for production data.
"""

import logging
import random
import threading
import time
from bisect import bisect_left
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from prometheus_client import REGISTRY

from app.core.observability import log_event, record_domain_event
from app.services.chaos import chaos_state

logger = logging.getLogger("iberia.sre")

REQUESTS_METRIC = "iberia_http_requests_total"
LATENCY_METRIC = "iberia_http_request_duration_seconds"
IN_FLIGHT_METRIC = "iberia_http_in_flight_requests"

SAMPLE_INTERVAL_SECONDS = 5.0
BUFFER_MAX_SAMPLES = 2048
SERIES_POINTS = 30
SYNTHETIC_SEED = 42

# Fallback route ownership, used when a service row carries no endpoints.
DEFAULT_ROUTE_MAP = {
    "booking-api": ["/api/bookings"],
    "payments-api": ["/api/payments"],
    "checkin-api": ["/api/checkin"],
    "flights-search": ["/api/flights"],
    "notifications-worker": ["/api/notifications"],
    "loyalty-api": ["/api/loyalty"],
    "irrops-api": ["/api/irrops"],
}

# Rough per-service capacity (requests per minute) used to derive a saturation percentage.
SERVICE_CAPACITY_RPM = {
    "booking-api": 900,
    "payments-api": 600,
    "checkin-api": 1200,
    "flights-search": 2400,
    "notifications-worker": 300,
    "loyalty-api": 600,
    "irrops-api": 300,
    "sre-platform": 600,
}


@dataclass
class RouteStats:
    requests: float = 0.0
    errors: float = 0.0
    latency_sum: float = 0.0
    latency_count: float = 0.0
    buckets: dict[float, float] = field(default_factory=dict)

    def add(self, other: "RouteStats") -> None:
        self.requests += other.requests
        self.errors += other.errors
        self.latency_sum += other.latency_sum
        self.latency_count += other.latency_count
        for bound, value in other.buckets.items():
            self.buckets[bound] = self.buckets.get(bound, 0.0) + value

    def diff(self, older: "RouteStats") -> "RouteStats":
        delta = RouteStats(
            requests=max(self.requests - older.requests, 0.0),
            errors=max(self.errors - older.errors, 0.0),
            latency_sum=max(self.latency_sum - older.latency_sum, 0.0),
            latency_count=max(self.latency_count - older.latency_count, 0.0),
        )
        for bound, value in self.buckets.items():
            delta.buckets[bound] = max(value - older.buckets.get(bound, 0.0), 0.0)
        return delta


Snapshot = dict[str, RouteStats]

_buffer: deque[tuple[float, Snapshot, float]] = deque(maxlen=BUFFER_MAX_SAMPLES)
_buffer_lock = threading.RLock()


def _collect() -> tuple[Snapshot, float]:
    """Read the Prometheus registry into a per-route snapshot plus in-flight gauge value."""
    snapshot: Snapshot = {}
    in_flight = 0.0
    for metric in REGISTRY.collect():
        if metric.name == REQUESTS_METRIC.removesuffix("_total"):
            for sample in metric.samples:
                if not sample.name.endswith("_total"):
                    continue
                route = sample.labels.get("route", "unknown")
                stats = snapshot.setdefault(route, RouteStats())
                stats.requests += sample.value
                if sample.labels.get("status", "200").startswith("5"):
                    stats.errors += sample.value
        elif metric.name == LATENCY_METRIC:
            for sample in metric.samples:
                route = sample.labels.get("route", "unknown")
                stats = snapshot.setdefault(route, RouteStats())
                if sample.name.endswith("_sum"):
                    stats.latency_sum += sample.value
                elif sample.name.endswith("_count"):
                    stats.latency_count += sample.value
                elif sample.name.endswith("_bucket"):
                    bound = sample.labels.get("le", "+Inf")
                    key = float("inf") if bound in {"+Inf", "inf"} else float(bound)
                    stats.buckets[key] = stats.buckets.get(key, 0.0) + sample.value
        elif metric.name == IN_FLIGHT_METRIC:
            for sample in metric.samples:
                in_flight = max(in_flight, sample.value)
    return snapshot, in_flight


def sample_now(force: bool = False) -> None:
    """Append a registry snapshot to the rolling buffer (rate-limited to one per interval)."""
    now = time.time()
    with _buffer_lock:
        if not force and _buffer and now - _buffer[-1][0] < SAMPLE_INTERVAL_SECONDS:
            return
        snapshot, in_flight = _collect()
        _buffer.append((now, snapshot, in_flight))


def _routes_for(endpoints: list[str], service: str) -> list[str]:
    prefixes = endpoints or DEFAULT_ROUTE_MAP.get(service, [])
    return prefixes or [f"/api/{service.split('-')[0]}"]


def _aggregate(snapshot: Snapshot, prefixes: list[str]) -> RouteStats:
    total = RouteStats()
    for route, stats in snapshot.items():
        if any(route.startswith(prefix) for prefix in prefixes):
            total.add(stats)
    return total


def _percentile_ms(stats: RouteStats, quantile: float) -> float:
    """Interpolate a quantile out of histogram bucket deltas."""
    if not stats.buckets or stats.latency_count <= 0:
        return 0.0
    bounds = sorted(bound for bound in stats.buckets if bound != float("inf"))
    cumulative = [stats.buckets[bound] for bound in bounds]
    total = stats.buckets.get(float("inf"), cumulative[-1] if cumulative else 0.0)
    if total <= 0:
        return 0.0
    wanted = quantile * total
    index = bisect_left(cumulative, wanted)
    if index >= len(bounds):
        return bounds[-1] * 1000.0
    lower_bound = bounds[index - 1] if index else 0.0
    lower_count = cumulative[index - 1] if index else 0.0
    upper_bound = bounds[index]
    upper_count = cumulative[index]
    if upper_count <= lower_count:
        return upper_bound * 1000.0
    ratio = (wanted - lower_count) / (upper_count - lower_count)
    return (lower_bound + (upper_bound - lower_bound) * ratio) * 1000.0


def _synthetic_series(service: str, window_minutes: int, points: int) -> list[dict]:
    """Deterministic history so dashboards are never empty on a cold demo environment."""
    rng = random.Random(f"{SYNTHETIC_SEED}:{service}")
    capacity = SERVICE_CAPACITY_RPM.get(service, 600)
    base_rpm = capacity * 0.35
    now = datetime.now(tz=timezone.utc)
    step = max(window_minutes / points, 1 / 60)
    series: list[dict] = []
    for index in range(points):
        ts = now - timedelta(minutes=step * (points - 1 - index))
        wave = 1.0 + 0.18 * ((index % 7) - 3) / 3
        rpm = round(base_rpm * wave * rng.uniform(0.9, 1.1), 1)
        error_rate = round(max(rng.gauss(0.0005, 0.0003), 0.0), 5)
        p95 = round(rng.uniform(180, 340), 1)
        series.append({"ts": ts.isoformat(), "rpm": rpm, "error_rate": error_rate, "p95_ms": p95})
    return series


def signals(service: str, endpoints: list[str], window_minutes: int = 30, tier: int = 2) -> dict:
    """Golden signals for one service over the requested window."""
    sample_now(force=True)
    prefixes = _routes_for(endpoints, service)
    cutoff = time.time() - window_minutes * 60

    with _buffer_lock:
        window = [entry for entry in _buffer if entry[0] >= cutoff]
        if len(window) < 2 and len(_buffer) >= 2:
            window = list(_buffer)[-2:]
        entries = [(ts, _aggregate(snap, prefixes), in_flight) for ts, snap, in_flight in window]

    series: list[dict] = []
    for (prev_ts, prev_stats, _), (ts, stats, _) in zip(entries, entries[1:], strict=False):
        delta = stats.diff(prev_stats)
        elapsed_minutes = max((ts - prev_ts) / 60.0, 1 / 60)
        series.append(
            {
                "ts": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "rpm": round(delta.requests / elapsed_minutes, 1),
                "error_rate": round(delta.errors / delta.requests, 4) if delta.requests else 0.0,
                "p95_ms": round(_percentile_ms(delta, 0.95), 1),
            }
        )

    total = RouteStats()
    if entries:
        total = entries[-1][1].diff(entries[0][1])
    observed_requests = total.requests
    synthetic = observed_requests < 5 or len(series) < 2

    if synthetic:
        series = _synthetic_series(service, window_minutes, SERIES_POINTS)
        traffic_rpm = round(sum(point["rpm"] for point in series) / len(series), 1)
        error_rate = round(sum(point["error_rate"] for point in series) / len(series), 4)
        p95 = round(sum(point["p95_ms"] for point in series) / len(series), 1)
        p50, p99 = round(p95 * 0.45, 1), round(p95 * 1.6, 1)
    else:
        elapsed_minutes = max((entries[-1][0] - entries[0][0]) / 60.0, 1 / 60)
        traffic_rpm = round(observed_requests / elapsed_minutes, 1)
        error_rate = round(total.errors / observed_requests, 4) if observed_requests else 0.0
        p50 = round(_percentile_ms(total, 0.50), 1)
        p95 = round(_percentile_ms(total, 0.95), 1)
        p99 = round(_percentile_ms(total, 0.99), 1)
        series = series[-SERIES_POINTS:]

    capacity = SERVICE_CAPACITY_RPM.get(service, 600)
    saturation = min(traffic_rpm / capacity * 100.0, 100.0)
    active_chaos = chaos_state(chaos_target_for(service))
    if active_chaos:
        # An armed toggle is part of the picture the on-call engineer needs to see.
        if active_chaos["mode"] in {"latency", "timeout", "slow_query"}:
            p95 = round(p95 + active_chaos["magnitude"], 1)
            p99 = round(p99 + active_chaos["magnitude"] * 1.3, 1)
        if active_chaos["mode"] == "error":
            error_rate = round(min(error_rate + active_chaos["magnitude"] / 100.0, 1.0), 4)
        if active_chaos["mode"] == "saturation":
            saturation = min(saturation + active_chaos["magnitude"], 100.0)

    return {
        "service": service,
        "window_minutes": window_minutes,
        "traffic_rpm": traffic_rpm,
        "error_rate": error_rate,
        "latency_p50_ms": p50,
        "latency_p95_ms": p95,
        "latency_p99_ms": p99,
        "saturation_pct": round(saturation, 1),
        "synthetic": synthetic,
        "series": series,
        "tier": tier,
        "chaos": active_chaos,
    }


def chaos_target_for(service: str) -> str:
    """Map a registry service name onto the short chaos target other domains use."""
    return service.removesuffix("-api").removesuffix("-worker").replace("flights-search", "flights")


def health_for(service: str, signal: dict) -> str:
    if signal["error_rate"] >= 0.1 or signal["saturation_pct"] >= 95:
        return "down"
    if (
        signal["error_rate"] >= 0.01
        or signal["latency_p95_ms"] >= 800
        or (signal["saturation_pct"] >= 75)
    ):
        return "degraded"
    return "healthy"


def evaluate_slo(slo, signal: dict) -> tuple[float, str]:
    """Return ``(current_pct, status)`` for an SLO given the service's current signals."""
    if slo.kind == "availability":
        current = round((1.0 - signal["error_rate"]) * 100.0, 3)
    else:
        threshold = slo.threshold_ms or 800.0
        p95 = signal["latency_p95_ms"] or 1.0
        # Share of requests presumed inside the latency threshold.
        current = round(min(100.0, max(0.0, 100.0 * min(threshold / p95, 1.0))), 3)
    if current >= slo.objective_pct:
        status = "ok"
    elif current >= slo.objective_pct - (100.0 - slo.objective_pct):
        status = "at_risk"
    else:
        status = "breached"
    return current, status


def error_budget(slo, signal: dict) -> dict:
    current, status = evaluate_slo(slo, signal)
    allowed_failure = max(100.0 - slo.objective_pct, 0.001)
    actual_failure = max(100.0 - current, 0.0)
    budget_remaining = round(max(0.0, (1.0 - actual_failure / allowed_failure) * 100.0), 2)
    burn_1h = round(actual_failure / allowed_failure, 3)
    # 6h window smooths the instantaneous rate; the demo has no long-term store.
    burn_6h = round(burn_1h * 0.6, 3)
    return {
        "slo_id": slo.id,
        "objective": slo.objective_pct,
        "achieved": current,
        "budget_remaining_pct": budget_remaining,
        "burn_rate_1h": burn_1h,
        "burn_rate_6h": burn_6h,
        "status": status,
    }


SCENARIO_PATHS = {
    "steady": [
        "/healthz",
        "/readyz",
        "/api/flights/airports",
    ],
    "checkout_rush": [
        "/api/flights/airports",
        "/api/bookings",
        "/api/payments",
        "/healthz",
    ],
    "search_storm": [
        "/api/flights/search?origin=MAD&destination=JFK&date=2026-08-01&passengers=1",
        "/api/flights/airports",
        "/healthz",
    ],
}


def run_load(base_url: str, scenario: str, duration_seconds: int, rps: int) -> None:
    """Drive the app's own endpoints so the dashboards fill up. Runs in a background task."""
    import httpx

    paths = SCENARIO_PATHS.get(scenario, SCENARIO_PATHS["steady"])
    deadline = time.time() + duration_seconds
    sent = 0
    failures = 0
    record_domain_event("sre", f"load_{scenario}_started")
    with httpx.Client(base_url=base_url, timeout=5.0) as client:
        while time.time() < deadline:
            started = time.time()
            for index in range(rps):
                path = paths[(sent + index) % len(paths)]
                try:
                    client.get(path)
                except Exception:  # noqa: BLE001 - a failed synthetic request is itself signal
                    failures += 1
            sent += rps
            sample_now()
            time.sleep(max(0.0, 1.0 - (time.time() - started)))
    record_domain_event("sre", f"load_{scenario}_finished")
    log_event(
        logger,
        logging.INFO,
        "load generator finished",
        scenario=scenario,
        requests_sent=sent,
        failures=failures,
        duration_seconds=duration_seconds,
    )
