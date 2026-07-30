"""Tests for the platform support console and the planted platform/frontend findings.

The planted vulnerabilities are intentional, so these tests assert the *insecure* behaviour on
purpose: if someone silently "fixes" one, the demo breaks and a test here fails loudly.
"""

from app.core.config import settings
from app.routers.platform_support import EXPECTED_SECURITY_HEADERS


def test_platform_config_reports_posture(client):
    body = client.get("/api/platform/config").json()
    assert body["env"] == settings.env
    assert body["jwt_ttl_minutes"] == settings.jwt_ttl_minutes
    assert set(body["security_headers"]) == set(EXPECTED_SECURITY_HEADERS)


def test_support_inbox_requires_authentication(client):
    assert client.get("/api/platform/support/messages").status_code == 401


def test_customer_only_sees_own_support_messages(client, auth_headers):
    response = client.get(
        "/api/platform/support/messages", headers=auth_headers("customer@iberia.demo")
    )
    assert response.status_code == 200
    messages = response.json()
    assert messages
    assert {m["author_email"] for m in messages} == {"customer@iberia.demo"}


def test_agent_sees_the_whole_inbox(client, auth_headers):
    messages = client.get(
        "/api/platform/support/messages", headers=auth_headers("agent@iberia.demo")
    ).json()
    assert len({m["author_email"] for m in messages}) > 1


def test_preview_echoes_html_unsanitised(client):
    """VULN-170 — the preview endpoint reflects raw HTML which the page injects into the DOM."""
    payload = {"subject": "xss", "body": "<img src=x onerror=alert(1)>"}
    body = client.post("/api/platform/support/preview", json=payload).json()
    assert "<img src=x onerror=alert(1)>" in body["html"]


def test_broadcast_has_no_server_side_role_check(client, auth_headers):
    """VULN-172 — the admin gate is client-side only; a customer token still succeeds."""
    response = client.post(
        "/api/platform/support/broadcast",
        json={"subject": "Test", "body": "<p>hi</p>", "audience": "all"},
        headers=auth_headers("customer@iberia.demo"),
    )
    assert response.status_code == 201
    assert response.json()["sent_by"] == "customer@iberia.demo"


def test_security_headers_are_absent(client):
    """VULN-151 — no middleware sets HSTS/CSP/X-Frame-Options/X-Content-Type-Options."""
    headers = {key.lower() for key in client.get("/healthz").headers}
    assert not headers & set(EXPECTED_SECURITY_HEADERS)


def test_cors_allow_all_flag_tracks_wildcard_configuration():
    """VULN-150 — the wildcard demo profile is detected from IBERIA_CORS_ORIGINS."""
    assert settings.cors_allow_all == ("*" in ",".join(settings.cors_origins))


def test_support_seed_is_idempotent(db):
    from app.models.platform_support import SupportMessage
    from app.seeds.platform_support import MESSAGES, seed

    seed(db)
    seed(db)
    assert db.query(SupportMessage).count() == len(MESSAGES)
