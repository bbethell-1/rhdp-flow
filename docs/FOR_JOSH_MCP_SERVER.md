# RHDP-Flow MCP Server / Skill - Quick Start Guide for Josh

**Date:** 2026-05-07  
**Purpose:** Build an MCP server or Claude Code skill to generate Flow CSV files programmatically

---

## Overview

This folder contains everything you need to build an MCP server or skill that generates RHDP-Flow CSV files. Flow is the Red Hat Demo Platform workshop automation tool — it deploys OpenShift workshops from CSV schedules.

**Your MCP server/skill will:**
1. Accept user requests like "deploy 10 workshops starting at 11:00 with 5-minute intervals"
2. Query the Flow API for catalog items and resource pool availability
3. Generate a valid Flow CSV file
4. Return the CSV or upload it directly to Flow

---

## Key Files

### 1. **`FLOW_CSV_SPEC_FOR_MCP.md`** (THIS IS YOUR MAIN SPEC)
Complete technical specification:
- All CSV columns (required + optional)
- Validation rules (catalog max, date formats, multi-asset)
- API endpoints for cluster data
- Edge cases and gotchas
- Example CSV generation logic
- Testing procedures

**Read this first!**

### 2. **`summit-test-load-1-deploy.csv`** (Real-World Example)
Actual CSV used for Summit 2026 load testing:
- 16 workshops
- Staggered deployment (10-minute intervals)
- Multi-asset workshops (5-part, 2-part, 3-part)
- Tenant catalog items (delayed start)
- All with concurrency=12, same password, same stop/destroy times

**Copy this pattern for bulk deployments.**

### 3. **`../examples/`** (Additional Examples)
- `full_featured.csv` — Shows all optional columns
- `basic_workshop.csv` — Minimal working CSV
- `multi_asset_grouped.csv` — New-style multi-asset
- `event_catalog_item.csv` — Event namespace example

### 4. **`../sample-csvs/`** (More Examples)
- `multi-asset-event-v2.csv`
- `multi_asset_grouped.csv`
- `dedicated_per_user.csv`
- `asset_passwords_example.csv`

---

## Quick Start: Building the MCP Server

### Step 1: API Endpoints You'll Use

**Get all catalog items** (shows available workshops, max users, parameters):
```bash
GET http://localhost:8000/api/catalog/items
```

Returns:
```json
[
  {
    "id": "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
    "display_name": "OCP Virt Roadshow",
    "catalog_namespace": "babylon-catalog-prod",
    "parameters": [
      {
        "name": "num_users",
        "maximum": 20,
        "minimum": 1,
        "default": 1
      }
    ]
  }
]
```

**Get all resource pools** (check availability before deploying):
```bash
GET http://localhost:8000/api/pools/all
```

**Upload generated CSV**:
```bash
POST http://localhost:8000/api/schedules/upload
Content-Type: multipart/form-data

file=@generated.csv
```

**Validate the uploaded CSV**:
```bash
POST http://localhost:8000/api/schedules/validate-num-users
POST http://localhost:8000/api/schedules/validate-catalog-namespaces
```

### Step 2: CSV Generation Logic

```python
import csv
from datetime import datetime, timedelta
from io import StringIO

def generate_flow_csv(
    catalog_item: str,
    namespace: str,
    count: int,
    start_time: datetime,
    interval_minutes: int = 10,
    users_per_workshop: int = 20,
    password: str = "summit2026",
    concurrency: int = 12
) -> str:
    """Generate Flow CSV for bulk workshop deployment."""
    
    # Calculate staggered times
    auto_stop_hours = 8
    auto_destroy_days = 23  # From provisioning date
    
    rows = []
    for i in range(count):
        prov_time = start_time + timedelta(minutes=i * interval_minutes)
        auto_stop = prov_time + timedelta(hours=auto_stop_hours)
        auto_destroy = prov_time + timedelta(days=auto_destroy_days)
        
        row = {
            "CI Name": f"Workshop {i+1}",
            "CI": catalog_item,
            "Namespace": namespace,
            "Users": users_per_workshop,
            "Instances": users_per_workshop,
            "Enable_workshop_interface": True,
            "Password": password,
            "Activity": "Admin",
            "Purpose": "QA",
            "Workshop Name": f"Test Workshop {i+1}",
            "Provisioning Date (UTC)": prov_time.strftime("%d/%m/%Y %H:%M"),
            "Auto-stop (UTC)": auto_stop.strftime("%d/%m/%Y %H:%M"),
            "Auto-destroy (UTC)": auto_destroy.strftime("%d/%m/%Y %H:%M"),
            "Concurrency": concurrency,
            "Redirect": True
        }
        rows.append(row)
    
    # Write to CSV
    output = StringIO()
    fieldnames = list(rows[0].keys())
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    
    return output.getvalue()

# Example usage:
csv_content = generate_flow_csv(
    catalog_item="summit-2026.lb2655-net-automation.event",
    namespace="user-klewis-redhat-com",
    count=10,
    start_time=datetime(2026, 5, 7, 11, 45),
    interval_minutes=10,
    users_per_workshop=60,
    password="ansnetauto",
    concurrency=12
)

print(csv_content)
```

