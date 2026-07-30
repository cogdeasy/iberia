"""Deterministic audit-trail fixtures so the security console is never empty."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.security import AuditEvent

ORDER = 110
SEED_MARKER = "seed:security"

EVENTS = [
    ("admin@iberia.demo", "auth.login", "session", "success", "10.20.0.11", 240),
    ("sre@iberia.demo", "sre.chaos.enable", "booking-api/latency", "success", "10.20.0.31", 200),
    ("agent@iberia.demo", "booking.cancel", "PNR/QX7T2L", "success", "10.20.0.52", 160),
    ("customer@iberia.demo", "auth.login", "session", "failure", "88.24.10.7", 120),
    ("customer@iberia.demo", "auth.login", "session", "success", "88.24.10.7", 118),
    ("admin@iberia.demo", "users.role.update", "user/42 -> agent", "success", "10.20.0.11", 90),
    (
        "agent@iberia.demo",
        "security.audit.read",
        "/api/security/audit",
        "success",
        "10.20.0.52",
        45,
    ),
    ("customer@iberia.demo", "payments.refund", "PAY-10021", "denied", "88.24.10.7", 20),
]


def seed(db: Session) -> None:
    if db.scalar(select(AuditEvent).where(AuditEvent.request_id == SEED_MARKER)) is not None:
        return

    now = datetime.utcnow()
    for actor, action, target, outcome, ip, minutes_ago in EVENTS:
        db.add(
            AuditEvent(
                ts=now - timedelta(minutes=minutes_ago),
                actor=actor,
                action=action,
                target=target,
                outcome=outcome,
                ip=ip,
                request_id=SEED_MARKER,
            )
        )
    db.commit()
