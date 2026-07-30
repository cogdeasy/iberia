"""Iberia Digital Platform API.

Routers are auto-discovered: any module in ``app/routers/`` exposing a module-level
``router`` (``fastapi.APIRouter``) is mounted at startup. Domain teams therefore never
edit this file, which keeps parallel workstreams conflict-free.
"""

import importlib
import logging
import pkgutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.routers
from app.core.config import settings
from app.core.observability import (
    ObservabilityMiddleware,
    configure_logging,
    log_event,
    metrics_response,
)
from app.db import create_all

logger = logging.getLogger("iberia.startup")


def discover_routers() -> list[tuple[str, APIRouter]]:
    found: list[tuple[str, APIRouter]] = []
    for module_info in pkgutil.iter_modules(app.routers.__path__):
        if module_info.name.startswith("_"):
            continue
        module = importlib.import_module(f"app.routers.{module_info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            found.append((module_info.name, router))
    return sorted(found, key=lambda item: item[0])


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    create_all()
    log_event(logger, logging.INFO, "iberia backend ready", env=settings.env)
    yield


def create_app() -> FastAPI:
    configure_logging()
    application = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Booking, operations and reliability platform for Iberia Airlines.",
        lifespan=lifespan,
    )
    application.add_middleware(ObservabilityMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for name, router in discover_routers():
        application.include_router(router)
        log_event(logger, logging.INFO, "router mounted", router=name, prefix=router.prefix)

    @application.get("/metrics", include_in_schema=False)
    def metrics():  # noqa: ANN202
        return metrics_response()

    return application


app = create_app()
