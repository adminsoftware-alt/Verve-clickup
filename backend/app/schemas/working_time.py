"""What the holiday calendar looks like over the wire."""

import uuid
from datetime import date
from typing import Annotated

from pydantic import BaseModel, StringConstraints


class HolidayIn(BaseModel):
    day: date
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class HolidayOut(BaseModel):
    id: uuid.UUID
    day: date
    name: str
