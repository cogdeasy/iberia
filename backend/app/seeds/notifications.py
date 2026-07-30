"""Idempotent seed data for the notifications domain.

Seeds a handful of recent passenger notifications (mixed channels/statuses) and two partner
webhooks so the ops console and the webhook panel are never empty.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notifications import Notification, Webhook
from app.services.notifications import render_template

ORDER = 100

_NOTIFICATIONS = [
    {
        "pnr": "YXR7K2",
        "channel": "email",
        "template": "delay_notice",
        "status": "sent",
        "ctx": {
            "passenger_name": "Lucía Fernández",
            "flight_number": "IB3162",
            "origin": "MAD",
            "destination": "JFK",
            "delay_minutes": "55",
        },
    },
    {
        "pnr": "YXR7K2",
        "channel": "push",
        "template": "boarding_reminder",
        "status": "sent",
        "ctx": {
            "passenger_name": "Lucía Fernández",
            "flight_number": "IB3162",
            "gate": "T4-K34",
            "seat": "22A",
        },
    },
    {
        "pnr": "QW9ZP1",
        "channel": "email",
        "template": "cancellation",
        "status": "sent",
        "ctx": {
            "passenger_name": "Marco Ortega",
            "flight_number": "IB6841",
            "origin": "MAD",
            "destination": "EZE",
        },
    },
    {
        "pnr": "QW9ZP1",
        "channel": "sms",
        "template": "delay_notice",
        "status": "failed",
        "ctx": {
            "passenger_name": "Marco Ortega",
            "flight_number": "IB6841",
            "delay_minutes": "120",
        },
    },
    {
        "pnr": "LM4TB8",
        "channel": "email",
        "template": "refund_confirmation",
        "status": "sent",
        "ctx": {"passenger_name": "Ana Ruiz", "amount_eur": "749.00", "pnr": "LM4TB8"},
    },
    {
        "pnr": "PZ2NX5",
        "channel": "push",
        "template": "boarding_reminder",
        "status": "queued",
        "ctx": {
            "passenger_name": "Diego Salas",
            "flight_number": "IB3041",
            "gate": "T4-B12",
            "seat": "9C",
        },
    },
]

_WEBHOOKS = [
    ("https://partner.iberia-demo.example/hooks/notifications", "notification.sent"),
    ("https://ops-bridge.iberia-demo.example/webhook", "notification.failed"),
]


def seed(db: Session) -> None:
    now = datetime.now(tz=timezone.utc)

    existing = db.scalar(select(Notification).limit(1))
    if existing is None:
        total = len(_NOTIFICATIONS)
        for offset, row in enumerate(_NOTIFICATIONS):
            status = row["status"]
            ctx = {**row["ctx"], "pnr": row["pnr"]}
            db.add(
                Notification(
                    pnr=row["pnr"],
                    channel=row["channel"],
                    template=row["template"],
                    status=status,
                    body=render_template(row["template"], ctx),
                    attempts=1 if status != "queued" else 0,
                    last_error="carrier rejected recipient" if status == "failed" else None,
                    created_at=now - timedelta(minutes=7 * (total - offset)),
                )
            )

    for url, event in _WEBHOOKS:
        if db.scalar(select(Webhook).where(Webhook.url == url)) is None:
            db.add(Webhook(url=url, event=event, active=True, last_status="registered"))

    db.commit()
