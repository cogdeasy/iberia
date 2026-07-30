"""Payments domain tests: authorisation, refunds, listing and the planted findings."""

VISA = "4111111111111111"
AMEX = "378282246310005"
MASTERCARD = "5555555555554444"


def _authorise(client, headers, pnr: str = "IBTST1", card_number: str = VISA):
    return client.post(
        "/api/payments/authorise",
        json={
            "pnr": pnr,
            "card_number": card_number,
            "card_holder": "Lucia Fernandez",
            "expiry": "12/29",
            "cvv": "123",
        },
        headers=headers,
    )


def test_authorise_masks_card_and_detects_brand(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    response = _authorise(client, headers)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["pnr"] == "IBTST1"
    assert body["status"] == "authorised"
    assert body["card_last4"] == "1111"
    assert body["card_brand"] == "Visa"
    assert body["provider_reference"].startswith("pay_")
    assert body["amount_eur"] > 0
    assert VISA not in response.text


def test_brand_detection_by_prefix(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    assert _authorise(client, headers, "IBAMEX", AMEX).json()["card_brand"] == "Amex"
    assert _authorise(client, headers, "IBMCRD", MASTERCARD).json()["card_brand"] == "Mastercard"


def test_authorise_rejects_invalid_card(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    response = _authorise(client, headers, "IBBAD1", "4111111111111112")
    assert response.status_code == 422


def test_authorise_requires_authentication(client):
    response = client.post(
        "/api/payments/authorise",
        json={
            "pnr": "IBTST2",
            "card_number": VISA,
            "card_holder": "Anon",
            "expiry": "12/29",
            "cvv": "123",
        },
    )
    assert response.status_code == 401


def test_list_and_get_payment(client, auth_headers):
    headers = auth_headers("customer@iberia.demo")
    created = _authorise(client, headers, "IBLIST").json()

    listed = client.get("/api/payments", headers=headers)
    assert listed.status_code == 200
    assert created["id"] in [payment["id"] for payment in listed.json()]

    detail = client.get(f"/api/payments/{created['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["provider_reference"] == created["provider_reference"]

    assert client.get("/api/payments/999999", headers=headers).status_code == 404


def test_customers_only_see_their_own_payments(client, auth_headers):
    owner = auth_headers("customer@iberia.demo")
    other = auth_headers("frequent@iberia.demo")
    created = _authorise(client, owner, "IBOWNR").json()

    listed = client.get("/api/payments", headers=other).json()
    assert created["id"] not in [payment["id"] for payment in listed]
    assert client.get(f"/api/payments/{created['id']}", headers=other).status_code == 403


def test_refund_happy_path(client, auth_headers):
    headers = auth_headers("agent@iberia.demo")
    payment = _authorise(client, headers, "IBRFND").json()

    response = client.post(
        f"/api/payments/{payment['id']}/refund",
        json={"amount_eur": 25.0, "reason": "Seat downgrade"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    refund = response.json()
    assert refund["payment_id"] == payment["id"]
    assert refund["amount_eur"] == 25.0
    assert refund["status"] == "refunded"

    assert client.get(f"/api/payments/{payment['id']}", headers=headers).json()["status"] == (
        "part_refunded"
    )
    refunds = client.get(f"/api/payments/{payment['id']}/refunds", headers=headers).json()
    assert [item["id"] for item in refunds] == [refund["id"]]


def test_full_refund_marks_payment_refunded(client, auth_headers):
    headers = auth_headers("agent@iberia.demo")
    payment = _authorise(client, headers, "IBFULL").json()
    response = client.post(
        f"/api/payments/{payment['id']}/refund",
        json={"amount_eur": payment["amount_eur"], "reason": "Flight cancelled"},
        headers=headers,
    )
    assert response.status_code == 201
    assert client.get(f"/api/payments/{payment['id']}", headers=headers).json()["status"] == (
        "refunded"
    )


def test_planted_vuln_052_refund_has_no_authorisation_check(client, auth_headers):
    """Documented in docs/vulnerabilities/VULN-052-missing-authz-refund.md."""
    victim = auth_headers("customer@iberia.demo")
    attacker = auth_headers("frequent@iberia.demo")
    payment = _authorise(client, victim, "IBVICT").json()

    response = client.post(
        f"/api/payments/{payment['id']}/refund",
        json={"amount_eur": payment["amount_eur"], "reason": "not mine"},
        headers=attacker,
    )
    assert response.status_code == 201


def test_planted_vuln_050_pan_is_recoverable(client, auth_headers):
    """Documented in docs/vulnerabilities/VULN-050-reversible-pan-storage.md."""
    headers = auth_headers("customer@iberia.demo")
    payment = _authorise(client, headers, "IBVAULT"[:6]).json()
    debug = client.get(f"/api/payments/{payment['id']}/debug", headers=headers)
    assert debug.status_code == 200
    assert debug.json()["card_number"] == VISA


def test_planted_vuln_051_hardcoded_provider_secret_present():
    """Documented in docs/vulnerabilities/VULN-051-hardcoded-provider-secret.md."""
    from app.services import payments as payments_service

    assert payments_service.PROVIDER_API_KEY.startswith("sk_live_")
    assert payments_service.PROVIDER_WEBHOOK_SIGNING_SECRET.startswith("whsec_")


def test_seeded_demo_payment_is_visible_to_the_customer(client, auth_headers):
    listed = client.get("/api/payments", headers=auth_headers("customer@iberia.demo")).json()
    assert any(payment["provider_reference"] == "pay_demo000000001" for payment in listed)
