class WorkError(Exception):
    """Base for domain errors raised by the work services; the API maps them to HTTP."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFound(WorkError):
    """The item does not exist, or the caller cannot see it. Deliberately indistinguishable."""


class Forbidden(WorkError):
    """The caller can see the item but lacks the level needed for this action."""


class Invalid(WorkError):
    """The request breaks a rule of the hierarchy or task model."""
