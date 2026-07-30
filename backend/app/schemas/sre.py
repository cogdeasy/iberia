from typing import Literal

from pydantic import BaseModel, Field

ChaosMode = Literal["latency", "error", "timeout", "slow_query", "saturation"]
LoadScenario = Literal["steady", "checkout_rush", "search_storm"]


class ServiceOut(BaseModel):
    name: str
    tier: int
    owner: str
    endpoints: list[str]
    health: Literal["healthy", "degraded", "down"]
    version: str


class SignalPoint(BaseModel):
    ts: str
    rpm: float
    error_rate: float
    p95_ms: float


class SignalsOut(BaseModel):
    service: str
    window_minutes: int
    traffic_rpm: float
    error_rate: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    saturation_pct: float
    synthetic: bool
    series: list[SignalPoint]


class SloOut(BaseModel):
    id: str
    service: str
    name: str
    kind: Literal["availability", "latency"]
    objective_pct: float
    window_days: int
    current_pct: float
    status: Literal["ok", "at_risk", "breached"]
    threshold_ms: float | None = None


class ErrorBudgetOut(BaseModel):
    slo_id: str
    objective: float
    achieved: float
    budget_remaining_pct: float
    burn_rate_1h: float
    burn_rate_6h: float
    status: Literal["ok", "at_risk", "breached"]


class ChaosToggleOut(BaseModel):
    target: str
    mode: ChaosMode
    magnitude: float
    active: bool
    expires_at: str | None = None


class ChaosToggleIn(BaseModel):
    target: str = Field(min_length=1, max_length=32)
    mode: ChaosMode
    magnitude: float = Field(default=500.0, ge=0, le=60000)
    ttl_seconds: int = Field(default=300, ge=1, le=3600)


class LoadRequest(BaseModel):
    scenario: LoadScenario = "steady"
    duration_seconds: int = Field(default=30, ge=1, le=600)
    rps: int = Field(default=5, ge=1, le=200)


class LoadResponse(BaseModel):
    status: str
    scenario: LoadScenario
    duration_seconds: int
    rps: int
    requests_planned: int
