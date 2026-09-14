# Direct Labagator Session Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Flow's manual CSV-export-then-upload Labagator workflow with direct, same-cluster API calls: Flow's backend fetches events and a ready-made Flow-format CSV from Labagator's existing endpoints, and the frontend gets an "Import from Labagator" card with an event dropdown, a preview/confirm step, and foolproof guardrails for non-technical users.

**Architecture:** A new `api/services/labagator_client.py` module wraps `requests` calls to Labagator's `labagator-backend.labagator-dev.svc.cluster.local:8080` service. Three new/changed FastAPI routes in `api/routes.py` expose events listing, a no-side-effect preview, and a confirm-to-ingest step that reuses the existing `_ingest_schedule_csv_text()` pipeline untouched. The old CSV-upload-and-transform path (`transform_labagator_to_flow`, `POST /schedules/import-labagator`) is deleted. The frontend replaces the "Labagator Sessions" CSV toggle with a new card driven by the three endpoints, with a confirmation modal matching existing modal patterns in `UploadTab.tsx`.

**Tech Stack:** FastAPI, Pydantic, `requests` (already a direct dependency), pytest + `unittest.mock.patch`, React + TypeScript + PatternFly 6, Playwright (`page.route` network mocking).

---

## File Structure

**Backend — create:**
- `api/services/labagator_client.py` — HTTP client functions: `list_events()`, `get_deploy_handoff_csv(...)`. Owns the `LABAGATOR_BASE_URL` env var default and all `requests` calls to Labagator.
- `tests/test_labagator_client.py` — unit tests for the client module, mocking `requests.get`.

**Backend — modify:**
- `api/models.py` — add `LabagatorEventSummary`, `LabagatorEventsResponse`, `LabagatorPreviewResponse`, `LabagatorImportRequest`.
- `api/routes.py` — remove `POST /schedules/import-labagator` and the `transform_labagator_to_flow` import; add `GET /labagator/events`, `GET /schedules/labagator-preview`, `POST /schedules/import-from-labagator`.
- `tests/test_routes_labagator.py` — replace old CSV-upload tests with tests for the three new endpoints, mocking `api.services.labagator_client`.

**Backend — delete:**
- `api/services/labagator_import.py`
- `tests/test_labagator_import.py`

**Frontend — modify:**
- `frontend/src/types/index.ts` — add `LabagatorEventSummary`, `LabagatorEventsResponse`, `LabagatorPreviewResponse`.
- `frontend/src/services/api.ts` — remove `importLabagatorCSV`; add `listLabagatorEvents`, `previewLabagatorImport`, `importFromLabagator`.
- `frontend/src/components/UploadTab.tsx` — remove the "Labagator Sessions" CSV toggle mode; add a new "Import from Labagator" card (event dropdown, namespace field, collapsed Advanced section, Import button, confirmation modal).
- `frontend/tests/labagator-integration.spec.ts` — rewrite for the new flow using `page.route()` to mock Flow's own `/api/labagator/events`, `/api/schedules/labagator-preview`, `/api/schedules/import-from-labagator` endpoints (the browser never talks to Labagator directly, so mocking Flow's own endpoints is the correct boundary — this also decouples the frontend test from whether a real Labagator instance is reachable, which backend-level tests already cover via mocked `requests` calls).

**No infra changes:** no NetworkPolicy, ConfigMap, or Kustomize changes — `LABAGATOR_BASE_URL` defaults in code (see Task 1).

---

### Task 1: Labagator HTTP client module

**Files:**
- Create: `api/services/labagator_client.py`
- Test: `tests/test_labagator_client.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_labagator_client.py
from datetime import date, timedelta
from unittest.mock import patch, MagicMock

import pytest
import requests

from api.services.labagator_client import list_events, get_deploy_handoff_csv, LabagatorError


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_labagator_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.labagator_client'`

- [ ] **Step 3: Write the implementation**

```python
# api/services/labagator_client.py
"""HTTP client for Labagator's read-only session/export endpoints.

Flow and Labagator run in the same OpenShift cluster. Flow calls
Labagator's in-cluster Service directly for read-only data (events list,
deploy-handoff CSV export). Writes back to Labagator are out of scope —
Labagator's write endpoints require OAuth-proxy-forwarded auth headers
that a direct pod-to-pod call does not have.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta

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
    today = today or date.today()
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_labagator_client.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/labagator_client.py tests/test_labagator_client.py
git commit -m "Add Labagator HTTP client for direct session import"
```

---

### Task 2: New Pydantic response/request models

**Files:**
- Modify: `api/models.py` (add after `UploadResponse`, line 273)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models_labagator.py
from api.models import LabagatorEventSummary, LabagatorEventsResponse, LabagatorPreviewResponse, LabagatorImportRequest


