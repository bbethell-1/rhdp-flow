# FLOW MCP Test Scenarios

**Based on:** Real Summit 2026 Day 3 deployment (2026-05-08)  
**Test Data:** See symlinks in this folder  
**Cluster:** ocp-us-west-2.infra.open.redhat.com

---

## Scenario 1: Missing .event Suffix (Today's Big One)

**Problem:** 15/16 workshops had CIs without `.event` suffix, causing catalog lookup failures.

**Input CSV:**
```csv
CI Name,CI,Catalog_Namespace
LB1208 Practical image mode,summit-2026.lb1208-image-mode,
```

**Expected Error:**
```
❌ Catalog item 'summit-2026.lb1208-image-mode' not found in babylon-catalog-prod
Found in babylon-catalog-event as 'summit-2026.lb1208-image-mode.event'
```

**Auto-Fix:**
```csv
CI Name,CI,Catalog_Namespace
LB1208 Practical image mode,summit-2026.lb1208-image-mode.event,babylon-catalog-event
```

**Tool:** `validate_catalog_namespaces`, `bulk_parameter_update`

---

## Scenario 2: Multi-Asset Format Confusion

**Problem:** LB1577 has 5 troubleshooting modules. Wrong format = ghost workshop.

**Wrong Format:**
```csv
CI Name,CI,Multi_Asset,Asset_CIs
LB1577 Troubleshooting,"summit-2026.lb1577-rhel-troubleshooting-1,summit-2026.lb1577-rhel-troubleshooting-2,summit-2026.lb1577-rhel-troubleshooting-3,summit-2026.lb1577-rhel-troubleshooting-4,summit-2026.lb1577-rhel-troubleshooting-5",False,
```

**Correct Format:**
```csv
CI Name,CI,Multi_Asset,Asset_CIs,White_Glove
LB1577 Troubleshooting,summit-2026.lb1577-rhel-troubleshooting-1.event,True,"summit-2026.lb1577-rhel-troubleshooting-1.event,summit-2026.lb1577-rhel-troubleshooting-2.event,summit-2026.lb1577-rhel-troubleshooting-3.event,summit-2026.lb1577-rhel-troubleshooting-4.event,summit-2026.lb1577-rhel-troubleshooting-5.event",True
```

**Key Rules:**
- CI = first asset only
- Asset_CIs = comma-separated all assets (including first)
- Multi_Asset = True
- White_Glove = True (required for MultiWorkshop)
- All assets need .event suffix

**Tool:** `expand_multi_asset_workshops`

---

## Scenario 2b: Multi-Asset Duplicate Provisioning Bug (FIXED 2026-05-08)

**Problem:** Multi-asset workshops created duplicate Workshop resources, all stuck at "Provisioning 0/60".

**Symptoms:**
```bash
# 10 workshops instead of 5!
oc get workshop -n user-bbethell-redhat-com | grep lb1577
automation-l6qyr-summit-2026-lb1577-rhel-troublesh-4xpgd   Provisioning 0/60
automation-l6qyr-summit-2026-lb1577-rhel-troublesh-k7jtz   Provisioning 0/60
automation-l6qyr-summit-2026-lb1577-rhel-troublesh-k82p6   Provisioning 0/60
automation-l6qyr-summit-2026-lb1577-rhel-troublesh-s8tgb   Provisioning 0/60
automation-l6qyr-summit-2026-lb1577-rhel-troublesh-scc97   Provisioning 0/60
# ... plus 5 more created by MultiWorkshop controller
```

**Root Cause:**
FLOW was creating individual WorkshopProvisions for each asset Workshop. The MultiWorkshop controller then created its own set of Workshops, resulting in duplicates.

**What FLOW was doing (WRONG):**
1. Create 5 asset Workshops ✅
2. Create 5 individual WorkshopProvisions ❌ (THIS WAS THE BUG)
3. Create MultiWorkshop ✅
4. MultiWorkshop controller creates 5 more Workshops → DUPLICATES!

**What FLOW should do (FIXED):**
1. Create 5 asset Workshops ✅
2. Create MultiWorkshop ✅
3. MultiWorkshop controller handles ALL provisioning ✅

**Fix:**
Removed WorkshopProvision creation from `create_multi_workshop()` in rhdp_flow.py (commit 4ea5eaee).

**Detection Tool:** `ghost_workshop_detector` or `deployment_monitor` (spot duplicate workshops)

