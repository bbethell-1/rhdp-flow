# Design: Resolve tenant→cluster bindings from AgnosticV, support out-of-batch clusters

Status: Draft (first iteration, approved for planning)
Date: 2026-09-10

## Context

RHDP-Scheduler (Flow) already has cluster/tenant deploy logic:

- `tenant_cluster_capacity.py` — read-only capacity warnings for `-tenant` catalog
  items deploying onto existing clusters.
- `rhdp_flow.py` — `is_tenant_ci`/`is_cluster_ci`/`get_cluster_ci_for_tenant`/
  `analyze_cluster_tenant_relationships`/`validate_cluster_before_tenant`, which
  detect tenant/cluster CIs and validate that a cluster is provisioned before its
  tenant, within the same CSV batch.

Today the tenant→cluster association is guessed two ways, in priority order:

1. Manual CSV `Cluster_CI` column override.
2. Naming convention: replace `-tenant.` with `-cluster.` in the CI name.

AgnosticV has recently added a more authoritative mechanism (`__meta__.sandboxes[].
tenant_cluster.item`, schema change #27852, 2026-08-19): a tenant catalog item's
own YAML declares which cluster catalog item it binds to, by AgnosticV path
(`ACCOUNT/NAME` or `ACCOUNT/NAME/STAGE`, stage defaults to the tenant's own
stage). AgnosticV PR #28079 shows this eventually collapsing to folder-based
matching (dev↔dev, prod↔prod) with `cloud_selector` becoming droppable once
`tenant_cluster` is set — but for now, both `cloud_selector` and `tenant_cluster`
must be specified.

**Key finding:** this binding is not resolved or surfaced anywhere on the
cluster today. `agnosticv-operator`, `poolboy`, and the Go Sandbox API have no
code referencing `tenant_cluster` yet — it exists only as declared YAML in the
`rhpds/agnosticv` repo. `ai-quickstarts/ai-qs-rag-tenant` is the first (and
currently only) consumer. There is no CRD Flow can query for the resolved
value; the only source of truth is the AgnosticV repo itself, merged the same
way `agnosticv-operator` merges it (`common.yaml` → account → item → stage,
with `sandboxes` using overwrite-not-merge semantics).

Flow's naming-convention guess and CSV override can therefore diverge from
what AgnosticV actually declares, and Flow has no way to deploy/validate a
tenant against a cluster that isn't part of the current CSV batch (e.g. a
shared, pre-existing cluster Flow didn't provision).

## Goals

1. Resolve the authoritative tenant→cluster binding from AgnosticV
   (`tenant_cluster.item`) instead of relying solely on naming convention or
   manual override.
2. Support deploying/validating a tenant whose cluster already exists on the
   target cluster but is not part of the current CSV batch.
3. Fail safe: if resolution is unavailable for any reason, fall back to
   existing behavior. Never block a deploy on this feature.

## Non-goals

- Implementing resolution inside `agnosticv-operator`/`sandbox-api`/`poolboy`
  themselves (out of scope for this repo).
- Supporting the future folder-based auto-matching described in AgnosticV PR
  #28079 (drops `cloud_selector`). Revisit once that ships to production.
- Any change to how Flow provisions clusters/tenants beyond ordering
  validation.

## Design

### 1. New module: `agnosticv_resolver.py`

```
resolve_tenant_cluster_item(ci: str, config: RHDPConfig) -> Optional[str]
```

- Input `ci` is a Babylon catalog item name in `account.item.stage` form,
  matching AgnosticV's `account/item/stage.yaml` layout.
- Splits `ci` into `account/item/stage` and resolves the corresponding
  AgnosticV path.
- Ensures a local clone of `rhpds/agnosticv` exists under `/tmp/agnosticv-cache`
  (shallow, `--depth 1`, via a dedicated read-only deploy key — see Infra
  below). Lazy: cloned on first resolution request per pod lifetime, not at
  startup.
- Refreshes the clone via `git pull` when it is older than a configurable TTL
  (default 15 minutes) rather than re-cloning on every call.
- Runs the vendored `agnosticv` CLI: `agnosticv --merge <account>/<item>/<stage>`
  against the local clone, producing the fully merged YAML for that catalog
  item.
- Parses `__meta__.sandboxes[]` for an entry with a `tenant_cluster.item`
  field. Applies the schema's own stage-defaulting: if the referenced item
  omits `/STAGE`, it inherits the tenant's own stage.
- Converts the resolved AgnosticV path back into a CI string
  (`account.name.stage`) so it plugs into Flow's existing cluster/tenant
  matching code (`detected_cluster_ci`) without further changes downstream.
- **Fails safe on any error**: clone failure, auth failure, missing binary,
  merge error, item not found, no `tenant_cluster` present, or malformed YAML
  all log a warning and return `None`. Callers must treat `None` as "fall
  back to existing detection," never as a deploy-blocking error.

### 2. Resolution priority in `analyze_cluster_tenant_relationships()`

Extend the existing logic to three tiers, evaluated in order, first hit wins:

1. **CSV `Cluster_CI` column override** — manual, unchanged, highest priority.
2. **AgnosticV resolution (new)** — call `resolve_tenant_cluster_item`; use the
   result if not `None`.
3. **Naming convention** (`-tenant.` → `-cluster.`) — existing fallback, used
   when AgnosticV resolution is unavailable or returns `None`.

Store which tier produced the value alongside `detected_cluster_ci` (e.g. a
new `cluster_ci_source: Literal["override", "agnosticv", "naming"]` field on
`WorkshopSchedule`) so the source can be surfaced in the UI (see §4).

### 3. Out-of-batch cluster handling in `validate_cluster_before_tenant()`

Today: if a tenant's `detected_cluster_ci` has no matching schedule in the
current CSV batch, this is an error ("tenant before cluster").

New behavior: when no matching schedule exists in the batch, check the live
cluster for an already-provisioned instance of that cluster CI (reusing
existing `oc get`-based catalog-item-instance lookup helpers already in
`rhdp_flow.py`, in the style of `validate_catalog_item_exists`).

- Found and healthy → treat ordering as satisfied. Add an informational
  (non-blocking) note, e.g. "cluster already provisioned outside this batch."
- Not found in the batch and not found on the cluster → keep today's error,
  but reword to distinguish the two cases: "tenant '<ci>' references cluster
  '<cluster_ci>', which is neither in this batch nor already provisioned."

This check is best-effort like the rest of this feature: if the cluster
lookup itself fails (API error, timeout), log a warning and fall back to
today's "not in batch = error" behavior rather than silently passing.

### 4. UI surfacing

In the schedule table (`UploadTab.tsx` / diff view), show the source of a
tenant's cluster association — e.g. a small tag or tooltip: "cluster:
ai-qs-rag-cluster (AgnosticV)" / "(naming convention)" / "(manual override)" —
plus, when applicable, "(existing on cluster)" for the out-of-batch case from
§3. This lets operators sanity-check the binding before deploying, especially
important while `tenant_cluster.item` is still a new, single-consumer feature
in AgnosticV.

### 5. Infra changes

These are deployment/image changes, separate from and prerequisite to the
application code above:

- **Dockerfile** (`dockerfiles/Dockerfile`): add `git` (dnf install), and
  vendor the `agnosticv` CLI binary at build time via the same public,
  unauthenticated download `agnosticv-operator` uses:
  `curl -sL https://github.com/redhat-cop/agnosticv/releases/download/v0.7.1/agnosticv_linux_amd64`,
  pinned to v0.7.1 to match the operator's current version.
- **New OpenShift Secret**: a dedicated, read-only SSH deploy key scoped only
  to `rhpds/agnosticv`, requested from that repo's admins — not a reused
  broader-scoped bot token. Mounted into the `rhdp-scheduler` pod for git
  auth.
- **Filesystem**: no PVC needed. The clone lives under the existing `/tmp`
  `emptyDir` (already writable despite `readOnlyRootFilesystem: true`). It is
  wiped on pod restart; each restart re-clones lazily on first use. Acceptable
  given the repo is cloned shallow and Flow runs a single replica.
- **Egress**: `github.com` egress from the `rhdp-scheduler` namespace on
  infra01-dal12 is **unconfirmed**. The pod's own `NetworkPolicy` only
  restricts ingress, so nothing in this repo blocks it, but a cluster-level
  egress firewall may. **Action item**: confirm with cluster/network admins
  before relying on this in production; if blocked, resolution will simply
  fail safe (§1) and Flow falls back to naming-convention/override behavior,
  so this is not a hard blocker for shipping, but it should be verified so
  the feature isn't silently dead on arrival.

### 6. Testing

- Unit tests for `agnosticv_resolver.py` mocking the `git`/`agnosticv` CLI
  subprocess calls, covering: successful resolution, missing binary, clone
  failure, stale-cache refresh, item not found, malformed merged YAML,
  stage-defaulting behavior.
- Unit tests extending `test_cluster_tenant.py` for the new three-tier
  priority order and the `cluster_ci_source` field.
- Unit tests for `validate_cluster_before_tenant()` covering the new
  out-of-batch/live-cluster-lookup path (found, not found, lookup failure).
- Frontend test coverage for the new source indicator in the schedule table.

## Open questions / follow-ups (not blocking, tracked for later)

- Once `agnosticv-operator`/`sandbox-api` implement real resolution and surface
  it on a CRD, revisit whether `agnosticv_resolver.py` should switch from
  git+CLI to a CRD read (simpler, no git dependency, always reflects deployed
  state).
- Once AgnosticV PR #28079-style folder-based auto-matching ships to
  production and `cloud_selector` becomes droppable, revisit whether Flow
  needs to change its resolution logic (likely not, since it reads the merged
  output either way — but worth a sanity check).
- Confirm github.com egress from infra01-dal12 (see §5).