def test_labagator_event_summary_shape():
    e = LabagatorEventSummary(id=1, name="Roadshow", start_date="2026-08-27", end_date="2026-08-29", location="Room 1")
    assert e.id == 1
    assert e.name == "Roadshow"


def test_labagator_events_response_defaults_no_error():
    r = LabagatorEventsResponse(events=[])
    assert r.events == []
    assert r.error is None


def test_labagator_events_response_with_error():
    r = LabagatorEventsResponse(events=[], error="labagator_unreachable")
    assert r.error == "labagator_unreachable"


def test_labagator_preview_response_shape():
    r = LabagatorPreviewResponse(event_name="Roadshow", session_count=3, csv_text="a,b\n1,2\n")
    assert r.session_count == 3


def test_labagator_import_request_shape():
    r = LabagatorImportRequest(csv_text="a,b\n1,2\n")
    assert r.filename == "labagator-import.csv"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models_labagator.py -v`
Expected: FAIL with `ImportError: cannot import name 'LabagatorEventSummary'`

- [ ] **Step 3: Write the minimal implementation**

Insert into `api/models.py` immediately after the `UploadResponse` class (currently line 269-273):

```python
class LabagatorEventSummary(BaseModel):
    id: int
    name: str
    start_date: str
    end_date: str
    location: str = ""


class LabagatorEventsResponse(BaseModel):
    events: list[LabagatorEventSummary]
    error: Optional[str] = None


class LabagatorPreviewResponse(BaseModel):
    event_name: str
    session_count: int
    csv_text: str


class LabagatorImportRequest(BaseModel):
    csv_text: str
    filename: str = "labagator-import.csv"
```

Check `api/models.py`'s existing imports at the top of the file — confirm `Optional` is already imported from `typing` (it is used elsewhere in the file for other response models); if not present, add `from typing import Optional` alongside the existing typing imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models_labagator.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add api/models.py tests/test_models_labagator.py
git commit -m "Add Pydantic models for direct Labagator import"
```

---

### Task 3: New routes — `GET /labagator/events`

**Files:**
- Modify: `api/routes.py`
- Modify: `tests/test_routes_labagator.py`

- [ ] **Step 1: Replace the old test file's imports and add the new events test**

Replace the entire contents of `tests/test_routes_labagator.py` with:

```python
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.server import app
from api.services.labagator_client import LabagatorError

client = TestClient(app)


@patch("api.routes.labagator_client.list_events")
def test_list_labagator_events_returns_trimmed_shape(mock_list):
    mock_list.return_value = [
        {"id": 1, "name": "Roadshow", "start_date": "2026-08-27", "end_date": "2026-08-29", "location": "Room 1"},
    ]

    response = client.get("/api/labagator/events")

    assert response.status_code == 200
    data = response.json()
    assert data["error"] is None
    assert data["events"] == [
        {"id": 1, "name": "Roadshow", "start_date": "2026-08-27", "end_date": "2026-08-29", "location": "Room 1"},
    ]


@patch("api.routes.labagator_client.list_events")
def test_list_labagator_events_returns_empty_list_with_error_on_unreachable(mock_list):
    mock_list.side_effect = LabagatorError("Labagator unreachable: connection refused")

    response = client.get("/api/labagator/events")

    assert response.status_code == 200
    data = response.json()
    assert data["events"] == []
    assert data["error"] == "labagator_unreachable"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_routes_labagator.py -v`
Expected: FAIL — `404 Not Found` for `GET /api/labagator/events` (route doesn't exist yet)

- [ ] **Step 3: Write the minimal implementation**

In `api/routes.py`:

1. Replace the import line (currently line 109):
```python
from api.services.labagator_import import transform_labagator_to_flow
```
with:
```python
from api.services import labagator_client
```

2. Add near the top of the "Schedules" section (immediately before the existing `@router.post("/schedules/upload", ...)` block, so it's grouped with related endpoints):

```python
@router.get("/labagator/events", response_model=LabagatorEventsResponse)
def list_labagator_events():
    """List Labagator events happening in the next 7 days, soonest first."""
    try:
        events = labagator_client.list_events()
    except labagator_client.LabagatorError:
        return LabagatorEventsResponse(events=[], error="labagator_unreachable")
    return LabagatorEventsResponse(
        events=[
            LabagatorEventSummary(
                id=e["id"], name=e["name"], start_date=e["start_date"],
                end_date=e["end_date"], location=e.get("location", ""),
            )
            for e in events
        ],
    )
```

3. Add `LabagatorEventSummary, LabagatorEventsResponse` to the existing `from api.models import (...)` block at the top of `api/routes.py` (find it and add these two names alongside `UploadResponse` and the other model imports already listed there).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_routes_labagator.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/routes.py tests/test_routes_labagator.py
git commit -m "Add GET /api/labagator/events endpoint"
```

---

### Task 4: `GET /schedules/labagator-preview`

**Files:**
- Modify: `api/routes.py`
- Modify: `tests/test_routes_labagator.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_routes_labagator.py`:

```python
@patch("api.routes.labagator_client.get_deploy_handoff_csv")
def test_labagator_preview_returns_session_count_and_csv(mock_csv):
    mock_csv.return_value = "Workshop Name,Namespace\nRoadshow,ns1\nRoadshow,ns1\n"

    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 1, "namespace": "ns1", "event_name": "Roadshow"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session_count"] == 2
    assert data["event_name"] == "Roadshow"
    assert data["csv_text"] == mock_csv.return_value


def test_labagator_preview_rejects_invalid_namespace():
    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 1, "namespace": "Not Valid!", "event_name": "Roadshow"},
    )

    assert response.status_code == 400


