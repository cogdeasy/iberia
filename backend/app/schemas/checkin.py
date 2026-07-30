from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PassengerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    seat: str | None = None
    checked_in: bool
    document_number: str


class ReservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    pnr: str
    flight_number: str
    origin: str
    destination: str
    scheduled_departure: datetime
    cabin: str
    gate: str
    contact_email: str
    passengers: list[PassengerOut] = Field(default_factory=list)


class BoardingPassOut(BaseModel):
    """Frozen shape from ``docs/API_CONTRACTS.md`` (extra fields are additive only)."""

    model_config = ConfigDict(from_attributes=True)

    pnr: str
    passenger_id: int
    passenger_name: str
    flight_number: str
    origin: str
    destination: str
    boarding_time: datetime
    gate: str
    seat: str
    sequence: int
    barcode: str
    qr_payload: str
    # NOTE(demo): planted VULN-072 — passport / travel document number leaves the API.
    document_number: str
    document_filename: str = ""


class CheckinRequest(BaseModel):
    passenger_ids: list[int] = Field(default_factory=list)


class CheckinResponse(BaseModel):
    pnr: str
    boarding_passes: list[BoardingPassOut]


class BagRequest(BaseModel):
    passenger_id: int
    weight_kg: float


class BagResponse(BaseModel):
    bag_tag: str
    fee_eur: float
    weight_kg: float
    passenger_id: int
    pnr: str