---

## Scenario 3: Timezone Conversion

**Problem:** Planning sheet in BST, FLOW needs UTC.

**Input (Planning Sheet):**
```
Session Date: 2026-05-14
Session Start: 08:00:00
Timezone: BST (British Summer Time)
```

**Output (FLOW CSV):**
```
Provisioning Date (UTC): 14/05/2026 07:00
```

**Conversion:**
- BST = UTC+1
- 08:00 BST = 07:00 UTC
- Date format: DD/MM/YYYY HH:MM

**Tool:** `transform_runbook_to_csv`

---

## Scenario 4: User Namespace Filtering

**Problem:** Exclude yordan's workshops (he went to the beer gods 🍺).

**Input:**
```
17 rows total
- 4 workshops for user-klewis-redhat-com
- 4 workshops for user-jappleii-redhat-com
- 5 workshops for user-bbethell-redhat-com
- 3 workshops for user-yvarbev-redhat-com (EXCLUDE)
- 1 workshop for user-yordan-* (EXCLUDE)
```

**Output:**
```
16 rows
- Filtered to klewis, jappleii, bbethell only
- Excluded all yordan/yvarbev namespaces
```

**Tool:** `transform_runbook_to_csv` with `exclude_users` parameter

---

## Scenario 5: Catalog Namespace Column Not in API

**Problem:** `Catalog_Namespace` in CSV but showed as empty in UI.

**Root Cause:**
```python
# api/routes.py - _schedule_to_response() was missing field
def _schedule_to_response(s: WorkshopSchedule) -> WorkshopScheduleResponse:
    return WorkshopScheduleResponse(
        ci_name=s.ci_name,
        ci=s.ci,
        # ... 
        redirect=s.redirect,
        # ❌ catalog_namespace=s.catalog_namespace,  # MISSING
        showroom_repo=s.showroom_repo,
    )
```

**Fix:**
```python
# Added catalog_namespace to response model
catalog_namespace=s.catalog_namespace,
```

**Tool:** `fix_csv_columns` (would detect this mismatch)

---

## Scenario 6: Workshop Name Templating

**Problem:** Need to add "Day 3-Test-Spiderman-" prefix to all workshop names.

**Input:**
```csv
CI Name,Workshop Name
LB1208 Practical image mode,
```

**Output:**
```csv
CI Name,Workshop Name
LB1208 Practical image mode,Day 3-Test-Spiderman-LB1208 Practical image mode for RHEL: delivering secure application baselines
```

**Template:**
```python
{
  "workshop_name_template": "Day {day}-Test-Spiderman-{title}"
}
```

**Tool:** `transform_runbook_to_csv`

---

## Scenario 7: Staggered vs Simultaneous Deployment

**Problem:** CNV workshops deploy every 10 minutes, Tenant workshops all at once.

**CNV Workshops (12 total):**
```
14:00 UTC - LB1208 (klewis)
14:10 UTC - LB1390 (klewis)
14:20 UTC - LB2655 (klewis)
14:30 UTC - LB1305 (klewis)
14:40 UTC - LB1347 (jappleii)
... (10-minute intervals)
15:50 UTC - LB1839 (bbethell)
```

**Tenant Workshops (4 total):**
```
16:00 UTC - LB2391 (klewis)
16:00 UTC - LB1216 (jappleii)
16:00 UTC - LB1216 (bbethell)
16:00 UTC - LB2865 (bbethell)
```

**Rule:**
- CNV workshops: stagger 10 minutes
- Tenant workshops: simultaneous
- Detection: CI contains "-tenant" = simultaneous

**Tool:** `multi_day_event_scheduler`

---

## Scenario 8: Ghost Workshop Detection

**Problem:** Workshop stuck at `PHASE: <none>` forever.

**Symptoms:**
```bash
oc get workshop lb1577-troubleshooting -n user-bbethell-redhat-com

NAME                      PHASE   PROVISIONING
lb1577-troubleshooting    <none>  0
```

**Common Causes:**
1. Wrong catalog namespace → catalog item not found
2. Multi-asset with Multi_Asset=False → MultiWorkshop not created
3. Multi-asset with White_Glove=False → MultiWorkshop fails
4. Missing resource pool when pools enabled

