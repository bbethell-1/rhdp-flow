# RHDP-Flow Cluster-Tenant Test Data

Test CSV files for validating cluster-tenant relationship functionality before production deployment.

**Target Environment:** Integration cluster (`user-bbethell-redhat-com` namespace)  
**Deployment Date:** Before Friday, 2026-08-07  
**Purpose:** Manual testing of cluster-tenant scheduling logic

---

## Test Files Overview

| File | Scenario | Expected Result |
|------|----------|----------------|
| `cluster-tenant-valid.csv` | Valid cluster → tenant relationship | PASS - All deployments succeed |
| `cluster-tenant-invalid-order.csv` | Tenant scheduled before cluster | FAIL - Validation error or deployment failure |
| `cluster-tenant-override.csv` | Cluster_CI override to different cluster | PASS - Tenant uses override cluster |
| `cluster-tenant-mixed.csv` | Mixed standalone + cluster-tenant pairs | PASS - All deployments succeed |

---

## 1. cluster-tenant-valid.csv

**Scenario:** One cluster CI followed by two tenant CIs, all properly timed.

**Contents:**
- 1 cluster: `summit-2026.lb4003-ai-rag-cluster.event` (15:30 UTC)
- 2 tenants: `summit-2026.lb4003-ai-rag-tenant.event` (16:45 UTC, 75 minutes after cluster)

**Expected Behavior:**
- Cluster deploys first at 15:30
- Both tenants deploy 75 minutes later at 16:45
- Tenants automatically associate with the cluster (based on matching CI prefix)
- All resources created in same namespace: `user-bbethell-redhat-com`

**Validation:**
```bash
# Deploy
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-valid.csv

# Verify cluster deployed first
oc get resourceclaim -n user-bbethell-redhat-com -l rhdp-flow.gpte.redhat.com/ci-name="AI RAG Cluster"

# Verify tenants deployed after cluster
oc get resourceclaim -n user-bbethell-redhat-com -l rhdp-flow.gpte.redhat.com/ci-name="AI RAG Tenant User 1"
oc get resourceclaim -n user-bbethell-redhat-com -l rhdp-flow.gpte.redhat.com/ci-name="AI RAG Tenant User 2"

# Check tenant resources reference cluster (if implementation supports this)
oc get workshop,workshopprovision -n user-bbethell-redhat-com
```

**Pass Criteria:**
- ✅ All 3 ResourceClaims created successfully
- ✅ Cluster ResourceClaim provisions first
- ✅ Tenant ResourceClaims provision after cluster is ready
- ✅ No errors in Flow deploy output

---

## 2. cluster-tenant-invalid-order.csv

**Scenario:** Tenant scheduled BEFORE cluster (should trigger error).

**Contents:**
- 1 tenant: `summit-2026.lb4003-ai-rag-tenant.event` (15:00 UTC) - **TOO EARLY**
- 1 cluster: `summit-2026.lb4003-ai-rag-cluster.event` (16:30 UTC) - **TOO LATE**

**Expected Behavior:**
- Flow validation should detect tenant scheduled before cluster
- Deployment should FAIL with error message like:
  - `"Tenant CI scheduled before cluster CI"`
  - `"Cluster must be provisioned at least 60 minutes before tenant"`

**Validation:**
```bash
# Deploy (should fail)
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-invalid-order.csv

# Expected: Error message in output
# Expected: No ResourceClaims created
```

**Pass Criteria:**
- ✅ Flow detects invalid ordering
- ✅ Clear error message shown to user
- ✅ No resources created (dry-run validation catches issue)
- ✅ Exit code non-zero

---

## 3. cluster-tenant-override.csv

**Scenario:** Tenant with `Cluster_CI` override pointing to different cluster.

**Contents:**
- 2 clusters:
  - `summit-2026.lb4003-ai-rag-cluster.event` (15:30 UTC)
  - `summit-2026.lb4001-ai-it-self-service-cluster.event` (15:30 UTC)
- 2 tenants:
  - `summit-2026.lb4003-ai-rag-tenant.event` - Uses default cluster (RAG)
  - `summit-2026.lb4001-ai-it-self-service-tenant.event` - **OVERRIDE to RAG cluster**

**Expected Behavior:**
- Both clusters deploy at 15:30
- First tenant uses default cluster (based on CI prefix match)
- Second tenant uses override (`Cluster_CI` column) to associate with RAG cluster
- Override allows tenant from one CI family to use cluster from different CI family

**Validation:**
```bash
# Deploy
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-override.csv

# Verify both clusters deployed
oc get resourceclaim -n user-bbethell-redhat-com | grep cluster

# Verify tenant override applied (check annotations/labels if implemented)
oc get resourceclaim -n user-bbethell-redhat-com \
  -l rhdp-flow.gpte.redhat.com/ci-name="AI IT Tenant Override" -o yaml
```

