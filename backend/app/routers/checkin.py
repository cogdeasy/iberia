"""Check-in, boarding passes, bags and travel-document downloads.

Planted (intentional, documented) weaknesses in this module:
  * VULN-071 — IDOR on ``GET /api/checkin/{pnr}/boarding-pass/{passenger_id}``
  * VULN-072 — passport / travel-document numbers in responses and log lines
See ``docs/vulnerabilities/VULN-07*-*.md``.
"""

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user
from app.db import get_db
from app.models.checkin import Bag, BoardingPass, CheckinPassenger, CheckinReservation
from app.models.core import User
from app.schemas.checkin import (
    BagRequest,
    BagResponse,
    BoardingPassOut,
    CheckinRequest,
    CheckinResponse,
    ReservationOut,
)
from app.services.checkin import (
    allocate_seat,
    bag_fee_eur,
    boarding_time_for,
    build_barcode,
    build_qr_payload,
    documents_dir,
    next_bag_tag,
    next_sequence,
    write_boarding_pass_document,
)

router = APIRouter(prefix="/api/checkin", tags=["checkin"])
logger = logging.getLogger("iberia.checkin")


def _reservation(db: Session, pnr: str) -> CheckinReservation:
    reservation = db.get(CheckinReservation, pnr.upper())
    if reservation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No reservation for PNR {pnr}")
    return reservation


@router.get("/reservations", response_model=list[ReservationOut])
def list_reservations(
    db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[CheckinReservation]:
    """Reservations open for check-in. Agents, ops and admin see every PNR."""
    stmt = select(CheckinReservation).order_by(CheckinReservation.scheduled_departure)
    if user.role == "customer":
        stmt = stmt.where(CheckinReservation.owner_email == user.email)
    return list(db.scalars(stmt).all())


@router.get("/documents/{filename:path}")
def download_document(filename: str, user: User = Depends(current_user)) -> FileResponse:
    """Serve a generated boarding pass / itinerary from the document store."""
    root = documents_dir().resolve()
    not_found = HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if filename != os.path.basename(filename) or filename in {"", ".", ".."} or "\x00" in filename:
        raise not_found
    target = (root / filename).resolve()
    if target.parent != root or not target.is_file():
        raise not_found
    record_domain_event("checkin", "document_downloaded")
    log_event(
        logger,
        logging.INFO,
        "travel document served",
        actor=user.email,
        filename=filename,
        resolved_path=str(target),
    )
    return FileResponse(target, media_type="application/octet-stream")


@router.get("/{pnr}/passengers", response_model=ReservationOut)
def reservation_passengers(
    pnr: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> CheckinReservation:
    return _reservation(db, pnr)


@router.post("/{pnr}", response_model=CheckinResponse)
def check_in(
    pnr: str,
    payload: CheckinRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> CheckinResponse:
    """Check the requested passengers in and issue their boarding passes."""
    reservation = _reservation(db, pnr)
    requested = set(payload.passenger_ids)
    passengers = [p for p in reservation.passengers if not requested or p.id in requested]
    if not passengers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No matching passengers on this PNR")

    issued: list[BoardingPass] = []
    for passenger in passengers:
        existing = db.scalar(select(BoardingPass).where(BoardingPass.passenger_id == passenger.id))
        if existing is not None:
            issued.append(existing)
            continue

        sequence = next_sequence(db, reservation.flight_number)
        seat = passenger.seat or allocate_seat(db, reservation, sequence)
        boarding = BoardingPass(
            pnr=reservation.pnr,
            passenger_id=passenger.id,
            passenger_name=passenger.full_name,
            flight_number=reservation.flight_number,
            origin=reservation.origin,
            destination=reservation.destination,
            boarding_time=boarding_time_for(reservation.scheduled_departure),
            gate=reservation.gate,
            seat=seat,
            sequence=sequence,
            barcode=build_barcode(passenger, reservation, seat, sequence),
            qr_payload=build_qr_payload(passenger, reservation, seat, sequence),
            document_number=passenger.document_number,
        )
        db.add(boarding)
        db.flush()
        boarding.document_filename = write_boarding_pass_document(boarding)
        passenger.seat = seat
        passenger.checked_in = True
        issued.append(boarding)

        record_domain_event("checkin", "passenger_checked_in")
        # NOTE(demo): planted VULN-072 — passport number written to the structured log
        # stream, where it is retained by the log pipeline (CWE-532).
        log_event(
            logger,
            logging.INFO,
            "passenger checked in",
            actor=user.email,
            pnr=reservation.pnr,
            passenger_id=passenger.id,
            passenger_name=passenger.full_name,
            passport_number=passenger.document_number,
            seat=seat,
            sequence=sequence,
        )

    db.commit()
    for boarding in issued:
        db.refresh(boarding)
    return CheckinResponse(
        pnr=reservation.pnr,
        boarding_passes=[BoardingPassOut.model_validate(b) for b in issued],
    )


@router.get("/{pnr}/boarding-pass/{passenger_id}", response_model=BoardingPassOut)
def get_boarding_pass(
    pnr: str,
    passenger_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> BoardingPass:
    # NOTE(demo): planted VULN-071 — the PNR in the path is never checked against the
    # boarding pass or the caller, so any authenticated user can enumerate passenger_id
    # and read someone else's boarding pass, passport number included (CWE-639).
    boarding = db.scalar(select(BoardingPass).where(BoardingPass.passenger_id == passenger_id))
    if boarding is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"No boarding pass for passenger {passenger_id}"
        )
    record_domain_event("checkin", "boarding_pass_viewed")
    log_event(
        logger,
        logging.INFO,
        "boarding pass retrieved",
        actor=user.email,
        requested_pnr=pnr,
        boarding_pass_pnr=boarding.pnr,
        passenger_id=passenger_id,
    )
    return boarding


@router.post("/{pnr}/bags", response_model=BagResponse)
def add_bag(
    pnr: str,
    payload: BagRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> BagResponse:
    reservation = _reservation(db, pnr)
    passenger = db.get(CheckinPassenger, payload.passenger_id)
    if passenger is None or passenger.pnr != reservation.pnr:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passenger not on this PNR")
    if payload.weight_kg <= 0 or payload.weight_kg > 60:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "weight_kg must be between 0 and 60")

    bag = Bag(
        pnr=reservation.pnr,
        passenger_id=passenger.id,
        bag_tag=next_bag_tag(db, reservation.pnr),
        weight_kg=payload.weight_kg,
        fee_eur=bag_fee_eur(payload.weight_kg),
    )
    db.add(bag)
    db.commit()
    db.refresh(bag)

    record_domain_event("checkin", "bag_tagged")
    log_event(
        logger,
        logging.INFO,
        "bag accepted",
        actor=user.email,
        pnr=reservation.pnr,
        bag_tag=bag.bag_tag,
        weight_kg=bag.weight_kg,
        fee_eur=bag.fee_eur,
    )
    return BagResponse(
        bag_tag=bag.bag_tag,
        fee_eur=bag.fee_eur,
        weight_kg=bag.weight_kg,
        passenger_id=bag.passenger_id,
        pnr=bag.pnr,
    )
