import pytest
from sqlalchemy import select

from app.models.core import Flight
from app.models.irrops import Disruption, StandaloneItinerary
from app.services.irrops import compute_compensation, distance_band, haversine_km


def _scheduled_flight(db, origin: str = "MAD", destination: str = "CDG") -> Flight:
    flight = db.scalars(
        select(Flight)
        .where(
            Flight.origin == origin,
            Flight.destination == destination,
            Flight.status == "scheduled",
        )
        .order_by(Flight.scheduled_departure)
        .limit(1)
    ).first()
    assert flight is not None, f"no scheduled {origin}-{destination} flight seeded"
    return flight


def test_seeded_disruption_board(client, auth_headers, db):
    response = client.get("/api/irrops/disruptions", headers=auth_headers("ops@iberia.demo"))
    assert response.status_code == 200
    board = response.json()
    assert len(board) >= 3, "seeder must keep the ops board populated"

    kinds = {item["kind"] for item in board}
    assert {"delay", "cancellation", "diversion"} <= kinds
    for item in board:
        assert item["affected_passengers"] > 0
        assert item["flight"]["flight_number"].startswith("IB")
        assert item["flight"]["duration_minutes"] > 0
    assert db.scalar(select(Disruption).limit(1)) is not None


def test_disruptions_require_authentication(client):
    assert client.get("/api/irrops/disruptions").status_code == 401
    assert (
        client.post("/api/irrops/disruptions", json={"flight_id": 1, "kind": "delay"}).status_code
        == 401
    )


