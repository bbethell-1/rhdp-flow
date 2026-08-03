# Cluster-Tenant Architecture Guide

**Last Updated:** 2026-07-31  
**Audience:** RHDP ops team, catalog item maintainers, advanced users  
**Flow Version:** 1.3.5+

---

## Overview

The **cluster-tenant pattern** is an infrastructure deployment strategy used by catalog items that offer **two variants**:

1. **Cluster variant** (`-cluster` suffix): Provisions a dedicated OpenShift cluster with workloads pre-installed
2. **Tenant variant** (`-tenant` suffix): Provisions tenant workloads on a pre-existing shared cluster via **Sandbox API**

This pattern optimizes for **cost** (tenant is cheaper) and **speed** (tenant provisions 3-4x faster) while maintaining workload isolation.

---

## Architecture Deep Dive

### Cluster Variant Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Babylon Provisioner                      │
│                                                             │
│  ResourceClaim → CatalogItem (cluster variant)              │
│         ↓                                                   │
│  Provision dedicated OpenShift cluster (AWS, Azure, etc.)   │
│         ↓                                                   │
│  Install workloads via AgnosticV (Ansible)                  │
│         ↓                                                   │
│  ┌──────────────────────────────────────────────┐          │
│  │  Dedicated OpenShift Cluster                 │          │
│  │  ┌────────────────────────────────────────┐  │          │
│  │  │ Namespace: openshift-ai                │  │          │
│  │  │  - RHOAI operator                      │  │          │
│  │  │  - Model serving (vLLM, Gaudi)         │  │          │
│  │  │                                        │  │          │
│  │  │ Namespace: app-workload                │  │          │
│  │  │  - Demo application                    │  │          │
│  │  │  - Database                            │  │          │
│  │  │                                        │  │          │
│  │  │ Namespace: showroom                    │  │          │
│  │  │  - Lab guide web UI                    │  │          │
│  │  └────────────────────────────────────────┘  │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Provisioning time:** 45-60 minutes  
**Cost:** High (full cluster + compute nodes)  
**Use case:** Production testing, cluster-level features, full admin access

---

### Tenant Variant Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Babylon Provisioner                      │
│                                                             │
│  ResourceClaim → CatalogItem (tenant variant)               │
│         ↓                                                   │
│  Lookup shared base cluster (pre-provisioned)               │
│         ↓                                                   │
│  Call Sandbox API: POST /sandboxes                          │
│         ↓                                                   │
│  ┌──────────────────────────────────────────────┐          │
│  │  Shared Base Cluster (already running)       │          │
│  │  ┌────────────────────────────────────────┐  │          │
│  │  │ Tenant Namespace: user-alice-sandbox   │  │          │
│  │  │  - RHOAI access (shared operator)      │  │          │
│  │  │  - Model serving endpoint (dedicated)  │  │          │
│  │  │  - Demo app (isolated)                 │  │          │
│  │  │  - Showroom lab guide                  │  │          │
│  │  │                                        │  │          │
│  │  │ Resource Quotas:                       │  │          │
│  │  │  - CPU: 20 cores                       │  │          │
│  │  │  - Memory: 80Gi                        │  │          │
│  │  │  - Storage: 50Gi                       │  │          │
│  │  └────────────────────────────────────────┘  │          │
│  │                                               │          │
│  │  (Other tenant namespaces for other users)    │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Provisioning time:** 5-15 minutes  
**Cost:** Low (shared cluster infrastructure, pay for namespace resources only)  
**Use case:** Workshops, demos, quickstarts, learning labs

---

## Sandbox API Integration

### How Tenant Provisioning Works

1. **Babylon receives ResourceClaim** with tenant-variant catalog item
2. **AgnosticV playbook queries Sandbox API** for available base clusters:
   ```bash
   GET /api/v1/sandboxes/available
   ```
