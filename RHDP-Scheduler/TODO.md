# RHDP-Flow TODO List

## Backlog

Validation 
If num-users hardcoded then don't deploy more then that number Hardcoded in agV / catalog

test mutli region split for aws items eg:

<img width="1099" height="1270" alt="image" src="https://github.com/user-attachments/assets/cdca9296-ffc0-4777-845a-98248f8a4f8f" />

## Testing

- [x] Test multi-asset with `Multi_Asset=True` + `Asset_CIs` (old format) vs grouped rows with `Multi_Workshop_Name` (new format) — verify both paths produce correct results and that per-item passwords work in both cases (5 tests: shared password, asset parsing, per-item password propagation, mixed concurrency, graceful degradation)
- [x] Test Virt Roadshow with 20 users and `Count=2` (2 clusters/instances) (5 tests: 2 named instances, count reset, no expansion for count=1, users not divided, fields preserved)
- [x] Test multi-region provisioning with an AWS catalog item (8 tests: even/remainder user distribution, region suffixes, underscore replacement, extra_parameters, single workshop + N provisions, concurrency inheritance, 3-region distribution)
- [x] Test on integration cluster (end-to-end with real `oc` commands) — deployed Workshop + WorkshopProvision, verified lock-enabled, white-glove, URL, lock/unlock operations
- [x] Verify landing page URLs work correctly and export to CSV automatically (7 tests: URL construction, empty input, tuple return, suffix extraction, CSV format, regular vs multi-workshop URL selection)

## Documentation

- [x] Create clear example CSV sheets covering each deployment type — see `docs/examples/`
- [x] Write clear example commands for deploying and for QA verification — see `docs/USAGE.md`
- [x] Write examples for operational commands: lock all, extend stop, extend destroy, scale — see `docs/USAGE.md`
- [x] Add CSV wizard usage examples — see `docs/USAGE.md`
- [ ] Record a short demo video showing all options

## Feature Ideas

- [x] **Update Passwords** — `--update-passwords` detects changed passwords in the CSV and patches existing workshops (`POST /api/operations/update-passwords`)
- [x] **White Glove CSV Import** — `--import-namespace` generates a schedule CSV from a deployed namespace (`POST /api/operations/import-namespace`)
- [x] **Master Sheet Sync** — `--sync` compares master vs local CSV by (CI, Namespace) key; reports added/changed/unchanged rows
- [x] **Business Requirements Document** — High-level BRD for presenting to John and team as a white glove solution (see `RHDP-Flow_BRD.md`)

## Completed Features

