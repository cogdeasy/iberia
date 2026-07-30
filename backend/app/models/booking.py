from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.core import utcnow


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pnr: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    flight_id: Mapped[int] = mapped_column(ForeignKey("flights.id"), index=True)
    cabin: Mapped[str] = mapped_column(String(16), default="economy")
    status: Mapped[str] = mapped_column(String(16), default="confirmed")
    payment_status: Mapped[str] = mapped_column(String(16), default="unpaid")
    total_eur: Mapped[float] = mapped_column(Float, default=0.0)
    contact_email: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    passengers: Mapped[list["Passenger"]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", order_by="Passenger.id"
    )


class Passenger(Base):
    __tablename__ = "booking_passengers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id"), index=True)
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64))
    date_of_birth: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # NOTE(demo): passport numbers are persisted in clear text — see VULN-031
    document_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    seat: Mapped[str | None] = mapped_column(String(4), nullable=True)
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False)

    booking: Mapped["Booking"] = relationship(back_populates="passengers")
