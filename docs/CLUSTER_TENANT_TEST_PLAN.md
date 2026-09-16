# Cluster-Tenant Integration Test Plan

**Target:** Production tests next Friday (2026-08-07)  
**Goal:** Confidence that catalog items auto-map to correct cluster/tenant (resource pool variants)  
**Context:** Flow currently has pool lookup API but needs validation that CI → pool mapping works correctly

---

## Executive Summary

**Must Pass by Friday:**
1. Unit tests for pool matching logic (1-2 hours)
2. Integration tests for auto-detect scenarios (2-3 hours)
3. Dry-run validation tests (1 hour)
4. Real deployment on integration cluster (2-3 hours)

**Nice-to-have:**
5. Edge case matrix (extra validation, not blocking)
6. Frontend pool indicator tests (polish, can defer)

**Total critical path:** ~8 hours of testing work

---

## 1. Unit Tests — Pool Matching Logic

### Test File: `tests/test_pool_matching.py`

**Purpose:** Validate the logic that maps catalog items to resource pool variants.

#### Test Cases (Priority: CRITICAL)

```python
def test_pool_suffix_detection():
    """Catalog item with -tenant suffix uses tenant pool."""
    assert get_pool_variant("workshop.prod-tenant") == "tenant"
    assert get_pool_variant("workshop.prod-slfsrv") == "slfsrv"
    assert get_pool_variant("workshop.prod") == None  # no pool

def test_pool_auto_detect_from_catalog():
    """Auto-detect pool from catalog metadata."""
    # Mock catalog response with pool annotations
    catalog_item = {
        "metadata": {
            "annotations": {
                "babylon.gpte.redhat.com/default-pool": "tenant"
            }
        }
    }
    assert detect_pool_preference(catalog_item) == "tenant"

def test_pool_fallback_to_on_demand():
    """No pool found → fall back to on-demand provisioning."""
    result = resolve_pool("nonexistent.ci.prod")
    assert result["provisioning_mode"] == "on-demand"
    assert result["pool_name"] is None

def test_pool_priority_order():
    """CSV override > catalog annotation > CI suffix > on-demand."""
    # CSV has explicit Pool_Override column → use it
    schedule = make_schedule(ci="workshop.prod-tenant", pool_override="slfsrv")
    assert resolve_pool_for_schedule(schedule) == "workshop.prod-slfsrv"

def test_event_catalog_tenant_default():
    """Event catalog items default to tenant pool if available."""
    assert infer_pool_for_event_ci("summit-2026.lb2655.event") == "tenant"

def test_prod_catalog_slfsrv_default():
    """Prod catalog items default to slfsrv pool if available."""
    assert infer_pool_for_prod_ci("openshift-cnv.workshop.prod") == "slfsrv"
```

**Implementation approach:**
- Extract pool resolution logic into `rhdp_flow.py` helper functions
- Use existing `pool_utils.py` as foundation
- Mock `oc get resourcepool` responses
- Test with existing `conftest.py` fixtures

**Time estimate:** 2 hours (write + debug)

---

## 2. Integration Tests — Auto-Detect Scenarios

### Test File: `tests/test_pool_integration.py`

**Purpose:** Validate end-to-end flow from CSV → pool lookup → manifest generation.

#### Test Cases (Priority: CRITICAL)

