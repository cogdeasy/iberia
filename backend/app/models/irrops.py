"""Irregular operations models: disruptions, rebooking events and a standalone itinerary.

``StandaloneItinerary`` exists purely so this workstream can be demoed and tested on its
own: the booking workstream owns the real ``bookings``/``passengers`` tables and this module
never imports them at import time. When the booking module is present, real bookings take
precedence and these rows act as extra demo data.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.core import Flight


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class Disruption(Base):
    __tablename__ = "irrops_disruptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    flight_id: Mapped[int] = mapped_column(ForeignKey("flights.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(String(255), default="")
    affected_passengers: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="open")
    declared_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    flight: Mapped[Flight] = relationship()


class RebookingEvent(Base):
    __tablename__ = "irrops_rebooking_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    disruption_id: Mapped[int] = mapped_column(ForeignKey("irrops_disruptions.id"), index=True)
    pnr: Mapped[str] = mapped_column(String(8), index=True)
    from_flight_id: Mapped[int] = mapped_column(ForeignKey("flights.id"))
    to_flight_id: Mapped[int] = mapped_column(ForeignKey("flights.id"))
    compensation_eur: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(24), default="standalone")
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StandaloneItinerary(Base):
    """Minimal itinerary used when the booking domain is not deployed."""

    __tablename__ = "irrops_standalone_itineraries"

    pnr: Mapped[str] = mapped_column(String(8), primary_key=True)
    flight_id: Mapped[int] = mapped_column(ForeignKey("flights.id"), index=True)
    cabin: Mapped[str] = mapped_column(String(16), default="economy")
    seat: Mapped[str | None] = mapped_column(String(4), nullable=True)
    passenger_name: Mapped[str] = mapped_column(String(128))
    document_number: Mapped[str] = mapped_column(String(32), default="")
    contact_email: Mapped[str] = mapped_column(String(255), default="")
    total_eur: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(24), default="confirmed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
