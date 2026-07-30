"""Security console: audit trail, findings register and posture score."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user, require_roles
from app.db import get_db
from app.models.core import User
from app.models.security import AuditEvent
from app.schemas.security import AuditEventIn, AuditEventOut, Finding, Posture
from app.services import security as security_service
from app.services.audit import audit_mutations, record_audit

logger = logging.getLogger("iberia.security")

router = APIRouter(
    prefix="/api/security",
    tags=["security"],
    dependencies=[Depends(audit_mutations)],
)


@router.get("/audit", response_model=list[AuditEventOut])
def list_audit(
    limit: int = 100,
    actor: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[AuditEvent]:
    """Read the platform audit trail.

    NOTE(demo): planted VULN-140 — this is a privileged, PII-bearing view but the
    dependency above is `current_user` instead of `require_roles("admin", "sre")`, so any
    authenticated principal (including `customer`) can read every actor, IP and action.
    """
    statement = select(AuditEvent).order_by(AuditEvent.id.desc())
    if actor:
        statement = statement.where(AuditEvent.actor == actor)
    if action:
        statement = statement.where(AuditEvent.action == action)
    if outcome:
        statement = statement.where(AuditEvent.outcome == outcome)
    events = list(db.scalars(statement.limit(max(1, min(limit, 1000)))))
    log_event(
        logger,
        logging.INFO,
        "audit trail read",
        reader=user.email,
        reader_role=user.role,
        returned=len(events),
    )
    record_domain_event("security", "audit_read")
    return events


@router.post("/audit/events", response_model=AuditEventOut, status_code=status.HTTP_201_CREATED)
def create_audit_event(
    payload: AuditEventIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> AuditEvent:
    """Append a client-supplied entry to the audit trail (used by front-end workflows).

    NOTE(demo): planted VULN-141 — `action`, `target` and `outcome` are stored and logged
    with no validation or CR/LF stripping, so a caller can inject newlines and forge
    additional audit/log records attributed to other actors.
    """
    return record_audit(
        db,
        actor=user.email,
        action=payload.action,
        target=payload.target,
        outcome=payload.outcome,
        ip=request.client.host if request.client else None,
    )


@router.get("/findings", response_model=list[Finding])
def list_findings(
    severity: str | None = None,
    domain: str | None = None,
    _user: User = Depends(require_roles("admin", "sre")),
) -> list[Finding]:
    items = security_service.findings()
    if severity:
        items = [f for f in items if f.severity == severity.lower()]
    if domain:
        items = [f for f in items if f.domain.lower() == domain.lower()]
    record_domain_event("security", "findings_listed")
    return items


@router.post("/findings/refresh", response_model=list[Finding])
def refresh_findings(_user: User = Depends(require_roles("admin", "sre"))) -> list[Finding]:
    """Reparse docs/vulnerabilities so newly merged findings show up without a restart."""
    return security_service.findings(refresh=True)


@router.get("/findings/{finding_id}", response_model=Finding)
def get_finding(
    finding_id: str,
    _user: User = Depends(require_roles("admin", "sre")),
) -> Finding:
    wanted = finding_id.upper()
    for finding in security_service.findings():
        if finding.id.upper() == wanted:
            return finding
    raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown finding {finding_id}")


@router.get("/posture", response_model=Posture)
def get_posture(_user: User = Depends(require_roles("admin", "sre"))) -> Posture:
    record_domain_event("security", "posture_read")
    return security_service.posture(security_service.findings())
