"""Card authorisation and refunds for Iberia bookings."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user
from app.db import get_db
from app.models.core import User
from app.models.payments import Payment, Refund
from app.schemas.payments import (
    AuthoriseRequest,
    PaymentDebugOut,
    PaymentOut,
    RefundOut,
    RefundRequest,
)
from app.services.payments import (
    ProviderTimeout,
    booking_amount_eur,
    call_provider,
    detect_brand,
    fallback_amount_eur,
    load_booking,
    luhn_valid,
    mark_booking_paid,
    normalise_pan,
    unvault_pan,
    vault_pan,
)

router = APIRouter(prefix="/api/payments", tags=["payments"])
logger = logging.getLogger("iberia.payments")

PRIVILEGED_ROLES = ("agent", "ops", "admin")


@router.post("/authorise", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def authorise_payment(
    payload: AuthoriseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Payment:
    pan = normalise_pan(payload.card_number)
    if not luhn_valid(pan):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Card number is not valid")

    pnr = payload.pnr.upper()
    booking = load_booking(db, pnr)
    amount_eur = (booking_amount_eur(booking) if booking is not None else None) or (
        fallback_amount_eur(pnr)
    )

    try:
        result = call_provider(pnr, amount_eur)
    except ProviderTimeout as exc:
        record_domain_event("payments", "authorisation_failed")
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc)) from exc

    payment = Payment(
        pnr=pnr,
        user_id=user.id,
        status="authorised",
        amount_eur=amount_eur,
        card_holder=payload.card_holder,
        card_last4=pan[-4:],
        card_brand=detect_brand(pan),
        card_expiry=payload.expiry,
        # NOTE(demo): planted VULN-050 — full PAN retained under a reversible cipher.
        card_pan_vault=vault_pan(pan),
        provider_reference=result.reference,
        provider_latency_ms=result.latency_ms,
    )
    db.add(payment)

    if booking is not None and mark_booking_paid(booking):
        db.add(booking)

    db.commit()
    db.refresh(payment)

    record_domain_event("payments", "authorised")
    log_event(
        logging.getLogger("iberia.payments"),
        logging.INFO,
        "payment authorised",
        payment_id=payment.id,
        pnr=pnr,
        amount_eur=amount_eur,
        card_brand=payment.card_brand,
        card_last4=payment.card_last4,
        provider_reference=payment.provider_reference,
    )
    return payment


@router.get("", response_model=list[PaymentOut])
def list_payments(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[Payment]:
    statement = select(Payment).order_by(Payment.created_at.desc(), Payment.id.desc())
    if user.role not in PRIVILEGED_ROLES:
        statement = statement.where(Payment.user_id == user.id)
    return list(db.scalars(statement))


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Payment:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if payment.user_id != user.id and user.role not in PRIVILEGED_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your payment")
    return payment


@router.get("/{payment_id}/debug", response_model=PaymentDebugOut)
def debug_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> PaymentDebugOut:
    """Support view used by the contact centre to re-read a card on file.

    NOTE(demo): planted VULN-050 — the stored PAN is decrypted and returned, proving the
    "vault" is reversible. A tokenised design could only ever return the last four digits.
    """
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    record_domain_event("payments", "debug_view")
    log_event(
        logger,
        logging.WARNING,
        "payment debug view",
        payment_id=payment.id,
        actor=user.email,
        card_number=unvault_pan(payment.card_pan_vault),
    )
    return PaymentDebugOut(
        id=payment.id,
        pnr=payment.pnr,
        status=payment.status,
        amount_eur=payment.amount_eur,
        card_last4=payment.card_last4,
        card_brand=payment.card_brand,
        provider_reference=payment.provider_reference,
        created_at=payment.created_at,
        card_holder=payment.card_holder,
        card_expiry=payment.card_expiry,
        card_number=unvault_pan(payment.card_pan_vault),
        card_pan_vault=payment.card_pan_vault,
        provider_latency_ms=payment.provider_latency_ms,
    )


# NOTE(demo): planted VULN-052 — refunds accept any authenticated caller: there is no
# require_roles(...) dependency and no check that the payment belongs to the caller.
@router.post("/{payment_id}/refund", response_model=RefundOut, status_code=status.HTTP_201_CREATED)
def refund_payment(
    payment_id: int,
    payload: RefundRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Refund:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")

    refund = Refund(
        payment_id=payment.id,
        amount_eur=round(payload.amount_eur, 2),
        status="refunded",
        reason=payload.reason,
        requested_by=user.id,
    )
    db.add(refund)
    payment.status = "refunded" if refund.amount_eur >= payment.amount_eur else "part_refunded"
    db.add(payment)
    db.commit()
    db.refresh(refund)

    record_domain_event("payments", "refunded")
    log_event(
        logger,
        logging.INFO,
        "payment refunded",
        payment_id=payment.id,
        refund_id=refund.id,
        amount_eur=refund.amount_eur,
        actor=user.email,
        reason=refund.reason,
    )
    return refund


@router.get("/{payment_id}/refunds", response_model=list[RefundOut])
def list_refunds(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[Refund]:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if payment.user_id != user.id and user.role not in PRIVILEGED_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your payment")
    return list(
        db.scalars(select(Refund).where(Refund.payment_id == payment_id).order_by(Refund.id))
    )
