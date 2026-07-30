"""Incident management models.

An ``Incident`` is the unit of coordination during an outage: it carries the severity,
the owning service, the incident commander and a chronological ``timeline`` used to
generate the blameless postmortem.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    """Naive UTC timestamp, matching the ``DateTime`` columns used across the estate."""
    return datetime.now(tz=timezone.utc).replace(tzinfo=None)


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    severity: Mapped[int] = mapped_column(Integer, default=2)
    status: Mapped[str] = mapped_column(String(16), default="open")
    service: Mapped[str] = mapped_column(String(64), index=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    commander: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    slo_impact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    runbook: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alert_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    timeline: Mapped[list["IncidentTimelineEntry"]] = relationship(
        back_populates="incident",
        cascade="all, delete-orphan",
        order_by="IncidentTimelineEntry.ts",
    )


class IncidentTimelineEntry(Base):
    __tablename__ = "incident_timeline_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    kind: Mapped[str] = mapped_column(String(16), default="note")
    message: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(128), default="system")

    incident: Mapped["Incident"] = relationship(back_populates="timeline")
