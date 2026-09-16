# RHDP-Flow CSV Format Specification (for MCP Server / Skill Development)

**Last Updated:** 2026-05-07  
**Audience:** Developers building skills, MCP servers, or automation tools that generate Flow CSV files  
**Flow Version:** 1.3.5+

---

## Overview

RHDP-Flow automates OpenShift workshop deployment from CSV schedules. This document provides a complete technical specification for generating valid CSV files programmatically.

### Quick Facts
- **Column order:** Does not matter
- **Header case:** Case-insensitive (e.g., `CI Name` = `ci name` = `CI_NAME`)
- **Optional `Archive` column:** Always ignored
- **Date format:** `DD/MM/YYYY HH:MM` (24-hour)
- **Parser:** `read_csv_input()` in `rhdp_flow.py`
- **Validation:** UI calls `/api/schedules/validate-num-users` and `/api/schedules/validate-catalog-namespaces` after upload

---

## Required Columns

### Core Identity

| Column | Type | Rules | Example |
|--------|------|-------|---------|
| `CI Name` | string | Workshop display name; appears in UIs | `Virt Roadshow` |
| `CI` | string | Catalog item ID (see catalog namespace rules below) | `openshift-cnv.ocp-virt-roadshow-multi-user.prod` |
| `Namespace` | string | OpenShift namespace where workshop deploys | `user-bbethell-redhat-com` |

### Seating & Workshop Type

| Column | Type | Rules | Example |
|--------|------|-------|---------|
| `Users` | int or empty | **Header required**. Cell may be empty (no `num_users` from CSV). If >0, becomes ResourceClaim `num_users`. **Enforced against catalog max** (see validation). | `20` or `` (empty) |
| `Enable_workshop_interface` | bool | `True`/`False`/`Yes`/`No`/`1`/`0`. If False: ResourceClaim only (no Workshop/WorkshopProvision). | `True` |
| `Instances` | int or empty | **Only used when** `Enable_workshop_interface=True` or multi-asset. Becomes WorkshopProvision `spec.count`. Defaults to 1 if empty. **Not used for ResourceClaim-only workshops.** | `30` or `` (empty) |

**Critical:** `Users` vs `Instances` vs `Count` are **different**:
- **`Users`** = seat count for `num_users` validation (catalog max check)
- **`Instances`** = WorkshopProvision replica count (`spec.count`)
- **`Count`** = CSV row expansion (1 row → N deployments)

### Credentials & Metadata

| Column | Type | Rules | Example |
|--------|------|-------|---------|
| `Password` | string | Workshop password (used in ResourceClaim annotation) | `virt2026` |
| `Activity` | string | Defaults to `Admin` if empty | `Admin` |
| `Purpose` | string | Defaults to `QA` if empty | `QA` |

### Dates (Choose ONE Set)

**Option 1 (recommended):** UTC-style headers:
- `Provisioning Date (UTC)`
- `Auto-stop (UTC)`
- `Auto-destroy (UTC)`

**Option 2 (legacy):** No suffix:
- `Provisioning Date`
- `Auto-stop`
- `Auto-destroy`

**Format:** `DD/MM/YYYY HH:MM` (24-hour)  
**Example:** `25/03/2026 10:00`

**Rule:** Use **all** legacy **or** **all** UTC headers—never mix.

---

## Optional Columns

### Display & Naming

| Column | Default | Notes |
|--------|---------|-------|
| `Workshop Name` | `CI Name` | Overrides display name in manifests |

### Multi-Asset Workshops

