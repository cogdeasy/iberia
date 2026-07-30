from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.core import Flight


def _flight_id(db) -> int:
    flight = db.scalar(select(Flight).order_by(Flight.id).limit(1))
    assert flight is not None
    return flight.id


def _create(client: TestClient, headers: dict[str, str], flight_id: int, **extra) -> dict:
    payload = {
        "flight_id": flight_id,
        "cabin": "economy",
        "contact_email": "customer@iberia.demo",
        "passengers": [
            {
                "first_name": "Sara",
                "last_name": "Molina",
                "date_of_birth": "1990-01-01",
                "document_number": "PAX0001111",
            }
        ],
    }
    payload.update(extra)
    response = client.post("/api/bookings", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_booking_prices_from_the_fare(client, db, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    flight = db.scalar(select(Flight).order_by(Flight.id).limit(1))
    booking = _create(client, headers, flight.id)

    assert len(booking["pnr"]) == 6
    assert booking["pnr"].isalnum()
    assert booking["status"] == "confirmed"
    assert booking["payment_status"] == "unpaid"
    assert booking["total_eur"] == flight.base_fare_eur
    assert booking["flight"]["flight_id"] == flight.id
    assert booking["passengers"][0]["first_name"] == "Sara"


def test_create_booking_requires_auth(client, db):
    response = client.post(
        "/api/bookings",
        json={
            "flight_id": _flight_id(db),
            "cabin": "economy",
            "contact_email": "nobody@iberia.demo",
            "passengers": [{"first_name": "A", "last_name": "B"}],
        },
    )
    assert response.status_code == 401


def test_business_cabin_uses_multiplier(client, db, auth_headers):
    flight = db.scalar(select(Flight).order_by(Flight.id).limit(1))
    booking = _create(
        client,
        auth_headers("frequent@iberia.demo"),
        flight.id,
        cabin="business",
        passengers=[
            {"first_name": "Marco", "last_name": "Ortega"},
            {"first_name": "Elena", "last_name": "Ortega"},
        ],
    )
    assert booking["total_eur"] == round(flight.base_fare_eur * 2.75, 2) * 2


def test_list_returns_only_callers_bookings(client, db, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    created = _create(client, headers, _flight_id(db))

    mine = client.get("/api/bookings", headers=headers)
    assert mine.status_code == 200
    assert created["pnr"] in [item["pnr"] for item in mine.json()]

    others = client.get("/api/bookings", headers=auth_headers("frequent@iberia.demo"))
    assert created["pnr"] not in [item["pnr"] for item in others.json()]


def test_get_booking_by_pnr(client, db, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    created = _create(client, headers, _flight_id(db))

    response = client.get(f"/api/bookings/{created['pnr']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["pnr"] == created["pnr"]

    assert client.get("/api/bookings/NOPE99", headers=headers).status_code == 404


def test_seatmap_and_seat_assignment(client, db, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    created = _create(client, headers, _flight_id(db))

    seatmap = client.get(f"/api/bookings/{created['pnr']}/seatmap", headers=headers)
    assert seatmap.status_code == 200
    rows = seatmap.json()["rows"]
    assert rows and rows[0]["seats"]

    free = next(
        seat
        for row in rows
        for seat in row["seats"]
        if seat["available"] and seat["cabin"] == "economy"
    )
    assignment = {"passenger_id": created["passengers"][0]["id"], "seat": free["seat"]}
    assigned = client.post(
        f"/api/bookings/{created['pnr']}/seats",
        json={"assignments": [assignment]},
        headers=headers,
    )
    assert assigned.status_code == 200
    assert assigned.json()["passengers"][0]["seat"] == free["seat"]


def test_cancel_booking(client, db, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    created = _create(client, headers, _flight_id(db))

    response = client.post(f"/api/bookings/{created['pnr']}/cancel", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    # cancellation is idempotent
    again = client.post(f"/api/bookings/{created['pnr']}/cancel", headers=headers)
    assert again.status_code == 200
    assert again.json()["status"] == "cancelled"


def test_seeded_bookings_present(client, auth_headers):
    response = client.get("/api/bookings", headers=auth_headers("frequent@iberia.demo"))
    assert response.status_code == 200
    pnrs = [item["pnr"] for item in response.json()]
    assert "ZL5V8P" in pnrs