**Pass Criteria:**
- ✅ Both clusters deploy successfully
- ✅ First tenant associates with default cluster
- ✅ Second tenant respects `Cluster_CI` override
- ✅ Override tenant references correct cluster (RAG, not IT cluster)

---

## 4. cluster-tenant-mixed.csv

**Scenario:** Real-world mix of standalone workshops + cluster-tenant pairs.

**Contents:**
- 3 standalone workshops (no Item_Type label):
  - OpenShift Virt Roadshow (prod catalog)
  - Ansible Network Basics (event catalog)
  - OpenShift AI Workshop (prod catalog)
- 2 cluster-tenant pairs:
  - AI RAG: 1 cluster + 2 tenants
  - AI PPE Monitor: 1 cluster + 1 tenant

**Timeline:**
```
15:00 - Standalone Virt Roadshow
15:30 - AI RAG Cluster
16:00 - Standalone Ansible Workshop
16:45 - AI RAG Tenant 1 + Tenant 2
17:00 - AI PPE Monitor Cluster
18:15 - AI PPE Monitor Tenant
18:30 - Standalone OpenShift AI
```

**Expected Behavior:**
- All standalone workshops deploy normally (no cluster dependency)
- Cluster-tenant pairs follow proper timing (tenant 60+ min after cluster)
- Mixed catalog namespaces work correctly (prod + event)
- Different deployment times staggered appropriately

**Validation:**
```bash
# Deploy
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-mixed.csv

# Count total deployments (should be 8)
oc get resourceclaim -n user-bbethell-redhat-com \
  -l rhdp-flow.gpte.redhat.com/scheduled=true | wc -l

# Verify standalone workshops (no Item_Type)
oc get resourceclaim -n user-bbethell-redhat-com \
  -l rhdp-flow.gpte.redhat.com/ci-name="Virt Roadshow Standalone"

# Verify cluster-tenant pairs
oc get resourceclaim -n user-bbethell-redhat-com | grep "AI RAG"
oc get resourceclaim -n user-bbethell-redhat-com | grep "AI PPE"
```

**Pass Criteria:**
- ✅ All 8 ResourceClaims created successfully
- ✅ Standalone workshops deploy independently
- ✅ Cluster-tenant pairs respect timing constraints
- ✅ Mixed catalog namespaces work correctly
- ✅ No interference between different workshop types

---

## Test Data Column Reference

### New Columns (Cluster-Tenant Feature)

| Column | Values | Purpose |
|--------|--------|---------|
| `Item_Type` | `cluster`, `tenant`, or empty | Labels the row as cluster or tenant CI |
| `Cluster_CI` | Full catalog item ID or empty | Override which cluster a tenant should use |

### Standard Columns (Per Flow CSV Spec)

All test CSVs include standard Flow columns:
- `CI Name` - Display name
- `CI` - Catalog item ID
- `Namespace` - OpenShift namespace (`user-bbethell-redhat-com`)
- `Users` - Number of users (seats)
- `Instances` - WorkshopProvision replica count
- `Enable_workshop_interface` - `True` (all test workshops)
- `Password` - Workshop password
- `Activity` - `Admin` (all tests)
- `Purpose` - `QA` (all tests)
- `Workshop Name` - Display name override
- `Provisioning Date (UTC)` - Start time
- `Auto-stop (UTC)` - Stop time
- `Auto-destroy (UTC)` - Destroy time

---

## Deployment Instructions

### Prerequisites

1. **Cluster Access:**
   ```bash
   oc whoami
   # Should show: user logged in to integration cluster
   ```

2. **Namespace Exists:**
   ```bash
   oc get namespace user-bbethell-redhat-com
   # Should show: namespace exists
   ```

3. **Catalog Items Available:**
   ```bash
   # Check event catalog
   oc get catalogitem -n babylon-catalog-event | grep "summit-2026.lb400"
   
   # Check prod catalog
   oc get catalogitem -n babylon-catalog-prod | grep "openshift-cnv"
   ```

### Deploy Tests

**Test 1 - Valid Cluster-Tenant (SHOULD PASS):**
```bash
cd ~/RHDP-FLOW/rhpds-utils/RHDP-Scheduler
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-valid.csv
```

**Test 2 - Invalid Order (SHOULD FAIL):**
```bash
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-invalid-order.csv
# Expected: Validation error, no resources created
```

**Test 3 - Cluster Override (SHOULD PASS):**
```bash
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-override.csv
```

**Test 4 - Mixed Workshops (SHOULD PASS):**
```bash
python3 rhdp_flow.py --input-csv test-data/cluster-tenant-mixed.csv
```

### Cleanup

**After each test:**
```bash
# Delete all test resources
oc delete resourceclaim,workshop,workshopprovision -n user-bbethell-redhat-com \
  -l rhdp-flow.gpte.redhat.com/scheduled=true

# Verify cleanup
oc get resourceclaim,workshop,workshopprovision -n user-bbethell-redhat-com
```

