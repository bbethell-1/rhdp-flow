"""Tests for parse_date_time, format_iso8601, calculate_duration."""

from datetime import datetime, timezone

from rhdp_flow import parse_date_time, format_iso8601, calculate_duration


def test_parse_dd_mm_yyyy():
    dt = parse_date_time("15/02/2026 11:00")
    assert dt is not None
    assert dt.year == 2026
    assert dt.month == 2
    assert dt.day == 15
    assert dt.hour == 11
    assert dt.tzinfo == timezone.utc


def test_parse_dd_mm_yy():
    dt = parse_date_time("15/02/26 11:00")
    assert dt is not None
    assert dt.year == 2026
    assert dt.tzinfo == timezone.utc


def test_parse_iso8601_with_z():
    dt = parse_date_time("2026-02-15T11:00:00Z")
    assert dt is not None
    assert dt.year == 2026
    assert dt.hour == 11


def test_parse_iso8601_without_z():
    dt = parse_date_time("2026-02-15T11:00:00")
    assert dt is not None
    assert dt.hour == 11


def test_parse_empty_returns_none():
    assert parse_date_time("") is None
    assert parse_date_time("   ") is None


def test_parse_invalid_returns_none():
    assert parse_date_time("not-a-date") is None


def test_format_iso8601_naive():
    dt = datetime(2026, 2, 15, 11, 0, 0)
    assert format_iso8601(dt) == "2026-02-15T11:00:00Z"


def test_format_iso8601_utc():
    dt = datetime(2026, 2, 15, 11, 0, 0, tzinfo=timezone.utc)
    assert format_iso8601(dt) == "2026-02-15T11:00:00Z"


def test_calculate_duration():
    start = datetime(2026, 2, 15, 11, 0, tzinfo=timezone.utc)
    end = datetime(2026, 2, 15, 19, 0, tzinfo=timezone.utc)
    assert calculate_duration(start, end) == "8h"


def test_calculate_duration_multi_day():
    start = datetime(2026, 2, 15, 11, 0, tzinfo=timezone.utc)
    end = datetime(2026, 2, 17, 11, 0, tzinfo=timezone.utc)
    assert calculate_duration(start, end) == "48h"