@patch("api.routes.labagator_client.get_deploy_handoff_csv")
def test_labagator_preview_propagates_labagator_error(mock_csv):
    from api.services.labagator_client import LabagatorError
    mock_csv.side_effect = LabagatorError("Labagator returned 404: event not found")

    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 999, "namespace": "ns1", "event_name": "Roadshow"},
    )

    assert response.status_code == 502
    assert "event not found" in response.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_routes_labagator.py -v`
Expected: FAIL — `404 Not Found` for `GET /api/schedules/labagator-preview`

- [ ] **Step 3: Write the minimal implementation**

Add to `api/routes.py`, immediately after the new `list_labagator_events` endpoint from Task 3:

```python
@router.get("/schedules/labagator-preview", response_model=LabagatorPreviewResponse)
def labagator_preview(
    event_id: int,
    namespace: str,
    event_name: str,
    enable_workshop_interface: bool = True,
    concurrency: int = 10,
    white_glove: bool = True,
    auto_stop_days: int = 7,
    auto_destroy_days: int = 14,
):
    """Fetch the Flow-format CSV for a Labagator event without ingesting it."""
    _validate_namespace(namespace)
    try:
        csv_text = labagator_client.get_deploy_handoff_csv(
            event_id=event_id,
            namespace=namespace,
            enable_workshop_interface=enable_workshop_interface,
            concurrency=concurrency,
            white_glove=white_glove,
            auto_stop_days=auto_stop_days,
            auto_destroy_days=auto_destroy_days,
        )
    except labagator_client.LabagatorError as e:
        raise HTTPException(502, str(e))

    reader = csv.reader(io.StringIO(csv_text))
    all_rows = [row for row in reader if any(cell.strip() for cell in row)]
    session_count = max(0, len(all_rows) - 1)

    return LabagatorPreviewResponse(event_name=event_name, session_count=session_count, csv_text=csv_text)
```

Add `LabagatorPreviewResponse` to the `from api.models import (...)` block alongside the names added in Task 3.

Note: `event_name` is passed through as a query param from the frontend (sourced from the event the user picked in the dropdown) rather than looked up again from Labagator — this keeps the preview endpoint to a single Labagator call and matches what the frontend already knows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_routes_labagator.py -v`
Expected: PASS (5 tests total so far)

- [ ] **Step 5: Commit**

```bash
git add api/routes.py tests/test_routes_labagator.py
git commit -m "Add GET /api/schedules/labagator-preview endpoint"
```

---

### Task 5: `POST /schedules/import-from-labagator` and removal of the old route

**Files:**
- Modify: `api/routes.py`
- Modify: `tests/test_routes_labagator.py`
- Delete: `api/services/labagator_import.py`
- Delete: `tests/test_labagator_import.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_routes_labagator.py`:

```python
def test_import_from_labagator_ingests_csv_text():
    csv_text = (
        "Workshop Name,CI,Namespace,Users,Enable_workshop_interface,"
        "Provisioning Date (UTC),Auto_stop (UTC),Auto_destroy (UTC)\n"
        "Test Workshop,babylon-catalog-prod.test-ci.prod,ns1,25,True,"
        "27/08/2026 09:00,27/08/2026 17:00,28/08/2026 09:00\n"
    )

    response = client.post(
        "/api/schedules/import-from-labagator",
        json={"csv_text": csv_text, "filename": "roadshow.csv"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1


def test_import_labagator_old_endpoint_removed():
    response = client.post(
        "/api/schedules/import-labagator",
        files={"file": ("sessions.csv", "a,b\n1,2\n", "text/csv")},
    )

    assert response.status_code == 404
```

Delete the two old tests that reference the removed endpoint (`test_labagator_import_endpoint` and `test_labagator_import_rejects_invalid_csv`) from the top of the same file — they test behavior that no longer exists.

