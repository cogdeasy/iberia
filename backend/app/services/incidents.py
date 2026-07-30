"""Incident lifecycle helpers: severity policy, references, alerts and postmortems.

Alerts are derived from the **live** Prometheus metric families exposed by
``app.core.observability`` so that the thresholds mirror the recording rules in
``ops/prometheus/rules/incidents-alerts.yml``. Active chaos experiments (owned by the
reliability workstream) are folded in when that module is present.
"""

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

from prometheus_client import REGISTRY
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.incidents import Incident, IncidentTimelineEntry, utcnow

# Sev0–Sev3 response expectations, shown on the incident board and in the postmortem.
SEVERITY_POLICY: dict[int, str] = {
    0: "Sev0 · total loss of a customer-facing journey — page duty manager, 5 min ack, "
    "comms every 15 min",
    1: "Sev1 · major degradation or SLO breach — page on-call, 10 min ack, comms every 30 min",
    2: "Sev2 · partial degradation, workaround exists — on-call during business hours, 1 h ack",
    3: "Sev3 · minor or cosmetic — next working day, tracked in the backlog",
}

ERROR_RATE_FIRING = 0.05
ERROR_RATE_PENDING = 0.02
LATENCY_P95_FIRING_SECONDS = 0.8
LATENCY_P95_PENDING_SECONDS = 0.5

ALERT_RUNBOOKS: dict[str, str] = {
    "IberiaApiHighErrorRate": "docs/runbooks/IberiaApiHighErrorRate.md",
    "IberiaApiLatencyP95High": "docs/runbooks/IberiaApiLatencyP95High.md",
    "IberiaChaosExperimentActive": "docs/runbooks/IberiaChaosExperimentActive.md",
}


def alert_time(minutes_ago: int = 0) -> datetime:
    return datetime.now(tz=timezone.utc) - timedelta(minutes=minutes_ago)


def severity_expectation(severity: int) -> str:
    return SEVERITY_POLICY.get(severity, SEVERITY_POLICY[3])


def next_reference(db: Session, when: datetime | None = None) -> str:
    """Allocate the next ``INC-<year>-<seq>`` reference."""
    year = (when or utcnow()).year
    prefix = f"INC-{year}-"
    existing = db.scalars(select(Incident.reference).where(Incident.reference.like(f"{prefix}%")))
    highest = 0
    for reference in existing:
        tail = reference.rsplit("-", 1)[-1]
        if tail.isdigit():
            highest = max(highest, int(tail))
    return f"{prefix}{highest + 1:04d}"


