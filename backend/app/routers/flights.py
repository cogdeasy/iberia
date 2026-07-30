"""Flights & inventory: schedule search, fares and per-cabin availability.

Reads are public — the customer site has to price an itinerary before anyone logs in — but
every search still emits a domain event so the SRE dashboards can chart search traffic.
"""

import logging
import time
import traceback
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.db import get_db
from app.models.core import Airport as AirportModel
from app.models.core import Flight
from app.schemas.flights import (
    AircraftInfo,
    Airport,
    CabinAvailability,
    FlightAvailability,
    FlightDetail,
    FlightOffer,
    FlightSearchResults,
)
from app.services.flights import (
    CABIN_MULTIPLIERS,
    cabin_capacity,
    cabin_fare,
    duration_minutes,
    normalise_cabin,
    seats_available,
    status_detail,
)

router = APIRouter(prefix="/api/flights", tags=["flights"])
logger = logging.getLogger("iberia.flights")

SEARCH_LIMIT = 200

# Sort keys offered by the customer site; anything else is treated as a raw column
# expression so the ops team can order by an ad-hoc column during a disruption.
SORT_COLUMNS: dict[str, str] = {
    "departure": "f.scheduled_departure ASC",
    "arrival": "f.scheduled_arrival ASC",
    "fare": "f.base_fare_eur ASC",
    "fare_desc": "f.base_fare_eur DESC",
    "number": "f.flight_number ASC",
}

SEARCH_SQL = """
    SELECT f.id AS flight_id, f.flight_number, f.origin, f.destination,
           f.scheduled_departure, f.scheduled_arrival, f.status, f.base_fare_eur,
           a.registration, a.model, a.seats_economy, a.seats_business
    FROM flights f
    LEFT JOIN aircraft a ON a.registration = f.aircraft_registration
    WHERE {where_sql}
    ORDER BY {order_sql}
    LIMIT {limit}
"""


@router.get("/airports", response_model=list[Airport])
def list_airports(db: Session = Depends(get_db)) -> list[Airport]:
    """Airports served by the network, used to populate the search form."""
    airports = db.scalars(select(AirportModel).order_by(AirportModel.city)).all()
    record_domain_event("flights", "airports_listed")
    return [Airport(iata=a.iata, name=a.name, city=a.city, country=a.country) for a in airports]


