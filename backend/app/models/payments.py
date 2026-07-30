from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pnr: Mapped[str] = mapped_column(String(8), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="authorised")
    amount_eur: Mapped[float] = mapped_column(Float, default=0.0)
    card_holder: Mapped[str] = mapped_column(String(128), default="")
    card_last4: Mapped[str] = mapped_column(String(4), default="")
    card_brand: Mapped[str] = mapped_column(String(24), default="Unknown")
    card_expiry: Mapped[str] = mapped_column(String(7), default="")
    # NOTE(demo): planted VULN-050 — the full PAN is kept here under a reversible
    # "cipher" instead of being replaced by a provider token.
    card_pan_vault: Mapped[str] = mapped_column(String(255), default="")
    provider_reference: Mapped[str] = mapped_column(String(32), default="")
    provider_latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    refunds: Mapped[list["Refund"]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )

    @property
    def refunded_eur(self) -> float:
        return round(sum(refund.amount_eur for refund in self.refunds), 2)


class Refund(Base):
    __tablename__ = "payment_refunds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id"), index=True)
    amount_eur: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(24), default="refunded")
    reason: Mapped[str] = mapped_column(String(255), default="")
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    payment: Mapped["Payment"] = relationship(back_populates="refunds")