### Step 3: Validate Before Deploying

```python
import requests

def validate_catalog_max(catalog_item: str, requested_users: int) -> bool:
    """Check if requested users exceeds catalog maximum."""
    
    catalog_items = requests.get("http://localhost:8000/api/catalog/items").json()
    item = next((c for c in catalog_items if c["id"] == catalog_item), None)
    
    if not item:
        raise ValueError(f"Catalog item {catalog_item} not found")
    
    num_users_param = next((p for p in item["parameters"] if p["name"] == "num_users"), None)
    
    if num_users_param and "maximum" in num_users_param:
        max_users = num_users_param["maximum"]
        if requested_users > max_users:
            raise ValueError(
                f"Requested {requested_users} users exceeds catalog max of {max_users}. "
                f"Split into multiple rows or use Count parameter."
            )
    
    return True

# Before generating CSV:
validate_catalog_max("openshift-cnv.ocp-virt-roadshow-multi-user.prod", 60)
```

### Step 4: Check Pool Availability

```python
def check_pool_availability(catalog_item: str) -> dict:
    """Check if resource pool has capacity."""
    
    pools = requests.get("http://localhost:8000/api/pools/all").json()["pools"]
    
    # Find pool matching catalog item
    pool = next((p for p in pools if catalog_item in p["pool_name"]), None)
    
    if not pool:
        return {"has_pool": False, "message": "No pool found, will use on-demand provisioning"}
    
    if pool["ready"] < pool["min_available"]:
        return {
            "has_pool": True,
            "warning": f"Pool low on resources: {pool['ready']} ready, {pool['min_available']} minimum. {pool['provisioning']} provisioning.",
            "pool": pool
        }
    
    return {"has_pool": True, "ok": True, "pool": pool}

# Example:
result = check_pool_availability("summit-2026.lb2655-net-automation.event")
if result.get("warning"):
    print(f"⚠️  {result['warning']}")
```

---

## Critical Rules (Read This!)

### 1. **`Users` vs `Instances` vs `Count`**

**Most common mistake:** Confusing these three columns.

- **`Users`** = Seat count for catalog validation (checks against max)
- **`Instances`** = WorkshopProvision replica count (only when `Enable_workshop_interface=True`)
- **`Count`** = Duplicate this CSV row N times (creates N separate deployments)

**Example:**
```csv
Users,Instances,Count
20,20,1
```
**Result:** 1 deployment, 20 users, WorkshopProvision with 20 instances.

```csv
Users,Instances,Count
20,20,2
```
**Result:** 2 separate deployments, each with 20 users and 20 instances.

### 2. **Catalog Max Enforcement**

Flow **blocks deployment** if `Users` > catalog max.

**Example:** Virt Roadshow max is 20, you want 40 users.

**Wrong:**
```csv
Users
40
```
**Blocked!** Validation fails.

**Correct:**
```csv
CI Name,Users,...
Virt Session 1,20,...
Virt Session 2,20,...
```
OR
```csv
Users,Count
20,2
```

### 3. **Date Format: `DD/MM/YYYY HH:MM`**

**Correct:**
```csv
Provisioning Date (UTC)
07/05/2026 11:45
```

**Wrong:**
```csv
Provisioning Date (UTC)
2026-05-07 11:45
05/07/2026 11:45 AM
```

### 4. **Catalog Namespace Auto-Detection**

Flow determines catalog namespace from CI suffix:

| CI Suffix | Catalog Namespace |
|-----------|-------------------|
| `.event` | `babylon-catalog-event` |
| `.prod` | `babylon-catalog-prod` |
| `.dev` | `babylon-catalog-dev` |
| *(none)* | `babylon-catalog-prod` |

**Wrong namespace = ghost workshops!** (stuck with `PHASE: <none>`)

**Example:**
```
summit-2026.lb2655.event → babylon-catalog-event ✓
openshift-cnv.workshop.prod → babylon-catalog-prod ✓
test-workshop → babylon-catalog-prod (default) ✓
```

### 5. **Multi-Asset Workshops**

**Legacy (single row with comma-separated CIs):**
```csv
CI Name,CI,Multi_Asset,Asset_CIs
Multi Workshop,main.prod,True,"asset1.prod,asset2.prod,asset3.prod"
```