@router.get("/search", response_model=FlightSearchResults)
def search_flights(
    origin: str | None = Query(default=None, description="Origin IATA code, e.g. MAD"),
    destination: str | None = Query(default=None, description="Destination IATA code"),
    date: str | None = Query(default=None, description="Departure date, YYYY-MM-DD"),
    passengers: int = Query(default=1, ge=1, le=9),
    cabin: str | None = Query(default=None, description="economy | premium_economy | business"),
    sort: str = Query(default="departure", description="departure | arrival | fare | number"),
    db: Session = Depends(get_db),
) -> FlightSearchResults:
    """Search the published schedule and price each leg for the requested cabin."""
    selected_cabin = normalise_cabin(cabin)
    started = time.perf_counter()
    sql = ""

    try:
        clauses: list[str] = ["1=1"]
        # NOTE(demo): planted VULN-020 — search filters are concatenated straight into the
        # statement below instead of being bound, so `MAD' OR '1'='1` alters the predicate.
        if origin:
            clauses.append(f"f.origin = '{origin}'")
        if destination:
            clauses.append(f"f.destination = '{destination}'")
        if date:
            departure_date = datetime.strptime(date, "%Y-%m-%d").date()
            clauses.append(f"date(f.scheduled_departure) = '{departure_date.isoformat()}'")

        # NOTE(demo): planted VULN-020 — unrecognised sort keys are used as a raw ORDER BY.
        order_sql = SORT_COLUMNS.get(sort, sort)
        sql = SEARCH_SQL.format(
            where_sql=" AND ".join(clauses), order_sql=order_sql, limit=SEARCH_LIMIT
        )
        rows = db.execute(text(sql)).mappings().all()
    except HTTPException:
        raise
    except Exception as exc:
        # NOTE(demo): planted VULN-021 — the raw exception, generated SQL and traceback are
        # returned to the caller to "help support diagnose failed searches".
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"flight search failed: {type(exc).__name__}: {exc}\n"
                f"query: {sql.strip()}\n"
                f"traceback: {traceback.format_exc()}"
            ),
        ) from exc

    offers: list[FlightOffer] = []
    for row in rows:
        capacity = cabin_capacity(
            selected_cabin, row["seats_economy"] or 0, row["seats_business"] or 0
        )
        available = seats_available(row["flight_id"], capacity)
        if available < passengers:
            continue
        departure = _as_datetime(row["scheduled_departure"])
        arrival = _as_datetime(row["scheduled_arrival"])
        offers.append(
            FlightOffer(
                flight_id=row["flight_id"],
                flight_number=row["flight_number"],
                origin=row["origin"],
                destination=row["destination"],
                scheduled_departure=departure,
                scheduled_arrival=arrival,
                duration_minutes=duration_minutes(departure, arrival),
                cabin=selected_cabin,
                fare_eur=cabin_fare(row["base_fare_eur"], selected_cabin),
                seats_available=available,
                status=row["status"],
            )
        )

    query_ms = round((time.perf_counter() - started) * 1000, 2)
    record_domain_event("flights", "search")
    log_event(
        logger,
        logging.INFO,
        "flight search executed",
        origin=origin,
        destination=destination,
        date=date,
        cabin=selected_cabin,
        passengers=passengers,
        results=len(offers),
        query_ms=query_ms,
    )
    return FlightSearchResults(results=offers, count=len(offers), query_ms=query_ms)


@router.get("/{flight_id}", response_model=FlightDetail)
def get_flight(
    flight_id: int,
    cabin: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> FlightDetail:
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flight not found")

    selected_cabin = normalise_cabin(cabin)
    aircraft = flight.aircraft
    capacity = cabin_capacity(
        selected_cabin,
        aircraft.seats_economy if aircraft else 0,
        aircraft.seats_business if aircraft else 0,
    )
    record_domain_event("flights", "detail_viewed")
    return FlightDetail(
        flight_id=flight.id,
        flight_number=flight.flight_number,
        origin=flight.origin,
        destination=flight.destination,
        scheduled_departure=flight.scheduled_departure,
        scheduled_arrival=flight.scheduled_arrival,
        duration_minutes=duration_minutes(flight.scheduled_departure, flight.scheduled_arrival),
        cabin=selected_cabin,
        fare_eur=cabin_fare(flight.base_fare_eur, selected_cabin),
        seats_available=seats_available(flight.id, capacity),
        status=flight.status,
        aircraft=(
            AircraftInfo(registration=aircraft.registration, model=aircraft.model)
            if aircraft
            else None
        ),
        status_detail=status_detail(flight.status),
    )


@router.get("/{flight_id}/availability", response_model=FlightAvailability)
def get_availability(flight_id: int, db: Session = Depends(get_db)) -> FlightAvailability:
    flight = db.get(Flight, flight_id)
    if flight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flight not found")

    aircraft = flight.aircraft
    economy_seats = aircraft.seats_economy if aircraft else 0
    business_seats = aircraft.seats_business if aircraft else 0

    cabins: dict[str, CabinAvailability] = {}
    for name in CABIN_MULTIPLIERS:
        capacity = cabin_capacity(name, economy_seats, business_seats)
        cabins[name] = CabinAvailability(
            seats_available=seats_available(flight.id, capacity),
            fare_eur=cabin_fare(flight.base_fare_eur, name),
        )

    record_domain_event("flights", "availability_checked")
    return FlightAvailability(flight_id=flight.id, cabins=cabins)


def _as_datetime(value: datetime | str) -> datetime:
    """Raw SQL returns SQLite datetimes as strings; the ORM path returns datetimes."""
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))
