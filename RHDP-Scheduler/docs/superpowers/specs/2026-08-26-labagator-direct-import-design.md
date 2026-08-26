# Direct Labagator Session Import — Design

## Problem

Flow and Labagator run on the same OpenShift cluster (`ocpv-infra01.dal12.infra.demo.redhat.com`), but session handoff between them is manual: a user exports a CSV from Labagator, then uploads it to Flow, which runs `transform_labagator_to_flow()` — a hand-rolled, simplified reimplementation of CSV-shaping logic that Labagator's own backend already does more completely.

Labagator already exposes `GET /exports/deploy-handoff/{event_id}/flow-csv`, a mature, read-only endpoint that generates a full Flow-format CSV server-side: multi-asset grouping, password fill, and query-param control over namespace, concurrency, white-glove, and auto-stop/destroy offsets. Flow should call this endpoint directly instead of re-deriving the same output from raw session data.

## Scope

- **In scope:** Flow fetches session data from Labagator directly (import direction only).
- **Out of scope (this iteration):** Pushing results/updates back to Labagator. Labagator's write endpoints (`POST`/`PATCH` on `room-sessions`, etc.) require `require_event_role("write")`, which depends on `X-Forwarded-Email`/`X-Forwarded-User` headers set by Labagator's OAuth proxy in front of the backend. A direct pod-to-pod call from Flow bypasses that proxy and arrives without those headers, so writes aren't safe to attempt until a service-to-service auth path exists. Export from Flow to Labagator remains CSV-based for now.

## Current State (verified against running cluster + both repos)

- Labagator backend: `labagator-backend` Service (ClusterIP, port 8080) in namespace `labagator-dev`, same cluster as Flow's `rhdp-scheduler` namespace.
- Labagator's OAuth proxy sits in front of an external Route (`labagator-api-dev...`) and enforces auth for browser traffic; the in-cluster Service itself has no NetworkPolicy restricting ingress, and Flow's own NetworkPolicy (`openshift/base/networkpolicy.yaml`) has no egress rules — so a direct in-cluster call from Flow to Labagator's Service is unobstructed today.
- `GET /room-sessions/` and `GET /exports/...` endpoints in Labagator have no `Depends(require_event_role(...))` — reads are open at the FastAPI layer (protected only by the ingress-level OAuth proxy for external traffic, which a same-cluster call bypasses).
- `GET /events/` (labagator/src/backend/app/api/events.py) returns all events, each with `start_date`/`end_date` (date, not datetime).
- Flow's existing Labagator integration: `api/services/labagator_import.py` (`transform_labagator_to_flow`), wired into `POST /api/schedules/import-labagator` in `api/routes.py`, tested in `tests/test_labagator_import.py` and `tests/test_routes_labagator.py`. Export side: `GET /api/schedules/export-for-labagator`.
- Frontend: `UploadTab.tsx` has a "Labagator Sessions" CSV upload toggle today.

## Architecture

### New Flow backend endpoints (`api/routes.py`)

