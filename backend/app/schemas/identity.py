"""Pydantic schemas for the identity domain.

Field names/types mirror ``docs/API_CONTRACTS.md`` exactly:
``User = {id, email, full_name, role, iberia_plus_number, is_active, created_at}``.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: str
    iberia_plus_number: str | None = None
    is_active: bool
    created_at: datetime


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetResponse(BaseModel):
    status: str
    reset_token: str | None = None


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class StatusResponse(BaseModel):
    status: str


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prefix: str
    active: bool
    created_at: datetime
    last_used_at: datetime | None = None


class ApiKeyCreated(ApiKeyOut):
    key: str


class ApiKeyCreateRequest(BaseModel):
    name: str = "default"
