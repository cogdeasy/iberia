"""Irregular-operations business logic: EU261 compensation, rebooking search, adapters.

The booking domain is owned by another workstream. Everything here reaches bookings through
:func:`load_itinerary`, which imports the booking models lazily inside a ``try/except
ImportError`` and degrades to this module's own ``StandaloneItinerary`` table, so irrops can
be demoed, tested and shipped independently.
"""

import logging
import math
import random
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event
from app.models.core import Aircraft, Flight
from app.models.irrops import Disruption, StandaloneItinerary

logger = logging.getLogger("iberia.irrops")

REGULATION = "EU 261/2004"
DELAY_THRESHOLD_MINUTES = 180
LONG_HAUL_REDUCED_THRESHOLD_MINUTES = 240

# Great-circle coordinates for the seeded airport set, used for the EU261 distance bands.
AIRPORT_COORDS: dict[str, tuple[float, float]] = {
    "MAD": (40.4936, -3.5668),
    "BCN": (41.2971, 2.0785),
    "LHR": (51.4700, -0.4543),
    "JFK": (40.6413, -73.7781),
    "EZE": (-34.8222, -58.5358),
    "MEX": (19.4363, -99.0721),
    "LIS": (38.7756, -9.1354),
    "CDG": (49.0097, 2.5479),
}
# Airports treated as inside the EU/EEA for the "intra-community" band rule.
INTRA_EU_AIRPORTS = {"MAD", "BCN", "LIS", "CDG"}


@dataclass
class PassengerView:
    id: int
    first_name: str
    last_name: str
    seat: str | None = None
    checked_in: bool = False
    document_number: str | None = None


@dataclass
class ItineraryView:
    """Normalised view over either a real booking or a standalone itinerary."""

    pnr: str
    flight_id: int
    cabin: str
    status: str
    contact_email: str
    total_eur: float
    source: str
    passengers: list[PassengerView] = field(default_factory=list)

    def as_payload(self) -> dict[str, Any]:
        return {
            "pnr": self.pnr,
            "status": self.status,
            "cabin": self.cabin,
            "flight_id": self.flight_id,
            "contact_email": self.contact_email,
            "total_eur": self.total_eur,
            "source": self.source,
            "passengers": [
                {
                    "id": p.id,
                    "first_name": p.first_name,
                    "last_name": p.last_name,
                    "seat": p.seat,
                    "checked_in": p.checked_in,
                    "document_number": p.document_number,
                }
                for p in self.passengers
            ],
        }


def haversine_km(origin: str, destination: str) -> float:
    start = AIRPORT_COORDS.get(origin)
    end = AIRPORT_COORDS.get(destination)
    if start is None or end is None:
        return 1000.0
    lat1, lon1 = math.radians(start[0]), math.radians(start[1])
    lat2, lon2 = math.radians(end[0]), math.radians(end[1])
    d_lat, d_lon = lat2 - lat1, lon2 - lon1
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return round(6371.0 * 2 * math.asin(math.sqrt(a)), 1)


def distance_band(distance_km: float, origin: str, destination: str) -> str:
    """EU261 distance bands: ``short`` (<=1500 km), ``medium`` (<=3500 km), ``long``."""
    if distance_km <= 1500:
        return "short"
    intra_eu = origin in INTRA_EU_AIRPORTS and destination in INTRA_EU_AIRPORTS
    if intra_eu or distance_km <= 3500:
        return "medium"
    return "long"


