# RHDP-Flow TODO List

All features implemented as of 2026-02-09.

test multi asset again with true in the coul in your sheet? or do we need multi asset true and asset ci's  (see cisco example if needed) v your example) but we do want it so we have it clearer on sheet as we want pdiffrent password for each multi asset item) 

test virt roadshow 20 users and 2 clusters/count

market it to John and team - soultion for White gloves

Test multi region (but use aws item)

Make super clear example sheets

make super clear example commands - for deployibng and for QA 

eXxamples to lock all, extend destory extend stops

Update passwords feature? can check all and update opasswords if changed in sheet (run tool though manually)

csv wizard examples

mini video showing all options

can test on intergration 

want a way to easily get csv from white glove workshop space or in a less mnaual fasshion - we have a white glov ehelper tool we run within white glove workshops and it gives us a csv? we need item name (maybe has to be agv item) but we are oc'd into cluster so it can check

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
- [x] **Display Name** - Use actual catalog display name in ResourceClaim annotations (PR #25)
- [x] **Deployment Concurrency** - Add `Concurrency` column to CSV, configurable per workshop (`--input-csv`)
- [x] **Multiple Instance Support (Count)** - Add `Count` column to CSV, automatically expands into N instances
- [x] **Multi-Asset Per-Item Passwords** - Rows sharing the same `Multi_Workshop_Name` are auto-grouped; each row has its own CI and password
- [x] **Lock All** - `--lock` flag stops all workshops from the CSV immediately (sets stop time to now)
- [x] **Extend Stop** - `--extend-stop --days N --hours N` extends auto-stop time for workshops
- [x] **Extend Destroy** - `--extend-destroy --days N --hours N` extends auto-destroy/lifespan time for workshops and provisions
- [x] **Scale** - `--scale N` sets WorkshopProvision count to target value
- [x] **Regions (Multi-Region Provisioning)** - `AWS_Region` column supports comma-separated regions; creates one Workshop with multiple regional WorkshopProvisions, users distributed evenly
- [x] **Interactive CSV Wizard** - `--wizard` launches a rich CLI wizard to generate workshop schedule CSVs interactively

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
