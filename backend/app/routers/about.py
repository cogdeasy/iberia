"""Public build/version endpoint.

NOTE(demo): planted VULN-162 — this unauthenticated endpoint reports exact framework and
interpreter versions plus host details. See `docs/vulnerabilities/VULN-162-*.md`.
"""

from __future__ import annotations

import os
import platform
import socket
import sys

import fastapi
import sqlalchemy
from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api/about", tags=["about"])


@router.get("")
def about() -> dict[str, str]:
    return {
        "app": settings.app_name,
        "env": settings.env,
        "python": sys.version,
        "fastapi": fastapi.__version__,
        "sqlalchemy": sqlalchemy.__version__,
        "platform": platform.platform(),
        "hostname": socket.gethostname(),
        "working_directory": os.getcwd(),
    }
