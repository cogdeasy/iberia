from datetime import datetime

from pydantic import BaseModel


class Airport(BaseModel):
    iata: str
    name: str
    city: str
    country: str


class FlightOffer(BaseModel):
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


class AircraftInfo(BaseModel):
    registration: str
    model: str


class FlightDetail(FlightOffer):
    aircraft: AircraftInfo | None = None
    status_detail: str


class CabinAvailability(BaseModel):
    seats_available: int
    fare_eur: float


class FlightAvailability(BaseModel):
    flight_id: int
    cabins: dict[str, CabinAvailability]


class FlightSearchResults(BaseModel):
    results: list[FlightOffer]
    count: int
    query_ms: float