The exact CSV header/row format above must match what `read_csv_input()` (from `rhdp_flow`) accepts — this is the same header shape the manual `POST /schedules/upload` tests already exercise elsewhere in the suite; if this test fails on parsing rather than on the route itself, check `tests/test_routes.py` for the canonical minimal-valid-CSV fixture already used for `/schedules/upload` and reuse that exact shape here instead, since the goal is to prove passthrough into `_ingest_schedule_csv_text`, not to re-validate CSV parsing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_routes_labagator.py -v`
Expected: FAIL — `404 Not Found` for `POST /api/schedules/import-from-labagator`; the "old endpoint removed" test currently PASSES already as a false positive only after Step 3 removes the route, so ignore its result until then.

- [ ] **Step 3: Write the minimal implementation**

In `api/routes.py`, delete the entire old `import_labagator_sessions` endpoint (the `@router.post("/schedules/import-labagator", ...)` block, roughly lines 821-840 per the current file, ending right before `@router.get("/schedules/examples")`).

Add the new endpoint in its place:

```python
@router.post("/schedules/import-from-labagator", response_model=UploadResponse)
async def import_from_labagator(body: LabagatorImportRequest, _key=Depends(verify_api_key)):
    """Ingest a Flow-format CSV previously fetched from Labagator via /schedules/labagator-preview."""
    return _ingest_schedule_csv_text(body.csv_text, body.filename)
```

Add `LabagatorImportRequest` to the `from api.models import (...)` block.

- [ ] **Step 4: Delete the dead transform module and its test**

```bash
rm api/services/labagator_import.py tests/test_labagator_import.py
```

Search for any remaining references before proceeding:

```bash
grep -rn "labagator_import\|transform_labagator_to_flow" api/ tests/
```

Expected: no output.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_routes_labagator.py -v`
Expected: PASS (7 tests total)

Run the full backend suite to catch any other stale references:

Run: `pytest -q`
Expected: PASS (no collection errors, no failures)

- [ ] **Step 6: Commit**

```bash
git add -A api/ tests/
git commit -m "Replace CSV-based Labagator import with direct API import"
```

---

### Task 6: Frontend types and API client methods

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add types**

In `frontend/src/types/index.ts`, add after the `UploadResponse` interface (line 45-50):

```typescript
export interface LabagatorEventSummary {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  location: string;
}

export interface LabagatorEventsResponse {
  events: LabagatorEventSummary[];
  error: string | null;
}

export interface LabagatorPreviewResponse {
  event_name: string;
  session_count: number;
  csv_text: string;
}
```

- [ ] **Step 2: Replace the API client method**

In `frontend/src/services/api.ts`, add `LabagatorEventsResponse, LabagatorPreviewResponse` to the `import type { ... } from '../types'` block at the top of the file.

Remove the `importLabagatorCSV` method (lines 103-113) and replace it with:

```typescript
  listLabagatorEvents: () => cachedRequest<LabagatorEventsResponse>('/labagator/events'),

  previewLabagatorImport: (params: {
    event_id: number;
    namespace: string;
    event_name: string;
    enable_workshop_interface: boolean;
    concurrency: number;
    white_glove: boolean;
    auto_stop_days: number;
    auto_destroy_days: number;
  }): Promise<LabagatorPreviewResponse> => {
    const qs = new URLSearchParams({
      event_id: String(params.event_id),
      namespace: params.namespace,
      event_name: params.event_name,
      enable_workshop_interface: String(params.enable_workshop_interface),
      concurrency: String(params.concurrency),
      white_glove: String(params.white_glove),
      auto_stop_days: String(params.auto_stop_days),
      auto_destroy_days: String(params.auto_destroy_days),
    });
    return request<LabagatorPreviewResponse>(`/schedules/labagator-preview?${qs.toString()}`);
  },

  importFromLabagator: (csvText: string, filename: string): Promise<UploadResponse> =>
    request<UploadResponse>('/schedules/import-from-labagator', {
      method: 'POST',
      body: JSON.stringify({ csv_text: csvText, filename }),
    }),
```

