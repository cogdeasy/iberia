from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FlightOffer(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    flight_id: int
    flight_number: str
    origin: str
    destination: str
    scheduled_departure: datetime
    scheduled_arrival: datetime
    duration_minutes: int
    cabin: str
    fare_eur: float
    seats_available: int
    status: str


class PassengerIn(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: str | None = None
    document_number: str | None = None


class PassengerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    seat: str | None = None
    checked_in: bool = False
    document_number: str | None = None


class BookingCreate(BaseModel):
    flight_id: int
    cabin: str = "economy"
    passengers: list[PassengerIn] = Field(min_length=1)
    contact_email: str
    # NOTE(demo): planted VULN-032 — client-supplied price override honoured verbatim
    total_eur: float | None = None


class BookingOut(BaseModel):
    pnr: str
    status: str
    flight: FlightOffer
    passengers: list[PassengerOut]
    total_eur: float
    payment_status: str
    created_at: datetime
    contact_email: str


class SeatOut(BaseModel):
    seat: str
    cabin: str
    available: bool
    price_eur: float


class SeatRow(BaseModel):
    row: int
    seats: list[SeatOut]


class SeatMapOut(BaseModel):
    rows: list[SeatRow]


class SeatAssignment(BaseModel):
    passenger_id: int
    seat: str


class SeatAssignmentRequest(BaseModel):
    assignments: list[SeatAssignment] = Field(min_length=1)