Two approaches (don't mix on same row):

**Approach 1 (legacy, single row):**
| Column | Example | Notes |
|--------|---------|-------|
| `Multi_Asset` | `True` | Marks row as multi-asset |
| `Asset_CIs` | `ci1.prod,ci2.prod,ci3.prod` | Comma-separated catalog items |

**Approach 2 (new-style, multiple rows):**
| Column | Example | Notes |
|--------|---------|-------|
| `Multi_Workshop_Name` | `Summit Workshop` | Same name on each row → groups into MultiWorkshop |

**Each row** has its own `CI`, `Namespace`, `Users`. Grouped by matching `Multi_Workshop_Name`.

**Passwords for multi-asset:**  
Upload a second CSV with columns: `CI Name`, `CI`, `Password`. Overrides per-asset passwords.

### Scaling & Concurrency

| Column | Default | Notes |
|--------|---------|-------|
| `Concurrency` | 1 | WorkshopProvision concurrency |
| `Count` | 1 | Row expansion: 1 row → N identical deployments (different seat counts than `Instances`) |

### Billing & Chargeback

| Column | Default | Example | Notes |
|--------|---------|---------|-------|
| `Salesforce IDs` | `""` | `opportunity:71456169;campaign:701Pe00000wHJg2IAG` | Semicolon-separated. Optional `type:` prefix. |
| `Salesforce_Type` | `opportunity` | `campaign` | Default type for IDs without `type:` prefix |

**Aliases:** `campaign_id` → `Salesforce IDs`

### Multi-Region

| Column | Default | Example | Notes |
|--------|---------|---------|-------|
| `AWS_Region` | `""` | `us-east-1,us-west-2` | Comma-separated. Creates separate deployment per region. |

### UI Behavior

| Column | Default | Example | Notes |
|--------|---------|---------|-------|
| `Redirect` | `True` | `False`, `0`, `No`, `N` | Per-row lab redirect. Global UI toggle sets defaults for new uploads. |

### Showroom Integration

| Column | Default | Notes |
|--------|---------|-------|
| `Showroom_Repo` | `""` | GitHub repo for Showroom content |
| `Showroom_Ref` | `""` | Git ref (branch/tag/SHA) |
| `Showroom_NoVNC` | `False` | Enable noVNC remote desktop tab |
| `Showroom_Zerotouch` | `False` | Use zerotouch chart with setup/runtime automation |

### Catalog Namespace (Advanced)

| Column | Default | Example | Notes |
|--------|---------|---------|-------|
| `Catalog_Namespace` | Auto-detected | `babylon-catalog-event` | Override auto-detection. **Wrong value = ghost workshops!** |

**Auto-detection rules:**
| CI Suffix | Catalog Namespace |
|-----------|-------------------|
| `.event` | `babylon-catalog-event` |
| `.prod` | `babylon-catalog-prod` |
| `.dev` | `babylon-catalog-dev` |
| *(none)* | `babylon-catalog-prod` |

---

## Cluster-Tenant Catalog Items

### Overview

Some catalog items are available in **two infrastructure variants**:

- **Cluster variant** (`-cluster` suffix): Provisions a dedicated OpenShift cluster
- **Tenant variant** (`-tenant` suffix): Provisions tenant namespace on shared cluster via Sandbox API

### Architecture Differences

| Variant | Infrastructure | Provision Time | Cost | Isolation |
|---------|---------------|----------------|------|-----------|
| Cluster | Dedicated cluster | 45-60 min | Higher | Complete (full cluster) |
| Tenant | Shared cluster + namespace | 5-15 min | Lower | Namespace-level |

### CSV Usage

**No special columns required** - just use the correct catalog item ID:

```csv
CI Name,CI,Namespace,...
Data Gov Tenant,ai-quickstarts.ai-qs-data-gov-tenant.event,user-alice,...
Data Gov Cluster,ai-quickstarts.ai-qs-data-gov-cluster.event,user-bob,...
```

### When to Generate Each Variant

**Use tenant variant (`-tenant`) when:**
- User requests workshop, demo, or quickstart deployment
- Event is time-sensitive (needs fast provisioning)
- Budget-conscious (lower cost)
- Multi-user event (20+ seats) - stagger deployments by 5-10 minutes

**Use cluster variant (`-cluster`) when:**
- User explicitly requests "full cluster" or "dedicated cluster"
- Testing cluster-level features (operators, cluster config, etc.)
- Production-like environment needed
- User mentions "cluster admin access" or "custom cluster configuration"

### Catalog Item Families

**AI Quickstarts** (event catalog):
```
ai-quickstarts.ai-qs-data-gov-cluster.event      | ai-quickstarts.ai-qs-data-gov-tenant.event
ai-quickstarts.ai-qs-it-self-service-cluster.event | ai-quickstarts.ai-qs-it-self-service-tenant.event
ai-quickstarts.ai-qs-product-rec-cluster.event   | ai-quickstarts.ai-qs-product-rec-tenant.event
ai-quickstarts.ai-qs-rag-cluster.event           | ai-quickstarts.ai-qs-rag-tenant.event
ai-quickstarts.ai-qs-ppe-comp-cluster.event      | ai-quickstarts.ai-qs-ppe-comp-tenant.event
```

### Validation

Before generating CSV with cluster/tenant items, verify existence:

```python
import requests

def validate_catalog_item(ci: str, catalog_ns: str = "babylon-catalog-event"):
    """Check if catalog item exists."""
    # Via API
    items = requests.get("http://localhost:8000/api/catalog/items").json()
    return any(item["id"] == ci and item["catalog_namespace"] == catalog_ns for item in items)

# Example
if validate_catalog_item("ai-quickstarts.ai-qs-data-gov-tenant.event"):
    print("Tenant variant exists")
```

### Staggered Deployment for Tenant Variants

When generating CSV with multiple tenant workshops (e.g., event with 50 seats), **stagger provisioning times** to avoid Sandbox API throttling:

```python
import datetime

base_time = datetime.datetime(2026, 5, 7, 9, 0)  # Event start: 09:00
interval_minutes = 5  # 5-minute gaps

for i in range(10):  # 10 tenant workshops
    prov_time = base_time + datetime.timedelta(minutes=i * interval_minutes)
    row = {
        "CI Name": f"AI Workshop {i+1}",
        "CI": "ai-quickstarts.ai-qs-data-gov-tenant.event",
        "Provisioning Date (UTC)": prov_time.strftime("%d/%m/%Y %H:%M"),
        # ... rest
    }
```

**Output:**
```csv
Provisioning Date (UTC)
07/05/2026 09:00
07/05/2026 09:05  ← 5-minute gap
07/05/2026 09:10
07/05/2026 09:15
```

**Recommended intervals:**
- Small events (<10 workshops): 5 minutes
- Medium events (10-30 workshops): 7-10 minutes
- Large events (30+ workshops): 10-15 minutes

---

## Validation Rules

### 1. `num_users` Catalog Maximum Enforcement

**Trigger:** Upload CSV with `Users > 0`  
**Validation:** `POST /api/schedules/validate-num-users` (called by UI after upload)

**Rules:**
- Catalog items may define a **maximum** for `num_users` (e.g., Virt Roadshow max 20)
- If `Users` in CSV > catalog max: **deployment blocked** (UI shows red alert, API returns 400)
- Multi-asset: **each asset CI** is checked individually
- Dry-run mode: **not blocked** (allows inspecting YAML)
- CLI: `process_schedule()` fails row with error message

**Workaround for higher seat counts:**
- Create **multiple rows** (e.g., 2 rows × 20 users = 40 total)
- Or use `Count=2` with `Users=20` (creates 2 separate deployments)
- Tool does **not** auto-split rows

**Example violations:**
```json
{
  "violations": [
    {
      "ci_name": "Virt Roadshow",
      "ci": "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
      "namespace": "user-alice",
      "requested_users": 40,
      "maximum": 20,
      "minimum": null,
      "default_value": 1
    }
  ]
}
```

### 2. Catalog Namespace Mismatch Detection

**Trigger:** Dry-run mode or validation  
**Validation:** `POST /api/schedules/validate-catalog-namespaces`

**Common errors:**
- Manual `Catalog_Namespace` override to wrong namespace
- CI missing suffix (defaults to prod, but actually in event)
- Typo in CI name

**Example:**
```
❌ Item 'summit-2026.lb1234.event' not found in babylon-catalog-prod.
   Found in babylon-catalog-event instead. Remove Catalog_Namespace column
   to use auto-detection, or set it to babylon-catalog-event.
```

### 3. Date Validation

**Rules enforced in UI (warnings, not blockers):**
- Provisioning date must be ≥ today (prevents accidental past deployments)
- Auto-stop must be > provisioning date
- Auto-destroy must be > auto-stop
- Recommended: auto-destroy = auto-stop + 1 day minimum

**Format:** `DD/MM/YYYY HH:MM` (24-hour, UTC recommended)

### 4. `Users` vs `Instances` Advisory

**Trigger:** `Users > 0` AND catalog item has no `num_users` parameter

**Severity:**
- **High:** `Enable_workshop_interface=True` + `Instances` unset/empty → likely forgot to set `Instances`
- **Medium:** `Enable_workshop_interface=False` → `Instances` ignored anyway

**Why:** Some catalog items use `Instances` for WorkshopProvision count, not `Users`. Setting `Users` when catalog doesn't define `num_users` may indicate confusion.

---

## CSV Template (All Columns)

```csv
CI Name,CI,Namespace,Users,Instances,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Concurrency,Count,AWS_Region,Salesforce IDs,Salesforce_Type,Multi_Asset,Asset_CIs,Multi_Workshop_Name,Redirect,Catalog_Namespace,Showroom_Repo,Showroom_Ref,Showroom_NoVNC,Showroom_Zerotouch
```

**Minimal working CSV (required columns only):**
```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Test Workshop,test.workshop.prod,user-alice,10,True,test123,Admin,QA,25/03/2026 10:00,28/03/2026 18:00,29/03/2026 10:00
```

---

## Examples

### Example 1: Simple Single Workshop

```csv
CI Name,CI,Namespace,Users,Instances,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Virt Roadshow,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-alice,20,,True,virt2026,Admin,QA,Virt Roadshow,25/03/2026 10:00,28/03/2026 18:00,29/03/2026 10:00
```

**Result:** ResourceClaim with `num_users=20`, Workshop, WorkshopProvision with `spec.count=1` (default)

---

### Example 2: Workshop with Instances (WorkshopProvision Count)

```csv
CI Name,CI,Namespace,Users,Instances,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Concurrency
Ansible Lab,zt-ansiblebu.ansible-network-automation-basics-lab-2.prod,user-bob,,30,True,ansible2026,Admin,QA,Ansible Lab,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,15
```

**Result:** ResourceClaim (no `num_users` from CSV), Workshop, WorkshopProvision with `spec.count=30`, `concurrency=15`

**Note:** `Users` is empty → no catalog max check. Catalog defaults may still apply to `num_users`.

---

### Example 3: Multi-Asset (Legacy, Single Row)

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs
Multi Workshop,main.ci.prod,user-charlie,25,True,multi2026,Admin,QA,Multi Workshop,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,True,"asset1.prod,asset2.prod,asset3.prod"
```

**Result:** MultiWorkshop with 3 assets. Main CI + 3 asset CIs. `Users` validated against all 4 catalog items.

---

### Example 4: Multi-Asset (New Style, Grouped Rows)

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Workshop_Name
Part 1,asset1.prod,user-dave,10,True,pass1,Admin,QA,Part 1,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,Summit Workshop
Part 2,asset2.prod,user-dave,10,True,pass2,Admin,QA,Part 2,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,Summit Workshop
Part 3,asset3.prod,user-dave,10,True,pass3,Admin,QA,Part 3,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,Summit Workshop
```

**Result:** 3 rows with same `Multi_Workshop_Name` → grouped into 1 MultiWorkshop with 3 assets.

**Override passwords:** Upload second CSV:
```csv
CI Name,CI,Password
Part 1,asset1.prod,custom-pass-1
Part 2,asset2.prod,custom-pass-2
```

---

### Example 5: Salesforce Multi-Type

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Salesforce IDs,Salesforce_Type
AI Workshop,openshift-ai.ai-workshop-multi-user.prod,user-eve,25,True,ai2026,Admin,QA,AI Workshop,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,"opportunity:71456169;campaign:701Pe00000wHJg2IAG;project:P144",
```

**Result:** 3 Salesforce IDs with different types. IDs without `type:` prefix use `Salesforce_Type` default (empty here → skipped).

---

### Example 6: Multi-Region Deployment

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),AWS_Region
Global Workshop,global.workshop.prod,user-frank,15,True,global2026,Admin,QA,Global Workshop,25/03/2026 10:00,27/03/2026 18:00,28/03/2026 10:00,"us-east-1,us-west-2,eu-west-1"
```

**Result:** 3 separate deployments (one per region). Each gets `-us-east-1`, `-us-west-2`, `-eu-west-1` suffix in name.

---

### Example 7: Event Catalog Item (with staggered timing)

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Summit Lab 1,summit-2026.lb1234.event,user-alice,20,True,summit2026,Admin,QA,Test Load 1,07/05/2026 11:45,30/05/2026 18:00,30/05/2026 18:00
Summit Lab 2,summit-2026.lb5678.event,user-bob,20,True,summit2026,Admin,QA,Test Load 2,07/05/2026 11:55,30/05/2026 18:00,30/05/2026 18:00
Summit Lab 3,summit-2026.lb9012.event,user-charlie,20,True,summit2026,Admin,QA,Test Load 3,07/05/2026 12:05,30/05/2026 18:00,30/05/2026 18:00
```

**Result:** 3 workshops with 10-minute deployment intervals. Auto-detected catalog namespace: `babylon-catalog-event` (from `.event` suffix).

---

## Common Pitfalls & Edge Cases

### 1. Ghost Workshops (Wrong Catalog Namespace)

**Symptom:** Workshop created with `PHASE: <none>`, `provisioningCount: 0`  
**Cause:** Catalog item doesn't exist in the target namespace  
**Fix:** Verify CI exists: `oc get catalogitem <CI> -n <namespace>`

### 2. `Users` vs `Instances` Confusion

**Wrong:**
```csv
Users,Instances,Enable_workshop_interface
30,,True
```
**Result:** ResourceClaim with `num_users=30`, WorkshopProvision with `spec.count=1` (default)

**If you wanted 30 workshop instances:**
```csv
Users,Instances,Enable_workshop_interface
,30,True
```

### 3. Over Catalog Max

**Example:** Virt Roadshow max 20, you want 40 users.

**Wrong (single row):**
```csv
CI Name,CI,Namespace,Users,...
Virt,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-alice,40,...
```
**Error:** Deployment blocked, validation fails.

**Correct (two rows):**
```csv
CI Name,CI,Namespace,Users,...
Virt Session 1,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-alice,20,...
Virt Session 2,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bob,20,...
```

**Or use `Count`:**
```csv
CI Name,CI,Namespace,Users,Count,...
Virt,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-alice,20,2,...
```
**Result:** 2 deployments, both with `Users=20`.

### 4. Mixed Date Headers

**Wrong:**
```csv
Provisioning Date,Auto-stop (UTC),Auto-destroy (UTC)
25/03/2026 10:00,28/03/2026 18:00,29/03/2026 10:00
```
**Parser may fail or use wrong columns.**

**Correct:** All UTC or all legacy:
```csv
Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
25/03/2026 10:00,28/03/2026 18:00,29/03/2026 10:00
```

### 5. Multi-Asset Password Override Order

**Main CSV:**
```csv
CI Name,CI,Password,Multi_Asset,Asset_CIs
Main,main.prod,mainpass,True,"a.prod,b.prod"
```

**Password CSV (uploaded after):**
```csv
CI Name,CI,Password
Asset A,a.prod,passA
```

**Result:** `a.prod` uses `passA`, `b.prod` uses `mainpass` (fallback), `main.prod` uses `mainpass`.

---

## Deploy Settings (Not in CSV)

These are **not** CSV columns. Set via UI toggles, API params, or CLI flags:

| Setting | Default | API Param | CLI Flag |
|---------|---------|-----------|----------|
| Resource Lock | True | `resource_lock` | `--lock` |
| Enable Resource Pools | False | `enable_resource_pools` | `--enable-resource-pools` |
| White Glove | True | `white_glove` | N/A (always True in code) |
| Redirect (global) | True | `redirect` | N/A |

**Resource Pools:**
- Toggle on → enables Poolboy resource pool allocation
- Pool Lookup → queries cluster for pool status, shows dropdown to override catalog item with any pool

---

## API Endpoints (for MCP Server Integration)

### Upload & Validation

```http
POST /api/schedules/upload
Content-Type: multipart/form-data

file=@schedule.csv
```
**Returns:** `UploadResponse` with `schedules`, `count`, `total_rows`, `skipped_rows`

```http
POST /api/schedules/validate-num-users
```
**Returns:** `NumUsersValidationResponse` with `violations` (over max), `users_not_in_catalog` (advisory)

```http
POST /api/schedules/validate-catalog-namespaces
```
**Returns:** `CatalogNamespaceValidationResponse` with `mismatches`, `not_found`

### Cluster Data (for Building CSVs)

```http
GET /api/catalog/items
```
**Returns:** Array of `CatalogItemEntry`:
```json
[
  {
    "id": "openshift-cnv.ocp-virt-roadshow-multi-user.prod",
    "display_name": "OCP Virt Roadshow",
    "catalog_namespace": "babylon-catalog-prod",
    "description": "...",
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

```http
GET /api/pools/all
```
**Returns:** Array of `PoolInfo` (all ResourcePools in cluster):
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

```http
GET /api/pools/lookup?catalog_item=<CI>
```
**Returns:** `PoolLookupResponse` with matched pool for a catalog item.

### Download Template

```http
GET /api/templates/schedule
```
**Returns:** CSV file with all column headers (blank rows).

---

## Edge Cases for MCP Server / Skill Logic

### 1. Staggered Deployments

**User request:** "Deploy 10 workshops starting at 11:00 with 5-minute intervals"

**CSV logic:**
```python
import datetime

base_time = datetime.datetime(2026, 5, 7, 11, 0)  # 07/05/2026 11:00
interval_minutes = 5

for i in range(10):
    prov_time = base_time + datetime.timedelta(minutes=i * interval_minutes)
    row = {
        "Provisioning Date (UTC)": prov_time.strftime("%d/%m/%Y %H:%M"),
        # ... rest of columns
    }
```

**Output:**
```csv
Provisioning Date (UTC)
07/05/2026 11:00
07/05/2026 11:05
07/05/2026 11:10
...
```

### 2. Pool Availability Check

Before generating CSV with resource pools, check availability:

```python
import requests

pools = requests.get("http://localhost:8000/api/pools/all").json()["pools"]
catalog_items = requests.get("http://localhost:8000/api/catalog/items").json()

for ci in catalog_items:
    pool = next((p for p in pools if ci["id"] in p["pool_name"]), None)
    if pool:
        if pool["ready"] < pool["min_available"]:
            print(f"⚠️  {ci['id']}: Pool low on resources (ready: {pool['ready']}, min: {pool['min_available']})")
```

### 3. Catalog Max Lookup

```python
def get_catalog_max_users(catalog_item_id):
    catalog_items = requests.get("http://localhost:8000/api/catalog/items").json()
    item = next((c for c in catalog_items if c["id"] == catalog_item_id), None)
    if item:
        num_users_param = next((p for p in item["parameters"] if p["name"] == "num_users"), None)
        if num_users_param and "maximum" in num_users_param:
            return num_users_param["maximum"]
    return None  # No limit defined
```

### 4. Tenant vs Self-Service Pool Selection

**Naming convention:**
- `-tenant` suffix → tenant pool (dedicated, higher cost)
- `-slfsrv` suffix → self-service pool (shared, lower cost)

**Example:**
```
openshift-cnv.ocp-virt-roadshow-multi-user.prod-tenant
openshift-cnv.ocp-virt-roadshow-multi-user.prod-slfsrv
```

**Logic for MCP:**
```python
def pick_pool_variant(catalog_item, prefer_tenant=False):
    if prefer_tenant:
        return f"{catalog_item}-tenant"
    else:
        return f"{catalog_item}-slfsrv"
```

### 5. Auto-Calculate Stop/Destroy from Duration

**User request:** "Workshop runs for 3 days, auto-stop after 8 hours"

```python
prov_date = datetime.datetime(2026, 5, 7, 11, 0)
duration_hours = 8
destroy_after_days = 3

auto_stop = prov_date + datetime.timedelta(hours=duration_hours)
auto_destroy = prov_date + datetime.timedelta(days=destroy_after_days)

row = {
    "Provisioning Date (UTC)": prov_date.strftime("%d/%m/%Y %H:%M"),
    "Auto-stop (UTC)": auto_stop.strftime("%d/%m/%Y %H:%M"),
    "Auto-destroy (UTC)": auto_destroy.strftime("%d/%m/%Y %H:%M"),
}
```

---

## Testing Your CSV

1. **Validate locally:**
   ```bash
   python3 rhdp_flow.py --input-csv test.csv --dry-run
   ```

2. **Upload to UI and check warnings:**
   - Red alerts = blocking errors (catalog max violations)
   - Yellow warnings = advisories (date issues, Users vs Instances)

3. **Run validation endpoints:**
   ```bash
   # Upload
   curl -X POST http://localhost:8000/api/schedules/upload \
     -F "file=@test.csv"
   
   # Validate num_users
   curl -X POST http://localhost:8000/api/schedules/validate-num-users
   
   # Validate catalog namespaces
   curl -X POST http://localhost:8000/api/schedules/validate-catalog-namespaces
   ```

4. **Deploy in dry-run mode:**
   ```bash
   python3 rhdp_flow.py --input-csv test.csv --dry-run
   ```
   Check JSON output for ResourceClaim, Workshop, WorkshopProvision manifests.

---

## Summary Checklist for MCP Server

When generating a Flow CSV programmatically:

- [ ] Include all **required columns** (CI Name, CI, Namespace, Users, Enable_workshop_interface, Password, Activity, Purpose, dates)
- [ ] Use **consistent date headers** (all UTC or all legacy, never mixed)
- [ ] Format dates as `DD/MM/YYYY HH:MM` (24-hour)
- [ ] Set `Users` for catalog max validation if >0 (empty = skip validation)
- [ ] Set `Instances` only for `Enable_workshop_interface=True` or multi-asset
- [ ] Check catalog max via `/api/catalog/items` before setting `Users`
- [ ] Use correct catalog namespace (auto-detect from CI suffix or query `/api/catalog/items`)
- [ ] Validate provisioning date ≥ today
- [ ] Validate auto-stop > provisioning, auto-destroy > auto-stop
- [ ] For multi-asset: use `Multi_Asset=True` + `Asset_CIs` OR `Multi_Workshop_Name` (don't mix)
- [ ] For multi-region: use `AWS_Region` (comma-separated)
- [ ] For Salesforce: use `type:id` format in `Salesforce IDs` (semicolon-separated)
- [ ] Test with dry-run before live deploy

---

## Example MCP Server Skill Implementation

```python
# Pseudocode for MCP server skill

def generate_flow_csv(
    workshops: List[Dict],
    start_time: datetime,
    interval_minutes: int = 10,
    auto_stop_hours: int = 8,
    auto_destroy_days: int = 3
) -> str:
    """
    Generate Flow CSV from workshop list.
    
    Args:
        workshops: List of {"ci": str, "namespace": str, "users": int, ...}
        start_time: First workshop provisioning time
        interval_minutes: Time between each workshop deploy
        auto_stop_hours: Hours until auto-stop
        auto_destroy_days: Days until auto-destroy
    
    Returns:
        CSV string ready for Flow upload
    """
    
    # Fetch catalog items for validation
    catalog = get_catalog_items()  # GET /api/catalog/items
    
    rows = []
    for i, workshop in enumerate(workshops):
        # Calculate staggered time
        prov_time = start_time + timedelta(minutes=i * interval_minutes)
        auto_stop = prov_time + timedelta(hours=auto_stop_hours)
        auto_destroy = prov_time + timedelta(days=auto_destroy_days)
        
        # Validate against catalog max
        catalog_item = find_catalog_item(catalog, workshop["ci"])
        if catalog_item:
            max_users = get_num_users_max(catalog_item)
            if max_users and workshop["users"] > max_users:
                raise ValueError(f"{workshop['ci']} max users is {max_users}, requested {workshop['users']}")
        
        row = {
            "CI Name": workshop.get("name", f"Workshop {i+1}"),
            "CI": workshop["ci"],
            "Namespace": workshop["namespace"],
            "Users": workshop.get("users", ""),
            "Instances": workshop.get("instances", ""),
            "Enable_workshop_interface": workshop.get("enable_ui", True),
            "Password": workshop.get("password", generate_random_password()),
            "Activity": "Admin",
            "Purpose": "QA",
            "Workshop Name": workshop.get("display_name", workshop.get("name", "")),
            "Provisioning Date (UTC)": prov_time.strftime("%d/%m/%Y %H:%M"),
            "Auto-stop (UTC)": auto_stop.strftime("%d/%m/%Y %H:%M"),
            "Auto-destroy (UTC)": auto_destroy.strftime("%d/%m/%Y %H:%M"),
            "Concurrency": workshop.get("concurrency", 12),
        }
        rows.append(row)
    
    # Convert to CSV
    return dict_to_csv(rows)
```

---

## References

- **Full README:** `/RHDP-Scheduler/README.md`
- **CSV Examples:** `/RHDP-Scheduler/docs/examples/`
- **Sample CSVs:** `/RHDP-Scheduler/sample-csvs/`
- **Risk Prevention:** `/RHDP-Scheduler/docs/RISK-PREVENTION.md`
- **Security:** `/RHDP-Scheduler/docs/SECURITY.md`
- **Parser Code:** `/RHDP-Scheduler/rhdp_flow.py` → `read_csv_input()`
- **Validation Code:** `/RHDP-Scheduler/api/routes.py` → `validate_num_users()`, `validate_catalog_namespaces()`

---

**Questions?** Check the Flow UI "Download CSV Template" button for a blank template with all headers, or review `docs/examples/` for real-world scenarios.
