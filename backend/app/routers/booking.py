"""Booking & PNR API.

Creates passenger name records (PNRs), lists them, cancels them and manages seat
assignment. Emits ``booking`` domain events so the SRE console can chart checkout
traffic and failures (demo scenario S1 — checkout latency).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user
from app.db import get_db
from app.models.booking import Booking, Passenger
from app.models.core import Flight, User
from app.schemas.booking import (
    BookingCreate,
    BookingOut,
    PassengerOut,
    SeatAssignmentRequest,
    SeatMapOut,
)
from app.services import booking as booking_service

router = APIRouter(prefix="/api/bookings", tags=["booking"])
logger = logging.getLogger("iberia.booking")


def _serialise(db: Session, booking: Booking) -> BookingOut:
    flight = db.get(Flight, booking.flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Flight no longer exists")
    return BookingOut(
        pnr=booking.pnr,
        status=booking.status,
        flight=booking_service.flight_offer(db, flight, booking.cabin),
        passengers=[PassengerOut.model_validate(p) for p in booking.passengers],
        total_eur=booking.total_eur,
        payment_status=booking.payment_status,
        created_at=booking.created_at,
        contact_email=booking.contact_email,
    )


def _load(db: Session, pnr: str) -> Booking:
    booking = db.scalar(select(Booking).where(Booking.pnr == pnr.upper()))
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "PNR not found")
    return booking


@router.post("", response_model=BookingOut, status_code=status.HTTP_201_CREATED)
def create_booking(
    payload: BookingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> BookingOut:
    flight = db.get(Flight, payload.flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flight not found")
    if payload.cabin not in booking_service.CABIN_MULTIPLIER:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown cabin")

    quoted = booking_service.quote_total(flight, payload.cabin, len(payload.passengers))
    # NOTE(demo): planted VULN-032 — trust the client's total when it sends one
    total_eur = payload.total_eur if payload.total_eur is not None else quoted

    booking = Booking(
        pnr=booking_service.generate_pnr(db),
        user_id=user.id,
        flight_id=flight.id,
        cabin=payload.cabin,
        status="confirmed",
        payment_status="unpaid",
        total_eur=total_eur,
        contact_email=payload.contact_email,
        passengers=[
            Passenger(
                first_name=p.first_name,
                last_name=p.last_name,
                date_of_birth=p.date_of_birth,
                document_number=p.document_number,
            )
            for p in payload.passengers
        ],
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)

    record_domain_event("booking", "created")
    # NOTE(demo): planted VULN-031 — passport numbers written to the structured logs
    log_event(
        logger,
        logging.INFO,
        "booking created",
        pnr=booking.pnr,
        flight_number=flight.flight_number,
        cabin=booking.cabin,
        total_eur=booking.total_eur,
        quoted_eur=quoted,
        contact_email=booking.contact_email,
        passenger_documents=[p.document_number for p in booking.passengers],
    )
    return _serialise(db, booking)


@router.get("", response_model=list[BookingOut])
def list_bookings(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[BookingOut]:
    bookings = db.scalars(
        select(Booking).where(Booking.user_id == user.id).order_by(Booking.created_at.desc())
    ).all()
    record_domain_event("booking", "listed")
    return [_serialise(db, booking) for booking in bookings]


@router.get("/{pnr}", response_model=BookingOut)
def get_booking(
    pnr: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> BookingOut:
    booking = _load(db, pnr)
    # NOTE(demo): planted VULN-030 — retrieval by locator, ownership is never verified
    record_domain_event("booking", "retrieved")
    log_event(
        logger,
        logging.INFO,
        "booking retrieved",
        pnr=booking.pnr,
        actor=user.email,
        owner_id=booking.user_id,
    )
    return _serialise(db, booking)


@router.post("/{pnr}/cancel", response_model=BookingOut)
def cancel_booking(
    pnr: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> BookingOut:
    booking = _load(db, pnr)
    # NOTE(demo): planted VULN-030 — any authenticated caller may cancel any PNR
    if booking.status == "cancelled":
        return _serialise(db, booking)
    booking.status = "cancelled"
    if booking.payment_status == "paid":
        booking.payment_status = "refund_pending"
    for passenger in booking.passengers:
        passenger.seat = None
    db.commit()
    db.refresh(booking)

    record_domain_event("booking", "cancelled")
    log_event(logger, logging.INFO, "booking cancelled", pnr=booking.pnr, actor=user.email)
    return _serialise(db, booking)


@router.get("/{pnr}/seatmap", response_model=SeatMapOut)
def get_seatmap(
    pnr: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> SeatMapOut:
    booking = _load(db, pnr)
    flight = db.get(Flight, booking.flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Flight no longer exists")
    record_domain_event("booking", "seatmap_viewed")
    return booking_service.build_seatmap(db, flight)


@router.post("/{pnr}/seats", response_model=BookingOut)
def assign_seats(
    pnr: str,
    payload: SeatAssignmentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> BookingOut:
    booking = _load(db, pnr)
    if booking.user_id != user.id and user.role not in ("agent", "ops", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    if booking.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Booking is cancelled")

    by_id = {passenger.id: passenger for passenger in booking.passengers}
    occupied = booking_service.taken_seats(db, booking.flight_id) - {
        p.seat for p in booking.passengers if p.seat
    }
    for assignment in payload.assignments:
        passenger = by_id.get(assignment.passenger_id)
        if passenger is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f"Passenger {assignment.passenger_id} not on this PNR"
            )
        seat = assignment.seat.upper()
        if seat in occupied:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Seat {seat} is already taken")
        occupied.add(seat)
        passenger.seat = seat
    db.commit()
    db.refresh(booking)

    record_domain_event("booking", "seats_assigned")
    log_event(
        logger,
        logging.INFO,
        "seats assigned",
        pnr=booking.pnr,
        seats=[p.seat for p in booking.passengers],
    )
    return _serialise(db, booking)
