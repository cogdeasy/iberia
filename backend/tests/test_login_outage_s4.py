"""SRE scenario S4 — login failures after the session-cache v2 release."""

import pytest
from fastapi.testclient import TestClient

from app.routers.identity import AUTH_SESSION_V2_FLAG


@pytest.fixture()
def session_cache_v2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(AUTH_SESSION_V2_FLAG, "1")


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_login_is_healthy_without_the_flag(client: TestClient, demo_password: str) -> None:
    for email in ("customer@iberia.demo", "sre@iberia.demo"):
        assert _login(client, email, demo_password).status_code == 200


@pytest.mark.usefixtures("session_cache_v2")
def test_v2_breaks_logins_for_accounts_without_an_iberia_plus_number(
    client: TestClient, demo_password: str
) -> None:
    # Loyalty members keep working — the partial failure is what makes triage interesting.
    assert _login(client, "customer@iberia.demo", demo_password).status_code == 200

    with pytest.raises(AttributeError):
        _login(client, "sre@iberia.demo", demo_password)
