"""Fare and inventory calculations for flight search.

Kept separate from the router so the pricing rules can be unit-tested and reused by the
booking workstream without importing FastAPI dependencies.
"""

from datetime import datetime

CABIN_MULTIPLIERS: dict[str, float] = {
    "economy": 1.0,
    "premium_economy": 1.6,
    "business": 2.5,
}
DEFAULT_CABIN = "economy"

STATUS_DETAIL: dict[str, str] = {
    "scheduled": "On time — departing as published",
    "delayed": "Delayed — see irregular operations for the revised time",
    "cancelled": "Cancelled — rebooking options available",
    "departed": "Departed",
    "arrived": "Arrived at destination",
}


def normalise_cabin(cabin: str | None) -> str:
    """Map a caller-supplied cabin onto a known cabin, defaulting to economy."""
    if cabin is None:
        return DEFAULT_CABIN
    candidate = cabin.strip().lower().replace("-", "_").replace(" ", "_")
    return candidate if candidate in CABIN_MULTIPLIERS else DEFAULT_CABIN


def cabin_fare(base_fare_eur: float, cabin: str) -> float:
    """Cabin-adjusted fare: business is ~2.5x the published economy base fare."""
    multiplier = CABIN_MULTIPLIERS.get(cabin, 1.0)
    return round(base_fare_eur * multiplier, 2)


def cabin_capacity(cabin: str, seats_economy: int, seats_business: int) -> int:
    if cabin == "business":
        return seats_business
    if cabin == "premium_economy":
        return max(seats_economy // 6, 1)
    return seats_economy


def seats_available(flight_id: int, capacity: int) -> int:
    """Deterministic remaining inventory so the demo dataset is stable across runs.

    Uses the flight id as the only input, which keeps `python seed.py` reproducible and
    means search results never change between two identical requests.
    """
    if capacity <= 0:
        return 0
    sold = (flight_id * 37) % max(int(capacity * 0.85), 1)
    return max(capacity - sold, 0)


def duration_minutes(departure: datetime, arrival: datetime) -> int:
    return max(int((arrival - departure).total_seconds() // 60), 0)


def status_detail(status: str) -> str:
    return STATUS_DETAIL.get(status, f"Status: {status}")