3. **Create sandbox request:**
   ```bash
   POST /api/v1/sandboxes
   {
     "user": "alice",
     "catalog_item": "ai-quickstarts.ai-qs-data-gov-tenant.event",
     "resources": {
       "cpu": "20",
       "memory": "80Gi",
       "storage": "50Gi"
     }
   }
   ```
4. **Sandbox API provisions tenant namespace** on shared cluster
5. **AgnosticV installs workloads** via Makefile in tenant namespace
6. **Returns access credentials** to user

### Sandbox API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/sandboxes` | GET | List user's sandboxes |
| `/api/v1/sandboxes` | POST | Create new sandbox |
| `/api/v1/sandboxes/{id}` | DELETE | Delete sandbox |
| `/api/v1/sandboxes/available` | GET | List available base clusters |
| `/api/v1/sandboxes/{id}/extend` | POST | Extend sandbox lifetime |

### Quotas & Limits

Each tenant namespace gets:

| Resource | Quota | Limit Behavior |
|----------|-------|----------------|
| CPU | 20 cores | Hard limit (pods fail to schedule if exceeded) |
| Memory | 80Gi | Hard limit (OOMKilled if exceeded) |
| Storage (PVC) | 50Gi | Hard limit (PVC creation fails) |
| Pods | 50 | Hard limit |
| Services | 10 | Hard limit |

**Base cluster capacity:**
- Typically supports 10-20 concurrent tenant namespaces
- Auto-scales worker nodes based on demand
- Shared control plane (API server, etcd, schedulers)

---

## When to Use Cluster vs Tenant

### Decision Matrix

| Requirement | Cluster | Tenant |
|-------------|---------|--------|
| **Fast provisioning** (< 20 min) | ❌ No (45-60 min) | ✅ Yes (5-15 min) |
| **Cost-effective** | ❌ No (full cluster) | ✅ Yes (namespace only) |
| **Cluster admin access** | ✅ Yes | ❌ No (namespace admin only) |
| **Custom cluster config** (node sizes, network, etc.) | ✅ Yes | ❌ No (shared cluster) |
| **Workshop with 20+ seats** | ❌ Expensive | ✅ Ideal |
| **Production-like testing** | ✅ Yes | ⚠️ Limited (shared cluster) |
| **Cluster-level operators** (ODF, ACM, ACS) | ✅ Yes | ⚠️ Depends (some shared) |
| **Multi-tenant isolation** | ✅ Complete | ⚠️ Namespace-level |
| **Resource quotas** | ✅ Flexible | ⚠️ Fixed quotas |
| **Event load (100+ provisions)** | ❌ Too slow | ✅ With staggering |

### Use Case Examples

**Use cluster variant when:**
- Customer demo requires cluster-level features (e.g., "Show me how to install ODF")
- POC testing for cluster architecture (e.g., "Test cluster with GPU nodes")
- Training for cluster admins (e.g., "Learn OpenShift cluster operations")
- Production environment simulation (e.g., "Test upgrade from 4.15 to 4.16")
- User explicitly asks for "dedicated cluster" or "cluster admin access"

**Use tenant variant when:**
- Workshop with multiple participants (e.g., "Deploy 30 seats for Summit lab")
- Demo of application workloads (e.g., "Show AI chatbot demo")
- Quickstart learning labs (e.g., "Try OpenShift AI in 15 minutes")
- Cost-constrained environment (e.g., "We need 50 seats but have limited budget")
- Fast turnaround required (e.g., "Provision for meeting starting in 30 minutes")

---

## Catalog Item Examples

### AI Quickstarts Family

All `ai-quickstarts` catalog items follow the cluster-tenant pattern:

