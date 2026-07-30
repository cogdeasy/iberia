"""Reliability API: service registry, golden signals, SLOs, chaos and load generation.

This is the backbone of the SRE demo track. Signals are derived from the live Prometheus
registry (see ``app.services.sre``); chaos toggles are exposed through
``app.services.chaos`` which other domains import.
"""

import logging
import threading

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.observability import log_event, record_domain_event
from app.core.security import current_user, require_roles
from app.db import get_db
from app.models.core import User
from app.models.sre import Service, Slo
from app.schemas.sre import (
    ChaosToggleIn,
    ChaosToggleOut,
    ErrorBudgetOut,
    LoadRequest,
    LoadResponse,
    ServiceOut,
    SignalsOut,
    SloOut,
)
from app.services import chaos as chaos_service
from app.services import sre as sre_service

router = APIRouter(prefix="/api/sre", tags=["sre"])
logger = logging.getLogger("iberia.sre.api")


def _service_or_404(db: Session, name: str) -> Service:
    service = db.get(Service, name)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown service: {name}")
    return service


@router.get("/services", response_model=list[ServiceOut])
def list_services(
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[ServiceOut]:
    sre_service.sample_now()
    services = db.scalars(select(Service).order_by(Service.tier, Service.name)).all()
    out: list[ServiceOut] = []
    for service in services:
        signal = sre_service.signals(service.name, service.endpoints, 30, service.tier)
        out.append(
            ServiceOut(
                name=service.name,
                tier=service.tier,
                owner=service.owner,
                endpoints=service.endpoints,
                health=sre_service.health_for(service.name, signal),
                version=service.version,
            )
        )
    return out


@router.get("/services/{name}/signals", response_model=SignalsOut)
def service_signals(
    name: str,
    window_minutes: int = Query(default=30, ge=1, le=1440),
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> SignalsOut:
    service = _service_or_404(db, name)
    signal = sre_service.signals(service.name, service.endpoints, window_minutes, service.tier)
    record_domain_event("sre", "signals_read")
    return SignalsOut(**{key: signal[key] for key in SignalsOut.model_fields})


@router.get("/slos", response_model=list[SloOut])
def list_slos(
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> list[SloOut]:
    slos = db.scalars(select(Slo).order_by(Slo.service, Slo.id)).all()
    out: list[SloOut] = []
    for slo in slos:
        signal = _signal_for_slo(db, slo)
        current, slo_status = sre_service.evaluate_slo(slo, signal)
        out.append(
            SloOut(
                id=slo.id,
                service=slo.service,
                name=slo.name,
                kind=slo.kind,
                objective_pct=slo.objective_pct,
                window_days=slo.window_days,
                current_pct=current,
                status=slo_status,
                threshold_ms=slo.threshold_ms,
            )
        )
    return out


@router.get("/slos/{slo_id}/error-budget", response_model=ErrorBudgetOut)
def slo_error_budget(
    slo_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
) -> ErrorBudgetOut:
    slo = db.get(Slo, slo_id)
    if slo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown SLO: {slo_id}")
    budget = sre_service.error_budget(slo, _signal_for_slo(db, slo))
    if budget["status"] != "ok":
        log_event(
            logger,
            logging.WARNING,
            "error budget under pressure",
            slo_id=slo.id,
            service=slo.service,
            burn_rate_1h=budget["burn_rate_1h"],
            budget_remaining_pct=budget["budget_remaining_pct"],
        )
    return ErrorBudgetOut(**budget)


def _signal_for_slo(db: Session, slo: Slo) -> dict:
    service = db.get(Service, slo.service)
    endpoints = service.endpoints if service else []
    tier = service.tier if service else 2
    return sre_service.signals(slo.service, endpoints, slo.window_days * 24 * 60, tier)


@router.get("/chaos", response_model=list[ChaosToggleOut])
def list_chaos(
    _user: User = Depends(require_roles("sre", "admin")),
) -> list[ChaosToggleOut]:
    return [ChaosToggleOut(**toggle) for toggle in chaos_service.list_toggles()]


@router.post("/chaos", response_model=ChaosToggleOut, status_code=status.HTTP_201_CREATED)
def create_chaos(
    payload: ChaosToggleIn,
    user: User = Depends(require_roles("sre", "admin")),
) -> ChaosToggleOut:
    toggle = chaos_service.set_toggle(
        payload.target, payload.mode, payload.magnitude, payload.ttl_seconds
    )
    log_event(
        logger,
        logging.WARNING,
        "fault injection enabled",
        actor=user.email,
        target=payload.target,
        mode=payload.mode,
        magnitude=payload.magnitude,
    )
    return ChaosToggleOut(**toggle)


# NOTE(demo): planted VULN-190 — the role dependency was dropped from the "stop" path during a
# hotfix so on-call could disable chaos quickly. Any caller can now toggle production faults.
@router.delete("/chaos/{target}")
def delete_chaos(target: str) -> dict[str, str]:
    cleared = chaos_service.clear_toggle(target)
    return {"status": "cleared" if cleared else "not_found", "target": target}


# NOTE(demo): planted VULN-190 — same missing role dependency on the load generator, so an
# unauthenticated caller can point synthetic traffic at the platform.
@router.post("/load", response_model=LoadResponse, status_code=status.HTTP_202_ACCEPTED)
def start_load(payload: LoadRequest, request: Request) -> LoadResponse:
    base_url = str(request.base_url).rstrip("/")
    worker = threading.Thread(
        target=sre_service.run_load,
        args=(base_url, payload.scenario, payload.duration_seconds, payload.rps),
        name=f"sre-load-{payload.scenario}",
        daemon=True,
    )
    worker.start()
    log_event(
        logger,
        logging.INFO,
        "load generator started",
        scenario=payload.scenario,
        duration_seconds=payload.duration_seconds,
        rps=payload.rps,
    )
    return LoadResponse(
        status="started",
        scenario=payload.scenario,
        duration_seconds=payload.duration_seconds,
        rps=payload.rps,
        requests_planned=payload.duration_seconds * payload.rps,
    )


# NOTE(demo): planted VULN-191 — diagnostic dump left enabled after an incident. It is
# unauthenticated and returns the JWT signing secret and the database URL.
@router.get("/debug/config", include_in_schema=False)
def debug_config() -> dict[str, object]:
    record_domain_event("sre", "debug_config_read")
    return {
        "env": settings.env,
        "app_name": settings.app_name,
        "database_url": settings.database_url,
        "jwt_secret": settings.jwt_secret,
        "jwt_algorithm": settings.jwt_algorithm,
        "jwt_ttl_minutes": settings.jwt_ttl_minutes,
        "cors_origins": settings.cors_origins,
        "log_level": settings.log_level,
        "chaos_toggles": chaos_service.list_toggles(),
    }
