"""Booking domain logic: PNR generation, pricing and seat maps."""

import random
import string

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.booking import Booking, Passenger
from app.models.core import Aircraft, Flight
from app.schemas.booking import FlightOffer, SeatMapOut, SeatOut, SeatRow

PNR_ALPHABET = string.ascii_uppercase.replace("I", "").replace("O", "") + "0123456789"

CABIN_MULTIPLIER: dict[str, float] = {
    "economy": 1.0,
    "premium_economy": 1.6,
    "business": 2.75,
    "first": 4.0,
}

DEFAULT_SEATS = {"economy": 180, "business": 24}
BUSINESS_SEAT_LETTERS = ("A", "C", "D", "F")
ECONOMY_SEAT_LETTERS = ("A", "B", "C", "D", "E", "F")
SEAT_FEE_EUR = {"business": 0.0, "economy": 12.0}
MAX_MAP_ROWS = 34


def cabin_multiplier(cabin: str) -> float:
    return CABIN_MULTIPLIER.get(cabin, 1.0)


def generate_pnr(db: Session, rng: random.Random | None = None) -> str:
    """Return an unused, realistic 6-character alphanumeric record locator."""
    source = rng or random
    for _ in range(50):
        pnr = "".join(source.choice(PNR_ALPHABET) for _ in range(6))
        if db.scalar(select(Booking).where(Booking.pnr == pnr)) is None:
            return pnr
    raise RuntimeError("could not allocate a unique PNR")


def cabin_capacity(flight: Flight, cabin: str) -> int:
    aircraft: Aircraft | None = flight.aircraft
    if aircraft is None:
        return DEFAULT_SEATS["business" if cabin == "business" else "economy"]
    return aircraft.seats_business if cabin == "business" else aircraft.seats_economy


def seats_sold(db: Session, flight_id: int, cabin: str) -> int:
    return (
        db.scalar(
            select(func.count(Passenger.id))
            .join(Booking, Passenger.booking_id == Booking.id)
            .where(
                Booking.flight_id == flight_id,
                Booking.cabin == cabin,
                Booking.status != "cancelled",
            )
        )
        or 0
    )


def fare_for(flight: Flight, cabin: str) -> float:
    return round(flight.base_fare_eur * cabin_multiplier(cabin), 2)


def quote_total(flight: Flight, cabin: str, passenger_count: int) -> float:
    return round(fare_for(flight, cabin) * passenger_count, 2)


def flight_offer(db: Session, flight: Flight, cabin: str) -> FlightOffer:
    duration = int((flight.scheduled_arrival - flight.scheduled_departure).total_seconds() // 60)
    available = max(cabin_capacity(flight, cabin) - seats_sold(db, flight.id, cabin), 0)
    return FlightOffer(
        flight_id=flight.id,
        flight_number=flight.flight_number,
        origin=flight.origin,
        destination=flight.destination,
        scheduled_departure=flight.scheduled_departure,
        scheduled_arrival=flight.scheduled_arrival,
        duration_minutes=duration,
        cabin=cabin,
        fare_eur=fare_for(flight, cabin),
        seats_available=available,
        status=flight.status,
    )


def taken_seats(db: Session, flight_id: int) -> set[str]:
    rows = db.execute(
        select(Passenger.seat)
        .join(Booking, Passenger.booking_id == Booking.id)
        .where(
            Booking.flight_id == flight_id,
            Booking.status != "cancelled",
            Passenger.seat.is_not(None),
        )
    ).all()
    return {row[0] for row in rows if row[0]}


def build_seatmap(db: Session, flight: Flight) -> SeatMapOut:
    """Business rows first (2-2), then economy (3-3), sized from the operating aircraft."""
    occupied = taken_seats(db, flight.id)
    business_rows = max(1, -(-cabin_capacity(flight, "business") // len(BUSINESS_SEAT_LETTERS)))
    economy_rows = max(1, -(-cabin_capacity(flight, "economy") // len(ECONOMY_SEAT_LETTERS)))
    rows: list[SeatRow] = []

    row_number = 1
    for _ in range(business_rows):
        rows.append(_row(row_number, "business", BUSINESS_SEAT_LETTERS, occupied))
        row_number += 1
    for _ in range(economy_rows):
        if len(rows) >= MAX_MAP_ROWS:
            break
        rows.append(_row(row_number, "economy", ECONOMY_SEAT_LETTERS, occupied))
        row_number += 1
    return SeatMapOut(rows=rows)


def _row(number: int, cabin: str, letters: tuple[str, ...], occupied: set[str]) -> SeatRow:
    return SeatRow(
        row=number,
        seats=[
            SeatOut(
                seat=f"{number}{letter}",
                cabin=cabin,
                available=f"{number}{letter}" not in occupied,
                price_eur=SEAT_FEE_EUR[cabin],
            )
            for letter in letters
        ],
    )
