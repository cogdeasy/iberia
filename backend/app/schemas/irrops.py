from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

DisruptionKind = Literal["delay", "cancellation", "diversion"]


class FlightOffer(BaseModel):
    flight_id: int
    flight_number: str
    origin: str
    destination: str
    scheduled_departure: datetime
    scheduled_arrival: datetime
    duration_minutes: int
    cabin: str = "economy"
    fare_eur: float
    seats_available: int
    status: str


class DisruptionOut(BaseModel):
    id: int
    flight: FlightOffer
    kind: DisruptionKind
    minutes: int
    reason: str
    affected_passengers: int
    status: str
    created_at: datetime


class DisruptionCreate(BaseModel):
    flight_id: int
    kind: DisruptionKind
    minutes: int | None = Field(default=None, ge=0, le=2880)
    reason: str = Field(default="", max_length=255)


class RebookRequest(BaseModel):
    pnr: str = Field(min_length=4, max_length=8)


class RebookOut(BaseModel):
    pnr: str
    rebooked_to: FlightOffer
    compensation_eur: float
    # NOTE(demo): planted VULN-101 — full itinerary incl. passenger PII is returned to any
    # authenticated caller, regardless of who owns the PNR.
    booking: dict[str, Any] | None = None


class CompensationOut(BaseModel):
    pnr: str
    eligible: bool
    regulation: str
    amount_eur: float
    rationale: str
