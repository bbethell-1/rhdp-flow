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

## Testing

The test suite (`test_rhdp_flow.py`) provides comprehensive coverage of all `rhdp_flow.py` functionality. All tests run **offline** — no cluster access or `oc` login needed. Subprocess calls are mocked with a dispatcher that returns realistic OpenShift responses.

### Running Tests

```bash
cd RHDP-Scheduler

# Run all tests with pytest (verbose)
python3 -m pytest test_rhdp_flow.py -v

# Run all tests with unittest
python3 -m unittest test_rhdp_flow -v

# Run a specific test group
python3 -m pytest test_rhdp_flow.py -v -k "TestCSVParsing"

# Run a single test
python3 -m pytest test_rhdp_flow.py -v -k "test_basic_single_row"
```

### Test Groups

| Group | Class | What it covers |
|-------|-------|----------------|
| 1 | `TestDateTimeUtilities` | `parse_date_time`, `format_iso8601`, `calculate_duration` |
| 2 | `TestCSVParsing` | `read_csv_input`, `write_deployment_results`, header formats, edge cases |
| 3 | `TestBuildResourceClaimPayload` | Payload structure, provider fields, passwords, annotations, date defaults |
| 4 | `TestCreateResourceClaimViaOc` | Dry-run, success/failure/timeout parsing, KUBECONFIG propagation |
| 5 | `TestCreateWorkshopWithUI` | Dry-run, generateName extraction, "already exists" handling |
| 6 | `TestCreateWorkshopProvision` | Dry-run, count/concurrency, name suffix, extra parameters |
| 7 | `TestCreateMultiWorkshop` | Old-style multi-asset with Asset_CIs, custom vs generated names |
| 8 | `TestCreateMultiWorkshopFromGroup` | Grouped rows sharing Multi_Workshop_Name, per-item passwords |
| 9 | `TestMultiRegionWorkshop` | Multi-region provisioning, user distribution, single-region rejection |
| 10 | `TestLockWorkshops` | Dry-run, `actionSchedule.stop` patching, no-workshops-found |
| 11 | `TestExtendStopTime` | New stop time calculation, dry-run |
| 12 | `TestExtendDestroyTime` | Workshop + WorkshopProvision `lifespan.end` patching |
| 13 | `TestScaleWorkshops` | `spec.count` patching |
| 14 | `TestProcessSchedule` | Routing: workshop UI, no UI, multi-asset, multi-region, failure |
| 15 | `TestMainCLI` | End-to-end CLI: dry-run, `--ci` filter, `--lock`, `--extend-*`, `--scale`, count expansion, grouped routing |
| 16 | `TestConstructWorkshopUrl` | URL construction with/without suffix |
| 17 | `TestVerifyDeployment` | Dry-run, healthy+ready, not healthy |
| 18 | `TestRHDPConfig` | `validate()` success, failure, oc-not-found |
| 19 | `TestCreateParser` | Default values, flag parsing, QA choices, scale integer |

### Writing New Tests

The test file provides three helper factories:

- **`make_schedule(**overrides)`** — creates a `WorkshopSchedule` with sensible defaults; override any field by keyword
- **`make_config(dry_run=False)`** — creates an `RHDPConfig`
- **`make_oc_dispatcher(overrides=None)`** — returns a callable for `@patch('rhdp_flow.subprocess.run')` that dispatches on the `oc` subcommand (`create`, `get`, `patch`, `delete`, `version`) and returns realistic `CompletedProcess` objects. Pass `overrides` dict to customize specific responses.

Example adding a new test:

```python
@patch("rhdp_flow.subprocess.run")
def test_my_new_feature(self, mock_run):
    mock_run.side_effect = make_oc_dispatcher()
    config = make_config(dry_run=False)
    schedule = make_schedule(users=50, password="NewPass")
    result = process_schedule(schedule, config)
    self.assertEqual(result.status, "verified")
```

## Requirements

- Python 3.7+
- OpenShift CLI (`oc`) installed and logged in
- `rich` library for the wizard (optional)
- Access to RHDP integration cluster