def test_declare_delay_updates_flight_and_counts_passengers(client, auth_headers, db):
    flight = _scheduled_flight(db, "MAD", "CDG")
    response = client.post(
        "/api/irrops/disruptions",
        headers=auth_headers("ops@iberia.demo"),
        json={"flight_id": flight.id, "kind": "delay", "minutes": 200, "reason": "ATC slot"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "delay"
    assert body["minutes"] == 200
    assert body["reason"] == "ATC slot"
    assert body["affected_passengers"] > 0
    assert body["flight"]["status"] == "delayed"

    db.expire_all()
    assert db.get(Flight, flight.id).status == "delayed"


def test_declare_disruption_rejects_unknown_flight_and_zero_delay(client, auth_headers, db):
    headers = auth_headers("ops@iberia.demo")
    assert (
        client.post(
            "/api/irrops/disruptions",
            headers=headers,
            json={"flight_id": 999999, "kind": "delay", "minutes": 60},
        ).status_code
        == 404
    )
    flight = _scheduled_flight(db, "MAD", "LIS")
    assert (
        client.post(
            "/api/irrops/disruptions",
            headers=headers,
            json={"flight_id": flight.id, "kind": "delay", "minutes": 0},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    ("kind", "minutes", "origin", "destination", "eligible", "amount"),
    [
        ("delay", 90, "MAD", "BCN", False, 0.0),
        ("delay", 215, "MAD", "BCN", True, 250.0),
        ("delay", 260, "MAD", "LHR", True, 250.0),
        ("delay", 300, "MAD", "MEX", True, 600.0),
        ("delay", 200, "MAD", "JFK", True, 300.0),
        ("cancellation", 0, "MAD", "JFK", True, 600.0),
        ("cancellation", 0, "MAD", "BCN", True, 250.0),
        ("diversion", 95, "MAD", "LHR", False, 0.0),
    ],
)
def test_eu261_bands(kind, minutes, origin, destination, eligible, amount):
    got_eligible, got_amount, rationale = compute_compensation(kind, minutes, origin, destination)
    assert (got_eligible, got_amount) == (eligible, amount)
    assert "EU 261/2004" in rationale


def test_distance_helpers():
    assert 450 < haversine_km("MAD", "BCN") < 550
    assert 5500 < haversine_km("MAD", "JFK") < 6000
    assert haversine_km("MAD", "ZZZ") == 1000.0
    assert distance_band(480.0, "MAD", "BCN") == "short"
    assert distance_band(2000.0, "MAD", "MEX") == "medium"
    assert distance_band(5760.0, "MAD", "JFK") == "long"


def test_compensation_endpoint_for_cancelled_long_haul(client, auth_headers):
    response = client.get(
        "/api/irrops/compensation/IB3ZT9", headers=auth_headers("frequent@iberia.demo")
    )
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "pnr": "IB3ZT9",
        "eligible": True,
        "regulation": "EU 261/2004",
        "amount_eur": 600.0,
        "rationale": body["rationale"],
    }
    assert "Cancellation" in body["rationale"]


def test_compensation_endpoint_unknown_pnr(client, auth_headers):
    response = client.get("/api/irrops/compensation/ZZZZZZ", headers=auth_headers())
    assert response.status_code == 404


def test_compensation_not_eligible_below_threshold(client, auth_headers, db):
    flight = _scheduled_flight(db, "MAD", "LIS")
    itinerary = StandaloneItinerary(
        pnr="IB0LIS1",
        flight_id=flight.id,
        cabin="economy",
        seat="12A",
        passenger_name="Test Passenger",
        document_number="ESP000001Z",
        contact_email="customer@iberia.demo",
        total_eur=109.0,
    )
    db.merge(itinerary)
    db.commit()

    created = client.post(
        "/api/irrops/disruptions",
        headers=auth_headers("ops@iberia.demo"),
        json={"flight_id": flight.id, "kind": "delay", "minutes": 45, "reason": "de-icing"},
    )
    assert created.status_code == 201

    response = client.get("/api/irrops/compensation/IB0LIS1", headers=auth_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["eligible"] is False
    assert body["amount_eur"] == 0.0
    assert "below" in body["rationale"]


def test_rebook_happy_path(client, auth_headers, db, monkeypatch):
    monkeypatch.delenv("IBERIA_IRROPS_REBOOK_V2", raising=False)

    disruption = db.scalars(
        select(Disruption).where(Disruption.kind == "cancellation").order_by(Disruption.id).limit(1)
    ).first()
    assert disruption is not None
    original_flight_id = db.get(StandaloneItinerary, "IB3ZT9").flight_id

    response = client.post(
        f"/api/irrops/disruptions/{disruption.id}/rebook",
        headers=auth_headers("agent@iberia.demo"),
        json={"pnr": "IB3ZT9"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["pnr"] == "IB3ZT9"
    assert body["compensation_eur"] == 600.0
    assert body["rebooked_to"]["flight_id"] != original_flight_id
    assert body["rebooked_to"]["origin"] == "MAD"
    assert body["rebooked_to"]["destination"] == "JFK"
    assert body["rebooked_to"]["status"] != "cancelled"

    db.expire_all()
    itinerary = db.get(StandaloneItinerary, "IB3ZT9")
    assert itinerary.flight_id == body["rebooked_to"]["flight_id"]
    assert itinerary.status == "rebooked"


def test_rebook_unknown_disruption_and_pnr(client, auth_headers, db):
    disruption = db.scalars(select(Disruption).order_by(Disruption.id).limit(1)).first()
    assert (
        client.post(
            "/api/irrops/disruptions/999999/rebook",
            headers=auth_headers("ops@iberia.demo"),
            json={"pnr": "IB7QK2"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/irrops/disruptions/{disruption.id}/rebook",
            headers=auth_headers("ops@iberia.demo"),
            json={"pnr": "NOPE01"},
        ).status_code
        == 404
    )


def test_vuln_100_customer_can_declare_disruption(client, auth_headers, db):
    """Planted VULN-100: missing function-level authorisation. Pins the demo behaviour."""
    flight = _scheduled_flight(db, "BCN", "MAD")
    response = client.post(
        "/api/irrops/disruptions",
        headers=auth_headers("customer@iberia.demo"),
        json={"flight_id": flight.id, "kind": "cancellation", "reason": "declared by a customer"},
    )
    assert response.status_code == 201
    assert response.json()["flight"]["status"] == "cancelled"


def test_vuln_101_rebook_leaks_other_passengers_pii(client, auth_headers, db):
    """Planted VULN-101: insecure direct object reference on rebooking."""
    disruption = db.scalars(
        select(Disruption).where(Disruption.kind == "delay").order_by(Disruption.id).limit(1)
    ).first()
    assert disruption is not None

    response = client.post(
        f"/api/irrops/disruptions/{disruption.id}/rebook",
        headers=auth_headers("customer@iberia.demo"),
        json={"pnr": "IB5WD4"},
    )
    assert response.status_code == 200
    booking = response.json()["booking"]
    assert booking["contact_email"]
    assert booking["passengers"][0]["document_number"]
