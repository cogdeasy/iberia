from fastapi.testclient import TestClient


def test_about_is_public_and_reports_versions(client: TestClient) -> None:
    response = client.get("/api/about")
    assert response.status_code == 200
    body = response.json()
    assert body["app"]
    for key in ("python", "fastapi", "sqlalchemy", "platform", "hostname"):
        assert body[key]
