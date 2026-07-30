import os
import tempfile

import pytest

os.environ.setdefault("IBERIA_ENV", "test")
_db_fd, _db_path = tempfile.mkstemp(prefix="iberia-test-", suffix=".db")
os.environ["IBERIA_DATABASE_URL"] = f"sqlite:///{_db_path}"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

import seed as seed_script  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.db import SessionLocal, create_all  # noqa: E402
from app.main import app  # noqa: E402
from app.models.core import User  # noqa: E402
from app.seeds.core import DEMO_PASSWORD  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database() -> None:
    create_all()
    seed_script.main()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def demo_password() -> str:
    return DEMO_PASSWORD


@pytest.fixture
def auth_headers(client: TestClient):
    """Bearer headers for a seeded user, e.g. ``auth_headers("ops@iberia.demo")``."""

    def _factory(email: str = "customer@iberia.demo") -> dict[str, str]:
        session = SessionLocal()
        try:
            user = session.scalar(select(User).where(User.email == email))
            assert user is not None, f"seed user missing: {email}"
            token = create_access_token(user.email, user.role)
        finally:
            session.close()
        return {"Authorization": f"Bearer {token}"}

    return _factory
