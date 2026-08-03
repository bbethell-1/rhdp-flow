# Flow Labels for Cluster-Tenant Tracking

## Overview

RHDP-Flow adds specialized labels to deployed Kubernetes resources (ResourceClaims, Workshops, and WorkshopProvisions) to enable cluster-tenant tracking and relationship mapping.

## Label Schema

### `flow.demo.redhat.com/item-type`

**Applies to:** ResourceClaim, Workshop, WorkshopProvision

**Values:**
- `cluster` - The resource is a cluster catalog item (OCP, ROSA, ARO, etc.)
- `tenant` - The resource is a tenant deployed on a shared cluster
- `workshop` - The resource is a standalone workshop (default)

**Detection Logic:**

**Cluster items** are detected by catalog item name patterns:
- Contains `ocp4-cluster`, `rosa-cluster`, `aro-cluster`, `ocp-cluster`
- Contains `.cluster.` or `-cluster-`

**Tenant items** are detected by catalog item name patterns:
- Contains `.tenant.`, `-tenant-`, `.tenant`, or `-tenant`
- AND is not a cluster item

**Workshop items** are the default when neither cluster nor tenant patterns match.

### `flow.demo.redhat.com/cluster-ci`

**Applies to:** ResourceClaim, Workshop, WorkshopProvision (tenant items only)

**Value:** Catalog item name of the associated cluster

**Sources:**
1. CSV `Cluster_CI` column (explicit override)
2. Auto-detected from tenant CI naming pattern
   - Example: `workshop.prod-tenant` → `workshop.prod-cluster` or `workshop-cluster.prod`

**Purpose:** Links tenant deployments to their host cluster for relationship tracking and debugging.

## Usage Examples

### Query All Cluster Resources

```bash
oc get resourceclaim -l flow.demo.redhat.com/item-type=cluster
```

### Find All Tenants for a Cluster

```bash
oc get resourceclaim -l flow.demo.redhat.com/cluster-ci=ocp4-cluster.prod
```

### List All Workshops (Non-Cluster, Non-Tenant)

```bash
oc get workshop -l flow.demo.redhat.com/item-type=workshop
```

### Debug Tenant Relationships

```bash
# Find tenant
TENANT_CI=$(oc get resourceclaim my-tenant -o jsonpath='{.metadata.labels.flow\.demo\.redhat\.com/item-type}')

# Find associated cluster
CLUSTER_CI=$(oc get resourceclaim my-tenant -o jsonpath='{.metadata.labels.flow\.demo\.redhat\.com/cluster-ci}')

# List all resources on that cluster
oc get resourceclaim -l flow.demo.redhat.com/cluster-ci=$CLUSTER_CI
```

## CSV Integration

### Optional Columns

**`Item_Type`** (optional)
- Explicitly set the item type: `cluster`, `tenant`, or `workshop`
- Overrides automatic detection

**`Cluster_CI`** (optional, tenant items only)
- Explicitly specify the cluster catalog item for tenant deployments
- Overrides auto-detection from naming patterns

### Example CSV

```csv
CI Name,CI,Namespace,Item_Type,Cluster_CI,...
OCP Cluster,ocp4-cluster.prod,user-demo,cluster,,...
Tenant App,app.tenant.prod,user-demo,tenant,ocp4-cluster.prod,...
Workshop,ansible-lab.prod,user-demo,,,... 
```

In this example:
- First row: Cluster explicitly labeled, no cluster-ci (it IS the cluster)
- Second row: Tenant explicitly labeled, associated with ocp4-cluster.prod
- Third row: Workshop (default), no special labels needed

## Implementation Details

### Detection in WorkshopSchedule

The `WorkshopSchedule` dataclass includes properties for detection:

```python
@property
def is_cluster(self) -> bool:
    """Detect if this catalog item is a cluster."""
    cluster_patterns = ["ocp4-cluster", "rosa-cluster", "aro-cluster", ...]
    return any(pattern in self.ci.lower() for pattern in cluster_patterns)

@property
def is_tenant(self) -> bool:
    """Detect if this catalog item is a tenant."""
    if self.is_cluster:
        return False
    tenant_patterns = [".tenant.", "-tenant-", ...]
    return any(pattern in self.ci.lower() for pattern in tenant_patterns)

@property
def detected_cluster_ci(self) -> Optional[str]:
    """Auto-detect cluster CI from tenant naming patterns."""
    # Converts .tenant. to .cluster. in catalog item name
    ...
```

### Label Application

Labels are applied in three places:

1. **ResourceClaim** (`build_resource_claim_payload`):
   - Line ~956: Flow labels added after resource pool configuration
   - Checks `schedule.is_cluster`, `schedule.is_tenant`
   - Adds `cluster-ci` label for tenants

2. **Workshop** (`build_workshop_resource_dict`):
   - Line ~1072: Copies Flow labels from ResourceClaim payload
   - Ensures consistency across related resources

3. **WorkshopProvision** (`build_workshop_provision_dict`):
   - Line ~1143: Copies Flow labels from ResourceClaim payload
   - Maintains label propagation through the resource hierarchy

## Benefits

1. **Resource Discovery**: Quickly find all clusters or tenants in a namespace
2. **Relationship Mapping**: Link tenants to their host clusters
3. **Debugging**: Trace issues from tenant back to cluster
4. **Reporting**: Generate cluster utilization reports
5. **Automation**: Enable automated cluster-tenant lifecycle management

## Future Enhancements

Potential future features enabled by these labels:

- Automated tenant cleanup when cluster is deleted
- Cluster capacity planning based on tenant count
- Multi-cluster tenant distribution
- Tenant-to-cluster affinity rules
- Cost allocation by cluster and tenant hierarchy
