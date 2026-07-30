from app.services.loyalty import multiplier_for_tier, tier_for_points


def test_tier_calculation():
    assert tier_for_points(0) == "Clásica"
    assert tier_for_points(1_199) == "Clásica"
    assert tier_for_points(1_200) == "Plata"
    assert tier_for_points(3_600) == "Oro"
    assert tier_for_points(9_450) == "Platino"
    assert multiplier_for_tier("Platino") == 2.0
    assert multiplier_for_tier("Clásica") == 1.0


def test_me_returns_seeded_member(client, auth_headers):
    body = client.get("/api/loyalty/me", headers=auth_headers("frequent@iberia.demo")).json()
    assert body["plus_number"] == "IB7654321"
    assert body["tier"] == "Platino"
    assert body["avios_balance"] > 0
    assert len(body["transactions"]) >= 15
    assert body["transactions"][-1]["balance_after"] == body["avios_balance"]


def test_me_requires_auth(client):
    assert client.get("/api/loyalty/me").status_code == 401


def test_accrue_awards_tier_multiplied_avios(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    before = client.get("/api/loyalty/me", headers=headers).json()
    response = client.post("/api/loyalty/accrue", json={"pnr": "ACCRU1"}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["avios_awarded"] > 0
    assert body["balance"] == before["avios_balance"] + body["avios_awarded"]


def test_redeem_spends_avios(client, auth_headers):
    headers = auth_headers("frequent@iberia.demo")
    flights = client.get("/api/loyalty/me", headers=headers)
    assert flights.status_code == 200
    before = flights.json()["avios_balance"]
    response = client.post(
        "/api/loyalty/redeem", json={"flight_id": 1, "avios": 2_500}, headers=headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == before - 2_500
    assert body["redemption_id"] > 0


def test_redeem_rejects_insufficient_balance(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    response = client.post(
        "/api/loyalty/redeem", json={"flight_id": 1, "avios": 10_000_000}, headers=headers
    )
    assert response.status_code == 400


def test_transfer_happy_path_moves_avios(client, auth_headers):
    sender = auth_headers("frequent@iberia.demo")
    recipient = auth_headers("customer@iberia.demo")
    sender_before = client.get("/api/loyalty/me", headers=sender).json()["avios_balance"]
    recipient_before = client.get("/api/loyalty/me", headers=recipient).json()["avios_balance"]

    response = client.post(
        "/api/loyalty/transfer",
        json={"to_plus_number": "IB1234567", "avios": 1_000},
        headers=sender,
    )
    assert response.status_code == 200
    assert response.json()["balance"] == sender_before - 1_000
    after = client.get("/api/loyalty/me", headers=recipient).json()
    assert after["avios_balance"] == recipient_before + 1_000
    assert after["transactions"][-1]["description"] == "Transfer from IB7654321"


def test_transfer_rejects_unknown_member(client, auth_headers):
    response = client.post(
        "/api/loyalty/transfer",
        json={"to_plus_number": "IB0000000", "avios": 100},
        headers=auth_headers("frequent@iberia.demo"),
    )
    assert response.status_code == 404


def test_member_lookup_is_reachable(client, auth_headers):
    """Planted VULN-090: any authenticated user can read another member's account."""
    response = client.get(
        "/api/loyalty/members/IB7654321", headers=auth_headers("customer@iberia.demo")
    )
    assert response.status_code == 200
    assert response.json()["full_name"]
