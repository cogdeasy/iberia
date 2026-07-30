"""Security domain schemas — see docs/API_CONTRACTS.md."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    actor: str
    action: str
    target: str
    ip: str | None = None
    request_id: str | None = None
    outcome: str


class AuditEventIn(BaseModel):
    action: str
    target: str = ""
    outcome: str = "success"


class Finding(BaseModel):
    id: str
    title: str
    severity: str
    cwe: str
    owasp: str
    location: str
    status: str = "open"
    description: str = ""
    remediation: str = ""
    domain: str = ""


class SeverityCounts(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0


class CategoryCount(BaseModel):
    category: str
    count: int


class Posture(BaseModel):
    score: int
    total: int
    counts: SeverityCounts
    categories: list[CategoryCount]
