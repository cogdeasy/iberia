"""Deterministic Iberia Plus fixtures.

``customer@iberia.demo`` is a Clásica member with a light history; ``frequent@iberia.demo``
is a Platino member with roughly fifteen ledger entries so the loyalty chart has shape.
Idempotent: accounts are keyed on the user's Iberia Plus number and transactions are only
created when the ledger is empty.
"""

import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.core import User
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction

ORDER = 60
SEED = 42

ROUTES = [
    ("IB3172", "MAD-BCN"),
    ("IB3170", "MAD-LHR"),
    ("IB6253", "MAD-JFK"),
    ("IB6841", "MAD-EZE"),
    ("IB6403", "MAD-MEX"),
    ("IB3108", "MAD-LIS"),
    ("IB3400", "MAD-CDG"),
]

MEMBERS = [
    # email, opening balance, tier points, number of history entries
    ("customer@iberia.demo", 4_800, 350, 4),
    ("frequent@iberia.demo", 186_500, 9_450, 15),
]


def _history(account: LoyaltyAccount, entries: int) -> list[LoyaltyTransaction]:
    """Build a deterministic ledger that ends on the account's current balance."""
    movements: list[tuple[str, str, int]] = []
    for index in range(entries):
        flight_number, route = ROUTES[index % len(ROUTES)]
        if index % 5 == 4:
            avios = -random.randrange(9, 26) * 500
            movements.append(("redemption", f"Redemption {flight_number} {route}", avios))
        else:
            avios = random.randrange(12, 60) * 125
            movements.append(("accrual", f"Flight accrual {flight_number} {route}", avios))

    net = sum(avios for _kind, _description, avios in movements)
    balance = account.avios_balance - net
    opened = datetime.utcnow() - timedelta(days=30 * entries)
    transactions = [
        LoyaltyTransaction(
            account_id=account.id,
            kind="adjustment",
            description="Opening balance migrated from legacy Iberia Plus",
            avios=balance,
            balance_after=balance,
            created_at=opened,
        )
    ]
    for index, (kind, description, avios) in enumerate(movements):
        balance += avios
        transactions.append(
            LoyaltyTransaction(
                account_id=account.id,
                kind=kind,
                description=description,
                avios=avios,
                balance_after=balance,
                reference=description.split()[1],
                created_at=opened + timedelta(days=30 * (index + 1)),
            )
        )
    return transactions


def seed(db: Session) -> None:
    random.seed(SEED)

    for email, balance, tier_points, entries in MEMBERS:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            continue
        plus_number = user.iberia_plus_number or f"IB{9_000_000 + user.id}"
        account = db.scalar(select(LoyaltyAccount).where(LoyaltyAccount.plus_number == plus_number))
        if account is None:
            account = LoyaltyAccount(
                user_id=user.id,
                plus_number=plus_number,
                avios_balance=balance,
                tier_points=tier_points,
            )
            db.add(account)
            db.flush()

        existing = db.scalar(
            select(LoyaltyTransaction).where(LoyaltyTransaction.account_id == account.id)
        )
        if existing is None:
            for transaction in _history(account, entries):
                db.add(transaction)

    db.commit()
