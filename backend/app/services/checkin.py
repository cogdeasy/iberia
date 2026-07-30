"""Check-in business logic: boarding-pass generation, bag pricing, document storage."""

import hashlib
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.checkin import Bag, BoardingPass, CheckinPassenger, CheckinReservation

#: Directory the airport document service writes generated boarding passes / itineraries to.
DOCUMENTS_DIR = Path(__file__).resolve().parents[1] / "documents"

BOARDING_LEAD_MINUTES = 40
HOLD_BAG_FEE_EUR = 25.0
EXCESS_KG_FEE_EUR = 15.0
FREE_ALLOWANCE_KG = 23.0

CABIN_CODE = {"economy": "Y", "premium_economy": "W", "business": "J", "first": "F"}
SEAT_LETTERS = "ACDF"


def documents_dir() -> Path:
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    return DOCUMENTS_DIR


def boarding_time_for(departure: datetime) -> datetime:
    return departure - timedelta(minutes=BOARDING_LEAD_MINUTES)


def next_sequence(db: Session, flight_number: str) -> int:
    used = db.scalar(
        select(func.count())
        .select_from(BoardingPass)
        .where(BoardingPass.flight_number == flight_number)
    )
    return int(used or 0) + 1


def allocate_seat(db: Session, reservation: CheckinReservation, sequence: int) -> str:
    """Deterministically pick a free seat when the passenger has no assignment yet."""
    taken = set(
        db.scalars(
            select(BoardingPass.seat).where(BoardingPass.flight_number == reservation.flight_number)
        ).all()
    )
    row = 10 if reservation.cabin == "economy" else 2
    for offset in range(sequence + 40):
        candidate = f"{row + offset // len(SEAT_LETTERS)}{SEAT_LETTERS[offset % len(SEAT_LETTERS)]}"
        if candidate not in taken:
            return candidate
    return f"{row + sequence}A"


def _bcbp_ascii(value: str) -> str:
    """BCBP barcodes are ASCII-only, so accents are transliterated away."""
    decomposed = unicodedata.normalize("NFKD", value)
    return decomposed.encode("ascii", "ignore").decode("ascii")


def build_barcode(
    passenger: CheckinPassenger, reservation: CheckinReservation, seat: str, sequence: int
) -> str:
    """IATA BCBP-style (M1) barcode string — good enough to render as a demo barcode."""
    raw_name = f"{passenger.last_name.upper()}/{passenger.first_name.upper()}"
    name = _bcbp_ascii(raw_name)[:20].ljust(20)
    julian = reservation.scheduled_departure.timetuple().tm_yday
    cabin = CABIN_CODE.get(reservation.cabin, "Y")
    flight = reservation.flight_number.replace("IB", "").rjust(4, "0")
    return (
        f"M1{name}E{reservation.pnr:<7}{reservation.origin}{reservation.destination}IB "
        f"{flight} {julian:03d}{cabin}{seat:>4}{sequence:04d} 100"
    )


def build_qr_payload(
    passenger: CheckinPassenger, reservation: CheckinReservation, seat: str, sequence: int
) -> str:
    # NOTE(demo): planted VULN-072 — the passport number is embedded in the scannable
    # payload, so it leaks anywhere the boarding pass is rendered, cached or logged.
    digest = hashlib.sha1(
        f"{reservation.pnr}{passenger.id}{sequence}".encode(), usedforsecurity=False
    ).hexdigest()[:10]
    return (
        f"IB|{reservation.pnr}|{reservation.flight_number}|{reservation.origin}"
        f"{reservation.destination}|{seat}|{sequence:04d}|{passenger.document_type.upper()}"
        f":{passenger.document_number}|{digest}"
    )


def write_boarding_pass_document(boarding: BoardingPass) -> str:
    """Render the boarding pass to the on-disk document store and return its filename."""
    filename = f"boarding-pass-{boarding.pnr}-{boarding.passenger_id}.txt"
    body = "\n".join(
        [
            "IBERIA — BOARDING PASS",
            "======================",
            f"Passenger      : {boarding.passenger_name}",
            f"PNR            : {boarding.pnr}",
            f"Flight         : {boarding.flight_number}  "
            f"{boarding.origin} -> {boarding.destination}",
            f"Boarding       : {boarding.boarding_time:%Y-%m-%d %H:%M} UTC",
            f"Gate / Seat    : {boarding.gate} / {boarding.seat}",
            f"Sequence       : {boarding.sequence:04d}",
            f"Document       : {boarding.document_number}",
            f"Barcode        : {boarding.barcode}",
            "",
        ]
    )
    (documents_dir() / filename).write_text(body, encoding="utf-8")
    return filename


def next_bag_tag(db: Session, pnr: str) -> str:
    used = db.scalar(select(func.count()).select_from(Bag))
    return f"IB{int(used or 0) + 600001:06d}"


def bag_fee_eur(weight_kg: float) -> float:
    if weight_kg <= 0:
        return 0.0
    fee = HOLD_BAG_FEE_EUR
    if weight_kg > FREE_ALLOWANCE_KG:
        fee += (weight_kg - FREE_ALLOWANCE_KG) * EXCESS_KG_FEE_EUR
    return round(fee, 2)
