import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.core import Aircraft, Airport, Flight, User

ORDER = 0
SEED = 42

AIRPORTS = [
    ("MAD", "Adolfo Suárez Madrid–Barajas", "Madrid", "Spain", "Europe/Madrid"),
    ("BCN", "Josep Tarradellas Barcelona–El Prat", "Barcelona", "Spain", "Europe/Madrid"),
    ("LHR", "London Heathrow", "London", "United Kingdom", "Europe/London"),
    ("JFK", "John F. Kennedy International", "New York", "United States", "America/New_York"),
    ("EZE", "Ministro Pistarini", "Buenos Aires", "Argentina", "America/Argentina/Buenos_Aires"),
    ("MEX", "Benito Juárez International", "Mexico City", "Mexico", "America/Mexico_City"),
    ("LIS", "Humberto Delgado", "Lisbon", "Portugal", "Europe/Lisbon"),
    ("CDG", "Paris Charles de Gaulle", "Paris", "France", "Europe/Paris"),
]

AIRCRAFT = [
    ("EC-MXV", "Airbus A320neo", 174, 12),
    ("EC-MYX", "Airbus A321neo", 200, 14),
    ("EC-NBE", "Airbus A350-900", 293, 31),
    ("EC-MIG", "Airbus A330-200", 254, 19),
]

USERS = [
    ("customer@iberia.demo", "Lucía Fernández", "customer", "IB1234567"),
    ("frequent@iberia.demo", "Marco Ortega", "customer", "IB7654321"),
    ("agent@iberia.demo", "Ana Ruiz", "agent", None),
    ("ops@iberia.demo", "Diego Salas", "ops", None),
    ("sre@iberia.demo", "Nuria Vidal", "sre", None),
    ("admin@iberia.demo", "Pablo Herrera", "admin", None),
]
DEMO_PASSWORD = "Iberia2026!"


def seed(db: Session) -> None:
    random.seed(SEED)

    for iata, name, city, country, tz in AIRPORTS:
        if db.get(Airport, iata) is None:
            db.add(Airport(iata=iata, name=name, city=city, country=country, timezone=tz))

    for registration, model, economy, business in AIRCRAFT:
        if db.get(Aircraft, registration) is None:
            db.add(
                Aircraft(
                    registration=registration,
                    model=model,
                    seats_economy=economy,
                    seats_business=business,
                )
            )

    for email, full_name, role, plus_number in USERS:
        if db.scalar(select(User).where(User.email == email)) is None:
            db.add(
                User(
                    email=email,
                    full_name=full_name,
                    role=role,
                    iberia_plus_number=plus_number,
                    password_hash=hash_password(DEMO_PASSWORD),
                )
            )
    db.flush()

    if db.scalar(select(Flight).limit(1)) is None:
        base = datetime.utcnow().replace(hour=6, minute=0, second=0, microsecond=0)
        routes = [
            ("MAD", "BCN", 80, 129.0),
            ("MAD", "LHR", 150, 189.0),
            ("MAD", "JFK", 480, 749.0),
            ("MAD", "EZE", 745, 899.0),
            ("BCN", "MAD", 80, 129.0),
            ("MAD", "MEX", 660, 829.0),
            ("MAD", "LIS", 85, 109.0),
            ("MAD", "CDG", 130, 159.0),
        ]
        number = 3000
        for day in range(14):
            for origin, destination, minutes, fare in routes:
                number += 1
                departure = base + timedelta(days=day, minutes=random.randint(0, 600))
                db.add(
                    Flight(
                        flight_number=f"IB{number % 9000 + 1000}",
                        origin=origin,
                        destination=destination,
                        scheduled_departure=departure,
                        scheduled_arrival=departure + timedelta(minutes=minutes),
                        aircraft_registration=random.choice(AIRCRAFT)[0],
                        base_fare_eur=fare,
                        status="scheduled",
                    )
                )
    db.commit()
