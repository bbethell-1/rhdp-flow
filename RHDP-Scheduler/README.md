# RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool

Automates scheduling and deployment for RHDP workshops with safety features.

## Features

- **CSV Input**: Reads workshop schedules from CSV files
- **Workshop UI**: Creates Workshop resources directly with lab user interface enabled
- **Multi-Asset Workshops**: Supports multi-asset MultiWorkshop creation with per-item passwords
- **Multi-Region**: Distributes users across multiple AWS regions
- **Multiple Instances**: Deploy N copies of the same workshop via Count column
- **Operational Commands**: Lock, extend stop/destroy, and scale existing workshops
- **Interactive Wizard**: CLI wizard for generating schedule CSVs
- **QA Verification**: Verifies deployments and exports student landing pages
- **Safety First**: `--dry-run` prints JSON payloads without creating resources

## Installation

```bash
pip3 install -r requirements.txt

# For the interactive wizard
pip3 install rich>=13.0.0
```

## Quick Start

```bash
# Preview what would be created
python3 rhdp_flow.py --input-csv example_workshop_schedule.csv --dry-run

# Deploy workshops
python3 rhdp_flow.py --input-csv workshop_schedule.csv

# Interactive wizard to generate a CSV
python3 rhdp_flow.py --wizard
```

## CSV Format

See `example_workshop_schedule.csv` for a complete example. Required and optional columns:

| Column | Required | Default | Description |
|--------|----------|---------|-------------|
| CI Name | Yes | - | Display name for the catalog item |
| CI | Yes | - | Catalog Item ID |
| Namespace | Yes | - | Kubernetes namespace (e.g., user-bbethell-redhat-com) |
| Users | Yes | 20 | Number of users/seats |
| Enable_workshop_interface | Yes | - | Enable Workshop UI (True/False) |
| Password | Yes | - | Access password |
| Activity | Yes | Admin | Purpose activity |
| Purpose | Yes | QA | Purpose |
| Workshop Name | No | CI Name | Display name for the workshop |
| Provisioning Date (UTC) | Yes | - | DD/MM/YYYY HH:MM format |
| Auto-stop (UTC) | Yes | - | DD/MM/YYYY HH:MM format |
| Auto-destroy (UTC) | Yes | - | DD/MM/YYYY HH:MM format |
| Multi_Asset | No | False | Old-style multi-asset flag (use with Asset_CIs) |
| Asset_CIs | No | - | Comma-separated asset CIs (old-style multi-asset) |
| Multi_Workshop_Name | No | - | Group rows into a multi-asset workshop (per-item passwords) |
| Concurrency | No | 1 | Deployment concurrency |
| Count | No | 1 | Number of instances to create |
| AWS_Region | No | - | Comma-separated AWS regions for multi-region |

## Usage

### Deploy Workshops

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv
```

### Filter to Specific CI

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod
```

### Lock All Workshops

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --lock
```

### Extend Stop/Destroy Time

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-stop --hours 2
python3 rhdp_flow.py --input-csv workshop_schedule.csv --extend-destroy --days 1
```

### Scale Workshops

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --scale 40
```

### QA Verification

```bash
python3 rhdp_flow.py --input-csv workshop_schedule.csv --qa both
```

## Command Line Arguments

| Argument | Description |
|----------|-------------|
| `--input-csv` | Path to input CSV file |
| `--output-csv` | Path to output CSV file (default: deployment_results.csv) |
| `--ci` | Filter to a specific Catalog Item ID |
| `--dry-run` | Print JSON payloads without creating resources |
| `--kubeconfig` | Path to kubeconfig file |
| `--timeout` | Command timeout in seconds (default: 60) |
| `--debug` | Enable debug logging |
| `--qa` | QA verification: 1, 2, or both |
| `--lock` | Lock all workshops (set stop time to now) |
| `--extend-stop` | Extend auto-stop time (use with --days/--hours) |
| `--extend-destroy` | Extend auto-destroy time (use with --days/--hours) |
| `--days` | Days to extend (default: 0) |
| `--hours` | Hours to extend (default: 0) |
| `--scale` | Scale WorkshopProvision count to N |
| `--wizard` | Launch interactive CSV generation wizard |

## Requirements

- Python 3.7+
- OpenShift CLI (`oc`) installed and logged in
- `rich` library for the wizard (optional)
