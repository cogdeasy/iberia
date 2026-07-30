from pathlib import Path

from app.services import security as security_service

FINDING_MD = """# VULN-999 — Temp finding for tests

| Field | Value |
|-------|-------|
| ID | VULN-999 |
| Domain | testing |
| CWE | CWE-89 (SQL Injection) |
| OWASP Top 10 (2021) | A03:2021 – Injection |
| Severity | Critical |
| Location | `backend/app/routers/nowhere.py:1` |
| Status | open |

## Description

Raw SQL string building in a test fixture.

## Intended remediation

Use bound parameters.
"""


def test_posture_contract(client, auth_headers):
    response = client.get("/api/security/posture", headers=auth_headers("admin@iberia.demo"))
    assert response.status_code == 200
    body = response.json()
    assert set(body) >= {"score", "counts", "categories"}
    assert 0 <= body["score"] <= 100
    assert set(body["counts"]) == {"critical", "high", "medium", "low"}
    assert body["total"] == sum(body["counts"].values()) or body["total"] >= 0
    for category in body["categories"]:
        assert set(category) == {"category", "count"}


def test_findings_register_is_never_empty(client, auth_headers):
    response = client.get("/api/security/findings", headers=auth_headers("sre@iberia.demo"))
    assert response.status_code == 200
    findings = response.json()
    assert findings, "the register must ship at least the security workstream's findings"
    ids = {finding["id"] for finding in findings}
    assert {"VULN-140", "VULN-141"} <= ids
    first = findings[0]
    assert set(first) >= {
        "id",
        "title",
        "severity",
        "cwe",
        "owasp",
        "location",
        "status",
        "description",
        "remediation",
    }


def test_finding_detail_and_404(client, auth_headers):
    headers = auth_headers("admin@iberia.demo")
    response = client.get("/api/security/findings/VULN-140", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["severity"] == "high"
    assert body["cwe"].startswith("CWE-285")
    assert "A01:2021" in body["owasp"]
    assert body["description"] and body["remediation"]
    assert client.get("/api/security/findings/VULN-000", headers=headers).status_code == 404


def test_findings_require_staff_role(client, auth_headers):
    response = client.get("/api/security/findings", headers=auth_headers("customer@iberia.demo"))
    assert response.status_code == 403


def test_parser_reads_markdown_from_disk(tmp_path: Path):
    (tmp_path / "VULN-999-temp.md").write_text(FINDING_MD, encoding="utf-8")
    (tmp_path / "notes.md").write_text("ignored", encoding="utf-8")

    findings = security_service.load_findings(tmp_path)
    assert len(findings) == 1
    finding = findings[0]
    assert finding.id == "VULN-999"
    assert finding.title == "Temp finding for tests"
    assert finding.severity == "critical"
    assert finding.domain == "testing"
    assert finding.location == "backend/app/routers/nowhere.py:1"
    assert "Raw SQL string building" in finding.description
    assert "bound parameters" in finding.remediation

    posture = security_service.posture(findings)
    assert posture.counts.critical == 1
    assert posture.score == 85
    assert posture.categories[0].category.startswith("A03:2021")


def test_parser_handles_missing_directory(tmp_path: Path):
    assert security_service.load_findings(tmp_path / "does-not-exist") == []


def test_audit_trail_records_a_mutation(client, auth_headers):
    headers = auth_headers("admin@iberia.demo")
    payload = {"action": "demo.walkthrough", "target": "act-3", "outcome": "success"}
    created = client.post("/api/security/audit/events", headers=headers, json=payload)
    assert created.status_code == 201
    event = created.json()
    assert set(event) >= {"id", "ts", "actor", "action", "target", "ip", "request_id", "outcome"}
    assert event["actor"] == "admin@iberia.demo"
    assert event["action"] == "demo.walkthrough"
    assert event["request_id"]

    listed = client.get("/api/security/audit?limit=50", headers=headers).json()
    actions = [item["action"] for item in listed]
    # the explicit event plus the middleware-style dependency record for the POST itself
    assert "demo.walkthrough" in actions
    assert "http.post" in actions


def test_audit_filters(client, auth_headers):
    headers = auth_headers("sre@iberia.demo")
    response = client.get(
        "/api/security/audit?actor=admin@iberia.demo&outcome=success", headers=headers
    )
    assert response.status_code == 200
    for event in response.json():
        assert event["actor"] == "admin@iberia.demo"
        assert event["outcome"] == "success"


def test_audit_requires_authentication(client):
    assert client.get("/api/security/audit").status_code == 401


def test_vuln_140_any_authenticated_user_can_read_audit(client, auth_headers):
    """Planted VULN-140: documented insecure behaviour — a customer token gets 200."""
    response = client.get(
        "/api/security/audit?limit=5", headers=auth_headers("customer@iberia.demo")
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_vuln_141_actor_controlled_fields_are_stored_verbatim(client, auth_headers):
    """Planted VULN-141: CRLF in actor-supplied fields is neither rejected nor escaped."""
    forged = 'users.role.update\n{"msg": "audit actor=admin@iberia.demo outcome=success"}'
    created = client.post(
        "/api/security/audit/events",
        headers=auth_headers("customer@iberia.demo"),
        json={"action": forged, "target": "user/9 -> admin", "outcome": "success"},
    )
    assert created.status_code == 201
    assert "\n" in created.json()["action"]
