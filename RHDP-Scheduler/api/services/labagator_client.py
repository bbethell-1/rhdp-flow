"""HTTP client for Labagator's read-only session/export endpoints.

Flow and Labagator run in the same OpenShift cluster. Flow calls
Labagator's in-cluster Service directly for read-only data (events list,
deploy-handoff CSV export). Writes back to Labagator are out of scope —
Labagator's write endpoints require OAuth-proxy-forwarded auth headers
that a direct pod-to-pod call does not have.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, timedelta

import requests

LABAGATOR_BASE_URL = os.environ.get(
    "LABAGATOR_BASE_URL", "http://labagator-backend.labagator-dev.svc.cluster.local:8080"
)
_API_PREFIX = "/api/v1"
_TIMEOUT_SECONDS = 10


class LabagatorError(Exception):
    """Raised when Labagator is unreachable or returns an error response."""


def list_events(today: date | None = None) -> list[dict]:
    """Return Labagator events whose date range overlaps the next 7 days, soonest first."""
    today = today or datetime.now(tz=UTC).date()
    window_end = today + timedelta(days=7)
    try:
        resp = requests.get(f"{LABAGATOR_BASE_URL}{_API_PREFIX}/events/", timeout=_TIMEOUT_SECONDS)
    except requests.RequestException as e:
        raise LabagatorError(f"Labagator unreachable: {e}") from e
    if resp.status_code != 200:
        raise LabagatorError(f"Labagator returned {resp.status_code} listing events")

    events = resp.json()
    in_window = []
    for event in events:
        start = _parse_date(event["start_date"])
        end = _parse_date(event["end_date"])
        if start <= window_end and end >= today:
            in_window.append(event)
    in_window.sort(key=lambda e: e["start_date"])
    return in_window


def get_deploy_handoff_csv(
    event_id: int,
    namespace: str,
    enable_workshop_interface: bool,
    concurrency: int,
    white_glove: bool,
    auto_stop_days: int,
    auto_destroy_days: int,
) -> str:
    """Fetch the Flow-format CSV for one event's sessions from Labagator."""
    url = f"{LABAGATOR_BASE_URL}{_API_PREFIX}/exports/deploy-handoff/{event_id}/flow-csv"
    params = {
        "namespace": namespace,
        "enable_workshop_interface": enable_workshop_interface,
        "concurrency": concurrency,
        "white_glove": white_glove,
        "auto_stop_days": auto_stop_days,
        "auto_destroy_days": auto_destroy_days,
    }
    try:
        resp = requests.get(url, params=params, timeout=_TIMEOUT_SECONDS)
    except requests.RequestException as e:
        raise LabagatorError(f"Labagator unreachable: {e}") from e
    if resp.status_code != 200:
        raise LabagatorError(f"Labagator returned {resp.status_code}: {resp.text[:200]}")
    return resp.text


def _parse_date(value: str) -> date:
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(value).date()
