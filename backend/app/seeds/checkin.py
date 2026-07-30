"""Idempotent check-in seed data: reservations open for check-in plus sample documents."""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.checkin import CheckinPassenger, CheckinReservation
from app.services.checkin import documents_dir

ORDER = 50

RESERVATIONS = [
    {
        "pnr": "XK7T2P",
        "flight_number": "IB3166",
        "origin": "MAD",
        "destination": "LHR",
        "hours_from_now": 20,
        "cabin": "economy",
        "gate": "H12",
        "contact_email": "customer@iberia.demo",
        "owner_email": "customer@iberia.demo",
        "passengers": [
            ("Lucía", "Fernández", "passport", "ESP-PA4471902", "ESP", "12A"),
            ("Hugo", "Fernández", "passport", "ESP-PA4471903", "ESP", None),
        ],
    },
    {
        "pnr": "QR9B4L",
        "flight_number": "IB6251",
        "origin": "MAD",
        "destination": "JFK",
        "hours_from_now": 30,
        "cabin": "business",
        "gate": "U54",
        "contact_email": "frequent@iberia.demo",
        "owner_email": "frequent@iberia.demo",
        "passengers": [
            ("Marco", "Ortega", "passport", "ESP-PA8812440", "ESP", "2A"),
        ],
    },
    {
        "pnr": "ZD3M8V",
        "flight_number": "IB2711",
        "origin": "BCN",
        "destination": "MAD",
        "hours_from_now": 6,
        "cabin": "economy",
        "gate": "B23",
        "contact_email": "elena.navarro@example.demo",
        "owner_email": "agent@iberia.demo",
        "passengers": [
            ("Elena", "Navarro", "national_id", "ESP-DNI50294411", "ESP", None),
            ("Tomás", "Navarro", "passport", "ESP-PA7730118", "ESP", None),
        ],
    },
]

SAMPLE_DOCUMENTS = {
    "itinerary-XK7T2P.txt": """IBERIA — ELECTRONIC TICKET / ITINERARY RECEIPT
==============================================
Record locator : XK7T2P
Passengers     : FERNANDEZ/LUCIA, FERNANDEZ/HUGO
Flight         : IB3166  MAD -> LHR
Cabin          : Economy
Bag allowance  : 1 x 23 kg
Issued by      : Iberia Digital Platform (demo document store)
""",
    "itinerary-QR9B4L.txt": """IBERIA — ELECTRONIC TICKET / ITINERARY RECEIPT
==============================================
Record locator : QR9B4L
Passengers     : ORTEGA/MARCO
Flight         : IB6251  MAD -> JFK
Cabin          : Business
Bag allowance  : 2 x 32 kg
Issued by      : Iberia Digital Platform (demo document store)
""",
    "README.txt": """Generated travel documents are written here by the check-in service and served
through GET /api/checkin/documents/{filename}. Demo data only.
""",
}


def _seed_documents() -> None:
    target = documents_dir()
    for filename, body in SAMPLE_DOCUMENTS.items():
        path = target / filename
        if not path.exists():
            path.write_text(body, encoding="utf-8")


def seed(db: Session) -> None:
    base = datetime.utcnow().replace(minute=0, second=0, microsecond=0)

    for spec in RESERVATIONS:
        reservation = db.get(CheckinReservation, spec["pnr"])
        if reservation is None:
            reservation = CheckinReservation(
                pnr=spec["pnr"],
                flight_number=spec["flight_number"],
                origin=spec["origin"],
                destination=spec["destination"],
                scheduled_departure=base + timedelta(hours=spec["hours_from_now"]),
                cabin=spec["cabin"],
                gate=spec["gate"],
                contact_email=spec["contact_email"],
                owner_email=spec["owner_email"],
            )
            db.add(reservation)
            db.flush()

        existing = {(p.first_name, p.last_name) for p in reservation.passengers}
        for first, last, doc_type, doc_number, nationality, seat in spec["passengers"]:
            if (first, last) in existing:
                continue
            db.add(
                CheckinPassenger(
                    pnr=reservation.pnr,
                    first_name=first,
                    last_name=last,
                    document_type=doc_type,
                    document_number=doc_number,
                    nationality=nationality,
                    seat=seat,
                )
            )

    _seed_documents()
    db.commit()
