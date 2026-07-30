from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.core import User, utcnow


class LoyaltyAccount(Base):
    """An Iberia Plus membership account."""

    __tablename__ = "loyalty_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    plus_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    avios_balance: Mapped[int] = mapped_column(Integer, default=0)
    tier_points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship()
    transactions: Mapped[list["LoyaltyTransaction"]] = relationship(
        back_populates="account", order_by="LoyaltyTransaction.id"
    )


class LoyaltyTransaction(Base):
    """A single Avios movement (accrual, redemption or transfer) on an account."""

    __tablename__ = "loyalty_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("loyalty_accounts.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24), default="accrual")
    description: Mapped[str] = mapped_column(String(255))
    avios: Mapped[int] = mapped_column(Integer, default=0)
    balance_after: Mapped[int] = mapped_column(Integer, default=0)
    reference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    account: Mapped[LoyaltyAccount] = relationship(back_populates="transactions")
