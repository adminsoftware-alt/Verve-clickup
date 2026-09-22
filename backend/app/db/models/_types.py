import enum
from typing import Type

from sqlalchemy import Enum as SAEnum


def enum_type(enum_cls: Type[enum.Enum], name: str) -> SAEnum:
    """Store enums as short strings guarded by a CHECK constraint.

    Plain VARCHAR + CHECK is far easier to migrate than native Postgres enums
    when a value is added later.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda members: [m.value for m in members],
        validate_strings=True,
    )
