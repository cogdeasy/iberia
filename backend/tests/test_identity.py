"""Identity happy-path tests.

These assert the contract in ``docs/API_CONTRACTS.md`` only. The planted vulnerabilities
(VULN-001..005) are intentional and are deliberately *not* asserted away here.
"""

import uuid

USER_FIELDS = {
    "id",
    "email",
    "full_name",
    "role",
    "iberia_plus_number",
    "is_active",
    "created_at",
}


def test_login_returns_token_and_user(client, demo_password):
    response = client.post(
        "/api/auth/login",
        json={"email": "customer@iberia.demo", "password": demo_password},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert USER_FIELDS <= set(body["user"])
    assert body["user"]["email"] == "customer@iberia.demo"
    assert body["user"]["role"] == "customer"


def test_me_returns_current_user(client, demo_password):
    login = client.post(
        "/api/auth/login",
        json={"email": "ops@iberia.demo", "password": demo_password},
    )
    token = login.json()["access_token"]
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "ops@iberia.demo"


def test_me_requires_a_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_register_then_login(client):
    email = f"new-{uuid.uuid4().hex[:8]}@iberia.demo"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "Barajas2026!", "full_name": "Nuevo Cliente"},
    )
    assert response.status_code == 201
    created = response.json()
    assert created["email"] == email
    assert created["role"] == "customer"
    assert created["is_active"] is True

    login = client.post("/api/auth/login", json={"email": email, "password": "Barajas2026!"})
    assert login.status_code == 200


def test_register_rejects_duplicate_email(client):
    payload = {
        "email": "customer@iberia.demo",
        "password": "Whatever2026!",
        "full_name": "Duplicate",
    }
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_list_and_get_users(client, auth_headers):
    headers = auth_headers("admin@iberia.demo")
    listing = client.get("/api/users", headers=headers)
    assert listing.status_code == 200
    users = listing.json()
    assert len(users) >= 6
    assert USER_FIELDS <= set(users[0])

    single = client.get(f"/api/users/{users[0]['id']}", headers=headers)
    assert single.status_code == 200
    assert single.json()["id"] == users[0]["id"]


def test_get_unknown_user_is_404(client, auth_headers):
    assert client.get("/api/users/999999", headers=auth_headers()).status_code == 404


def test_profile_update(client, auth_headers):
    headers = auth_headers("frequent@iberia.demo")
    me = client.get("/api/auth/me", headers=headers).json()
    response = client.patch(
        f"/api/users/{me['id']}",
        headers=headers,
        json={"full_name": "Marco Ortega Ruiz", "iberia_plus_number": "IB7654321"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Marco Ortega Ruiz"
    assert body["iberia_plus_number"] == "IB7654321"


def test_password_reset_round_trip(client, demo_password):
    email = f"reset-{uuid.uuid4().hex[:8]}@iberia.demo"
    client.post(
        "/api/auth/register",
        json={"email": email, "password": "Original2026!", "full_name": "Reset Tester"},
    )

    requested = client.post("/api/auth/password-reset", json={"email": email})
    assert requested.status_code == 200
    assert requested.json()["status"] == "sent"
    token = requested.json()["reset_token"]

    confirmed = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": token, "new_password": "Renovada2026!"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "reset"

    assert (
        client.post(
            "/api/auth/login", json={"email": email, "password": "Renovada2026!"}
        ).status_code
        == 200
    )
    assert demo_password  # fixture is available for other identity scenarios


def test_password_reset_for_unknown_email_is_accepted(client):
    response = client.post("/api/auth/password-reset", json={"email": "nobody@iberia.demo"})
    assert response.status_code == 200
    assert response.json()["status"] == "sent"


def test_password_reset_confirm_rejects_bad_token(client):
    response = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": "not-a-real-token", "new_password": "Whatever2026!"},
    )
    assert response.status_code == 400


def test_api_key_issue_list_and_revoke(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    created = client.post("/api/auth/api-keys", headers=headers, json={"name": "cli"})
    assert created.status_code == 201
    body = created.json()
    assert body["key"].startswith("ibk_")
    assert body["prefix"] == body["key"][:12]
    assert body["active"] is True

    listing = client.get("/api/auth/api-keys", headers=headers)
    assert listing.status_code == 200
    ids = [k["id"] for k in listing.json()]
    assert body["id"] in ids
    assert all("key" not in k for k in listing.json())

    revoked = client.delete(f"/api/auth/api-keys/{body['id']}", headers=headers)
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"

    after = client.get("/api/auth/api-keys", headers=headers).json()
    assert next(k for k in after if k["id"] == body["id"])["active"] is False


def test_seeded_api_key_fixtures_present(client, auth_headers):
    listing = client.get("/api/auth/api-keys", headers=auth_headers("agent@iberia.demo"))
    assert listing.status_code == 200
    assert any(k["name"] == "contact-centre-crm" for k in listing.json())
