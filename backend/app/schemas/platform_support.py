from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SupportMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_email: str
    subject: str
    body_html: str
    channel: str
    resolved: bool
    created_at: datetime


class PreviewIn(BaseModel):
    subject: str = ""
    body: str


class PreviewOut(BaseModel):
    subject: str
    html: str
    rendered_by: str


class BroadcastIn(BaseModel):
    subject: str
    body: str
    audience: str = "all"


class BroadcastOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    audience: str
    subject: str
    body_html: str
    sent_by: str
    created_at: datetime


class PlatformConfigOut(BaseModel):
    env: str
    app_name: str
    cors_origins: list[str]
    cors_allow_all: bool
    jwt_ttl_minutes: int
    security_headers: dict[str, bool]
