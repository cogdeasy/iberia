from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.core import utcnow


class SupportMessage(Base):
    """A message in the passenger support inbox rendered by the /support console page."""

    __tablename__ = "platform_support_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_email: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    body_html: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(32), default="web")
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SupportBroadcast(Base):
    """An operations broadcast sent from the support console's privileged panel."""

    __tablename__ = "platform_support_broadcasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    audience: Mapped[str] = mapped_column(String(32), default="all")
    subject: Mapped[str] = mapped_column(String(200))
    body_html: Mapped[str] = mapped_column(Text)
    sent_by: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
