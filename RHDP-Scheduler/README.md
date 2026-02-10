# RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool

Automates scheduling and deployment for RHDP workshops with safety features.

## Features

- **CSV Input**: Reads workshop schedules from CSV files
- **Web UI**: React/Vite frontend for browser-based scheduling
- **CLI**: Direct command-line deployment via `oc` commands
- **Interactive Wizard**: Guided CSV generation (`--wizard`)
- **Multi-Asset Workshops**: Group multiple CIs into a single MultiWorkshop
- **Multi-Region**: Distribute users across AWS regions
- **White-Glove**: Flag engagements for white-glove treatment
- **Per-Asset Passwords**: Override passwords per CI via companion CSV
- **Safety First**:
  - `--dry-run` flag prints JSON payloads without creating resources
  - Comprehensive error handling and logging
- **Operations**: Lock, extend, and scale running workshops
- **QA Verification**: Verify setup (times/users) and deployment status (seats)
- **Results Export**: Writes GUIDs and URLs to CSV for student landing pages

## UI and API

This repo includes UI and API components:

- **`frontend/`** — React/Vite TypeScript app: Upload, Deployments, Operations, QA, Students tabs.
- **`api/`** — Python FastAPI backend: `server.py`, `routes.py`, `models.py`, `jobs.py`.
- **`rhdp_flow_wizard.py`** — Interactive CLI wizard for building workshop schedule CSVs.

Use the API server and frontend for browser-based scheduling; use `rhdp_flow.py` for CLI/batch runs.

## Installation

```bash
pip3 install -r requirements.txt
```

## CSV Format

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Count,AWS_Region,White_Glove
```

See `example_workshop_schedule.csv` and `examples/` for complete examples.

## Usage

### Dry-Run Mode (Safe Preview)

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --dry-run
```

### Actual Deployment

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv
```

### Filter by Catalog Item

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod
```

### Interactive Wizard

```bash
python3 rhdp_flow.py --wizard
```

### Operations

```bash
# Lock workshops (set stop time to now)
python3 rhdp_flow.py --input-csv workshop_schedule.csv --lock

# Extend stop time
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-stop --days 1 --hours 4

# Extend destroy time
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-destroy --days 2

# Scale seats
python3 rhdp_flow.py --input-csv workshop_schedule.csv --scale 40
```

### QA Verification

```bash
# Verify setup (times, users)
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa 1

# Verify deployment status (seats)
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa 2

# Run both
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa both
```

## Per-Asset Passwords

Place a `{input_stem}_passwords.csv` alongside your input CSV to override passwords per CI:

```csv
CI,Password
openshift-cnv.ocp-virt-roadshow-multi-user.prod,VirtSecret1
zt-ansiblebu.ansible-network-automation-basics-lab-2.event,AnsibleSecret2
```

See `examples/asset_passwords_example.csv`.

## Command Line Arguments

| Flag | Description |
|------|-------------|
| `--input-csv` | Path to input CSV file (required unless `--wizard`) |
| `--output-csv` | Output CSV path (default: `deployment_results.csv`) |
| `--ci` | Filter to specific Catalog Item ID |
| `--dry-run` | Preview payloads without creating resources |
| `--kubeconfig` | Path to kubeconfig file |
| `--timeout` | Command timeout in seconds (default: 60) |
| `--debug` | Enable debug logging |
| `--wizard` | Launch interactive CSV wizard |
| `--qa {1,2,both}` | Run QA verification |
| `--lock` | Lock workshops (stop now) |
| `--extend-stop` | Extend auto-stop time |
| `--extend-destroy` | Extend auto-destroy time |
| `--days` | Days to extend (with `--extend-*`) |
| `--hours` | Hours to extend (with `--extend-*`) |
| `--scale N` | Scale WorkshopProvision seat count |

## Requirements

- Python 3.7+
- OpenShift CLI (`oc`) installed and logged in
- Access to RHDP cluster

## License

Internal Red Hat tool for RHDP automation.
