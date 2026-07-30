"""Notification delivery engine for the Iberia platform.

Owns three demo-worthy pieces:

* a small **template system** (delay notice, cancellation, boarding reminder, refund
  confirmation) rendered with passenger/flight context;
* an in-process **queue + simulated worker pool** with a dead-letter queue and retry, whose
  depth / worker saturation / DLQ are exported as Prometheus gauges;
* the plumbing for SRE scenario **S3** (queue saturation) via a ``saturation`` toggle.

The engine is deliberately process-local (no external broker) so the whole demo runs offline
on SQLite, exactly like the rest of the estate.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.core.observability import log_event, record_domain_event
from app.db import SessionLocal
from app.models.notifications import Notification

try:  # SRE chaos service is owned by another workstream; import defensively.
    from app.services.chaos import apply_chaos
except ImportError:  # pragma: no cover - chaos module may not be present yet

    def apply_chaos(target: str) -> None:  # noqa: D401 - no-op fallback
        return None


logger = logging.getLogger("iberia.notifications")

CHANNELS = ("email", "sms", "push")

# --------------------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Template:
    name: str
    subject: str
    channels: tuple[str, ...]
    body: str
    variables: tuple[str, ...]


TEMPLATES: dict[str, Template] = {
    "delay_notice": Template(
        name="delay_notice",
        subject="Your Iberia flight {flight_number} is delayed",
        channels=("email", "sms", "push"),
        body=(
            "Dear {passenger_name}, flight {flight_number} from {origin} to {destination} "
            "is delayed by {delay_minutes} minutes. New departure: {new_departure}. "
            "We apologise for the inconvenience. {custom_message}"
        ),
        variables=(
            "passenger_name",
            "flight_number",
            "origin",
            "destination",
            "delay_minutes",
            "new_departure",
            "custom_message",
        ),
    ),
    "cancellation": Template(
        name="cancellation",
        subject="Your Iberia flight {flight_number} has been cancelled",
        channels=("email", "sms", "push"),
        body=(
            "Dear {passenger_name}, we regret that flight {flight_number} ({origin}->"
            "{destination}) has been cancelled. Manage rebooking in Mi Iberia. "
            "{custom_message}"
        ),
        variables=(
            "passenger_name",
            "flight_number",
            "origin",
            "destination",
            "custom_message",
        ),
    ),
    "boarding_reminder": Template(
        name="boarding_reminder",
        subject="Boarding soon: {flight_number}",
        channels=("push", "sms"),
        body=(
            "Hola {passenger_name}, flight {flight_number} boards at {boarding_time} "
            "from gate {gate}. Seat {seat}. {custom_message}"
        ),
        variables=(
            "passenger_name",
            "flight_number",
            "boarding_time",
            "gate",
            "seat",
            "custom_message",
        ),
    ),
    "refund_confirmation": Template(
        name="refund_confirmation",
        subject="Refund confirmed for {pnr}",
        channels=("email",),
        body=(
            "Dear {passenger_name}, your refund of EUR {amount_eur} for booking {pnr} has "
            "been processed to your original payment method. {custom_message}"
        ),
        variables=("passenger_name", "amount_eur", "pnr", "custom_message"),
    ),
}


def default_context(pnr: str) -> dict[str, str]:
    return {
        "pnr": pnr,
        "passenger_name": "Iberia Plus Member",
        "flight_number": "IB3001",
        "origin": "MAD",
        "destination": "BCN",
        "delay_minutes": "45",
        "new_departure": "18:30",
        "boarding_time": "17:55",
        "gate": "B12",
        "seat": "14C",
        "amount_eur": "129.00",
        "custom_message": "",
    }


def render_template(template_name: str, context: dict[str, str]) -> str:
    template = TEMPLATES.get(template_name)
    if template is None:
        raise KeyError(template_name)
    # NOTE(demo): planted VULN-112 — passenger/agent-supplied context values are interpolated
    # straight into the notification body with no HTML/text escaping, and the rendered body is
    # returned verbatim in the API response (see routers/notifications.py::send).
    merged = default_context(context.get("pnr", "")) | {k: str(v) for k, v in context.items()}
    try:
        return template.body.format_map(_SafeDict(merged))
    except Exception as exc:  # pragma: no cover - formatting should not raise with SafeDict
        raise ValueError(f"template render failed: {exc}") from exc


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


# --------------------------------------------------------------------------------------
# Prometheus gauges (registered in this module only)
# --------------------------------------------------------------------------------------

from prometheus_client import Gauge  # noqa: E402  (kept beside the metric definitions)

QUEUE_DEPTH = Gauge(
    "iberia_notification_queue_depth",
    "Pending passenger notifications waiting to be delivered",
)
WORKERS_BUSY = Gauge(
    "iberia_notification_workers_busy",
    "Notification worker slots currently delivering",
)
DLQ_DEPTH = Gauge(
    "iberia_notification_dlq_depth",
    "Notifications parked in the dead-letter queue awaiting retry",
)


# --------------------------------------------------------------------------------------
# Queue + simulated worker pool
# --------------------------------------------------------------------------------------


@dataclass
class _QueueItem:
    notification_id: int
    enqueued_at: float = field(default_factory=time.monotonic)


class NotificationQueue:
    """A process-local queue with a fixed pool of simulated delivery workers.

    Under normal operation deliveries complete in milliseconds. When ``saturation`` is
    enabled (SRE scenario S3) every delivery is slow *and* fails, so items fall into the
    dead-letter queue and are re-enqueued by the retry loop faster than the workers can
    drain them — the classic unbounded-backlog + retry-storm failure mode.
    """

    def __init__(self, workers: int = 3) -> None:
        self._queue: deque[_QueueItem] = deque()
        self._dlq: deque[_QueueItem] = deque()
        self._lock = threading.Lock()
        self._num_workers = workers
        self._busy = 0
        self._started = False
        self._saturated = False
        self._retries_enabled = True
        self._processed = 0
        self._failed = 0
        self._history: deque[dict[str, float]] = deque(maxlen=120)

    # -- lifecycle -------------------------------------------------------------------
    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
        for _ in range(self._num_workers):
            threading.Thread(target=self._worker_loop, daemon=True).start()
        threading.Thread(target=self._retry_loop, daemon=True).start()
        threading.Thread(target=self._sampler_loop, daemon=True).start()

    # -- producers -------------------------------------------------------------------
    def enqueue(self, notification_id: int) -> None:
        # NOTE(demo): planted S3 sink — the queue is intentionally *unbounded* (no maxlen)
        # and there is no backpressure, so a burst or a retry storm grows depth without limit.
        with self._lock:
            self._queue.append(_QueueItem(notification_id))
        self._publish()

    def burst(self, notification_ids: list[int]) -> None:
        with self._lock:
            for nid in notification_ids:
                self._queue.append(_QueueItem(nid))
        self._publish()

    # -- controls (S3) ---------------------------------------------------------------
    def set_saturation(self, enabled: bool) -> None:
        with self._lock:
            self._saturated = enabled

    def set_retries(self, enabled: bool) -> None:
        with self._lock:
            self._retries_enabled = enabled

    def set_workers(self, workers: int) -> None:
        with self._lock:
            self._num_workers = max(1, workers)

    def drain(self) -> None:
        with self._lock:
            self._queue.clear()
            self._dlq.clear()
        self._publish()

    # -- introspection ---------------------------------------------------------------
    def snapshot(self) -> dict[str, float | int | bool]:
        with self._lock:
            depth = len(self._queue)
            dlq = len(self._dlq)
            busy = self._busy
            workers = self._num_workers
            oldest = 0.0
            if self._queue:
                oldest = time.monotonic() - self._queue[0].enqueued_at
            snap = {
                "depth": depth,
                "workers": workers,
                "workers_busy": busy,
                "oldest_age_seconds": round(oldest, 3),
                "dlq_depth": dlq,
                "saturated": self._saturated,
                "retries_enabled": self._retries_enabled,
                "processed_total": self._processed,
                "failed_total": self._failed,
            }
        self._publish_from(snap)
        return snap

    def history(self) -> list[dict[str, float]]:
        with self._lock:
            return list(self._history)

    # -- internals -------------------------------------------------------------------
    def _publish(self) -> None:
        self._publish_from(self.snapshot_unlocked())

    def snapshot_unlocked(self) -> dict[str, float | int | bool]:
        depth = len(self._queue)
        oldest = time.monotonic() - self._queue[0].enqueued_at if self._queue else 0.0
        return {
            "depth": depth,
            "workers_busy": self._busy,
            "dlq_depth": len(self._dlq),
            "oldest_age_seconds": round(oldest, 3),
        }

    def _publish_from(self, snap: dict[str, float | int | bool]) -> None:
        QUEUE_DEPTH.set(float(snap.get("depth", 0)))
        WORKERS_BUSY.set(float(snap.get("workers_busy", 0)))
        DLQ_DEPTH.set(float(snap.get("dlq_depth", 0)))

    def _worker_loop(self) -> None:
        while True:
            item = self._take()
            if item is None:
                time.sleep(0.02)
                continue
            with self._lock:
                self._busy += 1
                saturated = self._saturated
            self._publish()
            try:
                apply_chaos("notifications")
            except Exception:  # pragma: no cover - chaos must never crash the worker
                pass
            ok = self._deliver(item.notification_id, slow=saturated, fail=saturated)
            with self._lock:
                self._busy -= 1
                if ok:
                    self._processed += 1
                else:
                    self._failed += 1
                    self._dlq.append(item)
            self._publish()

    def _take(self) -> _QueueItem | None:
        with self._lock:
            if self._busy >= self._num_workers:
                return None
            if self._queue:
                return self._queue.popleft()
        return None

    def _deliver(self, notification_id: int, *, slow: bool, fail: bool) -> bool:
        time.sleep(1.0 if slow else 0.01)
        db = SessionLocal()
        try:
            note = db.get(Notification, notification_id)
            if note is None:
                return True
            note.attempts += 1
            if fail:
                note.status = "failed"
                note.last_error = "delivery timeout (provider saturated)"
                db.commit()
                log_event(
                    logger,
                    logging.WARNING,
                    "notification delivery failed",
                    notification_id=notification_id,
                    channel=note.channel,
                    attempts=note.attempts,
                )
                return False
            note.status = "sent"
            note.last_error = None
            db.commit()
            record_domain_event("notifications", "delivered")
            return True
        finally:
            db.close()

    def _retry_loop(self) -> None:
        while True:
            time.sleep(0.25)
            with self._lock:
                if not self._retries_enabled or not self._dlq:
                    continue
                # NOTE(demo): planted S3 sink — the DLQ is drained back onto the main queue
                # with no backoff and no max-retries cap, so failures amplify into a storm.
                requeued = list(self._dlq)
                self._dlq.clear()
                self._queue.extend(requeued)
            self._publish()

    def _sampler_loop(self) -> None:
        while True:
            snap = self.snapshot()
            with self._lock:
                self._history.append(
                    {
                        "ts": datetime.now(tz=timezone.utc).isoformat(),
                        "depth": float(snap["depth"]),
                        "workers_busy": float(snap["workers_busy"]),
                        "dlq_depth": float(snap["dlq_depth"]),
                        "oldest_age_seconds": float(snap["oldest_age_seconds"]),
                    }
                )
            time.sleep(1.0)


queue = NotificationQueue()
