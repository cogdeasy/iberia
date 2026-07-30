"""Reusable audit-trail helper.

Any domain can record a security-relevant action:

    from app.services.audit import record_audit
    record_audit(db, actor=user.email, action="booking.cancel", target=pnr, outcome="success")

``audit_mutations`` is a FastAPI dependency that records authenticated mutating requests
(POST/PATCH/PUT/DELETE) automatically. Attach it to a router:

    router = APIRouter(prefix="/api/booking", dependencies=[Depends(audit_mutations)])
"""

import logging

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event, request_id_ctx
from app.core.security import bearer_scheme, decode_access_token
from app.db import get_db
from app.models.security import AuditEvent

logger = logging.getLogger("iberia.audit")

MUTATING_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


def record_audit(
    db: Session,
    actor: str,
    action: str,
    target: str = "",
    outcome: str = "success",
    ip: str | None = None,
) -> AuditEvent:
    """Append an entry to the audit trail and mirror it into the structured log."""
    # NOTE(demo): planted VULN-141 — actor-controlled `action`/`target`/`outcome` are
    # persisted and logged verbatim, so embedded CR/LF can forge extra audit lines.
    event = AuditEvent(
        actor=actor,
        action=action,
        target=target,
        outcome=outcome,
        ip=ip,
        request_id=request_id_ctx.get(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    record_domain_event("security", "audit_event")
    log_event(
        logger,
        logging.INFO,
        f"audit actor={actor} action={action} target={target} outcome={outcome}",
        actor=actor,
        action=action,
        target=target,
        outcome=outcome,
        ip=ip,
    )
    return event


def _actor_from_request(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        payload = decode_access_token(token)
    except Exception:  # noqa: BLE001 - unauthenticated traffic is simply not audited
        return None
    subject = payload.get("sub")
    return str(subject) if subject else None


def audit_mutations(
    request: Request,
    db: Session = Depends(get_db),
    _credentials: object = Depends(bearer_scheme),
) -> None:
    """Record authenticated mutating requests with actor, route and request id."""
    if request.method.upper() not in MUTATING_METHODS:
        return
    actor = _actor_from_request(request)
    if actor is None:
        return
    record_audit(
        db,
        actor=actor,
        action=f"http.{request.method.lower()}",
        target=request.scope.get("path", "unknown"),
        outcome="accepted",
        ip=request.client.host if request.client else None,
    )
