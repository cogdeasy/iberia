"""Optional demo payment so the payments console is never empty.

Idempotent: keyed on the provider reference.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.core import User
from app.models.payments import Payment
from app.services.payments import detect_brand, fallback_amount_eur, load_booking, vault_pan

ORDER = 40

DEMO_PNR = "IBDEMO"
DEMO_CARD = "4111111111111111"
DEMO_REFERENCE = "pay_demo000000001"


def seed(db: Session) -> None:
    if db.scalar(select(Payment).where(Payment.provider_reference == DEMO_REFERENCE)):
        return

    customer = db.scalar(select(User).where(User.email == "customer@iberia.demo"))
    if customer is None:
        return

    booking = load_booking(db, DEMO_PNR)
    pnr = getattr(booking, "pnr", None) or DEMO_PNR

    db.add(
        Payment(
            pnr=pnr,
            user_id=customer.id,
            status="authorised",
            amount_eur=fallback_amount_eur(pnr),
            card_holder=customer.full_name,
            card_last4=DEMO_CARD[-4:],
            card_brand=detect_brand(DEMO_CARD),
            card_expiry="12/29",
            card_pan_vault=vault_pan(DEMO_CARD),
            provider_reference=DEMO_REFERENCE,
            provider_latency_ms=42.0,
        )
    )
    db.commit()