1. **`GET /api/labagator/events`**
   - Calls `GET http://labagator-backend.labagator-dev.svc.cluster.local:8080/api/events/` (adjust path prefix to match Labagator's actual mount point — verify `/api` prefix at implementation time).
   - Filters server-side to events whose `[start_date, end_date]` range overlaps `[today, today + 7 days]`.
   - Sorts ascending by `start_date` (soonest first).
   - Returns a trimmed shape: `{id, name, start_date, end_date, location}` — no need to leak Labagator's full event schema (tunables, phase deadlines, etc.) to the frontend.
   - On Labagator unreachable/error: return an empty list with a distinguishable error field (e.g. `{"events": [], "error": "labagator_unreachable"}`) rather than a 500, so the frontend can show a clear fallback message instead of a generic crash.

2. **`GET /api/schedules/labagator-preview`**
   - Query params: `event_id: int, namespace: str, enable_workshop_interface: bool, concurrency: int, white_glove: bool, auto_stop_days: int, auto_destroy_days: int`. All fields except `event_id` and `namespace` are optional and default to the same defaults Labagator's endpoint uses.
   - Validates `namespace` is non-blank and passes Flow's existing namespace-format check (reuse whatever validator the manual CSV upload path already applies to the `Namespace` column) — return 400 with a clear message before calling Labagator if it fails.
   - Calls `GET http://labagator-backend.labagator-dev.svc.cluster.local:8080/api/exports/deploy-handoff/{event_id}/flow-csv` with the above as query params.
   - On success, parses the returned CSV just far enough to count data rows, and returns `{event_name: str, session_count: int, csv_text: str}` — does **not** ingest anything yet.
   - On non-200 from Labagator (event not found, validation error on Labagator's side, connection failure): propagate a clear error (not a raw proxy of Labagator's response) so the frontend can toast something meaningful.

3. **`POST /api/schedules/import-from-labagator`**
   - Request body: `{csv_text: str, filename?: str}` — the exact `csv_text` returned by the preview call above, sent back unmodified once the user confirms. The backend does not re-fetch from Labagator here, so what the user confirmed in the dialog is exactly what gets ingested (no race condition if Labagator's data changes between preview and confirm).
   - Feeds `csv_text` through the existing `_ingest_schedule_csv_text()` function — the same ingestion path manual CSV upload already uses. No new parsing/validation logic; this reuses Flow's current preview/diff/dedup behavior untouched.
   - Response shape matches whatever `_ingest_schedule_csv_text()` / the existing `import-labagator` endpoint returns today (`UploadResponse`), so the frontend's existing post-upload handling (populating the schedule table) needs no changes.

### Removed

- `api/services/labagator_import.py` (`transform_labagator_to_flow`) — dead code once the above ships.
- `POST /api/schedules/import-labagator` endpoint (the old CSV-upload-and-transform path) and its route wiring.
- `tests/test_labagator_import.py` (tests the removed transform function).
- Labagator-CSV-specific assertions in `tests/test_routes_labagator.py` — replaced with tests for the three new endpoints (see Testing).

### Kept unchanged

- `GET /api/schedules/export-for-labagator` (export direction, out of scope this iteration).
- `_ingest_schedule_csv_text()` and everything downstream of it (schedule table, diff view, deploy flow).

## Frontend (`UploadTab.tsx`)

New "Import from Labagator" card, placed **alongside** the existing manual CSV upload (not replacing it) — if Labagator's API is ever unreachable, the manual export/upload path still works as a fallback.

**Default (common-case) flow:**
1. Event dropdown, populated from `GET /api/labagator/events`, pre-filtered to this week, soonest first. If the list is empty, show "No Labagator events this week" instead of a blank dropdown.
2. Single **Import** button. No other fields required — `namespace`, `enable_workshop_interface`, `concurrency`, `white_glove`, `auto_stop_days`, `auto_destroy_days` are all silently pulled from Flow's existing Deploy Settings panel state and sent as-is.
3. Client-side validation blocks the click with an inline error if the effective namespace (from Deploy Settings) is blank or fails the same format check as the manual CSV path — before any network call.
4. On click, Flow calls `GET /api/schedules/labagator-preview` with the event and effective Deploy Settings values.
5. If `session_count` is 0, skip the confirm dialog and show an inline message instead: "No sessions found for this event this week." No further action.
6. Otherwise, show a confirmation dialog: **"Import N sessions from [Event Name] into namespace [x]?"** with Cancel/Confirm, using `session_count`/`event_name` from the preview response and the namespace that was sent.
7. **Confirm** → Flow calls `POST /api/schedules/import-from-labagator` with the `csv_text` from the preview response. The result is fed into the same schedule table / diff view manual CSV upload already produces. Nothing deploys automatically; the existing "review then hit Deploy" behavior is unchanged.
   **Cancel** → discard the fetched preview, no state change, no second network call.

**Advanced (collapsed by default):**
- Expandable section exposing the same fields as Deploy Settings (namespace override, concurrency, white_glove, auto_stop_days, auto_destroy_days, enable_workshop_interface) so a user can override per-fetch without changing global Deploy Settings. Only visible after expanding — never required for the default path.

**Error handling:**
- Labagator unreachable / `GET /api/labagator/events` returns the `labagator_unreachable` error field → dropdown shows "Labagator is unavailable — use manual CSV export instead" and the Import button is disabled. No silent failure.
- `POST /api/schedules/import-from-labagator` non-200 → toast with the backend's error message, no partial table state.

## Testing

**Backend:**
- New tests mocking the Labagator HTTP call (via `responses`/`httpx` mock or existing test HTTP-mocking pattern in the repo) covering:
  - `GET /api/labagator/events`: correct week-window filtering, sort order, empty-list-on-unreachable behavior.
  - `GET /api/schedules/labagator-preview`: namespace validation rejection, correct `session_count`/`event_name`/`csv_text` on success, Labagator error propagation.
  - `POST /api/schedules/import-from-labagator`: successful passthrough of `csv_text` into `_ingest_schedule_csv_text()`, matching `UploadResponse` shape.
- Remove `tests/test_labagator_import.py`.
- Update `tests/test_routes_labagator.py` to drop assertions against the removed `import-labagator` endpoint and add coverage for the three new/changed endpoints.

**Frontend:**
- Extend the existing Labagator Playwright test to cover: event dropdown populated, Import click, confirmation dialog content (session count + event name + namespace), Confirm ingesting into the schedule table, and Cancel leaving state unchanged.
- Keep one test covering the manual CSV upload fallback path, since it remains in the UI.

## Non-goals

- No changes to Labagator's backend — this design only adds Flow-side code that calls Labagator's existing, already-shipped endpoints.
- No export/push-back to Labagator in this iteration.
- No changes to Flow's deploy pipeline — imported sessions land in the same pre-deploy schedule table as any CSV upload; deployment still requires an explicit user action.