There is no build/test step for this task in isolation — TypeScript compilation is verified together with Task 7, since `UploadTab.tsx` is the only consumer of these methods and a standalone compile of `api.ts` with unused exports wouldn't catch real integration errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "Add frontend types and API methods for direct Labagator import"
```

---

### Task 7: UploadTab.tsx — remove old CSV toggle, add Import from Labagator card

**Files:**
- Modify: `frontend/src/components/UploadTab.tsx`

- [ ] **Step 1: Remove the old Labagator CSV import mode**

Remove the `importMode` state (line 104) and every branch that depends on it:
- The `ToggleGroup` block (lines 692-707) — replace with nothing (delete it); the manual CSV upload (`FileUpload` + `Upload` button, lines 722-742) stays and is now unconditional.
- The `importMode === 'labagator'` info `Alert` block (lines 709-719) — delete.
- In `handleUpload` (lines 447-478), simplify to only the `flow` path:

```typescript
  const handleUpload = async () => {
    if (!csvFile) { showToast('Please select a CSV file', 'danger'); return; }
    try {
      const data = await api.uploadCSV(csvFile);
      setSchedules(data.schedules);
      setSkippedRows(data.skipped_rows ?? 0);
      setTotalRows(data.total_rows ?? 0);
      const msg = data.skipped_rows
        ? `Loaded ${data.count} of ${data.total_rows} row(s) — ${data.skipped_rows} row(s) skipped`
        : `Loaded ${data.count} schedule(s)`;
      showToast(msg, data.skipped_rows ? 'danger' : 'success');
      try {
        await refreshClusterValidation();
        const ctRes = await api.validateClusterTenant();
        setClusterTenantValidation(ctRes);
      } catch (e) {
        console.warn('Post-upload cluster validation failed', e);
      }
    } catch (e) {
      showToast(`Upload failed: ${e}`, 'danger');
    }
  };
```

- [ ] **Step 2: Add state for the new Import from Labagator card**

Add alongside the other `useState` declarations near line 104:

```typescript
  const [labagatorEvents, setLabagatorEvents] = useState<import('../types').LabagatorEventSummary[]>([]);
  const [labagatorUnavailable, setLabagatorUnavailable] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [labagatorNamespace, setLabagatorNamespace] = useState('');
  const [labagatorNamespaceError, setLabagatorNamespaceError] = useState('');
  const [labagatorAdvancedOpen, setLabagatorAdvancedOpen] = useState(false);
  const [labagatorEnableWorkshopInterface, setLabagatorEnableWorkshopInterface] = useState(true);
  const [labagatorConcurrency, setLabagatorConcurrency] = useState(10);
  const [labagatorAutoStopDays, setLabagatorAutoStopDays] = useState(7);
  const [labagatorAutoDestroyDays, setLabagatorAutoDestroyDays] = useState(14);
  const [labagatorPreviewing, setLabagatorPreviewing] = useState(false);
  const [labagatorPreview, setLabagatorPreview] = useState<import('../types').LabagatorPreviewResponse | null>(null);
  const [showLabagatorConfirm, setShowLabagatorConfirm] = useState(false);
```

Add a `useEffect` alongside the existing `listScheduleExamples` effect (line 93-97):

```typescript
  useEffect(() => {
    api.listLabagatorEvents()
      .then((res) => {
        setLabagatorUnavailable(!!res.error);
        setLabagatorEvents(res.events);
      })
      .catch(() => setLabagatorUnavailable(true));
  }, []);
```

- [ ] **Step 3: Add handler functions**

Add near `handleUpload`:

```typescript
  const NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

  const handleLabagatorPreview = async () => {
    if (selectedEventId === null) { showToast('Please select an event', 'danger'); return; }
    if (!labagatorNamespace || labagatorNamespace.length > 63 || !NAMESPACE_RE.test(labagatorNamespace)) {
      setLabagatorNamespaceError('Invalid namespace: must match [a-z0-9-], 1-63 chars');
      return;
    }
    setLabagatorNamespaceError('');
    const event = labagatorEvents.find((e) => e.id === selectedEventId);
    if (!event) { showToast('Selected event not found', 'danger'); return; }

    setLabagatorPreviewing(true);
    try {
      const preview = await api.previewLabagatorImport({
        event_id: selectedEventId,
        namespace: labagatorNamespace,
        event_name: event.name,
        enable_workshop_interface: labagatorEnableWorkshopInterface,
        concurrency: labagatorConcurrency,
        white_glove: whiteGlove,
        auto_stop_days: labagatorAutoStopDays,
        auto_destroy_days: labagatorAutoDestroyDays,
      });
      if (preview.session_count === 0) {
        showToast('No sessions found for this event this week.', 'info');
        return;
      }
      setLabagatorPreview(preview);
      setShowLabagatorConfirm(true);
    } catch (e) {
      showToast(`Preview failed: ${e}`, 'danger');
    } finally {
      setLabagatorPreviewing(false);
    }
  };

  const handleLabagatorConfirm = async () => {
    if (!labagatorPreview) return;
    setShowLabagatorConfirm(false);
    try {
      const data = await api.importFromLabagator(labagatorPreview.csv_text, `${labagatorPreview.event_name}.csv`);
      setSchedules(data.schedules);
      setSkippedRows(data.skipped_rows ?? 0);
      setTotalRows(data.total_rows ?? 0);
      showToast(`Imported ${data.count} session(s) from ${labagatorPreview.event_name}`, 'success');
      try {
        await refreshClusterValidation();
        const ctRes = await api.validateClusterTenant();
        setClusterTenantValidation(ctRes);
      } catch (e) {
        console.warn('Post-import cluster validation failed', e);
      }
    } catch (e) {
      showToast(`Import failed: ${e}`, 'danger');
    } finally {
      setLabagatorPreview(null);
    }
  };
