"""Incident management API — lifecycle, timeline, alerts and postmortems."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user, require_roles
from app.db import get_db
from app.models.core import User
from app.models.incidents import Incident, utcnow
from app.schemas.incidents import (
    AlertOut,
    IncidentCreate,
    IncidentOut,
    IncidentPatch,
    PostmortemOut,
    TimelineEntryIn,
    TimelineEntryOut,
)
from app.services.incidents import (
    ALERT_RUNBOOKS,
    add_timeline_entry,
    build_postmortem,
    duration_minutes,
    firing_alerts,
    next_reference,
    severity_expectation,
)

router = APIRouter(prefix="/api/incidents", tags=["incidents"])
logger = logging.getLogger("iberia.incidents")

STATUS_EVENTS = {"open": "declared", "mitigated": "mitigated", "resolved": "resolved"}


def _serialise(incident: Incident) -> IncidentOut:
    out = IncidentOut.model_validate(incident)
    out.duration_minutes = duration_minutes(incident)
    out.response_expectation = severity_expectation(incident.severity)
    return out


def _get_incident(db: Session, incident_id: int) -> Incident:
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Incident not found")
    return incident


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(_user: User = Depends(current_user)) -> list[AlertOut]:
    """Currently firing/pending alerts, derived from live metrics and chaos toggles."""
    alerts = [AlertOut.model_validate(alert) for alert in firing_alerts()]
    record_domain_event("incidents", "alerts_polled")
    return alerts


@router.get("", response_model=list[IncidentOut])
def list_incidents(
    status_filter: str | None = Query(default=None, alias="status"),
    severity: int | None = Query(default=None, ge=0, le=3),
    service: str | None = None,
    _user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[IncidentOut]:
    stmt = select(Incident).order_by(Incident.started_at.desc())
    if status_filter:
        stmt = stmt.where(Incident.status == status_filter)
    if severity is not None:
        stmt = stmt.where(Incident.severity == severity)
    if service:
        stmt = stmt.where(Incident.service == service)
    return [_serialise(incident) for incident in db.scalars(stmt)]


@router.post("", response_model=IncidentOut, status_code=status.HTTP_201_CREATED)
def declare_incident(
    payload: IncidentCreate,
    user: User = Depends(require_roles("ops", "sre", "admin")),
    db: Session = Depends(get_db),
) -> IncidentOut:
    runbook = payload.runbook or ALERT_RUNBOOKS.get(payload.alert_name or "")
    incident = Incident(
        reference=next_reference(db),
        title=payload.title,
        severity=payload.severity,
        status="open",
        service=payload.service,
        summary=payload.summary,
        commander=payload.commander or user.full_name,
        slo_impact=payload.slo_impact,
        runbook=runbook,
        alert_name=payload.alert_name,
        started_at=utcnow(),
    )
    db.add(incident)
    db.flush()
    add_timeline_entry(
        db,
        incident,
        kind="detect",
        message=(
            f"Incident declared as Sev{incident.severity} on {incident.service}"
            + (f" from alert {incident.alert_name}" if incident.alert_name else "")
        ),
        author=user.full_name,
    )
    db.commit()
    db.refresh(incident)
    record_domain_event("incidents", "declared")
    log_event(
        logger,
        logging.WARNING,
        "incident declared",
        reference=incident.reference,
        severity=incident.severity,
        service=incident.service,
        commander=incident.commander,
        actor=user.email,
    )
    return _serialise(incident)


@router.get("/{incident_id}", response_model=IncidentOut)
def get_incident(
    incident_id: int,
    _user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> IncidentOut:
    return _serialise(_get_incident(db, incident_id))


# NOTE(demo): planted VULN-131 — lifecycle mutation only depends on `current_user`, so any
# authenticated principal (including a customer) can resolve or downgrade an incident.
@router.patch("/{incident_id}", response_model=IncidentOut)
def patch_incident(
    incident_id: int,
    payload: IncidentPatch,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> IncidentOut:
    incident = _get_incident(db, incident_id)
    previous_status = incident.status
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)

    if payload.status is not None:
        incident.status = payload.status
    if payload.severity is not None:
        incident.severity = payload.severity
    if payload.commander is not None:
        incident.commander = payload.commander
    if payload.resolution is not None:
        incident.resolution = payload.resolution

    new_status = payload.status
    if new_status == "resolved" and incident.resolved_at is None:
        incident.resolved_at = utcnow()
    if new_status in {"open", "mitigated"}:
        incident.resolved_at = None

    if new_status and new_status != previous_status:
        kind = "resolve" if new_status == "resolved" else "mitigation"
        add_timeline_entry(
            db,
            incident,
            kind=kind,
            message=f"Status changed {previous_status} → {new_status}",
            author=user.full_name,
        )
        record_domain_event("incidents", STATUS_EVENTS.get(new_status, "updated"))
    if "severity" in updates:
        record_domain_event("incidents", "severity_changed")

    db.commit()
    db.refresh(incident)
    log_event(
        logger,
        logging.WARNING,
        "incident updated",
        reference=incident.reference,
        changes=sorted(updates),
        actor=user.email,
        actor_role=user.role,
    )
    return _serialise(incident)


@router.post(
    "/{incident_id}/timeline",
    response_model=TimelineEntryOut,
    status_code=status.HTTP_201_CREATED,
)
def append_timeline_entry(
    incident_id: int,
    payload: TimelineEntryIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> TimelineEntryOut:
    incident = _get_incident(db, incident_id)
    # NOTE(demo): planted VULN-130 — the note is persisted verbatim (no sanitisation or
    # output encoding) and the ops console renders it as HTML.
    entry = add_timeline_entry(
        db, incident, kind=payload.kind, message=payload.message, author=user.full_name
    )
    db.commit()
    db.refresh(entry)
    record_domain_event("incidents", f"timeline_{payload.kind}")
    log_event(
        logger,
        logging.INFO,
        "incident timeline entry",
        reference=incident.reference,
        kind=payload.kind,
        actor=user.email,
    )
    return TimelineEntryOut.model_validate(entry)


@router.get("/{incident_id}/postmortem", response_model=PostmortemOut)
def get_postmortem(
    incident_id: int,
    _user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PostmortemOut:
    incident = _get_incident(db, incident_id)
    record_domain_event("incidents", "postmortem_generated")
    return PostmortemOut(incident_id=incident.id, markdown=build_postmortem(incident))
