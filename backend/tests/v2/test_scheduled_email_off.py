"""What the server mails on a timer, which is meant to be nothing.

The firm asked for the scheduled email to stop: no daily summary, no week ahead, no month just
gone, no Friday recap, no overdue chase, no Monday heads-up, no team digest. The jobs that build
those are still here and still tested next door in test_outbound.py -- that is the point of
switching them off rather than deleting them -- so what needs a test is the switch.

Three things are worth pinning:

  Nothing on a timer runs by default. Every member of this workspace is saved as wanting a daily
  summary, so a regression here is not one stray email: it is seventy-five.

  The notification jobs keep running. run_instant is what marks a notification delivered and
  pushes it to a browser, so taking it out with the digests would quietly kill the bell.

  A job added to outbound.py later cannot go unclassified. The last test fails if somebody adds
  run_something_digests and forgets to decide which list it belongs on -- which is how a feature
  that was switched off comes back on by itself.
"""
import pytest

from app.core.config import settings
from app.services.work import outbound
from app.services.work.dashboards import reports


@pytest.fixture
def flags():
    """Restore both switches afterwards: they are process-wide settings, not fixtures."""
    before = (settings.SCHEDULED_EMAIL_ENABLED, settings.APPROVAL_REMINDER_EMAIL)
    yield settings
    settings.SCHEDULED_EMAIL_ENABLED, settings.APPROVAL_REMINDER_EMAIL = before


def test_nothing_on_a_timer_by_default():
    assert settings.SCHEDULED_EMAIL_ENABLED is False
    assert settings.APPROVAL_REMINDER_EMAIL is False
    running = reports.outbound_jobs()
    assert not set(running) & set(reports.ON_A_TIMER), "a scheduled digest is running"
    assert "run_approval_reminders" not in running


def test_the_bell_still_runs():
    # run_instant delivers notifications and push; losing it to this change would be a silent
    # regression in a feature nobody asked us to touch.
    assert "run_instant" in reports.outbound_jobs()
    assert "run_invite_reminders" in reports.outbound_jobs()


def test_the_switch_turns_them_back_on(flags):
    flags.SCHEDULED_EMAIL_ENABLED = True
    flags.APPROVAL_REMINDER_EMAIL = True
    running = reports.outbound_jobs()
    for job in reports.ON_A_TIMER:
        assert job in running
    assert "run_approval_reminders" in running


def test_every_job_named_here_exists(flags):
    # Catches a rename: a typo in either list is a job that silently never runs again.
    flags.SCHEDULED_EMAIL_ENABLED = True
    flags.APPROVAL_REMINDER_EMAIL = True
    for job in reports.outbound_jobs():
        assert callable(getattr(outbound, job, None)), f"{job} is not a job in outbound.py"


def test_no_job_goes_unclassified(flags):
    """Every run_* in outbound.py is either on an event or on a timer, deliberately."""
    flags.SCHEDULED_EMAIL_ENABLED = True
    flags.APPROVAL_REMINDER_EMAIL = True
    in_module = {name for name in dir(outbound) if name.startswith("run_") and callable(getattr(outbound, name))}
    classified = set(reports.outbound_jobs())
    unclassified = in_module - classified
    assert not unclassified, (
        f"{sorted(unclassified)} exist in outbound.py but no list claims them -- add each to "
        "ON_EVENT or ON_A_TIMER in reports.py so it is a decision and not an oversight"
    )