**New style (multiple rows, same Multi_Workshop_Name):**
```csv
CI Name,CI,Multi_Workshop_Name
Part 1,asset1.prod,Summit Workshop
Part 2,asset2.prod,Summit Workshop
Part 3,asset3.prod,Summit Workshop
```

**See:** `summit-test-load-1-deploy.csv` row 4 (LB1577, 5-part), row 9 (LB1846, 2-part), row 12 (LB1997, 3-part) for real examples.

---

## User Interaction Patterns

### Pattern 1: Bulk Deployment

**User:** "Deploy 10 Ansible workshops starting at 11:00 with 5-minute intervals"

**MCP Logic:**
1. Query catalog for `ansible-network-automation`
2. Check catalog max (e.g., 60)
3. Generate CSV with 10 rows, each:
   - Provisioning: 11:00, 11:05, 11:10, ..., 11:45
   - Users: 60
   - Auto-stop: 8 hours after provisioning
   - Auto-destroy: 23 days after provisioning
4. Return CSV or upload to Flow

### Pattern 2: Multi-Tenant Deployment

**User:** "Deploy across 3 namespaces with different timing"

**MCP Logic:**
```python
workshops = [
    {"namespace": "user-alice", "start": "11:00", "users": 20},
    {"namespace": "user-bob", "start": "12:00", "users": 30},
    {"namespace": "user-charlie", "start": "13:00", "users": 15},
]

for w in workshops:
    row = generate_workshop_row(
        catalog_item="openshift-cnv.workshop.prod",
        namespace=w["namespace"],
        start_time=parse_time(w["start"]),
        users=w["users"]
    )
```

### Pattern 3: Pool-Optimized Deployment

**User:** "Use resource pools if available, otherwise on-demand"

**MCP Logic:**
```python
pool_check = check_pool_availability(catalog_item)

if pool_check["has_pool"] and pool_check["ok"]:
    # Use pool variant
    catalog_item_with_pool = f"{catalog_item}-slfsrv"  # or -tenant
else:
    # Use original catalog item (on-demand)
    catalog_item_with_pool = catalog_item

generate_csv(catalog_item=catalog_item_with_pool, ...)
```

---

## Testing Your MCP Server

### 1. Dry-Run Validation

```bash
# Generate CSV
python your_mcp_server.py > test.csv

# Upload to Flow
curl -X POST http://localhost:8000/api/schedules/upload -F "file=@test.csv"

# Validate
curl -X POST http://localhost:8000/api/schedules/validate-num-users
curl -X POST http://localhost:8000/api/schedules/validate-catalog-namespaces

# Dry-run deploy
python3 rhdp_flow.py --input-csv test.csv --dry-run
```

### 2. Check Generated Manifests

```bash
# Dry-run with YAML export
python3 rhdp_flow.py --input-csv test.csv --dry-run --export-yaml-dir /tmp/flow-yaml

# Inspect ResourceClaim, Workshop, WorkshopProvision
cat /tmp/flow-yaml/*.yaml
```

### 3. Verify in UI

1. Start Flow UI: `cd frontend && npm run dev`
2. Upload your generated CSV
3. Check for red/yellow alerts
4. Review schedule table
5. Click "Dry-Run" to preview results

---

## Example: Summit 2026 Load Test (Real Deployment)

**Scenario:** Deploy 16 workshops for Summit 2026 Test Load 1

**Requirements:**
- Regular workshops: start 11:45, 10-minute intervals
- Tenant workshops: delayed until 12:30
- All: concurrency 12, same stop/destroy times (30/05/2026 18:00)
- Multi-asset workshops: 3 different configurations

**Generated CSV:** `summit-test-load-1-deploy.csv` (see file in this folder)

**Key features demonstrated:**
- Staggered deployment timing
- Multi-asset (legacy style, `Asset_CIs` column)
- Event catalog items (`.event` suffix)
- Concurrency settings
- Per-row redirect

**Code to generate similar CSV:**

