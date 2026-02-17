# RHDP-Flow TODO List

1. CSV Generation: Slack vs. Dedicated ToolThe current Slack workflow is likely hitting friction because Slack isn't a spreadsheet editor. You have two paths:Option A: The "Smoother Slack" Flow (Short-term)The Problem: Manual entry in Slack forms is slow and error-prone.The Fix: Use a Slack "Link Trigger" that opens a Modal with Data Validation.Workflow: Instead of a thread, the user fills a structured form $\rightarrow$ Data is sent to a Make.com or Zapier hook $\rightarrow$ CSV is auto-generated and posted back as a file.Option B: The Dedicated "CSV Creator" (Long-term)The Recommendation: If you’re doing this 5+ times a week, build a 1-page Retool or Glide dashboard.Why: You can have dropdowns for "Client Name," "Service Type," and "Priority," ensuring the CSV is perfectly formatted every time without Slack’s character limits or formatting quirks.
  

 2. Evaluate "Andrew’s Tool"Before merging, run it through this "Lightweight vs. Chunky" checklist:The "Addable" Test: Is it a single script or a Dockerized behemoth? If it requires more than 3 environment variables to run, it might be too chunky.The "Maintenance" Test: Does it use libraries we already have in our package.json or requirements.txt? Adding a whole new framework (like moving from Flask to Django just for one tool) is a red flag.Recommendation: If it's too chunky, extract the core logic into a utility function and discard the rest.
  

   3. Repo Cleanup & Docs ConsolidationYour repo currently has "knowledge leakage"—useful info hidden in deep folders.Proposed Folder StructurePlaintext/root
├── /src              # Production code
├── /examples         # THE NEW HOME: Consolidate everything here
│   ├── basic-csv-gen
│   ├── white-glove-workflow
│   └── advanced-api-usage
├── /docs             # High-level architecture & "The Why"
│   ├── README.md     # The entry point
│   └── architecture.md
└── /tools            # Internal scripts (Andrew's tool goes here)

Cleanup Tasks:Redundancy Audit: Delete any example_old.py or test_backup/ folders. If it’s not in the new /examples folder, it doesn't exist.Doc Migration: Move READMEs out of nested subfolders and into a single, searchable /docs directory or the root.4. UI Integration: Examples-as-CodeTo make the UI more intuitive, don't just link to docs—embed them.In-App Templates: Add a "Load Example" button in the UI that auto-fills the fields with a "White Glove" template.Tooltips: Add (?) icons next to complex fields that link directly to the specific line in your new /docs folder.


## Backlog
- [x] ~~**Destroy QA (read-only lifecycle check)** — `POST /api/qa/destroy-check` queries Workshop, WorkshopProvision, and ResourceClaim resources to verify they've been properly destroyed/stopped after scheduled times. Reports per-resource status (not_found/active/overdue) and overall lifecycle status. Never deletes anything. Frontend "Destroy QA" section in QA tab with summary cards and results table. 5 new backend tests.~~
- [x] ~~**agV num_users validation** — Before deploying, check if the catalog item has a hardcoded `num_users` limit in agnosticV; refuse to deploy more than the cap. `get_catalog_item_num_users_limit()` extracts `openAPIV3Schema.maximum` from the CI definition. Frontend shows danger alert after upload, deploy is blocked when violations exist. API endpoint `POST /api/schedules/validate-num-users` + deploy guard in both `process_schedule()` and the deploy endpoint.~~
- [x] ~~**Test multi-region split for AWS items**~~ — Covered by 8 unit tests (even/remainder user distribution, region suffixes, underscore replacement, extra_parameters, single workshop + N provisions, concurrency inheritance, 3-region distribution) plus `multi_region.csv` and `one_workshop_two_regions.csv` examples.
- [x] ~~**Redirect toggle behavior**~~ — Implemented: toggle explicitly sets `labUserInterface.redirect = False` when off (default True). agV defaults do NOT take precedence; the toggle always overrides.
- [x] ~~**CLI demo videos**~~ — 2 chapter videos in `videos/`: `07-cli-deploy-and-qa`, `08-cli-ops-and-wizard`.
- [x] ~~**Deployment log file** — Automatically save a timestamped log (txt) for each deployment and QA run. `api/log_capture.py` attaches a FileHandler per deploy/QA run; `GET /api/logs` lists files, `GET /api/logs/{file}` serves them; frontend "Download Log" button on Deployments tab. 7 new tests.~~

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
- [x] Record demo videos — 6 web UI chapters (`videos/01`–`06`) + 2 CLI chapters (`videos/07`–`08`)

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
- [x] **Test Suite** — 130 backend + 47 frontend = 177 tests (see `tests/` and `frontend/src/`)
- [x] **Fix Workshop URLs** — Map infra domain (`ocp-{env}.infra.open.redhat.com`) to RHDP UI domain (`{env}.demo.redhat.com`) and append `/details` suffix
- [x] **Fix Lock Label** — Use correct `demo.redhat.com/lock-enabled` label matching RHDP UI (was `resource-lock`)
- [x] **Remove False-Positive Warning** — Auto-destroy before auto-stop is valid (destroy nullifies stop)
- [x] **Redirect Toggle** — `labUserInterface.redirect` configurable per-schedule via `Redirect` CSV column (default: True) and per-row toggles in the schedule table. Global "Redirect (all)" switch in Deploy Settings flips all rows; per-row overrides individual schedules
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
| Users | No | unset | Number of users/seats; empty = no override |
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
| Instances | No | - | Seat count for multi-asset workshops |
| Count | No | 1 | Number of instances to create |
| AWS_Region | No | - | Comma-separated AWS regions for multi-region |
| Salesforce IDs | No | - | Salesforce items; plain ID or `type:id` pairs separated by `;` (e.g. `opportunity:71456169;campaign:701Pe00000wHJg2IAG;project:P144`) |
| Salesforce_Type | No | opportunity | Default type when IDs have no prefix: `opportunity`, `campaign`, `project`, or `cdh` |
| Redirect | No | True | Per-schedule `labUserInterface.redirect`; False/0/No/N disables |
