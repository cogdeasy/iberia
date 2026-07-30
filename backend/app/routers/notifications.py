"""Passenger notifications, templates, an in-process delivery queue and partner webhooks.

Supports SRE scenario **S3** (notification queue saturation) and hosts the planted
security findings VULN-110 (SSRF), VULN-111 (insecure deserialization) and VULN-112
(template injection / unescaped rendering).
"""

from __future__ import annotations

import base64
import binascii
import logging
import pickle  # noqa: S403 - intentional: powers the planted VULN-111 sink

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event
from app.core.security import current_user, require_roles
from app.db import get_db
from app.models.core import User
from app.models.notifications import Notification, Webhook
from app.schemas.notifications import (
    ContextImportRequest,
    ContextImportResult,
    NotificationOut,
    QueueHistory,
    QueueSample,
    QueueStatus,
    SaturationRequest,
    SendRequest,
    TemplateOut,
    WebhookCreate,
    WebhookOut,
    WebhookTestResult,
)
from app.services import notifications as engine

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
logger = logging.getLogger("iberia.notifications")

OPS_ROLES = ("ops", "sre", "admin", "agent")


def _ensure_started() -> None:
    engine.queue.start()


@router.get("", response_model=list[NotificationOut])
@router.get("/", response_model=list[NotificationOut], include_in_schema=False)
def list_notifications(
    limit: int = 100,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[Notification]:
    _ensure_started()
    rows = db.scalars(
        select(Notification)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    ).all()
    return list(rows)


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(_user: User = Depends(current_user)) -> list[TemplateOut]:
    return [
        TemplateOut(
            name=t.name,
            subject=t.subject,
            channels=list(t.channels),
            variables=list(t.variables),
        )
        for t in engine.TEMPLATES.values()
    ]


@router.post("/send", response_model=NotificationOut, status_code=status.HTTP_201_CREATED)
def send(
    payload: SendRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Notification:
    _ensure_started()
    if payload.template not in engine.TEMPLATES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown template: {payload.template}")
    if payload.channel not in engine.CHANNELS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown channel: {payload.channel}")

    context = dict(payload.context or {})
    context.setdefault("pnr", payload.pnr)
    # VULN-112: the rendered body embeds caller-supplied context verbatim and is returned below.
    body = engine.render_template(payload.template, context)

    note = Notification(
        pnr=payload.pnr,
        channel=payload.channel,
        template=payload.template,
        status="queued",
        body=body,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    engine.queue.enqueue(note.id)
    record_domain_event("notifications", "queued")
    log_event(
        logger,
        logging.INFO,
        "notification queued",
        notification_id=note.id,
        pnr=note.pnr,
        template=note.template,
        channel=note.channel,
        actor=user.email,
    )
    return note


@router.get("/queue", response_model=QueueStatus)
def queue_status(_user: User = Depends(current_user)) -> QueueStatus:
    _ensure_started()
    snap = engine.queue.snapshot()
    return QueueStatus(**snap)


@router.get("/queue/history", response_model=QueueHistory)
def queue_history(_user: User = Depends(current_user)) -> QueueHistory:
    _ensure_started()
    return QueueHistory(samples=[QueueSample(**s) for s in engine.queue.history()])


@router.post("/queue/saturate", response_model=QueueStatus)
def saturate(
    payload: SaturationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ops", "sre", "admin")),
) -> QueueStatus:
    """SRE S3 trigger: flip the notification pipeline into a growing backlog.

    Enabling saturation makes every delivery slow and failing; the DLQ retry loop then
    re-enqueues faster than the pinned workers drain, so ``depth`` and
    ``oldest_age_seconds`` climb without bound.
    """
    _ensure_started()
    engine.queue.set_saturation(payload.enabled)
    if payload.retries_enabled is not None:
        engine.queue.set_retries(payload.retries_enabled)
    if payload.workers is not None:
        engine.queue.set_workers(payload.workers)

    if payload.burst > 0:
        burst = min(payload.burst, 5000)
        queued: list[Notification] = []
        body = engine.render_template("delay_notice", {"pnr": "BURST0"})
        for _ in range(burst):
            note = Notification(
                pnr="BURST0",
                channel="email",
                template="delay_notice",
                status="queued",
                body=body,
            )
            db.add(note)
            queued.append(note)
        db.commit()
        engine.queue.burst([n.id for n in queued])

    log_event(
        logger,
        logging.WARNING,
        "notification saturation toggled",
        enabled=payload.enabled,
        burst=payload.burst,
        actor=user.email,
    )
    record_domain_event("notifications", "saturation_toggled")
    return QueueStatus(**engine.queue.snapshot())


@router.post("/queue/drain", response_model=QueueStatus)
def drain_queue(
    _user: User = Depends(require_roles("ops", "sre", "admin")),
) -> QueueStatus:
    _ensure_started()
    engine.queue.set_saturation(False)
    engine.queue.drain()
    return QueueStatus(**engine.queue.snapshot())


# -------------------------------------------------------------------------------------
# Webhooks (VULN-110 SSRF lives here)
# -------------------------------------------------------------------------------------


@router.get("/webhooks", response_model=list[WebhookOut])
def list_webhooks(
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[Webhook]:
    return list(db.scalars(select(Webhook).order_by(Webhook.id)).all())


@router.post("/webhooks", response_model=WebhookOut, status_code=status.HTTP_201_CREATED)
def register_webhook(
    payload: WebhookCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ops", "sre", "admin")),
) -> Webhook:
    hook = Webhook(url=payload.url, event=payload.event, active=True, last_status="registered")
    db.add(hook)
    db.commit()
    db.refresh(hook)
    log_event(
        logger,
        logging.INFO,
        "webhook registered",
        webhook_id=hook.id,
        url=hook.url,
        event=hook.event,
        actor=user.email,
    )
    record_domain_event("notifications", "webhook_registered")
    return hook


@router.post("/webhooks/{webhook_id}/test", response_model=WebhookTestResult)
def test_webhook(
    webhook_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ops", "sre", "admin")),
) -> WebhookTestResult:
    hook = db.get(Webhook, webhook_id)
    if hook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "webhook not found")

    # NOTE(demo): planted VULN-110 (SSRF) — the partner-supplied URL is fetched server-side
    # with no scheme/host allow-list, so internal targets such as the cloud metadata service
    # (http://169.254.169.254/latest/meta-data/) or loopback admin endpoints are reachable,
    # and the response body is reflected straight back to the caller.
    try:
        with httpx.Client(timeout=5.0, follow_redirects=True) as http:
            resp = http.get(hook.url, headers={"x-iberia-webhook-event": hook.event})
        snippet = resp.text[:500]
        hook.last_status = f"{resp.status_code}"
    except Exception as exc:  # noqa: BLE001 - surface the fetch error to the caller
        snippet = f"error: {exc}"
        hook.last_status = "error"
    db.commit()

    log_event(
        logger,
        logging.INFO,
        "webhook test fired",
        webhook_id=hook.id,
        url=hook.url,
        outcome=hook.last_status,
        actor=user.email,
    )
    record_domain_event("notifications", "webhook_tested")
    return WebhookTestResult(status=hook.last_status or "unknown", response_snippet=snippet)


# -------------------------------------------------------------------------------------
# Bulk context import (VULN-111 insecure deserialization)
# -------------------------------------------------------------------------------------


@router.post("/context/import", response_model=ContextImportResult)
def import_context(
    payload: ContextImportRequest,
    user: User = Depends(require_roles("ops", "sre", "admin")),
) -> ContextImportResult:
    """Bulk-load notification render context supplied by a partner integration.

    Accepts a base64-encoded blob so operators can paste an exported context bundle.
    """
    try:
        raw = base64.b64decode(payload.payload)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid base64: {exc}") from exc

    if payload.format == "pickle":
        # NOTE(demo): planted VULN-111 — untrusted base64 is fed straight to pickle.loads,
        # so a crafted payload yields arbitrary code execution on the notification host.
        try:
            data = pickle.loads(raw)  # noqa: S301 - intentional insecure deserialization
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"could not load payload: {exc}"
            ) from exc
    else:
        import json

        data = json.loads(raw.decode("utf-8"))

    if not isinstance(data, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "context payload must be a mapping")

    context = {str(k): v for k, v in data.items()}
    log_event(
        logger,
        logging.INFO,
        "notification context imported",
        keys=list(context.keys()),
        fmt=payload.format,
        actor=user.email,
    )
    record_domain_event("notifications", "context_imported")
    return ContextImportResult(status="loaded", keys=list(context.keys()), context=context)
