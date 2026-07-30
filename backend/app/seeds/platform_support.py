"""Deterministic fixtures for the support console (idempotent)."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.platform_support import SupportMessage

ORDER = 90

BASE_TS = datetime(2026, 7, 20, 9, 0, 0)

MESSAGES = [
    (
        "customer@iberia.demo",
        "Seat request for IB3170",
        "<p>Hola, could we have two seats together on the Madrid–Barcelona leg?</p>",
        "web",
        True,
    ),
    (
        "frequent@iberia.demo",
        "Avios missing for IB6253",
        "<p>My Iberia Plus account is missing the Avios for last week's JFK flight.</p>",
        "app",
        False,
    ),
    (
        "customer@iberia.demo",
        "Special assistance at MAD",
        "<p>I will need wheelchair assistance at Madrid on arrival. Thank you.</p>",
        "phone",
        False,
    ),
    (
        "frequent@iberia.demo",
        "Invoice for business trip",
        "<p>Please send a VAT invoice for booking <strong>QX7T2M</strong>.</p>",
        "web",
        True,
    ),
]


def seed(db: Session) -> None:
    for offset, (author, subject, body, channel, resolved) in enumerate(MESSAGES):
        existing = db.scalar(
            select(SupportMessage).where(
                SupportMessage.author_email == author,
                SupportMessage.subject == subject,
            )
        )
        if existing is not None:
            continue
        db.add(
            SupportMessage(
                author_email=author,
                subject=subject,
                body_html=body,
                channel=channel,
                resolved=resolved,
                created_at=BASE_TS + timedelta(hours=offset * 3),
            )
        )
    db.commit()
