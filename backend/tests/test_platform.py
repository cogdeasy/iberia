from sqlalchemy import func, select

from app.db import SessionLocal
from app.models.core import Flight, User


def test_healthz(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readyz(client):
    assert client.get("/readyz").json()["database"] == "reachable"


def test_metrics_exposes_http_family(client):
    client.get("/healthz")
    body = client.get("/metrics").text
    assert "iberia_http_requests_total" in body


def test_request_id_is_echoed(client):
    response = client.get("/healthz", headers={"x-request-id": "demo-trace-1"})
    assert response.headers["x-request-id"] == "demo-trace-1"


def test_seed_data_available(client):
    db = SessionLocal()
    try:
        assert db.scalar(select(func.count()).select_from(User)) >= 6
        assert db.scalar(select(func.count()).select_from(Flight)) > 50
    finally:
        db.close()
