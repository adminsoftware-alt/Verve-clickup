"""Shapes for the running-cost register."""

import uuid
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class CostItemIn(BaseModel):
    name: Name
    category: str = "other"
    # Minor units -- paise, cents -- as an integer, so the rows always sum to the total.
    amount_minor: Annotated[int, Field(ge=0, le=10**12)] = 0
    currency: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=3)] = "INR"
    period: str = "monthly"   # daily | monthly | yearly | once
    scales: str = "flat"      # flat | per_person | per_gb
    note: Optional[Note] = None
    active: bool = True


class CostLine(CostItemIn):
    id: uuid.UUID
    # The same cost on every scale, so a yearly renewal and a monthly server can be compared.
    daily_minor: int
    monthly_minor: int
    yearly_minor: int
    once_minor: int


class CostUsage(BaseModel):
    """What the per-unit rates are multiplied by, measured rather than typed."""

    active_people: int
    stored_bytes: int


class CostByCategory(BaseModel):
    category: str
    yearly_minor: int


class CostSummary(BaseModel):
    currency: str
    # True when the lines are not all in one currency, in which case the total is not meaningful
    # and the page says so rather than printing a confident wrong number.
    mixed_currencies: bool
    usage: CostUsage
    lines: List[CostLine]
    daily_minor: int
    monthly_minor: int
    yearly_minor: int
    per_person_monthly_minor: int
    one_off_minor: int
    by_category: List[CostByCategory]


class CostSuggestion(BaseModel):
    """A line this deployment probably has, offered as a starting point. Never a price."""

    name: str
    category: str
    why: str
    scales: str = "flat"
