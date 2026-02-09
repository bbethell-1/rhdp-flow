# RHDP-Flow TODO List

## Testing

- [x] Test multi-asset with `Multi_Asset=True` + `Asset_CIs` (old format) vs grouped rows with `Multi_Workshop_Name` (new format) — verify both paths produce correct results and that per-item passwords work in both cases (5 tests: shared password, asset parsing, per-item password propagation, mixed concurrency, graceful degradation)
- [x] Test Virt Roadshow with 20 users and `Count=2` (2 clusters/instances) (5 tests: 2 named instances, count reset, no expansion for count=1, users not divided, fields preserved)
- [x] Test multi-region provisioning with an AWS catalog item (8 tests: even/remainder user distribution, region suffixes, underscore replacement, extra_parameters, single workshop + N provisions, concurrency inheritance, 3-region distribution)
- [ ] Test on integration cluster (end-to-end with real `oc` commands)
- [x] Verify landing page URLs work correctly and export to CSV automatically (7 tests: URL construction, empty input, tuple return, suffix extraction, CSV format, regular vs multi-workshop URL selection)

## Documentation

- [ ] Create clear example CSV sheets covering each deployment type (basic, multi-asset, grouped, multi-region, count expansion)
- [ ] Write clear example commands for deploying and for QA verification
- [ ] Write examples for operational commands: lock all, extend stop, extend destroy, scale
- [ ] Add CSV wizard usage examples
- [ ] Record a short demo video showing all options

## Feature Ideas

- [ ] **Update Passwords** — Re-run tool to detect changed passwords in the CSV and patch existing workshops (manual trigger)
- [ ] **White Glove CSV Import** — Generate a schedule CSV directly from a white glove workshop namespace (the tool runs `oc` against the cluster to discover deployed items and exports them to CSV format)
- [ ] **Master Sheet Sync** — Sync changes from the master scheduling sheet to our local sheet; compare daily or sync with APT before an event
- [ ] **Business Requirements Document** — Create high-level BRD for presenting to John and team as a white glove solution (see `RHDP-Flow_BRD.md`)

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
- [x] **Lock All** — `--lock` flag stops all workshops from the CSV immediately (sets stop time to now)
- [x] **Extend Stop** — `--extend-stop --days N --hours N` extends auto-stop time for workshops
- [x] **Extend Destroy** — `--extend-destroy --days N --hours N` extends auto-destroy/lifespan time for workshops and provisions
- [x] **Scale** — `--scale N` sets WorkshopProvision count to target value
- [x] **Regions (Multi-Region Provisioning)** — `AWS_Region` column supports comma-separated regions; creates one Workshop with multiple regional WorkshopProvisions, users distributed evenly
- [x] **Interactive CSV Wizard** — `--wizard` launches a rich CLI wizard to generate workshop schedule CSVs interactively
- [x] **Test Suite** — 113 tests across 26 groups covering all functionality (see `test_rhdp_flow.py`)

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
