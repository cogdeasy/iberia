import time

import pytest

from app.services import chaos as chaos_service


@pytest.fixture(autouse=True)
def _clean_chaos():
    chaos_service.reset()
    yield
    chaos_service.reset()


def test_service_registry(client, auth_headers):
    response = client.get("/api/sre/services", headers=auth_headers("sre@iberia.demo"))
    assert response.status_code == 200
    services = response.json()
    names = {service["name"] for service in services}
    assert {
        "booking-api",
        "payments-api",
        "checkin-api",
        "flights-search",
        "notifications-worker",
        "loyalty-api",
        "irrops-api",
    } <= names
    for service in services:
        assert service["health"] in {"healthy", "degraded", "down"}
        assert service["endpoints"]
        assert service["tier"] in {1, 2, 3}


def test_services_require_authentication(client):
    assert client.get("/api/sre/services").status_code == 401


def test_signals_shape(client, auth_headers):
    response = client.get(
        "/api/sre/services/booking-api/signals?window_minutes=15",
        headers=auth_headers("ops@iberia.demo"),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "booking-api"
    assert body["window_minutes"] == 15
    for key in (
        "traffic_rpm",
        "error_rate",
        "latency_p50_ms",
        "latency_p95_ms",
        "latency_p99_ms",
        "saturation_pct",
    ):
        assert isinstance(body[key], int | float)
    assert isinstance(body["synthetic"], bool)
    assert len(body["series"]) >= 2
    point = body["series"][0]
    assert {"ts", "rpm", "error_rate", "p95_ms"} <= set(point)


def test_signals_unknown_service(client, auth_headers):
    response = client.get("/api/sre/services/nope/signals", headers=auth_headers("sre@iberia.demo"))
    assert response.status_code == 404


def test_slos_and_error_budget(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    slos = client.get("/api/sre/slos", headers=headers).json()
    ids = {slo["id"] for slo in slos}
    assert {"booking-availability", "checkout-latency", "checkin-availability"} <= ids
    for slo in slos:
        assert slo["kind"] in {"availability", "latency"}
        assert slo["status"] in {"ok", "at_risk", "breached"}
        assert 0 <= slo["current_pct"] <= 100

    budget = client.get("/api/sre/slos/checkout-latency/error-budget", headers=headers).json()
    assert budget["slo_id"] == "checkout-latency"
    assert 0 <= budget["budget_remaining_pct"] <= 100
    assert budget["burn_rate_1h"] >= 0
    assert budget["status"] in {"ok", "at_risk", "breached"}

    assert client.get("/api/sre/slos/nope/error-budget", headers=headers).status_code == 404


def test_chaos_requires_sre_role(client, auth_headers):
    response = client.post(
        "/api/sre/chaos",
        json={"target": "payments", "mode": "latency", "magnitude": 100, "ttl_seconds": 5},
        headers=auth_headers("customer@iberia.demo"),
    )
    assert response.status_code == 403


def test_chaos_create_list_and_expiry(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    created = client.post(
        "/api/sre/chaos",
        json={"target": "payments", "mode": "latency", "magnitude": 50, "ttl_seconds": 1},
        headers=headers,
    )
    assert created.status_code == 201
    toggle = created.json()
    assert toggle["target"] == "payments"
    assert toggle["mode"] == "latency"
    assert toggle["active"] is True

    listed = client.get("/api/sre/chaos", headers=headers).json()
    assert any(item["target"] == "payments" for item in listed)
    assert chaos_service.chaos_state("payments") is not None

    time.sleep(1.1)
    assert chaos_service.chaos_state("payments") is None
    assert client.get("/api/sre/chaos", headers=headers).json() == []


def test_chaos_delete(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    client.post(
        "/api/sre/chaos",
        json={"target": "booking", "mode": "error", "magnitude": 100, "ttl_seconds": 60},
        headers=headers,
    )
    deleted = client.request("DELETE", "/api/sre/chaos/booking")
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "cleared"
    assert chaos_service.chaos_state("booking") is None


def test_apply_chaos_is_noop_without_toggle():
    assert chaos_service.chaos_state("payments") is None
    from app.services.chaos import apply_chaos

    apply_chaos("payments")  # must not raise


def test_apply_chaos_latency_and_error():
    from app.services.chaos import ChaosError, ChaosTimeout, apply_chaos

    chaos_service.set_toggle("payments", "latency", 20, 30)
    started = time.perf_counter()
    apply_chaos("payments")
    assert time.perf_counter() - started >= 0.015

    chaos_service.set_toggle("payments", "error", 100, 30)
    with pytest.raises(ChaosError):
        apply_chaos("payments")

    chaos_service.set_toggle("payments", "timeout", 10, 30)
    with pytest.raises(ChaosTimeout):
        apply_chaos("payments")


def test_load_generator_returns_immediately(client):
    started = time.perf_counter()
    response = client.post(
        "/api/sre/load", json={"scenario": "steady", "duration_seconds": 2, "rps": 1}
    )
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "started"
    assert body["scenario"] == "steady"
    assert body["requests_planned"] == 2
    assert time.perf_counter() - started < 1.5


def test_debug_config_is_exposed(client):
    """Covers planted VULN-191 so the demo notices if it ever regresses."""
    body = client.get("/api/sre/debug/config").json()
    assert "jwt_secret" in body
    assert "database_url" in body
