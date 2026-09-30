"""Floor-day QA scoping (Ops Floor pin)."""

from types import SimpleNamespace

from api.services.qa_scope import (
    build_qa_scopes,
    filter_schedules_by_scope,
    format_day_label,
    schedule_floor_date,
)


def _row(**kwargs):
    defaults = dict(
        ci_name="W",
        ci="w.prod",
        namespace="ns",
        provisioning_date="30/09/2026 10:30",
        session_date="",
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_session_date_preferred_over_provisioning_day():
    s = _row(session_date="2026-09-30", provisioning_date="29/09/2026 22:00")
    assert schedule_floor_date(s) == "2026-09-30"


def test_falls_back_to_provisioning_calendar_day():
    s = _row(session_date="", provisioning_date="01/10/2026 13:00")
    assert schedule_floor_date(s) == "2026-10-01"


def test_filter_floor_day_excludes_other_days():
    rows = [
        _row(ci_name="Wed", session_date="2026-09-30", provisioning_date="30/09/2026 10:00"),
        _row(ci_name="Thu", session_date="2026-10-01", provisioning_date="01/10/2026 10:00"),
    ]
    scoped = filter_schedules_by_scope(rows, floor="day", floor_date="2026-09-30")
    assert [r.ci_name for r in scoped] == ["Wed"]


def test_filter_full_event_keeps_all():
    rows = [
        _row(session_date="2026-09-30"),
        _row(session_date="2026-10-01", provisioning_date="01/10/2026 15:30"),
    ]
    scoped = filter_schedules_by_scope(rows, floor="event")
    assert len(scoped) == 2


def test_time_band_midday():
    rows = [
        _row(ci_name="AM", provisioning_date="30/09/2026 10:30", session_date="2026-09-30"),
        _row(ci_name="MID", provisioning_date="30/09/2026 13:00", session_date="2026-09-30"),
        _row(ci_name="PM", provisioning_date="30/09/2026 15:30", session_date="2026-09-30"),
    ]
    scoped = filter_schedules_by_scope(
        rows, floor="day", floor_date="2026-09-30", time_band="midday"
    )
    assert [r.ci_name for r in scoped] == ["MID"]


def test_build_qa_scopes_labels():
    rows = [
        _row(session_date="2026-09-30", provisioning_date="30/09/2026 10:00"),
        _row(session_date="2026-09-30", provisioning_date="30/09/2026 15:30"),
        _row(session_date="2026-10-01", provisioning_date="01/10/2026 10:00"),
    ]
    scopes = build_qa_scopes(rows)
    assert scopes["total"] == 3
    assert scopes["dates"][0]["date"] == "2026-09-30"
    assert scopes["dates"][0]["label"] == format_day_label("2026-09-30")
    assert scopes["dates"][0]["count"] == 2
    assert {b["key"] for b in scopes["dates"][0]["bands"]} == {"morning", "afternoon"}
