# RHDP-Flow Design Philosophy

**Author:** @bbethell  
**Maintainer:** @rhjcd (Josh Israel)  
**Last Updated:** 2026-09-14

Flow's mission: Make workshop deployment simple, safe, and resilient to platform changes.

---

## Core Principles

### 1. Simplicity First

**Users are event coordinators, not DevOps engineers.**

Bad:
```
⚠️ CatalogItem spec.__meta__.sandboxes[0].tenant_cluster.item is undefined
```

Good:
```
⚠️ 3 workshops will fail — cluster setup missing

These workshops need to run ON a cluster, but the catalog doesn't know which cluster to use.
```

**Guidelines:**
- Plain language, no jargon
- State the consequence first ("Deploy will fail")
- Explain in terms users understand ("workshops run ON a cluster")
- One-sentence warnings when possible

### 2. Fail-Safe Detection

**Catch issues BEFORE deployment fails, not after.**

Flow validates against live cluster state:
- Catalog namespace auto-detection
- Cluster capacity calculation
- Tenant cluster reference validation
- Pool capacity checks

**Pattern:**
1. Query babylon/catalog for current truth
2. Compare against CSV
3. Warn on mismatch
4. Suggest fix (or auto-fix when safe)

**Example:** CSV says `babylon-catalog-prod`, catalog item exists in `babylon-catalog-event` → Flow auto-detects and deploys from `.event` with clear "This is fine" message.

### 3. Clear Warnings

**Reassure when things work, alarm when they won't.**

**Reassurance pattern:**
```
✓ This is fine — Flow will deploy from babylon-catalog-event
  (these items don't exist in babylon-catalog-prod)
```

**Alarm pattern:**
```
⚠️ Deploy will fail — catalog configuration needs updating.

Contact RHDP team in Slack (#forum-rhdp) or check for pending catalog updates.
```

**Never:**
- Leave users guessing what will happen
- Use warning color for informational messages
- Show technical errors without translation

### 4. Architecture Adaptability

**When babylon changes, Flow adapts gracefully.**

Platform evolution example — Tenant cluster references:

**Old behavior (2025):**
- Babylon used `cloudSelector.lab` to find clusters
- CSV `Cluster_CI` column was optional hint

**New behavior (2026):**
- Babylon requires explicit `tenant_cluster.item` in catalog
- Missing reference = immediate provision-error

