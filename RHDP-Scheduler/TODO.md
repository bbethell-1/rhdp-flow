# RHDP-Flow — Open Issues & Ideas

## Open Issues

- **Landing page URLs on non-prod clusters** — URLs generated for integration/dev clusters should map to the correct domain (e.g. `integration.demo.redhat.com`) rather than the production domain. The `_map_infra_domain()` helper may need additional hostname patterns.
- **Job history cap** — `api/jobs.py` silently drops jobs once the in-memory list exceeds 100. Consider exposing this limit as a config variable or adding a "truncated" indicator in the UI.
- **Auth coverage** — `verify_api_key` protects most mutation endpoints but not all (e.g. `PUT /schedules`, `DELETE /schedules/{index}`). Audit and ensure consistent coverage when `RHDP_API_KEY` is set.

## Backlog

- **Persistent storage** — Backend state is entirely in-memory. A lightweight SQLite or file-backed store would survive restarts.
- **WebSocket for deploy progress** — SSE works but is unidirectional. WebSockets would allow cancel/pause from the client side.
- **Multi-region deploy preview** — Show the region-split plan (users per region) before deploying.

## Completed Milestones

A comprehensive list of shipped features lives in the [CHANGELOG](CHANGELOG.md). Key highlights:

- 169 backend + 47 frontend tests
- Schedule Builder (advanced editor) with catalog item picker, move/duplicate/add rows, CSV download, inline validation, date format helpers
- Deployment log capture, retry, SSE streaming
- QA (QA1/QA2 + destroy check), student landing pages
- Multi-asset, multi-region, count, concurrency
- Lock/unlock, extend stop/destroy, scale, disable auto-stop
- Salesforce campaign/opportunity/CDH, redirect toggle, white glove
- Interactive CLI wizard, namespace validation, num_users validation
- Session history, diff view, keyboard shortcuts, dark mode
- Rate limiting, API key auth, CSP headers, CORS
