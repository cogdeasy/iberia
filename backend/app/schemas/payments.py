from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AuthoriseRequest(BaseModel):
    pnr: str = Field(min_length=5, max_length=8)
    card_number: str = Field(min_length=12, max_length=25)
    card_holder: str = Field(min_length=2, max_length=128)
    expiry: str = Field(min_length=4, max_length=7, description="MM/YY or MM/YYYY")
    cvv: str = Field(min_length=3, max_length=4)


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pnr: str
    status: str
    amount_eur: float
    card_last4: str
    card_brand: str
    provider_reference: str
    created_at: datetime


class PaymentDebugOut(PaymentOut):
    """Support/debug view of a payment.

    NOTE(demo): planted VULN-050 — returns the decrypted PAN, which is only possible
    because the card number is stored reversibly rather than tokenised.
    """

    card_holder: str
    card_expiry: str
    card_number: str
    card_pan_vault: str
    provider_latency_ms: float


class RefundRequest(BaseModel):
    amount_eur: float = Field(gt=0)
    reason: str = Field(default="", max_length=255)


class RefundOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    payment_id: int
    amount_eur: float
    status: str
    reason: str
    created_at: datetime
