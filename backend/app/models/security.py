"""Security domain models: the platform audit trail."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.core import utcnow


class AuditEvent(Base):
    """An append-only record of a security-relevant action."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[str] = mapped_column(String(255), index=True)
    action: Mapped[str] = mapped_column(String(255), index=True)
    target: Mapped[str] = mapped_column(String(512), default="")
    outcome: Mapped[str] = mapped_column(String(32), default="success", index=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
