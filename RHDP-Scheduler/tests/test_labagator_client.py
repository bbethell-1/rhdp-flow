# tests/test_labagator_client.py
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest
import requests

from api.services.labagator_client import LabagatorError, get_deploy_handoff_csv, list_events


def _mk_event(id_, name, start, end):
    return {"id": id_, "name": name, "start_date": start.isoformat(), "end_date": end.isoformat(), "location": "Room 1"}


@patch("api.services.labagator_client.requests.get")
def test_list_events_filters_to_this_week(mock_get):
    today = date(2026, 8, 26)
    events = [
        _mk_event(1, "In window", today, today + timedelta(days=2)),
        _mk_event(2, "Too far out", today + timedelta(days=30), today + timedelta(days=32)),
        _mk_event(3, "Already ended", today - timedelta(days=10), today - timedelta(days=8)),
    ]
    mock_get.return_value = MagicMock(status_code=200, json=lambda: events)

    result = list_events(today=today)

    assert [e["id"] for e in result] == [1]


@patch("api.services.labagator_client.requests.get")
def test_list_events_sorts_ascending_by_start_date(mock_get):
    today = date(2026, 8, 26)
    events = [
        _mk_event(1, "Later", today + timedelta(days=3), today + timedelta(days=4)),
        _mk_event(2, "Sooner", today, today + timedelta(days=1)),
    ]
    mock_get.return_value = MagicMock(status_code=200, json=lambda: events)

    result = list_events(today=today)

    assert [e["id"] for e in result] == [2, 1]


@patch("api.services.labagator_client.requests.get")
def test_list_events_raises_on_connection_error(mock_get):
    mock_get.side_effect = requests.ConnectionError("refused")

    with pytest.raises(LabagatorError):
        list_events(today=date(2026, 8, 26))


@patch("api.services.labagator_client.requests.get")
def test_get_deploy_handoff_csv_returns_text_on_200(mock_get):
    mock_get.return_value = MagicMock(status_code=200, text="Namespace,CI\nns1,ci1\n")

    result = get_deploy_handoff_csv(
        event_id=1, namespace="ns1", enable_workshop_interface=True,
        concurrency=10, white_glove=True, auto_stop_days=7, auto_destroy_days=14,
    )

    assert result == "Namespace,CI\nns1,ci1\n"


@patch("api.services.labagator_client.requests.get")
def test_get_deploy_handoff_csv_raises_on_non_200(mock_get):
    mock_get.return_value = MagicMock(status_code=404, text="event not found")

    with pytest.raises(LabagatorError):
        get_deploy_handoff_csv(
            event_id=999, namespace="ns1", enable_workshop_interface=True,
            concurrency=10, white_glove=True, auto_stop_days=7, auto_destroy_days=14,
        )
