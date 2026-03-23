# RHDP-Flow — Open Issues & Ideas

Items are grouped by priority. Easy wins are at the top of each section.

---

## High Priority

### WebSocket endpoint has no auth
`/deploy/ws/{job_id}` accepts connections without `verify_api_key`. Anyone who can reach the server and guess a job ID can send cancel/pause/resume commands.
**Fix**: Validate API key from a query param or first message before accepting commands.

### Ctrl+S in ScheduleEditPage may save stale data
The keyboard shortcut `useEffect` intentionally omits `handleSave` from its dependency array, so `handleSave` can close over an outdated `drafts` snapshot.
**Fix**: Use a ref for the save callback so the effect always calls the latest version.

### `export_yaml_dir` allows arbitrary filesystem writes
`DeployRequest.export_yaml_dir` is an unconstrained path string. Authenticated callers can write dry-run YAML anywhere the process can write.
**Fix**: Validate the path against an allowlist or restrict to a designated output directory.

### Auth inconsistency on read/preview/diff endpoints
`POST /schedules/diff`, `POST /deploy/preview`, `POST /schedules/validate-namespaces`, and `POST /schedules/validate-num-users` skip `verify_api_key` while other mutations require it.
**Fix**: Add `verify_api_key` to these endpoints for consistency.

### CSP `connect-src ws: wss:` is too broad
Allows WebSocket connections to any origin. Should be tightened to `'self'` once WebSocket paths are confirmed to use same-origin only.

### Deploy retry bypasses `num_users` limit
`POST /deploy/retry` does not replicate the user-count ceiling enforced in `POST /deploy`, so limits can be sidestepped.

### Demolition preflight leaks passwords in process listings
`rhdp_flow.py` `run_demolition_preflight` passes passwords as CLI arguments visible in `ps` on shared hosts. Consider passing them via stdin or environment variable.

### Silent failures across multiple frontend components
Many async operations only `console.warn` on failure (session history fetch, auto-refresh, cancel/pause/resume, clipboard). Users see no feedback.
**Fix**: Show a toast or inline alert on failure in `SessionHistory`, `DestroyQASection`, `QATab`, `OperationsTab`, and `UploadTab` control actions.

### `DestroyQASection` namespace override is a dead control
The `nsOverride` state is displayed in the UI but never passed to `api.destroyCheck`, so the filter control does nothing.

---

## Medium Priority — Larger Efforts

### Test coverage gaps — backend
Missing `TestClient` coverage for: `PUT /api/schedules`, `DELETE /api/schedules/{index}`, `POST /api/schedules/validate-namespaces`, `GET /api/deploy/stream/{job_id}`, WebSocket `/api/deploy/ws/{job_id}`, `POST /api/operations/update-passwords`, `POST /api/operations/import-namespace`, successful live deploy path (mocked `oc`), `POST /api/qa/run` with loaded schedules, `GET /api/deploy/status/{job_id}` success case.

### Test coverage gaps — frontend
No tests for: `ScheduleEditPage`, `DiffView`, `DestroyQASection`, `SessionHistory`, `QAResultsTable`, `services/api.ts`, `utils/scheduleCsv.ts`, `utils/scheduleDefaults.ts`, `hooks/useAutoRefresh.ts`, `hooks/useTheme.ts`, `hooks/useKeyboardShortcuts.ts`.

### Auth enforcement test coverage
`TestAuthEnforcement` only covers 6 endpoints. Extend to deploy, dry-run, operations, retry, cancel/pause/resume, stream, schedule replace/delete.

### CI: run container build on PRs
`container-build` currently only runs on push to `main`, so Dockerfile breakage can merge via PR undetected. Move it (or a build-only variant) into the PR workflow.

### CI: add Python linter / type checker
No `ruff`, `flake8`, or `mypy` job in CI. Adding one would catch issues earlier.

### `rhdp_flow.py` large function refactoring
`process_schedule` (~230 lines) and `qa1_verify_setup` (~400 lines) are large and hard to test in isolation. Extracting sub-functions would reduce defect surface.

### Job store thread safety
`_jobs` dict and job mutations in `api/jobs.py` have no locking. Sync endpoints and async tasks can interleave, risking rare consistency issues under concurrent requests.

### Persistent storage
Backend state is entirely in-memory. A lightweight SQLite or file-backed store would survive restarts.

---

## Low Priority — Polish

- `api/server.py` uses deprecated `@app.on_event("shutdown")` — migrate to lifespan context manager.
- `api/routes.py` uses `asyncio.get_event_loop()` instead of `get_running_loop()` in health checks.
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