```python
@patch("subprocess.run")
def test_tenant_pool_used_when_available(mock_run):
    """Event CI with tenant pool available → uses tenant variant."""
    mock_run.side_effect = make_oc_dispatcher({
        ("get", "resourcepool"): MagicMock(
            returncode=0, 
            stdout=json.dumps({"metadata": {"name": "summit.lb2655.event-tenant"}})
        )
    })
    
    schedule = make_schedule(ci="summit.lb2655.event")
    manifest = build_resource_claim_payload(schedule, auto_detect_pool=True)
    
    assert manifest["spec"]["provider"]["name"] == "summit.lb2655.event-tenant"

@patch("subprocess.run")
def test_slfsrv_pool_used_for_prod_catalog(mock_run):
    """Prod CI with slfsrv pool available → uses slfsrv variant."""
    mock_run.side_effect = make_oc_dispatcher({
        ("get", "resourcepool"): MagicMock(
            returncode=0,
            stdout=json.dumps({"metadata": {"name": "openshift-cnv.workshop.prod-slfsrv"}})
        )
    })
    
    schedule = make_schedule(ci="openshift-cnv.workshop.prod")
    manifest = build_resource_claim_payload(schedule, auto_detect_pool=True)
    
    assert manifest["spec"]["provider"]["name"] == "openshift-cnv.workshop.prod-slfsrv"

@patch("subprocess.run")
def test_manual_override_ignores_auto_detect(mock_run):
    """CSV Pool_Override column overrides auto-detection."""
    # Pool exists but CSV says use on-demand
    mock_run.side_effect = make_oc_dispatcher({
        ("get", "resourcepool"): MagicMock(returncode=0, stdout='{"metadata": {...}}')
    })
    
    schedule = make_schedule(ci="workshop.prod", pool_override="none")
    manifest = build_resource_claim_payload(schedule, auto_detect_pool=True)
    
    # Should use original CI, not pool variant
    assert manifest["spec"]["provider"]["name"] == "workshop.prod"

@patch("subprocess.run")
def test_validation_failure_on_wrong_cluster(mock_run):
    """Deployment to wrong cluster type (prod CI on dev cluster) → validation error."""
    # Mock cluster URL shows dev cluster
    mock_run.side_effect = make_oc_dispatcher({
        ("whoami", "--show-server"): MagicMock(
            returncode=0, 
            stdout="https://api.ocp-dev.infra.open.redhat.com:6443"
        )
    })
    
    schedule = make_schedule(ci="openshift-cnv.workshop.prod")
    
    with pytest.raises(ValidationError, match="prod catalog item on dev cluster"):
        validate_cluster_catalog_match(schedule)

@patch("subprocess.run")
def test_missing_pool_falls_back_to_on_demand(mock_run):
    """Pool not found → use on-demand (original CI)."""
    mock_run.side_effect = make_oc_dispatcher({
        ("get", "resourcepool"): MagicMock(returncode=1, stderr="NotFound")
    })
    
    schedule = make_schedule(ci="new-workshop.prod")
    manifest = build_resource_claim_payload(schedule, auto_detect_pool=True)
    
    assert manifest["spec"]["provider"]["name"] == "new-workshop.prod"
    # Verify no pool-related labels
    assert "poolboy.gpte.redhat.com/resource-pool" not in manifest["metadata"]["labels"]
```

**Implementation approach:**
- Extend `conftest.py` `make_oc_dispatcher` to handle pool lookups
- Add `auto_detect_pool` flag to `build_resource_claim_payload()`
- Test with mocked `oc get resourcepool` responses
- Verify manifest has correct `spec.provider.name`

**Time estimate:** 3 hours (write + debug + edge cases)

---

## 3. Test Matrix — Catalog Item Types

### Purpose: Document expected behavior for all catalog item patterns

| Catalog Item | Catalog NS | Expected Pool | Fallback | Notes |
|--------------|------------|---------------|----------|-------|
| `workshop.prod` | babylon-catalog-prod | `workshop.prod-slfsrv` | `workshop.prod` | Prod defaults to slfsrv |
| `workshop.prod-tenant` | babylon-catalog-prod | `workshop.prod-tenant` | `workshop.prod-tenant` | Explicit tenant |
| `workshop.prod-slfsrv` | babylon-catalog-prod | `workshop.prod-slfsrv` | `workshop.prod-slfsrv` | Explicit slfsrv |
| `summit-2026.lb2655.event` | babylon-catalog-event | `summit-2026.lb2655.event-tenant` | `summit-2026.lb2655.event` | Event defaults to tenant |
| `workshop.dev` | babylon-catalog-dev | None (on-demand) | `workshop.dev` | Dev has no pools |
| `workshop` (no suffix) | babylon-catalog-prod | `workshop-slfsrv` | `workshop` | Default prod |

