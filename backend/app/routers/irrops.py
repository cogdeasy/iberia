"""Irregular operations: disruption declaration, rebooking and EU261 compensation.

SRE demo scenario **S2** lives here: setting ``IBERIA_IRROPS_REBOOK_V2=1`` routes rebooking
through an unfinished "v2 seat retention" path that raises an unhandled exception, producing a
sustained HTTP 500 spike on ``POST /api/irrops/disruptions/{id}/rebook``.
See ``docs/demo/S2-rebooking-error-spike.md``.
"""

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import record_domain_event
from app.core.security import current_user
from app.db import get_db
from app.models.core import Flight, User
from app.models.irrops import Disruption, RebookingEvent
from app.schemas.irrops import (
    CompensationOut,
    DisruptionCreate,
    DisruptionOut,
    RebookOut,
    RebookRequest,
)
from app.services.irrops import (
    REGULATION,
    apply_disruption_to_flight,
    compute_compensation,
    count_affected_passengers,
    disruption_payload,
    find_next_flight,
    flight_offer,
    latest_disruption_for_flight,
    load_itinerary,
    log_irrops,
    move_itinerary,
)

router = APIRouter(prefix="/api/irrops", tags=["irrops"])

REBOOK_V2_FLAG = "IBERIA_IRROPS_REBOOK_V2"


def rebook_v2_enabled() -> bool:
    """Read the flag per request so the incident can be toggled during a live demo."""
    return os.getenv(REBOOK_V2_FLAG, "").strip() in {"1", "true", "yes", "on"}


@router.get("/disruptions", response_model=list[DisruptionOut])
def list_disruptions(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[dict]:
    query = select(Disruption).order_by(Disruption.created_at.desc(), Disruption.id.desc())
    if status_filter:
        query = query.where(Disruption.status == status_filter)
    disruptions = list(db.scalars(query))
    record_domain_event("irrops", "disruptions_listed")
    log_irrops(logging.INFO, "disruption board served", actor=user.email, count=len(disruptions))
    return [disruption_payload(db, d) for d in disruptions]


@router.post("/disruptions", response_model=DisruptionOut, status_code=status.HTTP_201_CREATED)
def declare_disruption(
    payload: DisruptionCreate,
    db: Session = Depends(get_db),
    # NOTE(demo): planted VULN-100 — this destructive operations action depends on
    # ``current_user`` only. It should be ``require_roles("ops", "admin")``, so today any
    # authenticated customer can delay, divert or cancel a live flight.
    user: User = Depends(current_user),
) -> dict:
    flight = db.get(Flight, payload.flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown flight")

    minutes = payload.minutes or 0
    if payload.kind == "delay" and minutes <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A delay needs minutes > 0")

    affected = count_affected_passengers(db, flight)
    apply_disruption_to_flight(flight, payload.kind, minutes)

    disruption = Disruption(
        flight_id=flight.id,
        kind=payload.kind,
        minutes=minutes,
        reason=payload.reason or f"{payload.kind} declared by operations",
        affected_passengers=affected,
        status="open",
        declared_by=user.email,
    )
    db.add(disruption)
    db.commit()
    db.refresh(disruption)

    record_domain_event("irrops", f"disruption_{payload.kind}")
    log_irrops(
        logging.WARNING,
        "disruption declared",
        actor=user.email,
        actor_role=user.role,
        disruption_id=disruption.id,
        flight_number=flight.flight_number,
        kind=payload.kind,
        minutes=minutes,
        affected_passengers=affected,
    )
    return disruption_payload(db, disruption)


@router.post("/disruptions/{disruption_id}/rebook", response_model=RebookOut)
def rebook(
    disruption_id: int,
    payload: RebookRequest,
    db: Session = Depends(get_db),
    # NOTE(demo): planted VULN-101 — no ownership check on the PNR and no agent/ops role
    # requirement, and the response echoes the full itinerary including passenger PII.
    user: User = Depends(current_user),
) -> dict:
    disruption = db.get(Disruption, disruption_id)
    if disruption is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown disruption")

    itinerary = load_itinerary(db, payload.pnr.upper())
    if itinerary is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown PNR")

    original = db.get(Flight, itinerary.flight_id)
    if original is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Itinerary has no flight to rebook from")

    replacement = find_next_flight(db, original)
    if replacement is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No alternative flight on this route")

    cabin = itinerary.cabin
    if rebook_v2_enabled():
        # v2 seat retention: carry the original cabin/seat assignment onto the new flight.
        # NOTE(demo): S2 error-spike path — ``cabin_class`` never existed on an itinerary,
        # so this raises AttributeError and the request returns HTTP 500.
        cabin = itinerary.cabin_class.code
        log_irrops(logging.INFO, "rebooking v2 seat retention", pnr=itinerary.pnr, cabin=cabin)

    move_itinerary(db, itinerary, replacement.id)

    _, compensation_eur, rationale = compute_compensation(
        disruption.kind, disruption.minutes, original.origin, original.destination
    )
    event = RebookingEvent(
        disruption_id=disruption.id,
        pnr=itinerary.pnr,
        from_flight_id=original.id,
        to_flight_id=replacement.id,
        compensation_eur=compensation_eur,
        source=itinerary.source,
        created_by=user.email,
    )
    db.add(event)
    disruption.status = "rebooking"
    db.commit()

    record_domain_event("irrops", "rebooked")
    log_irrops(
        logging.INFO,
        "pnr rebooked",
        actor=user.email,
        pnr=itinerary.pnr,
        disruption_id=disruption.id,
        from_flight=original.flight_number,
        to_flight=replacement.flight_number,
        compensation_eur=compensation_eur,
        rationale=rationale,
    )
    return {
        "pnr": itinerary.pnr,
        "rebooked_to": flight_offer(db, replacement, cabin),
        "compensation_eur": compensation_eur,
        "booking": itinerary.as_payload(),
    }


@router.get("/compensation/{pnr}", response_model=CompensationOut)
def compensation(
    pnr: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    itinerary = load_itinerary(db, pnr.upper())
    if itinerary is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown PNR")

    flight = db.get(Flight, itinerary.flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Itinerary has no flight")

    disruption = latest_disruption_for_flight(db, flight.id)
    if disruption is None:
        event = db.scalars(
            select(RebookingEvent)
            .where(RebookingEvent.pnr == itinerary.pnr)
            .order_by(RebookingEvent.id.desc())
            .limit(1)
        ).first()
        if event is not None:
            disruption = db.get(Disruption, event.disruption_id)

    if disruption is None:
        record_domain_event("irrops", "compensation_assessed")
        return {
            "pnr": itinerary.pnr,
            "eligible": False,
            "regulation": REGULATION,
            "amount_eur": 0.0,
            "rationale": (
                f"No disruption recorded against {flight.flight_number}; nothing is due under "
                f"{REGULATION}."
            ),
        }

    origin, destination = flight.origin, flight.destination
    if disruption.flight_id != flight.id:
        disrupted_flight = db.get(Flight, disruption.flight_id)
        if disrupted_flight is not None:
            origin, destination = disrupted_flight.origin, disrupted_flight.destination

    eligible, amount, rationale = compute_compensation(
        disruption.kind, disruption.minutes, origin, destination
    )
    record_domain_event("irrops", "compensation_assessed")
    log_irrops(
        logging.INFO,
        "compensation assessed",
        actor=user.email,
        pnr=itinerary.pnr,
        eligible=eligible,
        amount_eur=amount,
    )
    return {
        "pnr": itinerary.pnr,
        "eligible": eligible,
        "regulation": REGULATION,
        "amount_eur": amount,
        "rationale": rationale,
    }
