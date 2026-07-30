from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db

router = APIRouter(tags=["platform"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "env": settings.env, "service": "iberia-api"}


@router.get("/readyz")
def readyz(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ready", "database": "reachable"}
