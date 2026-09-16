# RHDP-Flow Usage Guide

## Deployment

### Basic deployment from CSV
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv
```

### Dry-run preview (no cluster changes)
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --dry-run
```

### Deploy only a specific catalog item
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod
```

### Deploy with dry-run for a single CI
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --dry-run --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod
```

---

## Operations

### Lock all workshops (prevent date changes)
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --lock
```

### Lock only a specific CI
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --lock --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod
```

### Extend auto-stop by 2 hours
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-stop --hours 2
```

### Extend auto-destroy by 1 day and 6 hours
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-destroy --days 1 --hours 6
```

### Scale workshops to 40 seats
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --scale 40
```

### Scale a specific CI to 30 seats
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod --scale 30
```

---

## QA Verification

### Run all QA checks (setup + deployment status)
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa
```

### QA1 only: verify setup (catalog items exist, parameters correct)
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa1
```

### QA2 only: verify deployment status (workshops running, seats provisioned)
```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa2
```

---

## Interactive CSV Wizard

### Launch the wizard to build a CSV interactively
```bash
python3 rhdp_flow.py --wizard
```

The wizard walks you through:
1. Selecting a catalog item from the cluster
2. Setting namespace, users, password, dates
3. Configuring optional fields (concurrency, count, regions)
4. Saving to a CSV file

---

## Web UI

### Start the backend API server
```bash
cd RHDP-Scheduler
uvicorn api.server:app --reload --port 8000
```

### Start the frontend dev server
```bash
cd RHDP-Scheduler/frontend
npm run dev
```

The UI is available at `http://localhost:5173` and proxies API calls to port 8000.

### Build for production
```bash
cd RHDP-Scheduler/frontend
npm run build
```

---

## Web UI Features

### CSV Template Download

Click **Download CSV Template** in the Upload tab toolbar to get a CSV whose headers match `read_csv_input()` (required + optional columns such as Showroom and Salesforce). The example row validates when uploaded. Endpoint: `GET /api/templates/schedule`. For semantics of each column, see **[README.md — CSV Format](../README.md#csv-format)** (authoritative list).

### Upload tab: Validate, dry-run, and YAML download

After schedules are loaded:

- **Validate** — Re-runs namespace checks (`POST /api/schedules/validate-namespaces`) and catalog **num_users** limits (`POST /api/schedules/validate-num-users`), then refreshes the same alerts as after upload.
- **Dry-run** — `POST /api/deploy/dry-run` (preview results; no cluster changes).
- **Download YAML** — `POST /api/deploy/dry-run-yaml` returns a single `rhdp-dry-run-manifests.yaml` file (manifests separated by `---`), built from the same dry-run path that writes ResourceClaim / Workshop / WorkshopProvision YAML when export is enabled.

### Catalog `num_users` limits

After upload, the UI checks loaded schedules against each catalog item’s **maximum `num_users`** (cluster must be reachable). Rows where **`Users`** exceeds the max show a **red alert**; **live deploy** is blocked until counts are fixed. **Dry-run** is still allowed. The same check runs on **`POST /api/deploy`** and in the CLI **`process_schedule`** path. See README **Catalog num_users maximum** for behavior and how to model “more seats than one claim allows” (e.g. `Count` or multiple rows)—there is no automatic split into 2×20 today.

### Keyboard Shortcuts

Press `?` anywhere in the UI to open the keyboard shortcuts help modal.

| Key | Action |
|-----|--------|
| `1` | Upload & Deploy tab |
| `2` | Deployments tab |
| `3` | Operations tab |
| `4` | QA tab |
| `5` | Students tab |
| `?` | Show help overlay |

### Schedule Diff

After uploading a CSV, use the **Compare CSV** section at the bottom of the Upload tab to upload a second CSV and see what changed:
- **Green** rows: added in the new CSV
- **Red** rows: removed from the new CSV
- **Yellow** rows: changed fields (details shown)

### Retry Failed Deployments

In the Deployments tab:
- **Single retry**: Click the retry icon on any failed row
- **Bulk retry**: Select failed rows using checkboxes, then click **Retry Selected**

### Search & Filter

All data tables have search inputs that filter across CI name, GUID, namespace, and other fields. The Deployments and QA tabs have toggle buttons to filter by status (All / Verified / Unverified / Failed). Search and filter selections persist across tab switches via `sessionStorage`.

### Select All Across Pages

In the Deployments tab, when all rows on the current page are selected, a banner appears offering to select all matching filtered results across all pages. A "Clear selection" banner appears when all filtered results are selected.

### QA Results Export

In the QA tab, click **Download Filtered CSV** to export the currently filtered QA results as a CSV file. The filename reflects the active status filter (e.g., `qa-results-all.csv`).

### Copy to Clipboard

Click the link icon on any deployment row to copy the workshop URL. A toast notification confirms the copy.

### Status Icons

Status cells display color-coded icons alongside text for accessibility:
- Green checkmark for verified/success
- Yellow warning triangle for unverified/no URL
- Red exclamation for failed/error

### URL Tab Routing

The current tab is synced to the URL hash (e.g., `http://localhost:8000/#deployments`). This means you can:
- Bookmark specific tabs
- Use browser back/forward to navigate between tabs
- Share direct links to specific tabs

---

## Structured Logging

Enable JSON-formatted log output for production environments:

```bash
export LOG_FORMAT=json
uvicorn api.server:app --port 8000
```

Requires `python-json-logger` (included in `requirements.txt`). When unset, logs use human-readable text format.

---

## Example CSV Files

Example CSVs are in `docs/examples/`:

| File | Description |
|------|-------------|
| `basic_workshop.csv` | Simple 2-workshop deployment |
| `multi_asset_grouped.csv` | Grouped multi-asset (per-item passwords, new format) |
| `multi_asset_legacy.csv` | Legacy multi-asset with `Multi_Asset=True` + `Asset_CIs` |
| `multi_region.csv` | AWS multi-region deployment (3 regions, users split evenly) |
| `count_expansion.csv` | Count=3 expands into 3 named instances |
| `full_featured.csv` | All optional columns including concurrency, Salesforce, etc. |