```python
workshops = [
    {"code": "LB2655", "ci": "summit-2026.lb2655-net-automation.event", "users": 60, "time": "11:45", "namespace": "user-klewis-redhat-com", "name": "Introduction to Ansible Network Automation Workshop"},
    {"code": "LB1347", "ci": "summit-2026.lb1347-advanced-features-of-aap-cnv.event", "users": 90, "time": "11:55", "namespace": "user-klewis-redhat-com", "name": "Advanced features of Ansible Automation Platform"},
    {"code": "LB1577", "ci": "summit-2026.lb1577-rhel-troubleshooting-1.event", "users": 90, "time": "12:05", "namespace": "user-klewis-redhat-com", "name": "Troubleshooting common problems on Red Hat Enterprise Linux", "multi_asset": True, "asset_cis": ["lb1577-rhel-troubleshooting-1", "lb1577-rhel-troubleshooting-2", "lb1577-rhel-troubleshooting-3", "lb1577-rhel-troubleshooting-4", "lb1577-rhel-troubleshooting-5"]},
    # ... 13 more workshops
]

for w in workshops:
    prov_time = datetime(2026, 5, 7, *parse_hhmm(w["time"]))
    
    row = {
        "CI Name": w["code"],
        "CI": w["ci"],
        "Namespace": w["namespace"],
        "Users": w["users"],
        "Instances": w["users"],
        "Enable_workshop_interface": True,
        "Password": "summit2026" if w["code"] != "LB2655" else "ansnetauto",
        "Activity": "Admin",
        "Purpose": "Summit 2026",
        "Workshop Name": f"Test Load 1 Test {w['code']} - {w['name']}",
        "Provisioning Date (UTC)": prov_time.strftime("%d/%m/%Y %H:%M"),
        "Auto-stop (UTC)": "30/05/2026 18:00",
        "Auto-destroy (UTC)": "30/05/2026 18:00",
        "Concurrency": 12,
        "Redirect": True
    }
    
    if w.get("multi_asset"):
        row["Multi_Asset"] = True
        row["Asset_CIs"] = ",".join([f"summit-2026.{ci}.event" for ci in w["asset_cis"]])
```

---

## Common Gotchas

1. **Empty `Users` column still requires header**
   ```csv
   Users
   
   20
   ```
   ✓ Valid (first row has no users, second has 20)

2. **Case-insensitive headers but values are case-sensitive**
   ```csv
   enable_workshop_interface  <- OK (case-insensitive header)
   TRUE                        <- Must be True/False/Yes/No/1/0
   ```

3. **Multi-asset password override order matters**
   - Main CSV sets base passwords
   - Upload password CSV **after** to override
   - Only overridden assets get new passwords

4. **Catalog namespace mismatch = ghost workshops**
   - Always verify: `oc get catalogitem <CI> -n <namespace>`
   - Use auto-detection (CI suffix) unless you have a specific reason to override

5. **Pool names have suffixes**
   - `-tenant` = dedicated pool (higher cost)
   - `-slfsrv` = self-service pool (shared, lower cost)
   - Example: `summit-2026.lb2655-net-automation.event-slfsrv`

---

## API Reference

### Upload CSV
```http
POST /api/schedules/upload
Content-Type: multipart/form-data

file: <CSV file>
```

**Response:**
```json
{
  "count": 10,
  "total_rows": 10,
  "skipped_rows": 0,
  "schedules": [ ... ]
}
```

### Get Catalog Items
```http
GET /api/catalog/items
```

**Response:**
```json
[
  {
    "id": "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
    "display_name": "OCP Virt Roadshow",
    "catalog_namespace": "babylon-catalog-prod",
    "description": "Workshop description",
    "category": "Workshops",
    "parameters": [
      {
        "name": "num_users",
        "type": "integer",
        "default": 1,
        "minimum": 1,
        "maximum": 20,
        "description": "Number of users"
      }
    ]
  }
]
```

### Get All Pools
```http
GET /api/pools/all
```

**Response:**
```json
{
  "pools": [
    {
      "pool_name": "openshift-cnv.ocp-virt-roadshow-multi-user.prod-slfsrv",
      "min_available": 5,
      "max_available": 10,
      "ready": 8,
      "available": 8,
      "claimed": 0,
      "provisioning": 2,
      "lifespan_default": "4h",
      "lifespan_unclaimed": "7d",
      "lifespan_maximum": "30d",
      "provider_name": "babylon-provider-aws",
      "exists": true
    }
  ]
}
```

### Validate Users
```http
POST /api/schedules/validate-num-users
```

**Response:**
```json
{
  "violations": [
    {
      "ci_name": "Workshop 1",
      "ci": "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
      "namespace": "user-alice",
      "requested_users": 40,
      "maximum": 20
    }
  ],
  "checked": 10,
  "skipped": 0
}
```

---

## Next Steps

1. **Read:** `FLOW_CSV_SPEC_FOR_MCP.md` (complete spec)
2. **Study:** `summit-test-load-1-deploy.csv` (real-world example)
3. **Explore:** `../examples/` and `../sample-csvs/` folders
4. **Test:** Generate a simple CSV and upload to Flow UI
5. **Build:** Implement MCP server with:
   - CSV generation logic
   - Catalog validation
   - Pool availability checks
   - User-friendly error messages

**Questions?** Check the Flow UI or review the parser code in `rhdp_flow.py`.

---

## Contact

**Flow Repository:** https://github.com/rhpds/rhpds-utils/tree/main/RHDP-Scheduler  
**Issues:** https://github.com/rhpds/rhpds-utils/issues

Good luck building the MCP server! 🚀
