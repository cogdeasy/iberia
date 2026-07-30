from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="customer")
    iberia_plus_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Airport(Base):
    __tablename__ = "airports"

    iata: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    city: Mapped[str] = mapped_column(String(64))
    country: Mapped[str] = mapped_column(String(64))
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Madrid")


class Aircraft(Base):
    __tablename__ = "aircraft"

    registration: Mapped[str] = mapped_column(String(16), primary_key=True)
    model: Mapped[str] = mapped_column(String(64))
    seats_economy: Mapped[int] = mapped_column(Integer, default=180)
    seats_business: Mapped[int] = mapped_column(Integer, default=24)


class Flight(Base):
    __tablename__ = "flights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    flight_number: Mapped[str] = mapped_column(String(8), index=True)
    origin: Mapped[str] = mapped_column(ForeignKey("airports.iata"))
    destination: Mapped[str] = mapped_column(ForeignKey("airports.iata"))
    scheduled_departure: Mapped[datetime] = mapped_column(DateTime)
    scheduled_arrival: Mapped[datetime] = mapped_column(DateTime)
    aircraft_registration: Mapped[str | None] = mapped_column(
        ForeignKey("aircraft.registration"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(24), default="scheduled")
    base_fare_eur: Mapped[float] = mapped_column(Float, default=99.0)

    aircraft: Mapped["Aircraft | None"] = relationship()