**Test implementation:**
```python
@pytest.mark.parametrize("ci,expected_pool,fallback", [
    ("workshop.prod", "workshop.prod-slfsrv", "workshop.prod"),
    ("summit.event", "summit.event-tenant", "summit.event"),
    ("workshop.dev", None, "workshop.dev"),
    # ... full matrix
])
def test_pool_matrix(ci, expected_pool, fallback):
    """Test expected pool resolution for all catalog item types."""
    with patch("subprocess.run") as mock_run:
        # Mock pool exists
        if expected_pool:
            mock_run.return_value = MagicMock(returncode=0, stdout='{"metadata": {...}}')
        else:
            mock_run.return_value = MagicMock(returncode=1)
        
        result = resolve_pool(ci)
        assert result["pool_name"] == expected_pool or result["fallback_ci"] == fallback
```

**Time estimate:** 1 hour (parametrize + document)

---

## 4. Dry-Run Validation Tests

### Test File: `tests/test_dry_run_pool_validation.py`

**Purpose:** Validate dry-run shows correct pool without actually deploying.

#### Test Cases (Priority: CRITICAL)

```python
def test_dry_run_shows_pool_selection(tmp_path):
    """Dry-run export YAML shows resolved pool in provider.name."""
    config = make_config(dry_run=True)
    config.dry_run_export_yaml_dir = str(tmp_path)
    
    schedule = make_schedule(ci="workshop.prod")
    
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='{"metadata": {"name": "workshop.prod-slfsrv"}}'
        )
        
        process_schedule(schedule, config)
    
    # Check YAML manifest
    yaml_files = list(tmp_path.glob("resourceclaim-*.yaml"))
    assert len(yaml_files) == 1
    
    yaml_content = yaml_files[0].read_text()
    assert "workshop.prod-slfsrv" in yaml_content

def test_dry_run_validation_warnings():
    """Dry-run warns when pool unavailable but continues with fallback."""
    config = make_config(dry_run=True)
    schedule = make_schedule(ci="workshop.prod")
    
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stderr="NotFound")
        
        with pytest.warns(UserWarning, match="No pool found.*falling back"):
            process_schedule(schedule, config)

def test_dry_run_csv_to_manifests_full_flow(basic_csv_file, tmp_path):
    """End-to-end: CSV → dry-run → YAML manifests with pool resolution."""
    schedules = read_csv_input(basic_csv_file)
    config = make_config(dry_run=True)
    config.dry_run_export_yaml_dir = str(tmp_path)
    
    with patch("subprocess.run") as mock_run:
        mock_run.side_effect = make_oc_dispatcher()
        
        for schedule in schedules:
            process_schedule(schedule, config)
    
    # Verify manifests created
    manifests = list(tmp_path.glob("*.yaml"))
    assert len(manifests) > 0
    
    # Check at least one has pool resolution
    yaml_text = manifests[0].read_text()
    assert "provider:" in yaml_text
```

**Implementation approach:**
- Use existing `export_dry_run_manifest_yaml()` function
- Verify YAML output contains resolved pool name
- Test warnings when pool unavailable

**Time estimate:** 2 hours

---

## 5. Real Deployment Tests on Integration Cluster

### Environment: `user-bbethell-redhat-com` namespace on integration

**Purpose:** Validate actual deployment with pool resolution.

#### Test Scenarios (Priority: CRITICAL)

**Scenario 1: Auto-detect slfsrv pool (prod catalog)**
```bash
# Generate test CSV
cat > /tmp/pool-test-prod.csv <<EOF
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Pool Test Prod,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,2,True,test123,Admin,QA,Pool Test,$(date -u -d '+5 minutes' '+%d/%m/%Y %H:%M'),$(date -u -d '+2 hours' '+%d/%m/%Y %H:%M'),$(date -u -d '+1 day' '+%d/%m/%Y %H:%M')
EOF

# Deploy
python3 rhdp_flow.py --input-csv /tmp/pool-test-prod.csv

# Verify pool used
oc get resourceclaim -n user-bbethell-redhat-com -l rhdp-flow.gpte.redhat.com/scheduled=true -o json \
  | jq '.items[0].spec.provider.name'

# Expected: "openshift-cnv.ocp-virt-roadshow-multi-user.prod-slfsrv"
```

