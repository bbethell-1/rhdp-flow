# Changelog

All notable changes to RHDP-Flow are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

#### Backend Hardening (Batch 1)
- Standardized logging: replaced `print()` calls with structured `logger.info()` / `logger.warning()` in `rhdp_flow.py`
- Deep health check: `/api/health` now probes RHDP API reachability (`rhdp_api_reachable` field)
- `base_domain` field in health response derived from cluster URL

#### Security & Infrastructure (Batch 2)
- Rate limiting via SlowAPI: 60 req/min on POST, 120 req/min on GET endpoints
- API versioning: all endpoints available at both `/api/` and `/api/v1/`
- Configurable CORS origins via `CORS_ORIGINS` environment variable (default: localhost only)
- Optional API key authentication via `RHDP_API_KEY` environment variable
- Content Security Policy (CSP) headers on all responses
- `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers
- Security documentation (`docs/SECURITY.md`)

#### Frontend Test Infrastructure (Batch 3)
- Vitest + React Testing Library + jsdom test environment
- `npm test`, `npm run test:watch`, `npm run test:coverage` scripts
- App smoke test (renders without crashing, shows Upload & Deploy tab)

#### CSS Polish & Confirmations (Batch 4)
- Row hover highlighting on all tables
- Monospace font for date cells
- SVG favicon
- Per-tab browser title (`RHDP-Flow | Tab Name`)
- Confirmation modals for Extend Stop and Extend Destroy operations
- Normalized spacing using PatternFly tokens

#### SSE & Real-Time Improvements (Batch 5)
- SSE auto-reconnect with exponential backoff (max 5 retries)
- `useAutoRefresh` reusable hook for polling intervals
- Auto-refresh toggle on Operations and QA tabs
- Graceful shutdown: backend sets shutdown flag, SSE generators yield closing event

#### Table UX (Batch 6)
- Sortable columns on all data tables (Deployments, QA, Students, Upload preview)
- Pagination on Deployments and QA tabs (default 20 rows/page)
- Sticky table headers across all tabs
- Column visibility toggle on Deployments tab

#### Template, Search, Bulk Ops, Retry (Batch 7)
- CSV template download: `GET /api/templates/schedule`
- "Download CSV Template" link in Upload tab toolbar
- Search input on schedule preview (Upload tab)
- Search input on operations history
- Retry failed deployments: `POST /api/deploy/retry` with CI name list
- Per-row retry button for failed results in Deployments tab
- Bulk retry via checkbox selection in Deployments tab

#### Advanced Frontend (Batch 8)
- Keyboard shortcuts: `1`-`5` for tabs, `?` for help overlay
- URL hash-based tab routing with browser back/forward support
- Schedule diff view: compare new CSV against loaded schedules
- `POST /api/schedules/diff` endpoint returning added/removed/changed/unchanged
- Help modal showing all keyboard shortcuts

#### Frontend Component Tests (Batch 9)
- UploadTab tests: empty state, preview table, deploy settings, buttons, search, template link
- DeploymentsTab tests: empty state, results table, summary cards, status filter, search, retry
- OperationsTab tests: operation cards, lock/unlock buttons, history
- QATab tests: empty state, type selector, guidance, results table
- StudentsTab tests: empty state, student table, copy URL, CSV download
- HealthBadge tests: initial state, connected/disconnected/error states
- Backend tests for template download, retry, diff, and error paths

#### Documentation (Batch 10)
- API documentation section in README (links to `/docs` and `/redoc`)
- Architecture diagram (Mermaid) in README
- This CHANGELOG
- Updated feature list, project structure, and testing sections in README

### Changed
- `print()` calls in `rhdp_flow.py` replaced with structured logging (non-interactive contexts)
- Health endpoint enhanced with RHDP API probe and base domain detection
- All tables now use sticky headers and responsive scroll wrappers
- Deploy settings card includes Redirect toggle alongside Resource Lock, Resource Pools, White Glove

### Fixed
- Timezone bugs: explicit UTC in backend timestamps, frontend date parsing, and UI labels
- Grouped multi-asset routing: inverted `is_multi_asset` condition
- Table columns: auto-size with horizontal scroll instead of truncating
