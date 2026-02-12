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

Click **Download CSV Template** in the Upload tab toolbar to get a pre-formatted CSV with all column headers and an example row. Available at `GET /api/templates/schedule`.

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

All data tables have search inputs that filter across CI name, GUID, namespace, and other fields. The Deployments tab also has toggle buttons to filter by status (All / Verified / Unverified / Failed).

### URL Tab Routing

The current tab is synced to the URL hash (e.g., `http://localhost:8000/#deployments`). This means you can:
- Bookmark specific tabs
- Use browser back/forward to navigate between tabs
- Share direct links to specific tabs

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