**Scenario 2: Auto-detect tenant pool (event catalog)**
```bash
# Generate test CSV with event catalog item
cat > /tmp/pool-test-event.csv <<EOF
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Pool Test Event,summit-2026.lb2655-net-automation.event,user-bbethell-redhat-com,2,True,test123,Admin,QA,Pool Test Event,$(date -u -d '+5 minutes' '+%d/%m/%Y %H:%M'),$(date -u -d '+2 hours' '+%d/%m/%Y %H:%M'),$(date -u -d '+1 day' '+%d/%m/%Y %H:%M')
EOF

python3 rhdp_flow.py --input-csv /tmp/pool-test-event.csv

oc get resourceclaim -n user-bbethell-redhat-com -l rhdp-flow.gpte.redhat.com/scheduled=true -o json \
  | jq '.items[0].spec.provider.name'

# Expected: "summit-2026.lb2655-net-automation.event-tenant"
```

**Scenario 3: Manual override (CSV Pool_Override column)**
```bash
# CSV with Pool_Override=none → force on-demand
cat > /tmp/pool-test-override.csv <<EOF
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Pool_Override
Pool Override Test,openshift-cnv.ocp-virt-roadshow-multi-user.prod,user-bbethell-redhat-com,2,True,test123,Admin,QA,Override Test,$(date -u -d '+5 minutes' '+%d/%m/%Y %H:%M'),$(date -u -d '+2 hours' '+%d/%m/%Y %H:%M'),$(date -u -d '+1 day' '+%d/%m/%Y %H:%M'),none
EOF

python3 rhdp_flow.py --input-csv /tmp/pool-test-override.csv

oc get resourceclaim -n user-bbethell-redhat-com -o json \
  | jq '.items[0].spec.provider.name'

# Expected: "openshift-cnv.ocp-virt-roadshow-multi-user.prod" (no pool suffix)
```

**Scenario 4: Validation — Provision succeeds**
```bash
# Wait for ResourceClaim to become Ready
oc wait --for=jsonpath='{.status.phase}'=Bound \
  resourceclaim -n user-bbethell-redhat-com \
  -l rhdp-flow.gpte.redhat.com/scheduled=true \
  --timeout=10m

# Verify workshop provisions
oc get workshop -n user-bbethell-redhat-com

# Cleanup
oc delete resourceclaim,workshop,workshopprovision -n user-bbethell-redhat-com \
  -l rhdp-flow.gpte.redhat.com/scheduled=true
```

**Pass criteria:**
- ResourceClaim created with correct pool variant in `spec.provider.name`
- ResourceClaim transitions to `Bound` status
- Workshop and WorkshopProvision created successfully
- No errors in Flow deploy output

**Time estimate:** 3 hours (deploy + wait + verify + cleanup)

---

## 6. Edge Cases Testing

### Test File: `tests/test_pool_edge_cases.py`

**Purpose:** Cover unusual scenarios (nice-to-have, not blocking Friday)

```python
def test_missing_cluster_connection():
    """Cluster unreachable → graceful fallback to on-demand."""
    with patch("subprocess.run") as mock_run:
        mock_run.side_effect = subprocess.TimeoutExpired("oc", 10)
        
        schedule = make_schedule(ci="workshop.prod")
        manifest = build_resource_claim_payload(schedule, auto_detect_pool=True)
        
        # Should fall back to original CI
        assert manifest["spec"]["provider"]["name"] == "workshop.prod"

def test_too_many_tenants_for_catalog_item():
    """Multiple pool variants exist → prefer tenant over slfsrv."""
    with patch("subprocess.run") as mock_run:
        # Mock returns both -tenant and -slfsrv pools
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=json.dumps({
                "items": [
                    {"metadata": {"name": "workshop.prod-tenant"}},
                    {"metadata": {"name": "workshop.prod-slfsrv"}}
                ]
            })
        )
        
        result = resolve_pool("workshop.prod")
        assert result["pool_name"] == "workshop.prod-tenant"  # prefer tenant

def test_wrong_cluster_type_for_catalog():
    """Prod CI on dev cluster → validation error."""
    # Already covered in integration tests
    pass

def test_pool_name_with_special_characters():
    """Pool name contains dots, dashes → handle correctly."""
    ci = "openshift-4.14-cnv.workshop.prod"
    result = resolve_pool(ci)
    assert result["pool_name"] in [
        "openshift-4.14-cnv.workshop.prod-slfsrv",
        "openshift-4.14-cnv.workshop.prod-tenant",
        None
    ]

def test_pool_status_low_availability():
    """Pool exists but ready < min_available → warn but allow."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=json.dumps({
                "metadata": {"name": "workshop.prod-slfsrv"},
                "spec": {"minAvailable": 5},
                "status": {"resourceHandleCount": {"ready": 2}}
            })
        )
        
        with pytest.warns(UserWarning, match="Pool low on resources"):
            resolve_pool("workshop.prod")
```