---

## Integration Testing Checklist

Use this checklist before Friday production tests:

### Pre-Deployment Validation
- [ ] All CSV files parse without errors
- [ ] All catalog items exist in babylon-catalog-event/prod
- [ ] Namespace `user-bbethell-redhat-com` exists and accessible
- [ ] Flow version supports `Item_Type` and `Cluster_CI` columns
- [ ] Dry-run mode shows correct timing constraints

### Test 1: Valid Cluster-Tenant
- [ ] CSV uploads without warnings
- [ ] Cluster deploys at scheduled time (15:30)
- [ ] Tenants deploy 75 minutes after cluster (16:45)
- [ ] All ResourceClaims reach `Bound` status
- [ ] Workshops provision successfully
- [ ] No errors in Flow output

### Test 2: Invalid Order
- [ ] Flow detects tenant before cluster
- [ ] Clear error message shown
- [ ] No resources created
- [ ] Non-zero exit code

### Test 3: Cluster Override
- [ ] Both clusters deploy successfully
- [ ] Default tenant uses matched cluster
- [ ] Override tenant uses specified cluster (not default)
- [ ] Override association visible in resource metadata

### Test 4: Mixed Workshops
- [ ] All 8 deployments scheduled correctly
- [ ] Standalone workshops deploy independently
- [ ] Cluster-tenant pairs follow timing constraints
- [ ] No cross-contamination between workshop types
- [ ] Mixed catalog namespaces work correctly

### Post-Deployment Verification
- [ ] All test resources cleaned up
- [ ] No orphaned ResourceClaims or Workshops
- [ ] Namespace ready for next test run
- [ ] Results documented (pass/fail per test)

---

## Known Issues & Notes

### Timing Constraints
- **Minimum gap:** Tenants should provision at least 60 minutes after cluster
- **Recommended gap:** 75-90 minutes to ensure cluster is fully ready
- **Test CSVs use:** 75 minutes (cluster at :30, tenant at :45 next hour)

### Catalog Item Naming
- **Cluster CIs:** End with `-cluster.event`
- **Tenant CIs:** End with `-tenant.event`
- **Matching:** Cluster and tenant share same prefix (e.g., `summit-2026.lb4003-ai-rag-`)

### Item_Type Column
- **Purpose:** Labels row as `cluster` or `tenant` for validation logic
- **Values:** `cluster`, `tenant`, or empty (standalone workshop)
- **Optional:** If empty, workshop treated as standalone (no cluster dependency)

### Cluster_CI Column
- **Purpose:** Override which cluster a tenant should use
- **Format:** Full catalog item ID (e.g., `summit-2026.lb4003-ai-rag-cluster.event`)
- **Use Case:** When tenant CI prefix doesn't match cluster CI prefix
- **Optional:** If empty, tenant auto-associates with cluster based on CI prefix match

---

## Expected Deployment Output

### Successful Valid Test (cluster-tenant-valid.csv)

```
=== RHDP-Flow Workshop Deployment ===
Reading CSV: test-data/cluster-tenant-valid.csv
Found 3 schedules

Validating cluster-tenant relationships...
✓ AI RAG Cluster (cluster) scheduled at 15:30
✓ AI RAG Tenant User 1 (tenant) scheduled at 16:45 - 75 min after cluster ✓
✓ AI RAG Tenant User 2 (tenant) scheduled at 16:45 - 75 min after cluster ✓

Deploying...
[15:30] Creating ResourceClaim: AI RAG Cluster
[16:45] Creating ResourceClaim: AI RAG Tenant User 1
[16:45] Creating ResourceClaim: AI RAG Tenant User 2

=== Deployment Complete ===
Total: 3 schedules
Success: 3
Failed: 0
```

### Failed Invalid Test (cluster-tenant-invalid-order.csv)

```
=== RHDP-Flow Workshop Deployment ===
Reading CSV: test-data/cluster-tenant-invalid-order.csv
Found 2 schedules

Validating cluster-tenant relationships...
✗ ERROR: Tenant "AI RAG Tenant (WRONG ORDER)" scheduled at 15:00
  but cluster "AI RAG Cluster (TOO LATE)" not scheduled until 16:30
  
Cluster must be provisioned at least 60 minutes before tenant.

=== Validation Failed ===
No resources created.
```

---

## Questions or Issues?

If tests fail or behavior unexpected:

1. **Check Flow logs:** Look for validation errors
2. **Verify catalog items:** Ensure CIs exist in correct namespace
3. **Check timing:** Confirm 60+ minute gap between cluster and tenant
4. **Review manifests:** Use dry-run mode to inspect generated YAML
5. **Consult test plan:** See `docs/CLUSTER_TENANT_TEST_PLAN.md` for details

---

**Last Updated:** 2026-07-31  
**Author:** RHDP Ops Team  
**Next Review:** 2026-08-07 (after Friday production tests)
