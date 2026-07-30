"""Structured logging, request correlation and Prometheus metrics.

The SRE demo relies on three things being always-on:
  * every log line is JSON with a ``request_id`` and ``route``
  * every HTTP request updates the ``iberia_http_*`` metric families
  * ``/metrics`` exposes the Prometheus text format
"""

import json
import logging
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

HTTP_REQUESTS = Counter(
    "iberia_http_requests_total",
    "HTTP requests handled by the Iberia backend",
    ["method", "route", "status"],
)
HTTP_LATENCY = Histogram(
    "iberia_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
HTTP_IN_FLIGHT = Gauge("iberia_http_in_flight_requests", "In-flight HTTP requests")
DOMAIN_EVENTS = Counter(
    "iberia_domain_events_total",
    "Business events emitted by domain services",
    ["domain", "event"],
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_ctx.get(),
            "env": settings.env,
        }
        for key, value in getattr(record, "extra_fields", {}).items():
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level)
    for noisy in ("uvicorn.access", "uvicorn.error"):
        logging.getLogger(noisy).handlers = [handler]
        logging.getLogger(noisy).propagate = False


def log_event(logger: logging.Logger, level: int, message: str, **fields: object) -> None:
    logger.log(level, message, extra={"extra_fields": fields})


def record_domain_event(domain: str, event: str) -> None:
    DOMAIN_EVENTS.labels(domain=domain, event=event).inc()


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        route = request.scope.get("path", "unknown")
        started = time.perf_counter()
        HTTP_IN_FLIGHT.inc()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["x-request-id"] = request_id
            return response
        finally:
            elapsed = time.perf_counter() - started
            HTTP_IN_FLIGHT.dec()
            HTTP_LATENCY.labels(request.method, route).observe(elapsed)
            HTTP_REQUESTS.labels(request.method, route, str(status_code)).inc()
            log_event(
                logging.getLogger("iberia.access"),
                logging.INFO,
                f"{request.method} {route} {status_code}",
                method=request.method,
                route=route,
                status=status_code,
                duration_ms=round(elapsed * 1000, 2),
            )
            request_id_ctx.reset(token)


def metrics_response() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
