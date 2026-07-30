"""Identity & authentication router.

Implements ``/api/auth`` and ``/api/users`` per ``docs/API_CONTRACTS.md``.

This module also hosts the identity security-track planted vulnerabilities VULN-001..005.
They are intentional and documented under ``docs/vulnerabilities/``; do not "fix" them.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.observability import log_event, record_domain_event
from app.core.security import (
    create_access_token,
    current_user,
    hash_password,
    verify_password,
)
from app.db import get_db
from app.models.core import User
from app.models.identity import ApiKey, PasswordResetToken
from app.schemas.identity import (
    ApiKeyCreated,
    ApiKeyCreateRequest,
    ApiKeyOut,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordResetResponse,
    RegisterRequest,
    StatusResponse,
    TokenResponse,
    UserOut,
)

auth_router = APIRouter(prefix="/api/auth", tags=["identity"])
users_router = APIRouter(prefix="/api/users", tags=["identity"])

logger = logging.getLogger("iberia.identity")

# NOTE(demo): planted VULN-005 — access tokens are minted with a 30-day lifetime, far longer
# than a session needs, so a leaked token stays valid for weeks and cannot be revoked.
LONG_LIVED_TTL = timedelta(days=30)

_identity_bearer = HTTPBearer(auto_error=False)


def _issue_token(user: User) -> str:
    expires = datetime.now(tz=timezone.utc) + LONG_LIVED_TTL
    return create_access_token(user.email, user.role, extra={"exp": expires})


def identity_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_identity_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the caller from a bearer token.

    NOTE(demo): planted VULN-005 (alg confusion) — this verifier accepts both ``HS256`` and
    the ``none`` algorithm, so a token whose header says ``alg: none`` is trusted without any
    signature. An attacker can forge an unsigned token for any subject/role.
    """
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") == "none":
            payload = jwt.decode(token, options={"verify_signature": False})
        else:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256", "none"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    user = db.scalar(select(User).where(User.email == payload.get("sub")))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown or inactive user")
    return user


@auth_router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    # NOTE(demo): planted VULN-001 — account enumeration + no rate limiting. A missing account
    # yields a distinct 404 while a wrong password yields 401, and there is no attempt throttle,
    # so an attacker can both enumerate valid emails and brute-force passwords freely.
    if user is None:
        log_event(logger, logging.INFO, "login unknown email", email=payload.email)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account registered with that email")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect password")
    record_domain_event("identity", "login")
    log_event(logger, logging.INFO, "login success", email=user.email, role=user.role)
    return TokenResponse(access_token=_issue_token(user), user=UserOut.model_validate(user))


@auth_router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> User:
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=payload.email,
        full_name=payload.full_name,
        role="customer",
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    record_domain_event("identity", "register")
    log_event(logger, logging.INFO, "user registered", email=user.email)
    return user


@auth_router.get("/me", response_model=UserOut)
def me(user: User = Depends(identity_user)) -> User:
    return user


@auth_router.post("/password-reset", response_model=PasswordResetResponse)
def password_reset(
    payload: PasswordResetRequest, db: Session = Depends(get_db)
) -> PasswordResetResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None:
        return PasswordResetResponse(status="sent")
    token = secrets.token_urlsafe(24)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.now(tz=timezone.utc) + timedelta(hours=1),
        )
    )
    db.commit()
    record_domain_event("identity", "password_reset_requested")
    # NOTE(demo): planted VULN-002 — the reset token is returned in the response body AND
    # written to the logs, so anyone who can see either can take over the account.
    log_event(logger, logging.INFO, "password reset issued", email=user.email, reset_token=token)
    return PasswordResetResponse(status="sent", reset_token=token)


@auth_router.post("/password-reset/confirm", response_model=StatusResponse)
def password_reset_confirm(
    payload: PasswordResetConfirm, db: Session = Depends(get_db)
) -> StatusResponse:
    row = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token == payload.token,
            PasswordResetToken.used.is_(False),
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or used token")
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(tz=timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Token expired")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid token")
    user.password_hash = hash_password(payload.new_password)
    row.used = True
    db.commit()
    record_domain_event("identity", "password_reset_confirmed")
    return StatusResponse(status="reset")


@auth_router.post("/api-keys", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
def create_api_key(
    payload: ApiKeyCreateRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ApiKey:
    raw = f"ibk_{secrets.token_hex(20)}"
    api_key = ApiKey(user_id=user.id, name=payload.name, key=raw, prefix=raw[:12])
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    record_domain_event("identity", "api_key_issued")
    return api_key


@auth_router.get("/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[ApiKey]:
    return list(db.scalars(select(ApiKey).where(ApiKey.user_id == user.id)).all())


@auth_router.delete("/api-keys/{key_id}", response_model=StatusResponse)
def revoke_api_key(
    key_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> StatusResponse:
    api_key = db.get(ApiKey, key_id)
    if api_key is None or api_key.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
    api_key.active = False
    db.commit()
    record_domain_event("identity", "api_key_revoked")
    return StatusResponse(status="revoked")


@users_router.get("", response_model=list[UserOut])
def list_users(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[User]:
    # NOTE(demo): planted VULN-004 — missing function-level authorization. The contract marks
    # this admin/agent-only, but it only checks authentication, so any logged-in customer can
    # enumerate every user and their email address.
    return list(db.scalars(select(User).order_by(User.id)).all())


@users_router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int, _caller: User = Depends(current_user), db: Session = Depends(get_db)
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return target


_USER_COLUMNS = {c.key for c in User.__table__.columns}


@users_router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    request: Request,
    _caller: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Body must be an object")
    # NOTE(demo): planted VULN-003 — mass assignment / privilege escalation. The request body
    # is applied field-by-field with no allow-list, so a customer can set "role": "admin" or
    # "is_active": false on themselves or on any other user.
    for field, value in body.items():
        if field in _USER_COLUMNS and field != "id":
            setattr(target, field, value)
    db.commit()
    db.refresh(target)
    record_domain_event("identity", "profile_updated")
    log_event(logger, logging.INFO, "user updated", user_id=user_id, fields=list(body.keys()))
    return target


# Mounted by ``app.main.discover_routers``, which looks for a module-level ``router``. The
# identity domain owns two prefixes (``/api/auth`` and ``/api/users``), so they are combined
# here rather than editing the shared ``main.py``.
router = APIRouter()
router.include_router(auth_router)
router.include_router(users_router)