**Diagnosis:**
```bash
# Check if catalog item exists
oc get catalogitem summit-2026.lb1577-rhel-troubleshooting-1.event -n babylon-catalog-event

# Check MultiWorkshop creation
oc get multiworkshop -n user-bbethell-redhat-com

# Check WorkshopProvision
oc get workshopprovision -n user-bbethell-redhat-com
```

**Tool:** `ghost_workshop_detector`

---

## Scenario 9: Deployment Progress Tracking

**Problem:** 16 workshops deploying, need to know status without manually checking.

**Expected Progress:**
```
14:00 UTC - Start deployment
14:05 UTC - 3 deployed_unverified, 1 deploying, 12 pending
14:10 UTC - 5 deployed_unverified, 1 deploying, 10 pending
14:20 UTC - 8 deployed_unverified, 1 deploying, 7 pending
...
16:05 UTC - 16 deployed_verified, 0 deploying, 0 pending
```

**Alerts:**
- LB1577 taking >15 minutes (multi-asset, normal)
- Any workshop stuck for >30 minutes (investigate)
- Cluster capacity >80% (slow down)

**Tool:** `deployment_monitor`

---

## Scenario 10: Bulk Parameter Update

**Problem:** Need to change catalog namespace for all 16 workshops.

**Before:**
```csv
CI,Catalog_Namespace
summit-2026.lb1208-image-mode,
summit-2026.lb1390-hashi-aap,
summit-2026.lb2655-net-automation.event,babylon-catalog-event
...
```

**Operation:**
```json
{
  "filter": {"all": true},
  "updates": {
    "catalog_namespace": "babylon-catalog-event"
  }
}
```

**After:**
```csv
CI,Catalog_Namespace
summit-2026.lb1208-image-mode,babylon-catalog-event
summit-2026.lb1390-hashi-aap,babylon-catalog-event
summit-2026.lb2655-net-automation.event,babylon-catalog-event
...
```

**Tool:** `bulk_parameter_update`

---

## Validation Queries

**Check catalog item exists:**
```bash
oc get catalogitem summit-2026.lb1208-image-mode.event -n babylon-catalog-event
```

**List all Summit 2026 catalog items:**
```bash
oc get catalogitem -n babylon-catalog-event | grep summit-2026
```

**Check namespace exists:**
```bash
oc get namespace user-klewis-redhat-com
```

**Check deployed workshop status:**
```bash
oc get workshop,workshopprovision,multiworkshop -n user-klewis-redhat-com
```

**Find stuck workshops:**
```bash
oc get workshop -A -o json | jq '.items[] | select(.status.phase == null) | {name: .metadata.name, namespace: .metadata.namespace}'
```

---

## Success Criteria

**Pre-Deployment:**
- ✅ All 16 catalog items found in babylon-catalog-event
- ✅ All 3 namespaces exist on cluster
- ✅ Multi-asset workshop (LB1577) properly formatted
- ✅ No duplicate CI+Namespace combinations
- ✅ All provisioning dates in future or within grace period

**During Deployment:**
- ✅ CNV workshops deploy 10 minutes apart
- ✅ Tenant workshops deploy simultaneously at 16:00 UTC
- ✅ No ghost workshops (all reach PHASE: Provisioning or Provisioned)
- ✅ Cluster capacity stays below 80%

**Post-Deployment:**
- ✅ 16/16 workshops reach deployed_verified
- ✅ All seats provisioned (matching Users or Instances)
- ✅ All workshop URLs accessible
- ✅ Multi-asset LB1577 has MultiWorkshop with 60 seats

---

## Test Commands

**Transform CSV:**
```bash
mcp__flow__transform_runbook_to_csv({
  "source_csv": "~/Joshs-IPA-MCP/test-data/summit-day3-input.csv",
  "event_config": {
    "name": "Summit 2026 Day 3",
    "timezone": "BST"
  }
})
```

**Validate Catalog:**
```bash
mcp__flow__validate_catalog_namespaces({
  "csv_path": "~/Joshs-IPA-MCP/test-data/summit-day3-output.csv",
  "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443"
})
```

**Pre-Deployment Check:**
```bash
mcp__flow__pre_deployment_checklist({
  "csv_path": "~/Joshs-IPA-MCP/test-data/summit-day3-output.csv",
  "cluster_url": "https://api.ocp-us-west-2.infra.open.redhat.com:6443"
})
```

---

**Real deployment from today = perfect test case!** 🎯
