"""Identity fixtures.

Users are seeded by ``app/seeds/core.py`` — this seeder only adds personal API-key
fixtures so the profile page and the ``/api/auth/api-keys`` endpoints have data to show.
Keys are deterministic and obviously fake demo values. Idempotent.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.core import User
from app.models.identity import ApiKey

ORDER = 1

# Fake, deterministic demo keys — never real credentials.
API_KEYS = [
    ("customer@iberia.demo", "mobile-app", "ibk_demo0000000000000customer01"),
    ("frequent@iberia.demo", "iberia-plus-widget", "ibk_demo0000000000000frequent1"),
    ("agent@iberia.demo", "contact-centre-crm", "ibk_demo00000000000000agent001"),
]


def seed(db: Session) -> None:
    for email, name, key in API_KEYS:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            continue
        if db.scalar(select(ApiKey).where(ApiKey.key == key)) is None:
            db.add(ApiKey(user_id=user.id, name=name, key=key, prefix=key[:12]))
    db.commit()