**Flow response:**
1. ✅ Detects missing `tenant_cluster` reference
2. ✅ Shows user-friendly warning before deploy
3. ✅ Doesn't break existing CSVs
4. ✅ Points to platform fix (not user's fault)
5. ✅ Continues working when catalog is fixed

**Anti-pattern:** Hard-coding assumptions about babylon behavior, breaking when platform evolves.

### 5. Default to Platform Truth

**CSV is override/hint, not source of truth.**

Query order:
1. **Catalog** (babylon CatalogItem) — source of truth
2. **Cluster** (live OpenShift state) — current reality  
3. **CSV** (user input) — preference/override

**Examples:**
- Catalog namespace: Query catalog, warn if CSV differs, use what exists
- Pool capacity: Query ResourcePool, calculate needs, warn on deficit
- Cluster references: Query CatalogItem sandboxes, detect gaps

**Why:** Babylon is authoritative. CSV can be stale, wrong, or based on old assumptions.

### 6. Graceful Degradation

**Flow works even when features are unavailable.**

```python
try:
    from tenant_cluster_capacity import check_tenant_cluster_references
    result = check_tenant_cluster_references(schedules)
except ImportError:
    logger.warning("Tenant cluster reference check unavailable")
    result = {"missing_refs": [], "total_tenant_count": 0}
```

**Degradation scenarios:**
- Cluster unreachable → skip live validations, proceed with CSV
- MCP unavailable → disable integration features, core deploy still works
- New catalog fields unknown → warn but don't block

**Never:** Crash or refuse to deploy because an enhancement feature failed.

---

## Validation Philosophy

### What to Validate

✅ **Critical path blockers** — Things that guarantee deployment failure:
- Missing catalog items
- Invalid dates (past provisioning dates)
- Tenant workshops without cluster references
- Cluster capacity deficit

✅ **User errors** — Fixable mistakes:
- Typos in catalog item names
- Wrong catalog namespaces (auto-fix with warning)
- Missing required fields (password, activity, purpose have defaults)

❌ **Don't validate:**
- Catalog item configuration quality (trust babylon)
- AgnosticD playbook correctness (not Flow's job)
- User's choice of workshop (trust their intent)

### Warning Levels

**Danger (red)** — Deploy will definitely fail:
```
⚠️ 3 catalog items not found
Verify the CI names are correct. Deployment will fail for these items.
```

**Warning (yellow)** — Deploy might fail or have issues:
```
⚠️ Need 2 more clusters for 15 tenant workshops
Add 2 cluster CI rows to your CSV, or ensure clusters exist in the pool.
```

**Info (blue)** — Everything is fine, just FYI:
```
ℹ️ 5 items are in babylon-catalog-event (your CSV says babylon-catalog-prod)
✓ This is fine — Flow will deploy from .event
```

### Auto-Fix Guidelines

**Auto-fix when:**
- Unambiguous (only one correct answer)
- Safe (can't break deployment)
- Reversible (user can override)

**Examples:**
- Catalog namespace detection (only one namespace has the item)
- Cluster timing offset (3hr buffer is standard)
- Default values (Activity→Admin, Purpose→QA)

**Never auto-fix:**
- Ambiguous choices (multiple pools available)
- User preferences (redirect, white glove)
- Capacity decisions (how many clusters to add)

---

## Future Evolution Checklist

When babylon adds new features, Flow should:

- [ ] **Detect** — Query catalog/cluster for new configuration
- [ ] **Validate** — Check if CSV aligns with new requirements
- [ ] **Warn** — Clear message if mismatch (user language, not technical)
- [ ] **Guide** — Point to docs, platform team, or auto-fix if safe
- [ ] **Degrade gracefully** — Don't break if feature unavailable
- [ ] **Document** — Update this philosophy with lessons learned

---

## Anti-Patterns to Avoid

❌ **Technical error pass-through**
```
Error: ResourceProvider summit-2026.lb1758-intelligent-apps-rag-tenant.event 
does not have tenant_cluster configured
```

✅ **User-friendly translation**
```
⚠️ 3 workshops will fail — cluster setup missing
These workshops need to run ON a cluster, but the catalog doesn't know which cluster to use.
```

---

❌ **Scary warnings for normal behavior**
```
⚠️ WARNING: Catalog namespace mismatch detected!
Flow will attempt to auto-detect the correct namespace.
This may cause unexpected behavior.
```

✅ **Reassuring info for auto-fix**
```
ℹ️ 5 items are in babylon-catalog-event (your CSV says babylon-catalog-prod)
✓ This is fine — Flow will deploy from .event
```

---

❌ **Blocking on enhancement failures**
```python
# DON'T
capacity = check_pool_capacity(ci)
if not capacity:
    raise HTTPException(500, "Pool capacity check failed")
```

✅ **Graceful degradation**
```python
# DO
try:
    capacity = check_pool_capacity(ci)
except Exception as e:
    logger.warning(f"Pool capacity unavailable: {e}")
    capacity = None  # Proceed without capacity data
```

---

## Implementation Examples

### Example 1: Catalog Namespace Auto-Detection (2025)

**Problem:** Users often get catalog namespace wrong in CSV (.prod vs .event).

**Flow Response:**
1. Query both `babylon-catalog-prod` and `babylon-catalog-event`
2. Find where item actually exists
3. Show friendly info alert (not warning)
4. Deploy from correct namespace

**User Experience:**
```
ℹ️ 5 items are in babylon-catalog-event (your CSV says babylon-catalog-prod)

Items:
- LB1758: Building Intelligent Apps with Python and RAG
- LB2645 Agentic DevOps
...

✓ This is fine — Flow will deploy from babylon-catalog-event
(these items don't exist in babylon-catalog-prod)

Note: Catalog item config may differ between event and prod catalogs.
```

**Lessons:**
- Auto-fix was safe (unambiguous)
- Info color, not warning (nothing broken)
- Green checkmark for reassurance
- Note about potential config differences

---

### Example 2: Tenant Cluster Reference Detection (2026)

**Problem:** Babylon changed to require explicit `tenant_cluster` references. Old catalog items missing this config cause immediate provision-error.

**Flow Response:**
1. Query CatalogItem for `tenant_cluster` in sandboxes
2. Detect missing references BEFORE deploy
3. Show clear warning with consequence
4. Point to platform team (not user's fault)

**User Experience:**
```
⚠️ 3 workshops will fail — cluster setup missing

These workshops need to run ON a cluster, but the catalog doesn't know which cluster to use:
- LB1758: Building Intelligent Apps with Python and RAG
- LB2645 Agentic DevOps
- LB2863: Unlocking OpenShift's Full Value

⚠️ Deploy will fail — catalog configuration needs updating.

Contact RHDP team in Slack (#forum-rhdp) or check for pending catalog updates.
```

**Lessons:**
- Platform change, not user error → guidance points to platform team
- Plain language ("run ON a cluster" vs "sandbox provisioning")
- Clear consequence ("Deploy will fail")
- Actionable (contact team in Slack)

---

## Conclusion

Flow is the **user-friendly layer** between event coordinators and the RHDP platform.

When babylon changes, Flow adapts. When users make mistakes, Flow guides. When deployments would fail, Flow prevents.

**The Flow way:**
- Simplicity over completeness
- Safety over speed  
- Clarity over cleverness
- Adaptation over assumption

---

**Questions or improvements?** Ping @rhjcd (Josh Israel) or @bbethell
