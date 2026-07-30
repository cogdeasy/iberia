"""Platform support console API.

Backs the `/support` page: the passenger support inbox, the message "preview" renderer and
the operations broadcast panel. This is platform tooling rather than a business domain, so it
lives under ``/api/platform`` and does not overlap any domain prefix in SPEC.md.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.observability import log_event, record_domain_event
from app.core.security import current_user
from app.db import get_db
from app.models.core import User
from app.models.platform_support import SupportBroadcast, SupportMessage
from app.schemas.platform_support import (
    BroadcastIn,
    BroadcastOut,
    PlatformConfigOut,
    PreviewIn,
    PreviewOut,
    SupportMessageOut,
)

router = APIRouter(prefix="/api/platform", tags=["platform"])
logger = logging.getLogger("iberia.platform")

# Headers the edge proxy is supposed to add. NOTE(demo): planted VULN-151 — no middleware sets
# them, so this map is reported as all-false by /api/platform/config.
EXPECTED_SECURITY_HEADERS = (
    "strict-transport-security",
    "content-security-policy",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
)


@router.get("/config", response_model=PlatformConfigOut)
def platform_config() -> PlatformConfigOut:
    """Runtime platform posture shown on the support console footer."""
    return PlatformConfigOut(
        env=settings.env,
        app_name=settings.app_name,
        cors_origins=settings.cors_origins,
        cors_allow_all=settings.cors_allow_all,
        jwt_ttl_minutes=settings.jwt_ttl_minutes,
        # NOTE(demo): planted VULN-151 — nothing in the stack emits these headers.
        security_headers=dict.fromkeys(EXPECTED_SECURITY_HEADERS, False),
    )


@router.get("/support/messages", response_model=list[SupportMessageOut])
def list_support_messages(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[SupportMessage]:
    stmt = select(SupportMessage).order_by(SupportMessage.created_at.desc())
    if user.role == "customer":
        stmt = stmt.where(SupportMessage.author_email == user.email)
    messages = list(db.scalars(stmt))
    record_domain_event("platform", "support_inbox_viewed")
    return messages


@router.post("/support/preview", response_model=PreviewOut)
def preview_support_message(payload: PreviewIn) -> PreviewOut:
    """Render a support message body for the agent's preview pane.

    The support console renders the returned ``html`` with ``dangerouslySetInnerHTML`` so that
    agents can use bold text and links in their replies.
    """
    # NOTE(demo): planted VULN-170 — the body is echoed back as HTML with no sanitisation or
    # escaping, which the frontend then injects into the DOM (reflected XSS).
    html = f"<div class='support-preview'>{payload.body}</div>"
    record_domain_event("platform", "support_preview_rendered")
    return PreviewOut(subject=payload.subject, html=html, rendered_by="support-console")


@router.post("/support/broadcast", response_model=BroadcastOut, status_code=201)
def send_broadcast(
    payload: BroadcastIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> SupportBroadcast:
    """Send an operations broadcast to a passenger audience.

    The UI only offers this to admins.
    """
    # NOTE(demo): planted VULN-172 — the admin gate lives in the React component only; there is
    # no require_roles("admin", "ops") dependency here, so any authenticated caller can send a
    # broadcast to every passenger.
    broadcast = SupportBroadcast(
        audience=payload.audience,
        subject=payload.subject,
        body_html=payload.body,
        sent_by=user.email,
    )
    db.add(broadcast)
    db.commit()
    db.refresh(broadcast)
    record_domain_event("platform", "support_broadcast_sent")
    log_event(
        logger,
        logging.INFO,
        "support broadcast sent",
        audience=broadcast.audience,
        sent_by=broadcast.sent_by,
        role=user.role,
        broadcast_id=broadcast.id,
    )
    return broadcast


@router.get("/support/broadcasts", response_model=list[BroadcastOut])
def list_broadcasts(
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[SupportBroadcast]:
    return list(db.scalars(select(SupportBroadcast).order_by(SupportBroadcast.created_at.desc())))
