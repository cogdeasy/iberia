"""Fault injection used by the SRE demo.

Public interface — other domains import exactly these two functions and nothing else::

    from app.services.chaos import apply_chaos, chaos_state

    apply_chaos("payments")     # no-op unless an SRE has armed a toggle for "payments"

``apply_chaos`` is intentionally cheap and side-effect free when no toggle is active so it
can be sprinkled through hot request paths. Toggles live in this process only (the demo runs
a single uvicorn worker) and expire on their own without a background reaper.
"""

import logging
import random
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import RLock

from app.core.observability import log_event, record_domain_event

logger = logging.getLogger("iberia.chaos")

MODES = ("latency", "error", "timeout", "slow_query", "saturation")

# Magnitude semantics per mode, surfaced in the UI so an operator knows what they are arming.
MODE_UNITS = {
    "latency": "ms of injected delay",
    "error": "percent of requests failed",
    "timeout": "ms before the dependency gives up",
    "slow_query": "ms added to database work",
    "saturation": "percent of worker capacity consumed",
}

# Hard ceiling so a fat-fingered demo magnitude cannot wedge the event loop for minutes.
MAX_SLEEP_SECONDS = 5.0


class ChaosError(RuntimeError):
    """Raised by ``apply_chaos`` when an ``error`` toggle fires."""


class ChaosTimeout(TimeoutError):
    """Raised by ``apply_chaos`` when a ``timeout`` toggle fires."""


@dataclass
class Toggle:
    target: str
    mode: str
    magnitude: float
    expires_at: datetime

    @property
    def active(self) -> bool:
        return datetime.now(tz=timezone.utc) < self.expires_at

    def as_dict(self) -> dict:
        return {
            "target": self.target,
            "mode": self.mode,
            "magnitude": self.magnitude,
            "active": self.active,
            "expires_at": self.expires_at.isoformat(),
            "unit": MODE_UNITS.get(self.mode, ""),
        }


_lock = RLock()
_toggles: dict[str, Toggle] = {}
_rng = random.Random(42)


def set_toggle(target: str, mode: str, magnitude: float, ttl_seconds: int) -> dict:
    """Arm (or replace) the toggle for ``target``. Returns its serialised form."""
    if mode not in MODES:
        raise ValueError(f"unknown chaos mode: {mode}")
    toggle = Toggle(
        target=target,
        mode=mode,
        magnitude=float(magnitude),
        expires_at=datetime.now(tz=timezone.utc) + timedelta(seconds=int(ttl_seconds)),
    )
    with _lock:
        _toggles[target] = toggle
    record_domain_event("sre", f"chaos_{mode}_armed")
    log_event(
        logger,
        logging.WARNING,
        "chaos toggle armed",
        target=target,
        mode=mode,
        magnitude=magnitude,
        ttl_seconds=ttl_seconds,
    )
    return toggle.as_dict()


def clear_toggle(target: str) -> bool:
    with _lock:
        removed = _toggles.pop(target, None)
    if removed is not None:
        record_domain_event("sre", "chaos_cleared")
        log_event(logger, logging.INFO, "chaos toggle cleared", target=target, mode=removed.mode)
    return removed is not None


def list_toggles() -> list[dict]:
    """All toggles, expired ones pruned first."""
    with _lock:
        for target, toggle in list(_toggles.items()):
            if not toggle.active:
                del _toggles[target]
        return [toggle.as_dict() for toggle in sorted(_toggles.values(), key=lambda t: t.target)]


def chaos_state(target: str) -> dict | None:
    """The active toggle for ``target``, or ``None`` when the target is healthy."""
    with _lock:
        toggle = _toggles.get(target)
        if toggle is None:
            return None
        if not toggle.active:
            del _toggles[target]
            return None
        return toggle.as_dict()


def apply_chaos(target: str) -> None:
    """Inject the fault currently armed for ``target``; a no-op when nothing is armed.

    Safe to call from any request path. Never raises unless an ``error``/``timeout`` toggle
    is deliberately active, in which case the raised exception mimics a real dependency
    failure so error handling further up the stack behaves realistically.
    """
    state = chaos_state(target)
    if state is None:
        return

    mode = state["mode"]
    magnitude = float(state["magnitude"])
    record_domain_event("sre", f"chaos_{mode}_injected")

    if mode == "latency":
        _sleep_ms(magnitude)
        log_event(
            logger, logging.WARNING, "chaos latency injected", target=target, delay_ms=magnitude
        )
        return

    if mode == "slow_query":
        _sleep_ms(magnitude)
        log_event(
            logger,
            logging.WARNING,
            "slow query detected",
            target=target,
            query="SELECT * FROM bookings JOIN payments USING (pnr)",
            duration_ms=magnitude,
        )
        return

    if mode == "error":
        # magnitude is a percentage of requests that should fail.
        if _rng.random() * 100.0 < max(magnitude, 0.0):
            log_event(logger, logging.ERROR, "chaos error injected", target=target)
            raise ChaosError(f"{target}: upstream dependency returned 502 Bad Gateway")
        return

    if mode == "timeout":
        _sleep_ms(min(magnitude, 1000.0))
        log_event(
            logger, logging.ERROR, "chaos timeout injected", target=target, timeout_ms=magnitude
        )
        raise ChaosTimeout(f"{target}: dependency call timed out after {magnitude:.0f}ms")

    if mode == "saturation":
        # Model queue pressure as a delay proportional to how saturated we claim to be.
        _sleep_ms(min(magnitude, 100.0) * 2)
        log_event(
            logger,
            logging.WARNING,
            "worker saturation",
            target=target,
            saturation_pct=magnitude,
        )


def _sleep_ms(milliseconds: float) -> None:
    time.sleep(min(max(milliseconds, 0.0) / 1000.0, MAX_SLEEP_SECONDS))


def reset() -> None:
    """Drop every toggle. Used by tests and by the demo reset helper."""
    with _lock:
        _toggles.clear()
