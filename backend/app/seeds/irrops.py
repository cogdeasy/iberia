"""Idempotent irregular-operations seed data.

Creates three disruptions across a short-haul, a long-haul and a diverted sector so the ops
board and the EU261 calculator are never empty, plus standalone itineraries that let rebooking
be demoed before the booking workstream lands.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.core import Flight
from app.models.irrops import Disruption, StandaloneItinerary
from app.services.irrops import apply_disruption_to_flight, count_affected_passengers

ORDER = 30

# (route, kind, minutes, reason, status)
DISRUPTIONS = [
    (("MAD", "BCN"), "delay", 215, "Inbound aircraft rotation late out of BCN", "open"),
    (("MAD", "JFK"), "cancellation", 0, "Technical defect — hydraulic system 2", "open"),
    (("MAD", "LHR"), "diversion", 95, "Diverted to LGW for low visibility at LHR", "monitoring"),
]

# (pnr, route, cabin, seat, passenger, document, email, total_eur)
ITINERARIES = [
    (
        "IB7QK2",
        ("MAD", "BCN"),
        "economy",
        "14C",
        "Lucía Fernández",
        "ESP884213X",
        "customer@iberia.demo",
        129.0,
    ),
    (
        "IB3ZT9",
        ("MAD", "JFK"),
        "business",
        "2A",
        "Marco Ortega",
        "ESP771904K",
        "frequent@iberia.demo",
        2321.9,
    ),
    (
        "IB5WD4",
        ("MAD", "LHR"),
        "economy",
        "9F",
        "Sofía Márquez",
        "ESP559120B",
        "customer@iberia.demo",
        189.0,
    ),
]


def _earliest_flight(db: Session, origin: str, destination: str) -> Flight | None:
    return db.scalars(
        select(Flight)
        .where(Flight.origin == origin, Flight.destination == destination)
        .order_by(Flight.scheduled_departure, Flight.id)
        .limit(1)
    ).first()


def seed(db: Session) -> None:
    route_flights: dict[tuple[str, str], Flight] = {}
    for route, kind, minutes, reason, status in DISRUPTIONS:
        flight = _earliest_flight(db, *route)
        if flight is None:
            continue
        route_flights[route] = flight

        existing = db.scalar(
            select(Disruption).where(Disruption.flight_id == flight.id, Disruption.kind == kind)
        )
        if existing is not None:
            continue

        apply_disruption_to_flight(flight, kind, minutes)
        db.add(
            Disruption(
                flight_id=flight.id,
                kind=kind,
                minutes=minutes,
                reason=reason,
                affected_passengers=count_affected_passengers(db, flight),
                status=status,
                declared_by="ops@iberia.demo",
            )
        )
    db.flush()

    for pnr, route, cabin, seat, name, document, email, total in ITINERARIES:
        flight = route_flights.get(route) or _earliest_flight(db, *route)
        if flight is None or db.get(StandaloneItinerary, pnr) is not None:
            continue
        db.add(
            StandaloneItinerary(
                pnr=pnr,
                flight_id=flight.id,
                cabin=cabin,
                seat=seat,
                passenger_name=name,
                document_number=document,
                contact_email=email,
                total_eur=total,
            )
        )
    db.commit()
