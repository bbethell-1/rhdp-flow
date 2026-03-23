# RHDP-Flow — Open Issues & Ideas

## Backlog

- **Persistent storage** — Backend state is entirely in-memory. A lightweight SQLite or file-backed store would survive restarts.

## Completed Milestones

A comprehensive list of shipped features lives in the [CHANGELOG](CHANGELOG.md). Key highlights:

- 192 backend + 47 frontend tests
- WebSocket deploy progress with cancel and pause/resume — bidirectional communication replaces SSE, deploy loop checks between each workshop for cancel/pause signals
- Multi-region deploy preview — `POST /deploy/preview` computes per-region user splits; expanded schedule rows show region breakdown
- Auth coverage — all mutation endpoints enforce `RHDP_API_KEY` when set
- Job history cap — configurable via `RHDP_MAX_JOBS` env var (default 100), truncation count exposed in `/debug/config`
- Landing page URLs — `derive_base_domain()` handles production, integration, dev, and infra cluster hostnames
- Schedule Builder (advanced editor) with catalog item picker, move/duplicate/add rows, CSV download, inline validation, date format helpers
- Date chronology validation — warns when auto-destroy/auto-stop are before provisioning date, or destroy is before stop
- Quick date buttons, random password generator, row summary strip, readiness badge, keyboard shortcuts (Ctrl+S, Alt+Up/Down)
- CSV BOM handling — uploads with UTF-8 BOM are parsed correctly
- Demolition preflight integration — browser-based workshop URL verification via rhpds/demolition
- Deployment log capture, retry, SSE streaming (legacy, still available)
- QA (QA1/QA2 + destroy check), student landing pages
- Multi-asset, multi-region, count, concurrency
- Lock/unlock, extend stop/destroy, scale, disable auto-stop
- Salesforce campaign/opportunity/CDH, redirect toggle, white glove
- Interactive CLI wizard, namespace validation, num_users validation
- Session history, diff view, dark mode
- Rate limiting, API key auth, CSP headers, CORS