```

- [ ] **Step 4: Add the card JSX**

Add `ExpandableSection` and `NumberInput` to the PatternFly import block at the top of the file (alongside `FileUpload`, `Modal`, etc.):

```typescript
  ExpandableSection,
  NumberInput,
```

Insert the new card immediately after the manual CSV upload `Split` block (after line 742, before the "Passwords CSV upload" block):

```tsx
      {/* Import from Labagator */}
      <Card style={{ marginBottom: 16 }}>
        <CardTitle>Import from Labagator</CardTitle>
        <CardBody>
          {labagatorUnavailable ? (
            <Alert variant="warning" isInline title="Labagator is unavailable — use manual CSV export instead" />
          ) : labagatorEvents.length === 0 ? (
            <Alert variant="info" isInline title="No Labagator events this week" />
          ) : (
            <>
              <Split hasGutter style={{ marginBottom: 12, alignItems: 'flex-end' }}>
                <SplitItem isFilled>
                  <FormSelect
                    aria-label="Labagator event"
                    value={selectedEventId ?? ''}
                    onChange={(_e, v) => setSelectedEventId(v ? Number(v) : null)}
                  >
                    <FormSelectOption key="" value="" label="Select an event…" />
                    {labagatorEvents.map((ev) => (
                      <FormSelectOption key={ev.id} value={ev.id} label={`${ev.name} (${ev.start_date} – ${ev.end_date})`} />
                    ))}
                  </FormSelect>
                </SplitItem>
                <SplitItem isFilled>
                  <TextInput
                    id="labagator-namespace"
                    aria-label="Namespace"
                    placeholder="Namespace (required)"
                    value={labagatorNamespace}
                    onChange={(_e, v) => { setLabagatorNamespace(v); setLabagatorNamespaceError(''); }}
                    validated={labagatorNamespaceError ? 'error' : 'default'}
                  />
                </SplitItem>
                <SplitItem>
                  <Button
                    variant="primary"
                    isDisabled={!labagatorNamespace || labagatorPreviewing}
                    isLoading={labagatorPreviewing}
                    onClick={handleLabagatorPreview}
                  >
                    Import
                  </Button>
                </SplitItem>
              </Split>
              {labagatorNamespaceError && (
                <Alert variant="danger" isInline title={labagatorNamespaceError} style={{ marginBottom: 12 }} />
              )}

              <ExpandableSection
                toggleText="Advanced"
                isExpanded={labagatorAdvancedOpen}
                onToggle={() => setLabagatorAdvancedOpen(!labagatorAdvancedOpen)}
              >
                <Split hasGutter style={{ marginTop: 12 }}>
                  <SplitItem>
                    <Switch
                      id="labagator-enable-workshop-interface"
                      label="Enable workshop interface"
                      isChecked={labagatorEnableWorkshopInterface}
                      onChange={(_e, checked) => setLabagatorEnableWorkshopInterface(checked)}
                    />
                  </SplitItem>
                  <SplitItem>
                    <NumberInput
                      value={labagatorConcurrency}
                      min={1}
                      onMinus={() => setLabagatorConcurrency((n) => Math.max(1, n - 1))}
                      onPlus={() => setLabagatorConcurrency((n) => n + 1)}
                      onChange={(e) => setLabagatorConcurrency(Number((e.target as HTMLInputElement).value) || 1)}
                      inputAriaLabel="Concurrency"
                      widthChars={4}
                    />
                  </SplitItem>
                  <SplitItem>
                    <NumberInput
                      value={labagatorAutoStopDays}
                      min={0}
                      onMinus={() => setLabagatorAutoStopDays((n) => Math.max(0, n - 1))}
                      onPlus={() => setLabagatorAutoStopDays((n) => n + 1)}
                      onChange={(e) => setLabagatorAutoStopDays(Number((e.target as HTMLInputElement).value) || 0)}
                      inputAriaLabel="Auto-stop days"
                      widthChars={4}
                    />
                  </SplitItem>
                  <SplitItem>
                    <NumberInput
                      value={labagatorAutoDestroyDays}
                      min={0}
                      onMinus={() => setLabagatorAutoDestroyDays((n) => Math.max(0, n - 1))}
                      onPlus={() => setLabagatorAutoDestroyDays((n) => n + 1)}
                      onChange={(e) => setLabagatorAutoDestroyDays(Number((e.target as HTMLInputElement).value) || 0)}
                      inputAriaLabel="Auto-destroy days"
                      widthChars={4}
                    />
                  </SplitItem>
                </Split>
              </ExpandableSection>
            </>
          )}
        </CardBody>
      </Card>