**Time estimate:** 2 hours (nice-to-have)

---

## Test Execution Plan

### Phase 1: Pre-Friday (Mon-Thu, Aug 4-6)

**Monday (Aug 4):**
- [ ] Write unit tests (`test_pool_matching.py`) — 2h
- [ ] Write integration tests (`test_pool_integration.py`) — 3h
- [ ] Document test matrix — 1h

**Tuesday (Aug 5):**
- [ ] Write dry-run validation tests — 2h
- [ ] Run full test suite locally — 1h
- [ ] Fix any failures — 2h

**Wednesday (Aug 6):**
- [ ] Deploy Scenario 1 on integration (prod catalog) — 1h
- [ ] Deploy Scenario 2 on integration (event catalog) — 1h
- [ ] Deploy Scenario 3 on integration (manual override) — 1h
- [ ] Document results — 1h

**Thursday (Aug 7 morning):**
- [ ] Final smoke test on integration — 1h
- [ ] Review results with team — 30min
- [ ] **GO/NO-GO decision for Friday production tests**

### Phase 2: Friday Production Tests (Aug 8)

**Criteria for production testing:**
- ✅ All unit tests passing
- ✅ All integration tests passing
- ✅ At least 2 successful integration deploys
- ✅ Dry-run validation shows correct pool resolution
- ✅ No regressions in existing tests

**Production test plan:**
1. Deploy 1 workshop to production with auto-detect enabled
2. Verify correct pool used
3. Monitor for 1 hour
4. If successful, enable for all deployments

---

## Test Infrastructure Requirements

### Existing (already available)

- ✅ `pytest` test harness
- ✅ `conftest.py` fixtures (`make_schedule`, `make_config`, `make_oc_dispatcher`)
- ✅ `tests/test_flow.py` pattern for mocking `subprocess.run`
- ✅ Integration cluster access (`user-bbethell-redhat-com`)

### New (to be created)

- `tests/test_pool_matching.py` — Unit tests
- `tests/test_pool_integration.py` — Integration tests
- `tests/test_dry_run_pool_validation.py` — Dry-run tests
- `tests/test_pool_edge_cases.py` — Edge cases (optional)

### Helper functions to add to `rhdp_flow.py`

```python
def resolve_pool_for_catalog_item(
    catalog_item: str, 
    config: RHDPConfig,
    pool_override: Optional[str] = None
) -> Dict[str, Any]:
    """
    Resolve resource pool for catalog item.
    
    Priority order:
    1. pool_override (from CSV Pool_Override column)
    2. Explicit suffix in catalog_item (-tenant, -slfsrv)
    3. Auto-detect from cluster (event → tenant, prod → slfsrv)
    4. Fallback to on-demand (original catalog_item)
    
    Returns:
    {
        "pool_name": str or None,
        "provider_name": str,  # what goes in ResourceClaim spec.provider.name
        "provisioning_mode": "pool" | "on-demand",
        "pool_info": dict or None  # from pool_utils.get_pool_for_catalog_item
    }
    """
    pass

def validate_cluster_catalog_match(
    schedule: WorkshopSchedule, 
    config: RHDPConfig
) -> None:
    """
    Validate catalog item matches cluster type.
    
    Raises ValidationError if:
    - Prod catalog item deployed to dev cluster
    - Dev catalog item deployed to prod cluster
    - Event catalog item deployed to wrong cluster
    """
    pass
```

