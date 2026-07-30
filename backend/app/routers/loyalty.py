"""Iberia Plus loyalty API: membership, Avios accrual, redemption and transfers."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user
from app.db import get_db
from app.models.core import Flight, User
from app.models.loyalty import LoyaltyAccount
from app.schemas.loyalty import (
    AccrueRequest,
    AccrueResponse,
    Member,
    RedeemRequest,
    RedeemResponse,
    TransferRequest,
    TransferResponse,
)
from app.services.loyalty import (
    AVIOS_PER_EUR,
    TIER_POINTS_PER_EUR,
    account_for_user,
    fare_for_pnr,
    member_payload,
    multiplier_for_tier,
    post_transaction,
    tier_for_points,
)

router = APIRouter(prefix="/api/loyalty", tags=["loyalty"])
logger = logging.getLogger("iberia.loyalty")


def _own_account(db: Session, user: User) -> LoyaltyAccount:
    account = account_for_user(db, user)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No Iberia Plus account for this user")
    return account


@router.get("/me", response_model=Member)
def get_me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Member:
    account = _own_account(db, user)
    record_domain_event("loyalty", "member_viewed")
    return Member(**member_payload(account))


@router.get("/members/{plus_number}", response_model=Member)
def get_member(
    plus_number: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Member:
    # NOTE(demo): planted VULN-090 — any authenticated caller can read any membership.
    # Iberia Plus numbers are short and sequential, so the whole base is enumerable.
    account = db.scalar(select(LoyaltyAccount).where(LoyaltyAccount.plus_number == plus_number))
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown Iberia Plus number")
    record_domain_event("loyalty", "member_lookup")
    log_event(
        logger,
        logging.INFO,
        "loyalty member lookup",
        caller=user.email,
        plus_number=plus_number,
    )
    return Member(**member_payload(account))


@router.post("/accrue", response_model=AccrueResponse)
def accrue(
    payload: AccrueRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AccrueResponse:
    account = _own_account(db, user)
    fare_eur = fare_for_pnr(db, payload.pnr)
    tier = tier_for_points(account.tier_points)
    base_avios = int(fare_eur * AVIOS_PER_EUR)
    awarded = int(base_avios * multiplier_for_tier(tier))

    account.tier_points += int(fare_eur * TIER_POINTS_PER_EUR)
    post_transaction(
        db,
        account,
        kind="accrual",
        description=f"Flight accrual {payload.pnr} ({tier} x{multiplier_for_tier(tier)})",
        avios=awarded,
        reference=payload.pnr,
    )
    db.commit()

    record_domain_event("loyalty", "avios_accrued")
    log_event(
        logger,
        logging.INFO,
        "avios accrued",
        plus_number=account.plus_number,
        pnr=payload.pnr,
        avios=awarded,
        tier=tier,
    )
    return AccrueResponse(avios_awarded=awarded, balance=account.avios_balance)


@router.post("/redeem", response_model=RedeemResponse)
def redeem(
    payload: RedeemRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> RedeemResponse:
    account = _own_account(db, user)
    if payload.avios <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Avios must be positive")
    flight = db.get(Flight, payload.flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown flight")
    if account.avios_balance < payload.avios:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient Avios balance")

    transaction = post_transaction(
        db,
        account,
        kind="redemption",
        description=(f"Redemption {flight.flight_number} {flight.origin}-{flight.destination}"),
        avios=-payload.avios,
        reference=flight.flight_number,
    )
    db.commit()

    record_domain_event("loyalty", "avios_redeemed")
    log_event(
        logger,
        logging.INFO,
        "avios redeemed",
        plus_number=account.plus_number,
        flight_id=payload.flight_id,
        avios=payload.avios,
    )
    return RedeemResponse(balance=account.avios_balance, redemption_id=transaction.id)


@router.post("/transfer", response_model=TransferResponse)
def transfer(
    payload: TransferRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> TransferResponse:
    account = _own_account(db, user)
    target = db.scalar(
        select(LoyaltyAccount).where(LoyaltyAccount.plus_number == payload.to_plus_number)
    )
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown Iberia Plus number")
    if target.id == account.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot transfer to your own account")

    # NOTE(demo): planted VULN-091 — the amount is never checked for sign and the balance
    # test happens before two separate, non-atomic writes.
    if account.avios_balance < payload.avios:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient Avios balance")

    post_transaction(
        db,
        account,
        kind="transfer_out",
        description=f"Transfer to {target.plus_number}",
        avios=-payload.avios,
        reference=target.plus_number,
    )
    db.commit()

    post_transaction(
        db,
        target,
        kind="transfer_in",
        description=f"Transfer from {account.plus_number}",
        avios=payload.avios,
        reference=account.plus_number,
    )
    db.commit()

    record_domain_event("loyalty", "avios_transferred")
    log_event(
        logger,
        logging.INFO,
        "avios transferred",
        from_plus_number=account.plus_number,
        to_plus_number=target.plus_number,
        avios=payload.avios,
    )
    return TransferResponse(balance=account.avios_balance)