- [x] Basic workshop scheduling via ResourceClaim
- [x] Workshop UI support (direct Workshop creation)
- [x] Multi-asset workshop support
- [x] Custom multi-workshop name from CSV
- [x] QA functions (QA1: setup verification, QA2: deployment status)
- [x] URL generation (link_to_service and landing_page_url)
- [x] Student landing page CSV export
- [x] WorkshopProvision creation for asset workshops
- [x] Proper catalog namespace detection for event items
- [x] **Display Name** — Use actual catalog display name in ResourceClaim annotations (PR #25)
- [x] **Deployment Concurrency** — Add `Concurrency` column to CSV, configurable per workshop
- [x] **Multiple Instance Support (Count)** — Add `Count` column to CSV, automatically expands into N instances
- [x] **Multi-Asset Per-Item Passwords** — Rows sharing the same `Multi_Workshop_Name` are auto-grouped; each row has its own CI and password
- [x] **Lock All** — `--lock` flag sets `demo.redhat.com/lock-enabled` label on workshops
- [x] **Extend Stop** — `--extend-stop --days N --hours N` extends auto-stop time for workshops
- [x] **Extend Destroy** — `--extend-destroy --days N --hours N` extends auto-destroy/lifespan time for workshops and provisions
- [x] **Scale** — `--scale N` sets WorkshopProvision count to target value
- [x] **Regions (Multi-Region Provisioning)** — `AWS_Region` column supports comma-separated regions; creates one Workshop with multiple regional WorkshopProvisions, users distributed evenly
- [x] **Interactive CSV Wizard** — `--wizard` launches a rich CLI wizard to generate workshop schedule CSVs interactively
- [x] **Test Suite** — 77 backend + 36 frontend = 113 API/component tests (see `tests/` and `frontend/src/`)
- [x] **Fix Workshop URLs** — Map infra domain (`ocp-{env}.infra.open.redhat.com`) to RHDP UI domain (`{env}.demo.redhat.com`) and append `/details` suffix
- [x] **Fix Lock Label** — Use correct `demo.redhat.com/lock-enabled` label matching RHDP UI (was `resource-lock`)
- [x] **Remove False-Positive Warning** — Auto-destroy before auto-stop is valid (destroy nullifies stop)
- [x] **Redirect Toggle** — `labUserInterface.redirect` configurable via Deploy Settings switch (default on); controls whether users auto-redirect to lab UI
- [x] **Enhanced CSV Validation** — Duplicate row detection, CI format check, namespace format check, user count reasonableness, auto-stop before provisioning warning
- [x] **Namespace Existence Validation** — API endpoint checks namespaces exist on cluster after upload; frontend shows danger alert for missing namespaces
- [x] **Salesforce Campaign vs Opportunity** — New `Salesforce_Type` CSV column (default: `opportunity`) allows specifying `campaign` or `opportunity` type for chargeback
- [x] **Standardized Logging** — Replaced print() with structured logger in rhdp_flow.py
- [x] **Deep Health Check** — `/api/health` probes RHDP API reachability
- [x] **Rate Limiting** — SlowAPI rate limiting on POST/GET endpoints
- [x] **API Versioning** — `/api/v1/` prefix with backward-compatible `/api/` alias
- [x] **CORS Configuration** — Configurable origins via `CORS_ORIGINS` env var
- [x] **Optional API Key Auth** — `RHDP_API_KEY` env var protects mutation endpoints
- [x] **CSP Headers** — Content Security Policy on all responses
- [x] **Frontend Test Suite** — Vitest + React Testing Library with 36 component tests
- [x] **Row Hover / Monospace Dates / Favicon / Tab Titles** — CSS polish and cosmetics
- [x] **Extend Operation Confirmations** — Confirmation modals for extend-stop and extend-destroy
- [x] **SSE Auto-Reconnect** — Exponential backoff reconnect (max 5 retries)
- [x] **Auto-Refresh Hook** — Reusable useAutoRefresh hook for Operations and QA tabs
- [x] **Graceful Shutdown** — Backend shutdown flag, SSE generators yield closing event
- [x] **Sortable Columns** — Click column headers to sort on all data tables
- [x] **Pagination** — Default 20 rows/page on Deployments and QA tabs
- [x] **Sticky Headers** — Table headers stay visible when scrolling
- [x] **CSV Template Download** — `GET /api/templates/schedule` with example row
- [x] **Search on Upload/Operations** — SearchInput on schedule preview and operations history
- [x] **Retry Failed Deployments** — Per-row and bulk retry via checkbox selection
- [x] **Keyboard Shortcuts** — 1-5 for tabs, ? for help overlay
- [x] **URL Hash Routing** — Tab state synced to URL hash for bookmarking
- [x] **Schedule Diff** — Compare new CSV against loaded schedules (added/removed/changed)
- [x] **Architecture Diagram** — Mermaid diagram in README
- [x] **API Documentation Links** — Swagger UI (`/docs`) and ReDoc (`/redoc`) links in README
- [x] **CHANGELOG** — Keep a Changelog format documenting all batches

## Usage Examples

```bash
# Normal deployment
python3 rhdp_flow.py --input-csv workshop_schedule.csv

# Dry-run preview
python3 rhdp_flow.py --input-csv workshop_schedule.csv --dry-run

# Lock all workshops from CSV
python3 rhdp_flow.py --input-csv workshop_schedule.csv --lock

# Extend stop time by 2 hours
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-stop --hours 2

# Extend destroy time by 1 day
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-destroy --days 1

# Scale workshops to 40 seats
python3 rhdp_flow.py --input-csv workshop_schedule.csv --scale 40

# Filter to specific CI
python3 rhdp_flow.py --input-csv workshop_schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod --scale 30

# Interactive wizard
python3 rhdp_flow.py --wizard
```

## CSV Column Reference

| Column | Required | Default | Description |
|--------|----------|---------|-------------|
| CI Name | Yes | - | Display name for the catalog item |
| CI | Yes | - | Catalog Item ID |
| Namespace | Yes | - | Kubernetes namespace |
| Users | Yes | 20 | Number of users/seats |
| Enable_workshop_interface | Yes | - | Enable Workshop UI (True/False) |
| Password | Yes | - | Access password |
| Activity | Yes | Admin | Purpose activity |
| Purpose | Yes | QA | Purpose |
| Workshop Name | No | CI Name | Display name for the workshop |
| Provisioning Date (UTC) | Yes | - | DD/MM/YYYY HH:MM format |
| Auto-stop (UTC) | Yes | - | DD/MM/YYYY HH:MM format |
| Auto-destroy (UTC) | Yes | - | DD/MM/YYYY HH:MM format |
| Multi_Asset | No | False | Old-style multi-asset flag |
| Asset_CIs | No | - | Old-style comma-separated asset CIs |
| Multi_Workshop_Name | No | - | Group rows into a multi-asset workshop (new style: per-item passwords) |
| Concurrency | No | 1 | Deployment concurrency |
| Count | No | 1 | Number of instances to create |
| AWS_Region | No | - | Comma-separated AWS regions for multi-region |
| Salesforce IDs | No | - | Salesforce items; plain ID or `type:id` pairs separated by `;` (e.g. `opportunity:71456169;campaign:701Pe00000wHJg2IAG;project:P144`) |
| Salesforce_Type | No | opportunity | Default type when IDs have no prefix: `opportunity`, `campaign`, `project`, or `cdh` |