| Cluster Variant | Tenant Variant | Workload Description |
|----------------|----------------|---------------------|
| `ai-quickstarts.ai-qs-data-gov-cluster.event` | `ai-quickstarts.ai-qs-data-gov-tenant.event` | Data Governance Copilot with Qwen3-14b LLM on Intel Gaudi |
| `ai-quickstarts.ai-qs-it-self-service-cluster.event` | `ai-quickstarts.ai-qs-it-self-service-tenant.event` | IT Self-Service Chatbot with knowledge base RAG |
| `ai-quickstarts.ai-qs-product-rec-cluster.event` | `ai-quickstarts.ai-qs-product-rec-tenant.event` | Product Recommender using embedding models |
| `ai-quickstarts.ai-qs-rag-cluster.event` | `ai-quickstarts.ai-qs-rag-tenant.event` | Retrieval-Augmented Generation demo |
| `ai-quickstarts.ai-qs-ppe-comp-cluster.event` | `ai-quickstarts.ai-qs-ppe-comp-tenant.event` | PPE Monitoring with Computer Vision (object detection) |

**Catalog namespace:** `babylon-catalog-event`  
**Common features:**
- Showroom lab guide (interactive HTML with embedded console)
- OpenShift AI (RHOAI) model serving
- Pre-configured LLMs (Llama, Qwen, Mistral variants)
- Make-based workload deployment

### Verifying Variants Exist

```bash
# List all ai-quickstarts catalog items
oc get catalogitem -n babylon-catalog-event | grep ai-quickstarts

# Check specific variant
oc get catalogitem ai-quickstarts.ai-qs-data-gov-tenant.event -n babylon-catalog-event

# Compare cluster vs tenant specs
diff \
  <(oc get catalogitem ai-quickstarts.ai-qs-data-gov-cluster.event -n babylon-catalog-event -o yaml) \
  <(oc get catalogitem ai-quickstarts.ai-qs-data-gov-tenant.event -n babylon-catalog-event -o yaml)
```

**Key differences in catalog item spec:**
```yaml
# Cluster variant
spec:
  agnosticvWorkload: ocp4-workload-openshift-ai-cluster  # ← different workload

# Tenant variant
spec:
  agnosticvWorkload: ocp4-workload-openshift-ai-tenant  # ← uses Sandbox API
```

---

## CSV Deployment Examples

### Example 1: Single Tenant Workshop (Fast Demo)

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
AI Demo,ai-quickstarts.ai-qs-data-gov-tenant.event,user-alice,1,True,demo123,Admin,QA,31/07/2026 14:00,31/07/2026 18:00,01/08/2026 10:00
```

**Result:**
- Provisions in ~10 minutes
- Tenant namespace on shared cluster
- Showroom at `https://ai-demo.apps.shared-cluster.demo.redhat.com`

---

### Example 2: Cluster Deployment (Full Control)

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
AI Cluster,ai-quickstarts.ai-qs-data-gov-cluster.event,user-bob,1,True,cluster456,Admin,QA,31/07/2026 09:00,03/08/2026 18:00,04/08/2026 10:00
```

**Result:**
- Provisions in ~50 minutes
- Dedicated OpenShift cluster
- Full cluster admin access
- Cluster console at `https://console-openshift-console.apps.cluster-xyz.demo.redhat.com`

---

### Example 3: Staggered Tenant Deployment for Event

**Scenario:** Summit lab with 20 participants, need fast provisioning.

```csv
CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Summit Lab 1,ai-quickstarts.ai-qs-rag-tenant.event,user-s1,1,True,summit2026,Admin,QA,07/08/2026 09:00,10/08/2026 18:00,11/08/2026 10:00
Summit Lab 2,ai-quickstarts.ai-qs-rag-tenant.event,user-s2,1,True,summit2026,Admin,QA,07/08/2026 09:05,10/08/2026 18:00,11/08/2026 10:00
Summit Lab 3,ai-quickstarts.ai-qs-rag-tenant.event,user-s3,1,True,summit2026,Admin,QA,07/08/2026 09:10,10/08/2026 18:00,11/08/2026 10:00
...
Summit Lab 20,ai-quickstarts.ai-qs-rag-tenant.event,user-s20,1,True,summit2026,Admin,QA,07/08/2026 10:35,10/08/2026 18:00,11/08/2026 10:00
```

