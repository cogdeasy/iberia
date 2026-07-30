"""Check-in and travel-document tables.

The check-in domain keeps its own lightweight view of a reservation
(``checkin_reservations`` / ``checkin_passengers``) so that the airport journey can be
demonstrated end-to-end without coupling to another workstream's schema. Boarding passes
and bags are owned exclusively by this domain.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.core import utcnow


class CheckinReservation(Base):
    __tablename__ = "checkin_reservations"

    pnr: Mapped[str] = mapped_column(String(8), primary_key=True)
    flight_number: Mapped[str] = mapped_column(String(8), index=True)
    origin: Mapped[str] = mapped_column(String(3))
    destination: Mapped[str] = mapped_column(String(3))
    scheduled_departure: Mapped[datetime] = mapped_column(DateTime)
    cabin: Mapped[str] = mapped_column(String(16), default="economy")
    gate: Mapped[str] = mapped_column(String(8), default="A1")
    contact_email: Mapped[str] = mapped_column(String(255))
    owner_email: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    passengers: Mapped[list["CheckinPassenger"]] = relationship(
        back_populates="reservation", order_by="CheckinPassenger.id"
    )


class CheckinPassenger(Base):
    __tablename__ = "checkin_passengers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pnr: Mapped[str] = mapped_column(ForeignKey("checkin_reservations.pnr"), index=True)
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64))
    document_type: Mapped[str] = mapped_column(String(16), default="passport")
    document_number: Mapped[str] = mapped_column(String(32))
    nationality: Mapped[str] = mapped_column(String(3), default="ESP")
    seat: Mapped[str | None] = mapped_column(String(4), nullable=True)
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False)

    reservation: Mapped["CheckinReservation"] = relationship(back_populates="passengers")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class BoardingPass(Base):
    __tablename__ = "boarding_passes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pnr: Mapped[str] = mapped_column(String(8), index=True)
    passenger_id: Mapped[int] = mapped_column(
        ForeignKey("checkin_passengers.id"), unique=True, index=True
    )
    passenger_name: Mapped[str] = mapped_column(String(128))
    flight_number: Mapped[str] = mapped_column(String(8), index=True)
    origin: Mapped[str] = mapped_column(String(3))
    destination: Mapped[str] = mapped_column(String(3))
    boarding_time: Mapped[datetime] = mapped_column(DateTime)
    gate: Mapped[str] = mapped_column(String(8))
    seat: Mapped[str] = mapped_column(String(4))
    sequence: Mapped[int] = mapped_column(Integer)
    barcode: Mapped[str] = mapped_column(String(128))
    qr_payload: Mapped[str] = mapped_column(String(256))
    # NOTE(demo): planted VULN-072 — the travel document number is persisted on the
    # boarding pass and echoed back in the API payload.
    document_number: Mapped[str] = mapped_column(String(32))
    document_filename: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Bag(Base):
    __tablename__ = "bags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pnr: Mapped[str] = mapped_column(String(8), index=True)
    passenger_id: Mapped[int] = mapped_column(ForeignKey("checkin_passengers.id"), index=True)
    bag_tag: Mapped[str] = mapped_column(String(16), unique=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    fee_eur: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
