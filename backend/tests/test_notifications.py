import base64
import pickle
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest


def _drain(client, headers, tries=40):
    """Wait until the worker pool has drained the (non-saturated) queue."""
    for _ in range(tries):
        snap = client.get("/api/notifications/queue", headers=headers).json()
        if snap["depth"] == 0 and snap["workers_busy"] == 0:
            return snap
        time.sleep(0.1)
    return snap


def test_list_notifications_seeded(client, auth_headers):
    resp = client.get("/api/notifications", headers=auth_headers("ops@iberia.demo"))
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list) and len(body) >= 1
    first = body[0]
    assert set({"id", "pnr", "channel", "template", "status", "created_at", "body"}).issubset(first)


def test_send_renders_and_queues(client, auth_headers):
    headers = auth_headers("agent@iberia.demo")
    resp = client.post(
        "/api/notifications/send",
        headers=headers,
        json={
            "pnr": "TEST01",
            "template": "delay_notice",
            "channel": "email",
            "context": {"passenger_name": "Test Traveller", "delay_minutes": "30"},
        },
    )
    assert resp.status_code == 201, resp.text
    note = resp.json()
    assert note["pnr"] == "TEST01"
    assert "Test Traveller" in note["body"]
    assert note["channel"] == "email"
    _drain(client, headers)
    listed = client.get("/api/notifications", headers=headers).json()
    assert any(n["pnr"] == "TEST01" for n in listed)


def test_send_rejects_unknown_template(client, auth_headers):
    resp = client.post(
        "/api/notifications/send",
        headers=auth_headers("agent@iberia.demo"),
        json={"pnr": "X", "template": "does_not_exist", "channel": "email"},
    )
    assert resp.status_code == 400


def test_queue_shape(client, auth_headers):
    resp = client.get("/api/notifications/queue", headers=auth_headers("sre@iberia.demo"))
    assert resp.status_code == 200
    body = resp.json()
    for key in ("depth", "workers", "oldest_age_seconds", "dlq_depth"):
        assert key in body
    assert isinstance(body["depth"], int)
    assert isinstance(body["workers"], int)
    assert isinstance(body["dlq_depth"], int)


def test_metrics_expose_queue_gauges(client, auth_headers):
    client.get("/api/notifications/queue", headers=auth_headers("sre@iberia.demo"))
    body = client.get("/metrics").text
    assert "iberia_notification_queue_depth" in body
    assert "iberia_notification_workers_busy" in body
    assert "iberia_notification_dlq_depth" in body


def test_webhook_register_and_test_local(client, auth_headers):
    """Happy path: register a webhook pointing at a local server and test-fire it."""
    received = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            received["event"] = self.headers.get("x-iberia-webhook-event")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"pong-from-partner")

        def log_message(self, *args):  # silence
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        headers = auth_headers("ops@iberia.demo")
        reg = client.post(
            "/api/notifications/webhooks",
            headers=headers,
            json={"url": f"http://127.0.0.1:{port}/hook", "event": "notification.sent"},
        )
        assert reg.status_code == 201, reg.text
        hook_id = reg.json()["id"]

        fired = client.post(f"/api/notifications/webhooks/{hook_id}/test", headers=headers)
        assert fired.status_code == 200, fired.text
        result = fired.json()
        assert result["status"] == "200"
        assert "pong-from-partner" in result["response_snippet"]
    finally:
        server.shutdown()


def test_webhook_requires_ops_role(client, auth_headers):
    resp = client.post(
        "/api/notifications/webhooks",
        headers=auth_headers("customer@iberia.demo"),
        json={"url": "http://127.0.0.1:1/x", "event": "e"},
    )
    assert resp.status_code == 403


def test_templates_listed(client, auth_headers):
    resp = client.get("/api/notifications/templates", headers=auth_headers("ops@iberia.demo"))
    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert {"delay_notice", "cancellation", "boarding_reminder", "refund_confirmation"} <= names


def test_context_import_json_roundtrip(client, auth_headers):
    payload = base64.b64encode(b'{"passenger_name": "Imported", "delay_minutes": "10"}').decode()
    resp = client.post(
        "/api/notifications/context/import",
        headers=auth_headers("ops@iberia.demo"),
        json={"payload": payload, "format": "json"},
    )
    assert resp.status_code == 200
    assert resp.json()["context"]["passenger_name"] == "Imported"


def test_context_import_pickle_loads(client, auth_headers):
    # VULN-111 happy path: a benign pickle round-trips (exploit lives in the docs).
    payload = base64.b64encode(pickle.dumps({"passenger_name": "Pickled"})).decode()
    resp = client.post(
        "/api/notifications/context/import",
        headers=auth_headers("ops@iberia.demo"),
        json={"payload": payload, "format": "pickle"},
    )
    assert resp.status_code == 200
    assert resp.json()["context"]["passenger_name"] == "Pickled"


@pytest.fixture(autouse=True)
def _restore_queue_state(client, auth_headers):
    yield
    client.post("/api/notifications/queue/drain", headers=auth_headers("sre@iberia.demo"))
