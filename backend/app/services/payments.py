"""Payment authorisation logic.

The provider call is deliberately isolated in :func:`call_provider` so the SRE demo can
inject latency or timeouts into the checkout path (scenario S1) without touching the
router. Chaos state is read defensively: the ``sre`` domain owns it and may not be
installed in every branch.
"""

import base64
import importlib
import logging
import random
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.observability import log_event, record_domain_event

logger = logging.getLogger("iberia.payments")

# NOTE(demo): planted VULN-051 — provider credentials hardcoded in source instead of
# being read from configuration/secret storage. Obviously fake values.
PROVIDER_API_KEY = "sk_live_iberia_demo_51H8fakeKEYnotreal0000"
PROVIDER_WEBHOOK_SIGNING_SECRET = "whsec_iberia_demo_f4k3_s1gn1ng_s3cr3t"
PROVIDER_BASE_URL = "https://payments.provider.invalid/v1"

# NOTE(demo): planted VULN-050 — static XOR key used to make card numbers recoverable.
PAN_VAULT_KEY = "iberia-demo-pan-key"

BRAND_PREFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Amex", ("34", "37")),
    ("Visa", ("4",)),
    ("Mastercard", ("51", "52", "53", "54", "55", "2221", "2720")),
    ("Diners", ("36", "38")),
    ("Discover", ("6011", "65")),
)

PROVIDER_TIMEOUT_SECONDS = 5.0
DEFAULT_FARE_EUR = 189.0


class ProviderTimeout(Exception):
    """Raised when the simulated payment provider does not answer in time."""


@dataclass
class ProviderResult:
    reference: str
    latency_ms: float


def normalise_pan(card_number: str) -> str:
    return "".join(ch for ch in card_number if ch.isdigit())


def detect_brand(card_number: str) -> str:
    digits = normalise_pan(card_number)
    for brand, prefixes in BRAND_PREFIXES:
        if digits.startswith(prefixes):
            return brand
    return "Unknown"


def luhn_valid(card_number: str) -> bool:
    digits = [int(ch) for ch in normalise_pan(card_number)]
    if len(digits) < 12:
        return False
    checksum = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def vault_pan(card_number: str) -> str:
    """ "Encrypt" a PAN for storage.

    NOTE(demo): planted VULN-050 — XOR with a hardcoded key plus base64 is trivially
    reversible, so this is plaintext card storage with extra steps.
    """
    digits = normalise_pan(card_number)
    key = PAN_VAULT_KEY.encode()
    mixed = bytes(byte ^ key[index % len(key)] for index, byte in enumerate(digits.encode()))
    return base64.b64encode(mixed).decode()


def unvault_pan(vaulted: str) -> str:
    if not vaulted:
        return ""
    key = PAN_VAULT_KEY.encode()
    raw = base64.b64decode(vaulted.encode())
    return bytes(byte ^ key[index % len(key)] for index, byte in enumerate(raw)).decode(
        errors="replace"
    )


BOOKING_AMOUNT_FIELDS = (
    "total_amount_eur",
    "total_eur",
    "amount_eur",
    "total_fare_eur",
    "fare_eur",
    "price_eur",
)


def load_booking(db: Session, pnr: str) -> Any | None:
    """Fetch the booking for a PNR if the ``booking`` domain is installed.

    The booking module is owned by another workstream and is resolved dynamically so
    that payments stays independently deployable.
    """
    try:
        module = importlib.import_module("app.models.booking")
    except ModuleNotFoundError:
        return None
    model = getattr(module, "Booking", None)
    if model is None or not hasattr(model, "pnr"):
        return None
    return db.scalar(select(model).where(model.pnr == pnr))


def fallback_amount_eur(pnr: str) -> float:
    """Deterministic fare used when the booking domain cannot supply an amount."""
    return round(DEFAULT_FARE_EUR + sum(ord(ch) for ch in pnr) % 120, 2)


def booking_amount_eur(booking: Any) -> float | None:
    for field in BOOKING_AMOUNT_FIELDS:
        value = getattr(booking, field, None)
        if isinstance(value, int | float) and not isinstance(value, bool) and value > 0:
            return round(float(value), 2)
    return None


def mark_booking_paid(booking: Any) -> bool:
    if hasattr(booking, "payment_status"):
        booking.payment_status = "paid"
        return True
    return False


def _apply_chaos() -> None:
    """Consult the SRE chaos toggles if that domain is present."""
    try:
        from app.services.chaos import apply_chaos
    except ImportError:
        return
    apply_chaos("payments")


def call_provider(pnr: str, amount_eur: float) -> ProviderResult:
    """Simulate the card-acquirer round trip used by scenario S1."""
    started = time.perf_counter()
    _apply_chaos()
    time.sleep(random.uniform(0.005, 0.02))
    elapsed = time.perf_counter() - started
    if elapsed > PROVIDER_TIMEOUT_SECONDS:
        record_domain_event("payments", "provider_timeout")
        log_event(
            logger,
            logging.ERROR,
            "payment provider timeout",
            pnr=pnr,
            amount_eur=amount_eur,
            waited_ms=round(elapsed * 1000, 2),
            provider_url=PROVIDER_BASE_URL,
        )
        raise ProviderTimeout(f"payment provider did not respond within {elapsed:.1f}s")
    reference = f"pay_{random.randint(10**11, 10**12 - 1):012d}"
    record_domain_event("payments", "provider_call")
    log_event(
        logger,
        logging.INFO,
        "payment provider authorised",
        pnr=pnr,
        amount_eur=amount_eur,
        provider_reference=reference,
        duration_ms=round(elapsed * 1000, 2),
    )
    return ProviderResult(reference=reference, latency_ms=round(elapsed * 1000, 2))
