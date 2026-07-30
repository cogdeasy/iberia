from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.core import Flight


def _any_flight(db) -> Flight:
    flight = db.scalar(select(Flight).order_by(Flight.id))
    assert flight is not None, "core seeder should have created flights"
    return flight


def test_airports_returns_seeded_network(client: TestClient) -> None:
    response = client.get("/api/flights/airports")
    assert response.status_code == 200
    airports = response.json()
    assert len(airports) == 8
    codes = {a["iata"] for a in airports}
    assert {"MAD", "BCN", "JFK"} <= codes
    assert set(airports[0]) == {"iata", "name", "city", "country"}


def test_search_returns_offers_for_a_seeded_route(client: TestClient) -> None:
    response = client.get("/api/flights/search", params={"origin": "MAD", "destination": "BCN"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == len(body["results"])
    assert body["count"] > 0
    assert body["query_ms"] >= 0

    offer = body["results"][0]
    assert set(offer) == {
        "flight_id",
        "flight_number",
        "origin",
        "destination",
        "scheduled_departure",
        "scheduled_arrival",
        "duration_minutes",
        "cabin",
        "fare_eur",
        "seats_available",
        "status",
    }
    assert offer["origin"] == "MAD"
    assert offer["destination"] == "BCN"
    assert offer["cabin"] == "economy"
    assert offer["duration_minutes"] > 0
    assert offer["seats_available"] >= 1


def test_search_is_public_and_needs_no_token(client: TestClient) -> None:
    assert client.get("/api/flights/search", params={"origin": "MAD"}).status_code == 200


def test_search_filters_by_date(client: TestClient, db) -> None:
    flight = _any_flight(db)
    day = flight.scheduled_departure.date().isoformat()
    response = client.get(
        "/api/flights/search",
        params={"origin": flight.origin, "destination": flight.destination, "date": day},
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert results
    assert all(offer["scheduled_departure"].startswith(day) for offer in results)


def test_business_cabin_is_priced_above_economy(client: TestClient) -> None:
    params = {"origin": "MAD", "destination": "JFK"}
    economy = client.get("/api/flights/search", params={**params, "cabin": "economy"}).json()
    business = client.get("/api/flights/search", params={**params, "cabin": "business"}).json()
    assert economy["results"] and business["results"]

    economy_fares = {o["flight_id"]: o["fare_eur"] for o in economy["results"]}
    business_offer = business["results"][0]
    assert business_offer["cabin"] == "business"
    assert business_offer["fare_eur"] == round(economy_fares[business_offer["flight_id"]] * 2.5, 2)


def test_unknown_cabin_falls_back_to_economy(client: TestClient) -> None:
    body = client.get(
        "/api/flights/search", params={"origin": "MAD", "cabin": "first-class"}
    ).json()
    assert body["results"][0]["cabin"] == "economy"


def test_search_sorted_by_fare_is_ascending(client: TestClient) -> None:
    body = client.get("/api/flights/search", params={"origin": "MAD", "sort": "fare"}).json()
    fares = [offer["fare_eur"] for offer in body["results"]]
    assert fares == sorted(fares)


def test_flight_detail_includes_aircraft_and_status_detail(client: TestClient, db) -> None:
    flight = _any_flight(db)
    response = client.get(f"/api/flights/{flight.id}")
    assert response.status_code == 200
    detail = response.json()
    assert detail["flight_id"] == flight.id
    assert detail["flight_number"] == flight.flight_number
    assert detail["status_detail"]
    assert set(detail["aircraft"]) == {"registration", "model"}


def test_flight_detail_404_for_unknown_id(client: TestClient) -> None:
    assert client.get("/api/flights/999999").status_code == 404


def test_availability_returns_per_cabin_seats_and_fares(client: TestClient, db) -> None:
    flight = _any_flight(db)
    response = client.get(f"/api/flights/{flight.id}/availability")
    assert response.status_code == 200
    body = response.json()
    assert body["flight_id"] == flight.id
    assert {"economy", "business"} <= set(body["cabins"])

    economy = body["cabins"]["economy"]
    business = body["cabins"]["business"]
    assert set(economy) == {"seats_available", "fare_eur"}
    assert business["fare_eur"] > economy["fare_eur"]
    assert economy["seats_available"] >= 0


def test_availability_404_for_unknown_id(client: TestClient) -> None:
    assert client.get("/api/flights/999999/availability").status_code == 404


def test_search_emits_domain_event_metric(client: TestClient) -> None:
    client.get("/api/flights/search", params={"origin": "MAD"})
    metrics = client.get("/metrics").text
    assert 'iberia_domain_events_total{domain="flights",event="search"}' in metrics