---

## Success Metrics

### Must achieve by Friday

1. **Test coverage:** ≥90% coverage of pool resolution logic
2. **Integration tests:** ≥3 successful deploys on integration cluster
3. **Dry-run validation:** All test scenarios show correct pool in YAML
4. **Zero regressions:** Existing 182 tests still passing

### Nice-to-have

5. **Edge case coverage:** ≥5 edge cases documented and tested
6. **Frontend indicator:** Pool name shown in UI (can defer to next sprint)
7. **Performance:** Pool lookup adds <500ms to deploy time

---

## Risk Mitigation

### Risk 1: Integration cluster unavailable

**Mitigation:** Test on local `minikube` or `kind` cluster with mocked pools

### Risk 2: Pool API changes between test and prod

**Mitigation:** 
- Use `oc get resourcepool` (stable API) not custom endpoints
- Validate pool schema in pre-deploy checks
- Feature flag for rollback

### Risk 3: Existing deployments break

**Mitigation:**
- Pool resolution is **additive** (fallback to on-demand)
- No changes to existing CSV format
- Deploy opt-in via config flag initially

### Risk 4: Time constraints (8 hours to implement + test)

**Mitigation:**
- Focus on critical path (tests 1-4)
- Defer edge cases to post-Friday
- Parallelize: unit tests while integration deploys run

---

## Rollback Plan

If Friday production tests fail:

1. **Immediate:** Set `ENABLE_POOL_AUTO_DETECT=false` in config
2. **Fallback:** All deployments use original catalog item (on-demand)
3. **Debug:** Review integration test logs, check pool API responses
4. **Fix:** Patch issue, re-test on integration, schedule retry for Monday

Feature flag:
```python
class RHDPConfig:
    def __init__(self):
        self.enable_pool_auto_detect = os.getenv("ENABLE_POOL_AUTO_DETECT", "false").lower() == "true"
```

---

## Questions for Clarification

Before starting implementation:

1. **Pool override column name:** Is it `Pool_Override`, `ResourcePool`, or something else?
2. **Default behavior:** Should auto-detect be opt-in (via CSV column/config flag) or always-on?
3. **Catalog namespace validation:** Should we enforce prod CI on prod cluster, or just warn?
4. **Pool availability threshold:** What's the minimum `ready` count before we warn/block?
5. **Friday production test scope:** Single deployment or batch? Which catalog items?

---

## References

- **Existing pool code:** `/home/bbethell/RHDP-FLOW/rhpds-utils/RHDP-Scheduler/api/pool_utils.py`
- **Test patterns:** `/home/bbethell/RHDP-FLOW/rhpds-utils/RHDP-Scheduler/tests/test_flow.py`
- **Pool API docs:** `/home/bbethell/RHDP-FLOW/rhpds-utils/RHDP-Scheduler/docs/FOR_JOSH_MCP_SERVER.md` (lines 206-233)
- **Recent pool work:** Git commits `15c245b5`, `126fe807`, `605dcd64` (pool lookup UI)

---

## Appendix: Josh's Prior Testing in Flow

Based on git history and test files:

1. **CSV parsing tests** (`test_csv.py`) — 505 lines, covers all column variants
2. **API endpoint tests** (`test_api.py`) — 58,975 lines (!), comprehensive FastAPI TestClient coverage
3. **Flow logic tests** (`test_flow.py`) — Domain derivation, payload building, catalog limits
4. **Mocking pattern:** Uses `make_oc_dispatcher()` in `conftest.py` to simulate `oc` commands

**Pattern to follow:**
- Parametrized tests for matrix scenarios
- Mock `subprocess.run` for `oc` commands
- Dry-run tests with YAML export validation
- Integration tests with actual `oc` calls (guarded by cluster availability)

---

**Total estimated effort:** 8-12 hours (critical path: 8h, nice-to-have: +4h)

**Confidence level for Friday:** HIGH (if critical path tests pass by Thursday EOD)
