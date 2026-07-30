"""Check-in happy path.

The planted vulnerabilities (VULN-070/071/072) are asserted here too, so that a reviewer
who "fixes" one without updating the answer key sees a failing test rather than a silent
change in demo behaviour.
"""

CUSTOMER = "customer@iberia.demo"
AGENT = "agent@iberia.demo"
PNR = "XK7T2P"
OTHER_PNR = "QR9B4L"


def _passengers(client, headers, pnr=PNR):
    response = client.get(f"/api/checkin/{pnr}/passengers", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_reservations_are_scoped_to_the_caller(client, auth_headers):
    body = client.get("/api/checkin/reservations", headers=auth_headers(CUSTOMER)).json()
    assert [r["pnr"] for r in body] == [PNR]

    agent_body = client.get("/api/checkin/reservations", headers=auth_headers(AGENT)).json()
    assert len(agent_body) >= 3


def test_reservations_require_authentication(client):
    assert client.get("/api/checkin/reservations").status_code == 401


def test_check_in_issues_boarding_passes(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    reservation = _passengers(client, headers)
    passenger_ids = [p["id"] for p in reservation["passengers"]]

    response = client.post(
        f"/api/checkin/{PNR}", json={"passenger_ids": passenger_ids}, headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pnr"] == PNR
    assert len(body["boarding_passes"]) == len(passenger_ids)

    for boarding in body["boarding_passes"]:
        assert boarding["flight_number"] == "IB3166"
        assert boarding["origin"] == "MAD"
        assert boarding["destination"] == "LHR"
        assert boarding["gate"] == "H12"
        assert boarding["seat"]
        assert boarding["sequence"] >= 1
        assert boarding["barcode"].startswith("M1")
        assert boarding["qr_payload"].startswith("IB|")
        assert boarding["boarding_time"] < reservation["scheduled_departure"]

    after = _passengers(client, headers)
    assert all(p["checked_in"] for p in after["passengers"])
    assert all(p["seat"] for p in after["passengers"])


def test_check_in_is_idempotent(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    ids = [p["id"] for p in _passengers(client, headers)["passengers"]]
    first = client.post(f"/api/checkin/{PNR}", json={"passenger_ids": ids}, headers=headers).json()
    second = client.post(f"/api/checkin/{PNR}", json={"passenger_ids": ids}, headers=headers).json()
    assert [b["sequence"] for b in first["boarding_passes"]] == [
        b["sequence"] for b in second["boarding_passes"]
    ]


def test_boarding_pass_retrieval(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    ids = [p["id"] for p in _passengers(client, headers)["passengers"]]
    client.post(f"/api/checkin/{PNR}", json={"passenger_ids": ids}, headers=headers)

    response = client.get(f"/api/checkin/{PNR}/boarding-pass/{ids[0]}", headers=headers)
    assert response.status_code == 200, response.text
    boarding = response.json()
    assert boarding["pnr"] == PNR
    assert boarding["passenger_id"] == ids[0]
    assert boarding["passenger_name"]

    missing = client.get(f"/api/checkin/{PNR}/boarding-pass/999999", headers=headers)
    assert missing.status_code == 404


def test_bag_tagging_and_fees(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    ids = [p["id"] for p in _passengers(client, headers)["passengers"]]

    standard = client.post(
        f"/api/checkin/{PNR}/bags",
        json={"passenger_id": ids[0], "weight_kg": 18.0},
        headers=headers,
    )
    assert standard.status_code == 200, standard.text
    assert standard.json()["fee_eur"] == 25.0
    assert standard.json()["bag_tag"].startswith("IB")

    excess = client.post(
        f"/api/checkin/{PNR}/bags",
        json={"passenger_id": ids[0], "weight_kg": 27.0},
        headers=headers,
    )
    assert excess.json()["fee_eur"] == 85.0
    assert excess.json()["bag_tag"] != standard.json()["bag_tag"]

    too_heavy = client.post(
        f"/api/checkin/{PNR}/bags",
        json={"passenger_id": ids[0], "weight_kg": 90.0},
        headers=headers,
    )
    assert too_heavy.status_code == 400

    wrong_pnr = client.post(
        f"/api/checkin/{OTHER_PNR}/bags",
        json={"passenger_id": ids[0], "weight_kg": 10.0},
        headers=headers,
    )
    assert wrong_pnr.status_code == 404


def test_unknown_pnr_is_404(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    assert client.post("/api/checkin/NOPE00", json={}, headers=headers).status_code == 404


def test_document_download_happy_path(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    response = client.get("/api/checkin/documents/itinerary-XK7T2P.txt", headers=headers)
    assert response.status_code == 200, response.text
    assert "XK7T2P" in response.text

    assert client.get("/api/checkin/documents/nope.txt", headers=headers).status_code == 404


def test_generated_boarding_pass_document_is_downloadable(client, auth_headers):
    headers = auth_headers(CUSTOMER)
    ids = [p["id"] for p in _passengers(client, headers)["passengers"]]
    body = client.post(f"/api/checkin/{PNR}", json={"passenger_ids": ids}, headers=headers).json()
    filename = body["boarding_passes"][0]["document_filename"]
    assert filename
    document = client.get(f"/api/checkin/documents/{filename}", headers=headers)
    assert document.status_code == 200
    assert "BOARDING PASS" in document.text


# --- planted vulnerabilities: intentional, see docs/vulnerabilities/ ------------------


def test_vuln_070_path_traversal_is_present(client, auth_headers):
    """VULN-070 — documents endpoint escapes its root directory."""
    # percent-encoded because httpx normalises literal dot-segments away before sending;
    # with a real client use `curl --path-as-is .../documents/../../app/core/config.py`.
    response = client.get(
        "/api/checkin/documents/%2e%2e/%2e%2e/app/core/config.py",
        headers=auth_headers(CUSTOMER),
    )
    assert response.status_code == 200
    assert "class Settings" in response.text


def test_vuln_071_idor_on_boarding_pass(client, auth_headers):
    """VULN-071 — no ownership check on boarding-pass retrieval."""
    owner = auth_headers("frequent@iberia.demo")
    victim_ids = [p["id"] for p in _passengers(client, owner, OTHER_PNR)["passengers"]]
    client.post(f"/api/checkin/{OTHER_PNR}", json={"passenger_ids": victim_ids}, headers=owner)

    attacker = auth_headers(CUSTOMER)
    stolen = client.get(f"/api/checkin/{PNR}/boarding-pass/{victim_ids[0]}", headers=attacker)
    assert stolen.status_code == 200
    assert stolen.json()["pnr"] == OTHER_PNR


def test_vuln_072_document_number_is_exposed(client, auth_headers):
    """VULN-072 — passport number returned in the boarding-pass payload."""
    headers = auth_headers(CUSTOMER)
    ids = [p["id"] for p in _passengers(client, headers)["passengers"]]
    body = client.post(f"/api/checkin/{PNR}", json={"passenger_ids": ids}, headers=headers).json()
    boarding = body["boarding_passes"][0]
    assert boarding["document_number"].startswith("ESP-")
    assert boarding["document_number"] in boarding["qr_payload"]
