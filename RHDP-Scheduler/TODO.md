# RHDP-Flow — Open Issues & Ideas

## Backlog

- **Persistent storage** — Backend state is entirely in-memory. A lightweight SQLite or file-backed store would survive restarts.
- **WebSocket for deploy progress** — SSE works but is unidirectional. WebSockets would allow cancel/pause from the client side.
- **Multi-region deploy preview** — Show the region-split plan (users per region) before deploying.

## Completed Milestones

A comprehensive list of shipped features lives in the [CHANGELOG](CHANGELOG.md). Key highlights:

- 184 backend + 47 frontend tests
- Auth coverage — all mutation endpoints enforce `RHDP_API_KEY` when set (upload, session clear, load example, QA run, destroy check, password upload)
- Job history cap — configurable via `RHDP_MAX_JOBS` env var (default 100), truncation count exposed in `/debug/config`
- Landing page URLs — `derive_base_domain()` handles production, integration, dev, and infra cluster hostnames (`ocp-*`, `ocp4-*`)
- Schedule Builder (advanced editor) with catalog item picker, move/duplicate/add rows, CSV download, inline validation, date format helpers
- Date chronology validation — warns when auto-destroy/auto-stop are before provisioning date, or destroy is before stop
- Quick date buttons, random password generator, row summary strip, readiness badge, keyboard shortcuts (Ctrl+S, Alt+Up/Down)
- CSV BOM handling — uploads with UTF-8 BOM are parsed correctly
- Demolition preflight integration — browser-based workshop URL verification via rhpds/demolition
- Deployment log capture, retry, SSE streaming
- QA (QA1/QA2 + destroy check), student landing pages
- Multi-asset, multi-region, count, concurrency
- Lock/unlock, extend stop/destroy, scale, disable auto-stop
- Salesforce campaign/opportunity/CDH, redirect toggle, white glove
- Interactive CLI wizard, namespace validation, num_users validation
- Session history, diff view, dark mode
- Rate limiting, API key auth, CSP headers, CORS
