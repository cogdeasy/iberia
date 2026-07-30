"""Reliability domain models: the service registry and the SLO catalogue.

Chaos toggles are deliberately *not* persisted — they live in-process in
``app.services.chaos`` so that request paths can consult them without a database
round-trip.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class Service(Base):
    __tablename__ = "sre_services"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    tier: Mapped[int] = mapped_column(Integer, default=2)
    owner: Mapped[str] = mapped_column(String(64), default="platform-sre")
    version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    # Comma-separated route prefixes owned by this service, e.g. "/api/bookings,/api/flights".
    endpoints_csv: Mapped[str] = mapped_column(String(512), default="")
    chaos_target: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def endpoints(self) -> list[str]:
        return [item for item in self.endpoints_csv.split(",") if item]


class Slo(Base):
    __tablename__ = "sre_slos"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    service: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), default="availability")
    objective_pct: Mapped[float] = mapped_column(Float, default=99.5)
    window_days: Mapped[int] = mapped_column(Integer, default=30)
    # Latency SLOs only: the threshold the p95 must stay under.
    threshold_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
