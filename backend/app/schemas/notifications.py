from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

Channel = Literal["email", "sms", "push"]


class NotificationOut(BaseModel):
    """Contract: {id, pnr, channel, template, status, created_at, body}."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    pnr: str
    channel: Channel
    template: str
    status: str
    created_at: datetime
    body: str
    attempts: int = 0
    last_error: str | None = None


class SendRequest(BaseModel):
    pnr: str
    template: str
    channel: Channel = "email"
    # Free-text overrides merged into the render context (passenger name, reason, ...).
    context: dict[str, str] | None = None


class QueueStatus(BaseModel):
    """Contract: {depth, workers, oldest_age_seconds, dlq_depth}."""

    depth: int
    workers: int
    oldest_age_seconds: float
    dlq_depth: int
    workers_busy: int = 0
    saturated: bool = False
    retries_enabled: bool = True
    processed_total: int = 0
    failed_total: int = 0


class QueueSample(BaseModel):
    ts: datetime
    depth: int
    workers_busy: int
    dlq_depth: int
    oldest_age_seconds: float


class QueueHistory(BaseModel):
    samples: list[QueueSample]


class WebhookCreate(BaseModel):
    url: str
    event: str = "notification.sent"


class WebhookOut(BaseModel):
    """Contract: {id, url, event, active, last_status}."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    event: str
    active: bool
    last_status: str | None = None


class WebhookTestResult(BaseModel):
    """Contract: {status, response_snippet}."""

    status: str
    response_snippet: str


class TemplateOut(BaseModel):
    name: str
    subject: str
    channels: list[str]
    variables: list[str]


class SaturationRequest(BaseModel):
    enabled: bool = True
    burst: int = 0
    workers: int | None = None
    retries_enabled: bool | None = None


class ContextImportRequest(BaseModel):
    """Bulk import of render context, used by the partner onboarding tooling."""

    payload: str
    format: Literal["pickle", "json"] = "pickle"


class ContextImportResult(BaseModel):
    status: str
    keys: list[str]
    context: dict[str, Any]
