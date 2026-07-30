"""Iberia Plus tier and Avios arithmetic.

Tiers are derived from tier points earned in the current membership year. Each tier
carries an accrual multiplier applied on top of the base Avios earned for a flight.
"""

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.models.core import User
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction

# (tier name, tier points required, accrual multiplier)
TIERS: list[tuple[str, int, float]] = [
    ("Clásica", 0, 1.0),
    ("Plata", 1_200, 1.25),
    ("Oro", 3_600, 1.5),
    ("Platino", 7_200, 2.0),
]

AVIOS_PER_EUR = 5
TIER_POINTS_PER_EUR = 0.1
REDEMPTION_AVIOS_PER_EUR = 100


def tier_for_points(tier_points: int) -> str:
    tier = TIERS[0][0]
    for name, threshold, _multiplier in TIERS:
        if tier_points >= threshold:
            tier = name
    return tier


def multiplier_for_tier(tier: str) -> float:
    for name, _threshold, multiplier in TIERS:
        if name == tier:
            return multiplier
    return 1.0


def next_tier(tier_points: int) -> tuple[str | None, int]:
    """Return the next tier name and the tier points still needed for it."""
    for name, threshold, _multiplier in TIERS:
        if tier_points < threshold:
            return name, threshold - tier_points
    return None, 0


def fare_for_pnr(db: Session, pnr: str) -> float:
    """Fare basis for an accrual.

    The booking domain owns the ``bookings`` table; when it is present we use the real
    ticketed amount, otherwise we fall back to a deterministic amount derived from the
    record locator so the loyalty demo works standalone.
    """
    if "bookings" in inspect(db.get_bind()).get_table_names():
        row = db.execute(
            text("SELECT total_eur FROM bookings WHERE pnr = :pnr"), {"pnr": pnr}
        ).first()
        if row is not None and row[0]:
            return float(row[0])
    return 120.0 + (sum(ord(character) for character in pnr) % 60) * 10.0


def account_for_user(db: Session, user: User) -> LoyaltyAccount | None:
    return db.scalar(select(LoyaltyAccount).where(LoyaltyAccount.user_id == user.id))


def post_transaction(
    db: Session,
    account: LoyaltyAccount,
    *,
    kind: str,
    description: str,
    avios: int,
    reference: str | None = None,
) -> LoyaltyTransaction:
    """Apply an Avios movement to an account and record the ledger entry."""
    account.avios_balance += avios
    transaction = LoyaltyTransaction(
        account_id=account.id,
        kind=kind,
        description=description,
        avios=avios,
        balance_after=account.avios_balance,
        reference=reference,
    )
    db.add(transaction)
    db.flush()
    return transaction


def member_payload(account: LoyaltyAccount) -> dict:
    return {
        "plus_number": account.plus_number,
        "full_name": account.user.full_name,
        "tier": tier_for_points(account.tier_points),
        "avios_balance": account.avios_balance,
        "tier_points": account.tier_points,
        "transactions": list(account.transactions),
    }
