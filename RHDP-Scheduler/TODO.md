# RHDP-Flow — Open Issues & Ideas

Items are grouped by priority. Easy wins are at the top of each section.

---

## Recently Completed (March 2026)

### ✅ WebSocket endpoint auth fixed
Added API key authentication via query parameter to `/deploy/ws/{job_id}` endpoint.

### ✅ Ctrl+S stale data issue resolved
Implemented useRef pattern in ScheduleEditPage to prevent stale closure in keyboard shortcuts.

### ✅ export_yaml_dir path validation added
Added `_validate_export_yaml_dir()` function restricting paths to temp/exports/tmp directories.

### ✅ Auth consistency on endpoints
Added `verify_api_key` to `POST /schedules/diff`, `POST /deploy/preview`, `POST /schedules/validate-namespaces`, and `POST /schedules/validate-num-users`.

### ✅ CSP policy tightened
Changed CSP from `connect-src 'self' ws: wss:` to `connect-src 'self'` for same-origin WebSocket connections only.

### ✅ Deploy retry num_users validation
Added same num_users limit validation to `POST /deploy/retry` as main deploy endpoint.

### ✅ Demolition preflight password protection
Modified to pass passwords via environment variable (`DEMOLITION_PASSWORD`) instead of CLI arguments.

### ✅ Silent failures user feedback
Added proper error handling with toast notifications for WebSocket operations, clipboard access, and manual refresh failures.

### ✅ DestroyQASection namespace override fixed
Added DestroyCheckRequest model and made namespace override functional in destroy check API.

### ✅ Extended auth enforcement test coverage
Added 10 new auth tests covering deploy, retry, cancel/pause/resume endpoints (17 total auth tests).

### ✅ Container build in PR workflow
Added `container-build-pr` job to validate Docker builds on pull requests.

### ✅ Python linting in CI
Added ruff linting and mypy type checking to CI pipeline.

### ✅ Job store thread safety
Added `_jobs_lock` threading.Lock() to all job store operations for concurrent request safety.

### ✅ Basic persistent storage config
Added `RHDP_JOBS_PERSIST` environment variable for future file/SQLite-backed job storage.

### ✅ FastAPI deprecation warnings fixed
Migrated from `@app.on_event("shutdown")` to lifespan context manager and `asyncio.get_running_loop()`.

---

## High Priority

---

## Medium Priority — Larger Efforts

### Test coverage gaps — backend
Missing `TestClient` coverage for: `PUT /api/schedules`, `DELETE /api/schedules/{index}`, `POST /api/schedules/validate-namespaces`, `GET /api/deploy/stream/{job_id}`, WebSocket `/api/deploy/ws/{job_id}`, `POST /api/operations/update-passwords`, `POST /api/operations/import-namespace`, successful live deploy path (mocked `oc`), `POST /api/qa/run` with loaded schedules, `GET /api/deploy/status/{job_id}` success case.

### Test coverage gaps — frontend
No tests for: `ScheduleEditPage`, `DiffView`, `DestroyQASection`, `SessionHistory`, `QAResultsTable`, `services/api.ts`, `utils/scheduleCsv.ts`, `utils/scheduleDefaults.ts`, `hooks/useAutoRefresh.ts`, `hooks/useTheme.ts`, `hooks/useKeyboardShortcuts.ts`.


### `rhdp_flow.py` large function refactoring
`process_schedule` (~230 lines) and `qa1_verify_setup` (~400 lines) are large and hard to test in isolation. Extracting sub-functions would reduce defect surface.


---

## Low Priority — Polish

- `sys.path.insert` for imports in `routes.py` is fragile — consider proper packaging.
- Module-level `logging.basicConfig` in `rhdp_flow.py` can fight application logging.
- `UploadTab.tsx` per-cell `setSchedules(schedules.map(...))` should use functional updater `setSchedules(prev => ...)` to avoid state races on rapid edits.
- `DeploymentsTab.tsx` timestamp sorting uses string `localeCompare` instead of date comparison.
- `StudentsTab.tsx` `useMemo` dependency creates a new array every render, defeating memoization.
- `useKeyboardShortcuts` digit/`?` shortcuts don't call `preventDefault` and don't check `contenteditable`.
- `HealthBadge` tooltip content is not keyboard-accessible (label not focusable).
- Shortcuts help table in `App.tsx` has no `<caption>` or `scope` attributes for screen readers.
- `ErrorBoundary` fallback has no `aria-live` region for screen reader announcement.
- README does not document SSE/WebSocket deploy progress endpoints.
- `frontend/package.json`: vitest `^3.2.4` vs `@vitest/coverage-v8` `^4.0.18` version skew.

---

## Completed Milestones

A comprehensive list of shipped features lives in the [CHANGELOG](CHANGELOG.md). Key highlights:

- 192 backend + 47 frontend tests
- Job status API/frontend types now accept `cancelled` and `paused`
- Multipart upload requests now send `X-API-Key` when `RHDP_API_KEY` is set
- WebSocket polling fallback now stops cleanly on cancelled jobs and unmount
- Cancelled jobs are now pruned from the in-memory job store
- Example CSV buttons in empty state for immediate exploration
- WebSocket deploy progress with cancel and pause/resume
- Multi-region deploy preview with per-region user splits
- Auth coverage on all mutation endpoints when `RHDP_API_KEY` is set
- Job history cap configurable via `RHDP_MAX_JOBS`
- Landing page URLs with `derive_base_domain()` for all cluster patterns
- Schedule Builder with catalog picker, move/duplicate/add rows, CSV download, inline validation
- Date chronology validation, quick date buttons, random password generator, keyboard shortcuts
- CSV BOM handling, Demolition preflight integration
- Deployment log capture, retry, SSE streaming (legacy)
- QA (QA1/QA2 + destroy check), student landing pages
- Multi-asset, multi-region, count, concurrency
- Lock/unlock, extend stop/destroy, scale, disable auto-stop
- Salesforce campaign/opportunity/CDH, redirect toggle, white glove
- Session history, diff view, dark mode
- Rate limiting, API key auth, CSP headers, CORS
