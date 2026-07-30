"""Pydantic schemas for the incident domain (see docs/API_CONTRACTS.md)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

IncidentStatus = Literal["open", "mitigated", "resolved"]
TimelineKind = Literal["detect", "note", "mitigation", "escalation", "resolve"]
AlertState = Literal["firing", "pending", "resolved"]


class TimelineEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    kind: str
    message: str
    author: str


class TimelineEntryIn(BaseModel):
    kind: TimelineKind = "note"
    message: str = Field(min_length=1, max_length=4000)


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reference: str
    title: str
    severity: int
    status: str
    service: str
    summary: str
    commander: str | None = None
    started_at: datetime
    resolved_at: datetime | None = None
    timeline: list[TimelineEntryOut] = []
    slo_impact: str | None = None
    runbook: str | None = None
    resolution: str | None = None
    alert_name: str | None = None
    duration_minutes: int | None = None
    response_expectation: str | None = None


class IncidentCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    severity: int = Field(default=2, ge=0, le=3)
    service: str = Field(min_length=1, max_length=64)
    summary: str = ""
    commander: str | None = None
    alert_name: str | None = None
    runbook: str | None = None
    slo_impact: str | None = None


class IncidentPatch(BaseModel):
    status: IncidentStatus | None = None
    severity: int | None = Field(default=None, ge=0, le=3)
    commander: str | None = None
    resolution: str | None = None


class PostmortemOut(BaseModel):
    incident_id: int
    markdown: str


class AlertOut(BaseModel):
    name: str
    severity: int
    service: str
    state: AlertState
    since: datetime
    summary: str
    runbook: str | None = None