**Staggering strategy:**
- 5-minute intervals (09:00, 09:05, 09:10, ...)
- Avoids Sandbox API throttling
- All 20 seats ready by 10:45 (1h 45min total)
- vs cluster variant: would take 16+ hours (20 × 50min)

**Flow CLI:**
```bash
python3 rhdp_flow.py --input-csv summit-labs.csv --dry-run  # verify
python3 rhdp_flow.py --input-csv summit-labs.csv            # deploy
```

---

## Resource Labels & Annotations

### Flow-Applied Labels

Flow applies these labels to **all** workshops (cluster and tenant):

```yaml
metadata:
  labels:
    rhdp-flow.gpte.redhat.com/scheduled: "true"
    rhdp-flow.gpte.redhat.com/ci-name: "AI Demo"
    demo.redhat.com/lock-enabled: "true"  # when Resource Lock toggle is on
```

### Sandbox API Labels (Tenant Only)

Tenant-variant ResourceClaims get additional labels from the provisioner:

```yaml
metadata:
  labels:
    sandbox.demo.redhat.com/base-cluster: "shared-ocp-01"
    sandbox.demo.redhat.com/tenant-namespace: "user-alice-sandbox-xyz"
  annotations:
    sandbox.demo.redhat.com/namespace-quota: '{"cpu": "20", "memory": "80Gi"}'
    sandbox.demo.redhat.com/created-at: "2026-07-31T14:05:32Z"
```

**Querying tenant workshops:**
```bash
# Find all tenant workshops
oc get resourceclaim -A -l sandbox.demo.redhat.com/base-cluster

# Get sandbox namespace for a workshop
oc get resourceclaim my-workshop -n user-alice -o jsonpath='{.metadata.labels.sandbox\.demo\.redhat\.com/tenant-namespace}'
```

---

## Troubleshooting

### Problem: Tenant Provision Stuck at "Provisioning"

**Symptoms:**
- ResourceClaim phase stuck at `Provisioning` for >30 minutes
- Workshop never becomes `Ready`

**Possible Causes:**

1. **Sandbox API quota exceeded**
   ```bash
   # Check Sandbox API logs
   oc logs -n sandbox-api deployment/sandbox-api-server | grep quota
   ```
   **Fix:** Stagger deployments with 5-10 minute intervals in CSV.

2. **Base cluster capacity full**
   ```bash
   # Check available sandboxes
   curl https://sandbox-api.demo.redhat.com/api/v1/sandboxes/available
   ```
   **Fix:** Wait for capacity to free up, or use cluster variant.

3. **Makefile workload deployment failed**
   ```bash
   # Check provision logs
   oc logs -n user-alice job/provision-workload
   ```
   **Fix:** Check catalog item workload definition, may need catalog item fix.

---

### Problem: Wrong Variant Deployed

**Symptoms:**
- Expected fast provisioning (tenant) but took 50+ minutes
- Expected cluster admin access but only have namespace admin

**Cause:**
- Typo in CSV: used `-cluster` instead of `-tenant` (or vice versa)

**Fix:**
```bash
# Check deployed catalog item
oc get resourceclaim my-workshop -n user-alice -o jsonpath='{.spec.resources[0].provider.name}'

# If wrong variant, delete and redeploy
oc delete resourceclaim my-workshop -n user-alice
python3 rhdp_flow.py --input-csv corrected.csv
```

---

### Problem: Catalog Item Not Found

**Symptoms:**
- Dry-run shows error: `CatalogItem not found in babylon-catalog-event`
- Workshop becomes ghost (PHASE: none)

**Cause:**
- Catalog item doesn't exist (typo, wrong namespace, or hasn't been published)

**Fix:**
```bash
# List available ai-quickstarts items
oc get catalogitem -n babylon-catalog-event | grep ai-quickstarts

# Check exact name
oc get catalogitem ai-quickstarts.ai-qs-data-gov-tenant.event -n babylon-catalog-event

# Use catalog aliases (Flow auto-corrects common typos)
# See: catalog_item_aliases.json
```

