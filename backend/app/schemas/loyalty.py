from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LoyaltyTxn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    description: str
    avios: int
    balance_after: int


class Member(BaseModel):
    plus_number: str
    full_name: str
    tier: str
    avios_balance: int
    tier_points: int
    transactions: list[LoyaltyTxn]


class AccrueRequest(BaseModel):
    pnr: str


class AccrueResponse(BaseModel):
    avios_awarded: int
    balance: int


class RedeemRequest(BaseModel):
    flight_id: int
    avios: int


class RedeemResponse(BaseModel):
    balance: int
    redemption_id: int


class TransferRequest(BaseModel):
    to_plus_number: str
    avios: int


class TransferResponse(BaseModel):
    balance: int