def duration_minutes(incident: Incident) -> int:
    started = (incident.started_at or utcnow()).replace(tzinfo=None)
    ended = (incident.resolved_at or utcnow()).replace(tzinfo=None)
    return max(0, int((ended - started).total_seconds() // 60))


def add_timeline_entry(
    db: Session, incident: Incident, kind: str, message: str, author: str
) -> IncidentTimelineEntry:
    entry = IncidentTimelineEntry(
        incident_id=incident.id,
        kind=kind,
        message=message,
        author=author,
    )
    db.add(entry)
    db.flush()
    return entry


# --------------------------------------------------------------------------- metrics


def _samples(sample_name: str) -> Iterable[tuple[dict[str, str], float]]:
    for metric in REGISTRY.collect():
        for sample in metric.samples:
            if sample.name == sample_name:
                yield sample.labels, sample.value


def http_error_rate() -> tuple[float, float]:
    """Return ``(error_rate, request_total)`` across every route since process start."""
    total = 0.0
    errors = 0.0
    for labels, value in _samples("iberia_http_requests_total"):
        total += value
        status = labels.get("status", "200")
        if status.startswith("5"):
            errors += value
    return (errors / total if total else 0.0), total


def http_latency_p95_seconds() -> float:
    """Approximate p95 latency by interpolating the shared HTTP latency histogram."""
    buckets: dict[float, float] = {}
    for labels, value in _samples("iberia_http_request_duration_seconds_bucket"):
        edge = labels.get("le", "+Inf")
        bound = float("inf") if edge in {"+Inf", "Inf"} else float(edge)
        buckets[bound] = buckets.get(bound, 0.0) + value
    if not buckets:
        return 0.0
    bounds = sorted(buckets)
    observations = buckets[bounds[-1]]
    if observations <= 0:
        return 0.0
    target = observations * 0.95
    previous_bound = 0.0
    previous_count = 0.0
    for bound in bounds:
        count = buckets[bound]
        if count >= target:
            if bound == float("inf"):
                return previous_bound
            span = count - previous_count
            if span <= 0:
                return bound
            ratio = (target - previous_count) / span
            return previous_bound + (bound - previous_bound) * ratio
        previous_bound = bound
        previous_count = count
    return bounds[-2] if len(bounds) > 1 else 0.0


def active_chaos_toggles() -> list[tuple[str, str]]:
    """``[(target, mode)]`` for active chaos experiments, or ``[]`` when unavailable.

    The reliability workstream owns ``app.services.chaos``; this module keeps working when
    that module is absent.
    """
    try:
        from app.services.chaos import list_toggles
    except ImportError:
        return []

    return [
        (str(toggle.get("target", "unknown")), str(toggle.get("mode", "unknown")))
        for toggle in list_toggles()
        if toggle.get("active", True)
    ]


def firing_alerts() -> list[dict[str, object]]:
    """Alert instances mirroring ``ops/prometheus/rules/incidents-alerts.yml``."""
    alerts: list[dict[str, object]] = []
    error_rate, requests_total = http_error_rate()
    p95 = http_latency_p95_seconds()

    if requests_total and error_rate >= ERROR_RATE_PENDING:
        firing = error_rate >= ERROR_RATE_FIRING
        alerts.append(
            {
                "name": "IberiaApiHighErrorRate",
                "severity": 1,
                "service": "iberia-api",
                "state": "firing" if firing else "pending",
                "since": alert_time(5 if firing else 1),
                "summary": (
                    f"HTTP 5xx ratio {error_rate * 100:.2f}% over "
                    f"{int(requests_total)} requests (threshold "
                    f"{ERROR_RATE_FIRING * 100:.0f}%)"
                ),
                "runbook": ALERT_RUNBOOKS["IberiaApiHighErrorRate"],
            }
        )

    if p95 >= LATENCY_P95_PENDING_SECONDS:
        firing = p95 >= LATENCY_P95_FIRING_SECONDS
        alerts.append(
            {
                "name": "IberiaApiLatencyP95High",
                "severity": 2,
                "service": "iberia-api",
                "state": "firing" if firing else "pending",
                "since": alert_time(10 if firing else 2),
                "summary": (
                    f"p95 latency {p95 * 1000:.0f} ms (threshold "
                    f"{LATENCY_P95_FIRING_SECONDS * 1000:.0f} ms)"
                ),
                "runbook": ALERT_RUNBOOKS["IberiaApiLatencyP95High"],
            }
        )

    for target, mode in active_chaos_toggles():
        alerts.append(
            {
                "name": "IberiaChaosExperimentActive",
                "severity": 3,
                "service": target,
                "state": "firing",
                "since": alert_time(0),
                "summary": f"Chaos experiment '{mode}' is active on {target}",
                "runbook": ALERT_RUNBOOKS["IberiaChaosExperimentActive"],
            }
        )

    return alerts


# ------------------------------------------------------------------------ postmortem


def _fmt(ts: datetime | None) -> str:
    return ts.strftime("%Y-%m-%d %H:%M UTC") if ts else "—"


def build_postmortem(incident: Incident) -> str:
    """Blameless postmortem skeleton pre-filled from the incident record."""
    timeline = sorted(incident.timeline, key=lambda entry: entry.ts)
    detection = next((entry for entry in timeline if entry.kind == "detect"), None)
    mitigations = [entry for entry in timeline if entry.kind == "mitigation"]

    timeline_rows = (
        "\n".join(
            f"| {_fmt(entry.ts)} | {entry.kind} | {entry.author} | {entry.message} |"
            for entry in timeline
        )
        or "| — | — | — | no timeline entries recorded |"
    )

    mitigation_lines = "\n".join(f"* {entry.message}" for entry in mitigations) or (
        "* _no mitigation recorded — describe what stopped the bleeding_"
    )

    # NOTE(demo): planted VULN-130 — timeline messages are interpolated into the postmortem
    # markdown (and returned to the ops console) with no HTML escaping.
    return f"""# Postmortem — {incident.reference}: {incident.title}

| Field | Value |
|-------|-------|
| Reference | {incident.reference} |
| Severity | Sev{incident.severity} |
| Status | {incident.status} |
| Service | {incident.service} |
| Commander | {incident.commander or "unassigned"} |
| Detected | {_fmt(detection.ts if detection else incident.started_at)} |
| Resolved | {_fmt(incident.resolved_at)} |
| Duration | {duration_minutes(incident)} minutes |
| Response expectation | {severity_expectation(incident.severity)} |

## Summary

{incident.summary or "_fill in a two-sentence narrative of what happened._"}

## Impact

* Customer-facing impact: _who could not book, check in or fly, and for how long._
* SLO impact: {incident.slo_impact or "_error budget consumed: TBD_"}
* Duration: {duration_minutes(incident)} minutes ({_fmt(incident.started_at)} → \
{_fmt(incident.resolved_at)}).

## Timeline

| Time | Kind | Author | Entry |
|------|------|--------|-------|
{timeline_rows}

## Detection

{
        f"Detected via **{incident.alert_name}** "
        f"(runbook `{incident.runbook or ALERT_RUNBOOKS.get(incident.alert_name or '', 'n/a')}`)."
        if incident.alert_name
        else "_How was this found? Alert, synthetic check or customer report?_"
    }

## Mitigation

{mitigation_lines}

## Resolution

{incident.resolution or "_what made the system healthy again, and how was it verified._"}

## Contributing factors (blameless)

1. _Trigger — the change or condition that started it._
2. _Amplifier — why the impact spread._
3. _Detection gap — why it took this long to notice._

## Action items

| # | Action | Type | Owner | Due |
|---|--------|------|-------|-----|
| 1 | Add or tighten an alert that would have caught this sooner | detect | {
        incident.commander or "TBD"
    } | +14d |
| 2 | Remove the failure mode at source (guardrail, timeout, retry budget) | prevent | TBD | +30d |
| 3 | Improve the runbook with what actually worked here | respond | TBD | +7d |
| 4 | Review the SLO/error budget policy for {incident.service} | measure | TBD | +30d |

## Lessons learned

* What went well:
* What was difficult:
* Where we got lucky:
"""