---

### Problem: Sandbox API 429 (Too Many Requests)

**Symptoms:**
- Multiple tenant provisions fail simultaneously
- Logs show `HTTP 429: Rate limit exceeded`

**Cause:**
- Too many simultaneous Sandbox API requests (no staggering)

**Fix:**
- **Preventive:** Always stagger tenant deployments in CSV (5-10 min intervals)
- **Reactive:** Wait 10-15 minutes, then retry failed workshops:
  ```bash
  # Retry via Flow UI: Deployments tab → select failed → Retry
  # Or via CLI:
  python3 rhdp_flow.py --input-csv failed-workshops.csv
  ```

---

## Best Practices

### 1. Default to Tenant for Workshops

Unless user explicitly needs cluster-level features, always use tenant variant:
- Faster provisioning
- Lower cost
- Sufficient for 90% of workshop use cases

### 2. Stagger Tenant Deployments

For events with >5 tenant workshops, always stagger provisioning:

```python
# Example: Generate staggered CSV
import datetime
import csv

base_time = datetime.datetime(2026, 8, 7, 9, 0)  # Event start
workshops = 20
interval_minutes = 5

rows = []
for i in range(workshops):
    prov_time = base_time + datetime.timedelta(minutes=i * interval_minutes)
    rows.append({
        "CI Name": f"Workshop {i+1}",
        "CI": "ai-quickstarts.ai-qs-rag-tenant.event",
        "Namespace": f"user-s{i+1}",
        "Provisioning Date (UTC)": prov_time.strftime("%d/%m/%Y %H:%M"),
        # ... other fields
    })

with open("staggered.csv", "w") as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
```

### 3. Verify Catalog Items Before Events

Before deploying for a large event, verify all catalog items exist:

```bash
# Run QA3 validation
python3 rhdp_flow.py --input-csv event.csv --qa 3

# Or manually check
oc get catalogitem ai-quickstarts.ai-qs-rag-tenant.event -n babylon-catalog-event
```

### 4. Use Dry-Run Mode

Always test with dry-run before live deployment:

```bash
# Generate manifests without creating resources
python3 rhdp_flow.py --input-csv workshops.csv --dry-run

# Check exported YAML
cat dry_run_manifests/resourceclaim-*.yaml
```

### 5. Monitor Sandbox API Health

For large events, check Sandbox API health before deploying:

```bash
# Check available capacity
curl https://sandbox-api.demo.redhat.com/api/v1/sandboxes/available | jq '.available_slots'

# Check API latency
curl -w "@curl-format.txt" -o /dev/null -s https://sandbox-api.demo.redhat.com/health
```

---

## Related Documentation

- **README.md** — Main Flow documentation, CSV format, UI usage
- **FLOW_CSV_SPEC_FOR_MCP.md** — Complete CSV specification for MCP/skill development
- **CLUSTER_TENANT_TEST_PLAN.md** — Testing plan for cluster-tenant feature validation
- **docs/examples/** — Example CSV files for various scenarios

---

## Glossary

| Term | Definition |
|------|------------|
| **Cluster variant** | Catalog item that provisions a dedicated OpenShift cluster |
| **Tenant variant** | Catalog item that provisions a namespace on shared cluster via Sandbox API |
| **Sandbox API** | RHDP service that manages tenant namespaces on shared base clusters |
| **Base cluster** | Pre-provisioned OpenShift cluster that hosts multiple tenant namespaces |
| **AgnosticV** | Ansible-based provisioner for deploying catalog items |
| **Staggering** | Deploying workshops with time intervals to avoid API throttling |
| **Ghost workshop** | Workshop with PHASE: none (usually due to wrong catalog namespace) |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-31 | Initial documentation — cluster-tenant architecture, Sandbox API integration, examples |
