"""Deterministic booking fixtures so the customer journey is never empty.

Runs after the core seeder (users, airports, flights) and after any flights-domain
seeder that may extend the schedule.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking, Passenger
from app.models.core import Flight, User
from app.services import booking as booking_service

ORDER = 20

FIXTURES = [
    {
        "pnr": "QX7T4M",
        "email": "customer@iberia.demo",
        "route": ("MAD", "JFK"),
        "cabin": "economy",
        "payment_status": "paid",
        "passengers": [
            ("Lucía", "Fernández", "1988-04-12", "PAX4471290", "14A"),
            ("Hugo", "Fernández", "2015-09-03", "PAX4471291", "14B"),
        ],
    },
    {
        "pnr": "RB2K9D",
        "email": "customer@iberia.demo",
        "route": ("MAD", "BCN"),
        "cabin": "economy",
        "payment_status": "unpaid",
        "passengers": [("Lucía", "Fernández", "1988-04-12", "PAX4471290", None)],
    },
    {
        "pnr": "ZL5V8P",
        "email": "frequent@iberia.demo",
        "route": ("MAD", "LHR"),
        "cabin": "business",
        "payment_status": "paid",
        "passengers": [("Marco", "Ortega", "1979-11-27", "PAX9930517", "2A")],
    },
    {
        "pnr": "HD3N6W",
        "email": "frequent@iberia.demo",
        "route": ("MAD", "MEX"),
        "cabin": "business",
        "payment_status": "unpaid",
        "passengers": [
            ("Marco", "Ortega", "1979-11-27", "PAX9930517", None),
            ("Elena", "Ortega", "1982-02-19", "PAX9930518", None),
        ],
    },
]


def _first_flight(db: Session, origin: str, destination: str) -> Flight | None:
    return db.scalar(
        select(Flight)
        .where(Flight.origin == origin, Flight.destination == destination)
        .order_by(Flight.scheduled_departure, Flight.id)
        .limit(1)
    )


def seed(db: Session) -> None:
    for fixture in FIXTURES:
        if db.scalar(select(Booking).where(Booking.pnr == fixture["pnr"])) is not None:
            continue
        user = db.scalar(select(User).where(User.email == fixture["email"]))
        flight = _first_flight(db, *fixture["route"])
        if user is None or flight is None:
            continue
        passengers = [
            Passenger(
                first_name=first,
                last_name=last,
                date_of_birth=dob,
                document_number=document,
                seat=seat,
            )
            for first, last, dob, document, seat in fixture["passengers"]
        ]
        db.add(
            Booking(
                pnr=fixture["pnr"],
                user_id=user.id,
                flight_id=flight.id,
                cabin=fixture["cabin"],
                status="confirmed",
                payment_status=fixture["payment_status"],
                total_eur=booking_service.quote_total(
                    flight, fixture["cabin"], len(fixture["passengers"])
                ),
                contact_email=fixture["email"],
                passengers=passengers,
            )
        )
    db.commit()