def compute_compensation(
    kind: str, minutes: int, origin: str, destination: str
) -> tuple[bool, float, str]:
    """Return ``(eligible, amount_eur, rationale)`` for an EU261 claim."""
    distance = haversine_km(origin, destination)
    band = distance_band(distance, origin, destination)
    band_amount = {"short": 250.0, "medium": 400.0, "long": 600.0}[band]
    delay = minutes if kind != "cancellation" else max(minutes, DELAY_THRESHOLD_MINUTES)

    if kind == "cancellation":
        return (
            True,
            band_amount,
            f"Cancellation on {origin}–{destination} ({distance} km, {band} band): "
            f"€{band_amount:.0f} due under {REGULATION} Art. 5 and Art. 7.",
        )

    if delay < DELAY_THRESHOLD_MINUTES:
        return (
            False,
            0.0,
            f"Arrival delay of {delay} min on {origin}–{destination} ({distance} km) is below "
            f"the {DELAY_THRESHOLD_MINUTES} min threshold in {REGULATION} Art. 7.",
        )

    if band == "long" and delay < LONG_HAUL_REDUCED_THRESHOLD_MINUTES:
        reduced = band_amount / 2
        return (
            True,
            reduced,
            f"Delay of {delay} min on a {distance} km {band}-haul sector: €{band_amount:.0f} "
            f"reduced by 50% to €{reduced:.0f} under {REGULATION} Art. 7(2)(c).",
        )

    return (
        True,
        band_amount,
        f"Delay of {delay} min on {origin}–{destination} ({distance} km, {band} band): "
        f"€{band_amount:.0f} due under {REGULATION} Art. 7.",
    )