```

- [ ] **Step 5: Add the confirmation modal**

Add alongside the other modals near the end of the component (near the `showClearConfirm` modal, before its closing):

```tsx
      {/* Labagator import confirmation modal */}
      <Modal
        variant="small"
        isOpen={showLabagatorConfirm}
        onClose={() => { setShowLabagatorConfirm(false); setLabagatorPreview(null); }}
        aria-labelledby="labagator-confirm-title"
      >
        <ModalHeader title="Confirm Labagator Import" labelId="labagator-confirm-title" />
        <ModalBody>
          {labagatorPreview && (
            <p>
              Import <strong>{labagatorPreview.session_count}</strong> session(s) from{' '}
              <strong>{labagatorPreview.event_name}</strong> into namespace <strong>{labagatorNamespace}</strong>?
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleLabagatorConfirm}>Confirm</Button>
          <Button variant="link" onClick={() => { setShowLabagatorConfirm(false); setLabagatorPreview(null); }}>Cancel</Button>
        </ModalFooter>
      </Modal>
```

- [ ] **Step 6: Build and fix any TypeScript errors**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. If `NumberInput`'s `onChange` event type doesn't match, check the installed PatternFly version's type definition for `NumberInputProps['onChange']` and adjust the cast accordingly — do not use `any`.

- [ ] **Step 7: Run the existing frontend unit test suite**

Run: `cd frontend && npm test`
Expected: PASS — no test currently asserts on `importMode` or the removed toggle (confirm by grepping first: `grep -rn "importMode\|Labagator Sessions\|labagator-format" frontend/src/**/*.test.*`; if any exist, update or remove them since the toggle no longer exists).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/UploadTab.tsx
git commit -m "Replace Labagator CSV upload with direct Import from Labagator card"
```

---

### Task 8: Rewrite the Playwright end-to-end test

**Files:**
- Modify: `frontend/tests/labagator-integration.spec.ts`

- [ ] **Step 1: Write the new test file**

Replace the full contents of `frontend/tests/labagator-integration.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

const EVENTS_RESPONSE = {
  events: [
    { id: 1, name: 'Virt Roadshow', start_date: '2026-08-27', end_date: '2026-08-29', location: 'Room 1' },
  ],
  error: null,
};

const PREVIEW_RESPONSE = {
  event_name: 'Virt Roadshow',
  session_count: 2,
  csv_text:
    'Workshop Name,CI,Namespace,Users,Enable_workshop_interface,Provisioning Date (UTC),Auto_stop (UTC),Auto_destroy (UTC)\n' +
    'Virt Roadshow,babylon-catalog-prod.test-ci.prod,demo-ns,25,True,27/08/2026 09:00,27/08/2026 17:00,28/08/2026 09:00\n' +
    'Virt Roadshow,babylon-catalog-prod.test-ci.prod,demo-ns,25,True,27/08/2026 09:00,27/08/2026 17:00,28/08/2026 09:00\n',
};

const IMPORT_RESPONSE = {
  count: 2,
  total_rows: 2,
  skipped_rows: 0,
  schedules: [
    { ci_name: 'Virt Roadshow', ci: 'babylon-catalog-prod.test-ci.prod', namespace: 'demo-ns' },
    { ci_name: 'Virt Roadshow', ci: 'babylon-catalog-prod.test-ci.prod', namespace: 'demo-ns' },
  ],
};

test.describe('Direct Labagator import', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/labagator/events', (route) =>
      route.fulfill({ json: EVENTS_RESPONSE }));
    await page.goto('/');
  });

  test('populates event dropdown and imports on confirm', async ({ page }) => {
    await page.route('**/api/schedules/labagator-preview*', (route) =>
      route.fulfill({ json: PREVIEW_RESPONSE }));
    await page.route('**/api/schedules/import-from-labagator', (route) =>
      route.fulfill({ json: IMPORT_RESPONSE }));

    await expect(page.getByRole('combobox', { name: 'Labagator event' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Labagator event' }).selectOption({ label: /Virt Roadshow/ });
    await page.getByLabel('Namespace').fill('demo-ns');
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByText('Confirm Labagator Import')).toBeVisible();
    await expect(page.getByText(/Import.*2.*session/)).toBeVisible();
    await expect(page.getByText('Virt Roadshow')).toBeVisible();

    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText(/Imported 2 session/)).toBeVisible();
  });

  test('cancel leaves schedule table unchanged', async ({ page }) => {
    await page.route('**/api/schedules/labagator-preview*', (route) =>
      route.fulfill({ json: PREVIEW_RESPONSE }));

    await page.getByRole('combobox', { name: 'Labagator event' }).selectOption({ label: /Virt Roadshow/ });
    await page.getByLabel('Namespace').fill('demo-ns');
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByText('Confirm Labagator Import')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Confirm Labagator Import')).not.toBeVisible();
    await expect(page.getByText(/Imported/)).not.toBeVisible();
  });

  test('shows unavailable message when Labagator events call errors', async ({ page }) => {
    await page.route('**/api/labagator/events', (route) =>
      route.fulfill({ json: { events: [], error: 'labagator_unreachable' } }));
    await page.reload();

    await expect(page.getByText('Labagator is unavailable — use manual CSV export instead')).toBeVisible();
  });
});

test.describe('Manual CSV upload fallback', () => {
  test('still works independently of Labagator', async ({ page }) => {
    await page.route('**/api/labagator/events', (route) =>
      route.fulfill({ json: { events: [], error: null } }));
    await page.goto('/');

    const csvContent = 'Workshop Name,CI,Namespace,Users\nBasic,babylon-catalog-prod.test-ci.prod,demo-ns,10\n';
    await page.evaluate(async (csv) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const fd = new FormData();
      fd.append('file', blob, 'basic.csv');
      await fetch('/api/schedules/upload', { method: 'POST', body: fd });
    }, csvContent);
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByText('Basic')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the Playwright test**

Start the dev servers first if not already running:

```bash
uvicorn api.server:app --port 8000 &
cd frontend && npm run dev &
```

Run: `cd frontend && npx playwright test labagator-integration.spec.ts`
Expected: PASS (4 tests). If selector text doesn't match exactly (e.g. the toast wording from Task 7's `showToast` calls), adjust the test's text matchers to the exact strings used in `UploadTab.tsx`, not the other way around — the implementation is the source of truth.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/labagator-integration.spec.ts
git commit -m "Rewrite Labagator Playwright test for direct API import flow"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `pytest -q`
Expected: all tests pass (135 pre-existing minus 2 removed plus new tests added in Tasks 1, 2, 3, 4, 5).

- [ ] **Step 2: Run the full frontend unit suite**

Run: `cd frontend && npm test`
Expected: all tests pass.

- [ ] **Step 3: Run the full Playwright suite**

Run: `cd frontend && npx playwright test`
Expected: all tests pass, including the rewritten Labagator spec from Task 8 and every other existing spec (confirms no regression from removing `importMode`).

- [ ] **Step 4: Grep for any remaining dead references**

```bash
grep -rn "import-labagator\b" api/ frontend/src/ frontend/tests/ docs/deployment-infra-dev.md
```

Expected: no output referencing the old `POST /schedules/import-labagator` route. If `docs/deployment-infra-dev.md` describes the old CSV-based workflow, update that section to describe the new direct-import flow (event dropdown → preview → confirm) instead — this is a documentation-only change, no code.

- [ ] **Step 5: Commit any doc fix**

```bash
git add docs/deployment-infra-dev.md
git commit -m "Update deployment docs for direct Labagator import"
```

(Skip this commit if no doc changes were needed.)

---

## Self-Review Notes

**Spec coverage:**
- `GET /api/labagator/events` (week-window filter, sort, unreachable → empty list + error field) — Task 3.
- `GET /api/schedules/labagator-preview` (namespace validation, session_count/event_name/csv_text, error propagation) — Task 4.
- `POST /api/schedules/import-from-labagator` (passthrough into `_ingest_schedule_csv_text`) — Task 5.
- Removal of `transform_labagator_to_flow`, old route, old tests — Task 5.
- Frontend: event dropdown, visible namespace field, Advanced-collapsed fields with Labagator's defaults, single Import button, client-side namespace validation, confirm dialog with count/event/namespace, Cancel with no ingest, empty-state and unreachable-state messaging — Task 7.
- Manual CSV upload kept as fallback — Task 7 (unconditional, not removed) + Task 8 (dedicated test).
- Backend and frontend test coverage per the spec's Testing section — Tasks 1, 3, 4, 5, 8.
- No infra changes, `LABAGATOR_BASE_URL` code-level default — Task 1.

**Placeholder scan:** none found — every step has concrete code, exact file paths, and exact commands.

**Type consistency:** `LabagatorEventSummary`, `LabagatorEventsResponse`, `LabagatorPreviewResponse`, `LabagatorImportRequest` are named identically across `api/models.py` (Task 2), `api/routes.py` imports (Tasks 3-5), and `frontend/src/types/index.ts` (Task 6). `api.listLabagatorEvents`, `api.previewLabagatorImport`, `api.importFromLabagator` are the exact names used in both Task 6 (definition) and Task 7 (usage). `labagator_client.list_events` / `labagator_client.get_deploy_handoff_csv` / `labagator_client.LabagatorError` are used identically in Task 1 (definition) and Tasks 3-5 (route usage and test mocking via `api.routes.labagator_client.*`).
