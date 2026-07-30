"""Historical incidents so the ops board is populated for the demo.

Idempotent: incidents are keyed on their ``reference``.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.incidents import Incident, IncidentTimelineEntry

ORDER = 90

# Anchored to "now" so the board always looks fresh, rounded to the hour for determinism.
NOW = datetime.utcnow().replace(minute=0, second=0, microsecond=0)


@dataclass(frozen=True)
class IncidentSpec:
    reference: str
    title: str
    severity: int
    status: str
    service: str
    summary: str
    commander: str
    started_at: datetime
    slo_impact: str | None = None
    runbook: str | None = None
    alert_name: str | None = None
    resolved_at: datetime | None = None
    resolution: str | None = None
    #: ``(minutes after start, kind, message, author)``
    timeline: tuple[tuple[int, str, str, str], ...] = field(default_factory=tuple)


INCIDENTS: list[IncidentSpec] = [
    IncidentSpec(
        reference="INC-2026-0001",
        title="Checkout p95 latency breach after payment provider timeout",
        severity=1,
        status="resolved",
        service="payments",
        summary=(
            "Card authorisation calls to the payment provider queued behind a 30 s socket "
            "timeout, pushing booking checkout p95 to 4.2 s and breaching the checkout "
            "latency SLO for 48 minutes."
        ),
        commander="Nuria Vidal",
        slo_impact="checkout-latency-p95: 41% of the 28-day error budget consumed",
        runbook="docs/runbooks/IberiaApiLatencyP95High.md",
        alert_name="IberiaApiLatencyP95High",
        started_at=NOW - timedelta(days=6, hours=3),
        resolved_at=NOW - timedelta(days=6, hours=2, minutes=12),
        resolution=(
            "Reduced the provider socket timeout to 3 s with a retry budget and shed load by "
            "disabling the non-critical fraud enrichment call. Provider recovered at 09:41."
        ),
        timeline=(
            (
                0,
                "detect",
                "IberiaApiLatencyP95High firing on payments (p95 4.2 s, threshold 800 ms)",
                "alertmanager",
            ),
            (
                4,
                "note",
                "Golden signals show traffic flat, errors flat, latency only on "
                "/api/payments/authorise — dependency, not load.",
                "Nuria Vidal",
            ),
            (
                9,
                "escalation",
                "Paged payments on-call; declared Sev1 as checkout conversion dropped 60%.",
                "Nuria Vidal",
            ),
            (
                17,
                "note",
                "Logs filtered by request_id 8f21ac show 30 s upstream socket timeout to "
                "the provider sandbox.",
                "Diego Salas",
            ),
            (
                26,
                "mitigation",
                "Socket timeout cut 30 s → 3 s and fraud enrichment feature-flagged off.",
                "Diego Salas",
            ),
            (
                39,
                "note",
                "p95 back to 620 ms, error budget burn rate below 1.",
                "Nuria Vidal",
            ),
            (
                48,
                "resolve",
                "Checkout healthy for 10 minutes; incident resolved, postmortem scheduled.",
                "Nuria Vidal",
            ),
        ),
    ),
    IncidentSpec(
        reference="INC-2026-0002",
        title="500 error spike on irregular-ops rebooking",
        severity=1,
        status="open",
        service="irrops",
        summary=(
            "Rebooking a passenger onto a cancelled long-haul returns HTTP 500 for roughly "
            "9% of attempts. Agents are falling back to manual rebooking in the GDS."
        ),
        commander="Diego Salas",
        slo_impact="irrops-availability: burn rate 6.4x, budget exhausted in ~11 h",
        runbook="docs/runbooks/IberiaApiHighErrorRate.md",
        alert_name="IberiaApiHighErrorRate",
        started_at=NOW - timedelta(hours=2, minutes=35),
        resolved_at=None,
        resolution=None,
        timeline=(
            (
                0,
                "detect",
                "IberiaApiHighErrorRate firing on irrops (5xx ratio 9.1%).",
                "alertmanager",
            ),
            (
                6,
                "note",
                "Errors isolated to POST /api/irrops/disruptions/{id}/rebook; other routes clean.",
                "Diego Salas",
            ),
            (
                14,
                "escalation",
                "Contact centre reporting agent workarounds; declared Sev1.",
                "Ana Ruiz",
            ),
            (
                21,
                "note",
                "Structured logs show an unhandled exception when no alternative flight "
                "exists within the rebooking window.",
                "Nuria Vidal",
            ),
        ),
    ),
    IncidentSpec(
        reference="INC-2026-0003",
        title="Notification queue backlog exhausting workers",
        severity=2,
        status="mitigated",
        service="notifications",
        summary=(
            "Departure-change SMS backlog grew to 14k messages after a worker leak; oldest "
            "message age reached 41 minutes so passengers were notified late."
        ),
        commander="Nuria Vidal",
        slo_impact="notification-freshness: 18% of budget consumed",
        runbook="docs/runbooks/IberiaNotificationBacklogGrowing.md",
        alert_name="IberiaNotificationBacklogGrowing",
        started_at=NOW - timedelta(days=1, hours=5),
        resolved_at=None,
        resolution=None,
        timeline=(
            (
                0,
                "detect",
                "Queue depth alert: 14,208 pending, oldest age 41 min.",
                "alertmanager",
            ),
            (
                12,
                "mitigation",
                "Scaled notification workers 4 → 12 and drained the DLQ.",
                "Nuria Vidal",
            ),
            (
                48,
                "note",
                "Backlog draining at ~600 msg/min; awaiting a permanent fix for the "
                "worker handle leak before resolving.",
                "Nuria Vidal",
            ),
        ),
    ),
    IncidentSpec(
        reference="INC-2026-0004",
        title="Seat map renders empty for A350 long-haul flights",
        severity=3,
        status="resolved",
        service="booking",
        summary="Seat map returned no rows for A350-900 cabins because of a stale cache key.",
        commander="Ana Ruiz",
        slo_impact="no SLO impact (cosmetic, workaround available)",
        runbook=None,
        alert_name=None,
        started_at=NOW - timedelta(days=12, hours=6),
        resolved_at=NOW - timedelta(days=12, hours=4),
        resolution="Invalidated the seatmap cache namespace and added a cache-key unit test.",
        timeline=(
            (0, "detect", "Customer report via contact centre; reproduced on IB6253.", "Ana Ruiz"),
            (35, "mitigation", "Cleared the seatmap cache namespace.", "Ana Ruiz"),
            (120, "resolve", "Seat maps rendering; regression test added.", "Ana Ruiz"),
        ),
    ),
]


def seed(db: Session) -> None:
    for spec in INCIDENTS:
        if db.scalar(select(Incident).where(Incident.reference == spec.reference)) is not None:
            continue

        incident = Incident(
            reference=spec.reference,
            title=spec.title,
            severity=spec.severity,
            status=spec.status,
            service=spec.service,
            summary=spec.summary,
            commander=spec.commander,
            resolution=spec.resolution,
            slo_impact=spec.slo_impact,
            runbook=spec.runbook,
            alert_name=spec.alert_name,
            started_at=spec.started_at,
            resolved_at=spec.resolved_at,
        )
        db.add(incident)
        db.flush()

        for offset_minutes, kind, message, author in spec.timeline:
            db.add(
                IncidentTimelineEntry(
                    incident_id=incident.id,
                    ts=spec.started_at + timedelta(minutes=offset_minutes),
                    kind=kind,
                    message=message,
                    author=author,
                )
            )
    db.commit()