def flight_offer(db: Session, flight: Flight, cabin: str = "economy") -> dict[str, Any]:
    aircraft = (
        db.get(Aircraft, flight.aircraft_registration) if flight.aircraft_registration else None
    )
    capacity = (
        (aircraft.seats_business if cabin == "business" else aircraft.seats_economy)
        if aircraft
        else 150
    )
    duration = int((flight.scheduled_arrival - flight.scheduled_departure).total_seconds() // 60)
    rng = random.Random(f"{flight.id}:{cabin}")
    seats_available = (
        0 if flight.status == "cancelled" else max(0, capacity - rng.randint(0, capacity - 1))
    )
    multiplier = 3.1 if cabin == "business" else 1.0
    return {
        "flight_id": flight.id,
        "flight_number": flight.flight_number,
        "origin": flight.origin,
        "destination": flight.destination,
        "scheduled_departure": flight.scheduled_departure,
        "scheduled_arrival": flight.scheduled_arrival,
        "duration_minutes": duration,
        "cabin": cabin,
        "fare_eur": round(flight.base_fare_eur * multiplier, 2),
        "seats_available": seats_available,
        "status": flight.status,
    }


def _real_booking_models() -> tuple[Any, Any] | None:
    """Import the booking workstream's models, or ``None`` when that domain is absent."""
    try:
        from app.models.booking import Booking, Passenger  # type: ignore[import-not-found]
    except ImportError:
        return None
    return Booking, Passenger


def load_itinerary(db: Session, pnr: str) -> ItineraryView | None:
    models = _real_booking_models()
    if models is not None:
        booking_model, passenger_model = models
        booking = db.scalar(select(booking_model).where(booking_model.pnr == pnr))
        if booking is not None:
            passengers = list(db.scalars(select(passenger_model).where(passenger_model.pnr == pnr)))
            return ItineraryView(
                pnr=booking.pnr,
                flight_id=booking.flight_id,
                cabin=getattr(booking, "cabin", "economy"),
                status=getattr(booking, "status", "confirmed"),
                contact_email=getattr(booking, "contact_email", ""),
                total_eur=float(getattr(booking, "total_eur", 0.0) or 0.0),
                source="booking",
                passengers=[
                    PassengerView(
                        id=p.id,
                        first_name=getattr(p, "first_name", ""),
                        last_name=getattr(p, "last_name", ""),
                        seat=getattr(p, "seat", None),
                        checked_in=bool(getattr(p, "checked_in", False)),
                        document_number=getattr(p, "document_number", None),
                    )
                    for p in passengers
                ],
            )

    itinerary = db.get(StandaloneItinerary, pnr)
    if itinerary is None:
        return None
    first, _, last = itinerary.passenger_name.partition(" ")
    return ItineraryView(
        pnr=itinerary.pnr,
        flight_id=itinerary.flight_id,
        cabin=itinerary.cabin,
        status=itinerary.status,
        contact_email=itinerary.contact_email,
        total_eur=itinerary.total_eur,
        source="standalone",
        passengers=[
            PassengerView(
                id=1,
                first_name=first,
                last_name=last or first,
                seat=itinerary.seat,
                document_number=itinerary.document_number,
            )
        ],
    )


def move_itinerary(db: Session, itinerary: ItineraryView, flight_id: int) -> None:
    """Persist the flight change on whichever store the itinerary came from."""
    if itinerary.source == "booking":
        models = _real_booking_models()
        if models is not None:
            booking_model, _ = models
            booking = db.scalar(select(booking_model).where(booking_model.pnr == itinerary.pnr))
            if booking is not None:
                booking.flight_id = flight_id
                booking.status = "rebooked"
        itinerary.flight_id = flight_id
        return

    row = db.get(StandaloneItinerary, itinerary.pnr)
    if row is not None:
        row.flight_id = flight_id
        row.status = "rebooked"
    itinerary.flight_id = flight_id


def count_affected_passengers(db: Session, flight: Flight) -> int:
    """Passengers booked on a flight, with a deterministic load estimate as a fallback."""
    total = 0
    models = _real_booking_models()
    if models is not None:
        booking_model, _ = models
        total += len(
            list(db.scalars(select(booking_model).where(booking_model.flight_id == flight.id)))
        )
    total += len(
        list(
            db.scalars(
                select(StandaloneItinerary).where(StandaloneItinerary.flight_id == flight.id)
            )
        )
    )
    if total:
        return total

    aircraft = (
        db.get(Aircraft, flight.aircraft_registration) if flight.aircraft_registration else None
    )
    capacity = aircraft.seats_economy if aircraft else 150
    rng = random.Random(f"load:{flight.id}")
    return int(capacity * rng.uniform(0.62, 0.94))


def find_next_flight(db: Session, flight: Flight) -> Flight | None:
    """Next scheduled departure on the same route after the disrupted one."""
    candidates = db.scalars(
        select(Flight)
        .where(
            Flight.origin == flight.origin,
            Flight.destination == flight.destination,
            Flight.id != flight.id,
            Flight.status.notin_(("cancelled", "diverted")),
            Flight.scheduled_departure >= flight.scheduled_departure,
        )
        .order_by(Flight.scheduled_departure)
        .limit(1)
    )
    nxt = candidates.first()
    if nxt is not None:
        return nxt
    # Fall back to any later scheduled flight on the route within the schedule horizon.
    return db.scalars(
        select(Flight)
        .where(
            Flight.origin == flight.origin,
            Flight.destination == flight.destination,
            Flight.id != flight.id,
            Flight.status == "scheduled",
            Flight.scheduled_departure >= flight.scheduled_departure - timedelta(days=1),
        )
        .order_by(Flight.scheduled_departure)
        .limit(1)
    ).first()


def apply_disruption_to_flight(flight: Flight, kind: str, minutes: int) -> None:
    if kind == "cancellation":
        flight.status = "cancelled"
    elif kind == "diversion":
        flight.status = "diverted"
    else:
        flight.status = "delayed"
        flight.scheduled_arrival = flight.scheduled_arrival + timedelta(minutes=minutes)


def disruption_payload(db: Session, disruption: Disruption) -> dict[str, Any]:
    flight = disruption.flight or db.get(Flight, disruption.flight_id)
    return {
        "id": disruption.id,
        "flight": flight_offer(db, flight),
        "kind": disruption.kind,
        "minutes": disruption.minutes,
        "reason": disruption.reason,
        "affected_passengers": disruption.affected_passengers,
        "status": disruption.status,
        "created_at": disruption.created_at,
    }


def latest_disruption_for_flight(db: Session, flight_id: int) -> Disruption | None:
    return db.scalars(
        select(Disruption)
        .where(Disruption.flight_id == flight_id)
        .order_by(Disruption.created_at.desc(), Disruption.id.desc())
        .limit(1)
    ).first()


def log_irrops(level: int, message: str, **fields: object) -> None:
    log_event(logger, level, message, domain="irrops", **fields)
