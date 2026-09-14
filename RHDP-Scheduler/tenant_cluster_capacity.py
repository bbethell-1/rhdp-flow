"""Tenant cluster capacity checking for RHDP-Flow.

Provides read-only capacity warnings for workshops deploying to existing tenant clusters.
Only applies to catalog items ending in -tenant (existing clusters).
Fresh cluster deployments are skipped.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("rhdp_flow.tenant_cluster_capacity")


@dataclass
class ClusterCapacity:
    """Cluster capacity information with dual metrics.

    Tracks both pool saturation (cluster allocation) and placement capacity
    (actual workshop slot utilization).
    """
    cluster_name: str
    total_clusters: int
    available_clusters: int
    pool_saturation_percent: int  # Renamed from utilization_percent
    max_placements_per_cluster: int
    workshops_deployed: int
    placement_capacity_percent: int

    @property
    def status(self) -> str:
        """Return status: healthy, warning, or critical.

        Uses placement capacity as primary metric when available,
        falls back to pool saturation.
        """
        # Use placement capacity if workshop count is available
        metric = self.placement_capacity_percent if self.workshops_deployed >= 0 else self.pool_saturation_percent

        if metric >= 90:
            return "critical"
        elif metric >= 70:
            return "warning"
        return "healthy"

    @property
    def message(self) -> str:
        """Return human-readable message showing both metrics."""
        pool_msg = f"Pool: {self.pool_saturation_percent}% saturated ({self.total_clusters - self.available_clusters}/{self.total_clusters} clusters occupied)"
        placement_msg = f"Placements: {self.placement_capacity_percent}% utilized ({self.workshops_deployed}/{self.total_clusters * self.max_placements_per_cluster} workshops)"

        if self.status == "critical":
            return f"CRITICAL: Cluster {self.cluster_name} at capacity - {placement_msg}, {pool_msg}"
        elif self.status == "warning":
            return f"WARNING: Cluster {self.cluster_name} nearing capacity - {placement_msg}, {pool_msg}"
        return f"OK: Cluster {self.cluster_name} has capacity - {placement_msg}, {pool_msg}"


def is_tenant_catalog_item(ci: str) -> bool:
    """Check if catalog item is a tenant variant (deploys to existing cluster)."""
    return ci.endswith("-tenant")


def check_cluster_capacity(catalog_item: str, namespace: str = None) -> ClusterCapacity | None:
    """
    Check tenant cluster capacity for a catalog item (read-only).

    Args:
        catalog_item: Catalog item name (e.g., "workshop.prod-tenant")
        namespace: Optional namespace hint

    Returns:
        ClusterCapacity if cluster found and capacity determined, None otherwise

    Note:
        This function is safe to fail - if API is unavailable or cluster not found,
        it returns None and deployment proceeds without warnings.
    """
    # Skip if not a tenant variant
    if not is_tenant_catalog_item(catalog_item):
        logger.debug(f"Skipping capacity check for non-tenant catalog item: {catalog_item}")
        return None

    try:
        # Import kubernetes client only when needed
        try:
            from kubernetes import client, config
        except ImportError:
            logger.warning("kubernetes client not installed - skipping capacity check")
            return None

        # Try to load kube config
        try:
            config.load_incluster_config()
        except config.ConfigException:
            try:
                config.load_kube_config()
            except config.ConfigException:
                logger.warning("Could not load kubernetes config - skipping capacity check")
                return None

        # Query TenantClusterPools (read-only)
        api = client.CustomObjectsApi()

        try:
            # List all TenantClusterPools (cluster-wide query)
            pools = api.list_cluster_custom_object(
                group="babylon.gpte.redhat.com",
                version="v1",
                plural="tenantclusterpools"
            )
        except client.exceptions.ApiException as e:
            if e.status == 404:
                logger.debug("TenantClusterPool CRD not found - skipping capacity check")
            else:
                logger.warning(f"Error querying TenantClusterPools: {e}")
            return None

        # Find matching pool (simple heuristic: first pool with available clusters)
        # In production, this would use resource claim mapping like babylon ops does
        # For now, we just check if ANY tenant cluster pool exists and report its capacity
        for pool in pools.get("items", []):
            pool_name = pool.get("metadata", {}).get("name", "")
            pool_namespace = pool.get("metadata", {}).get("namespace", "")
            status = pool.get("status", {})
            spec = pool.get("spec", {})
            clusters = status.get("clusters", [])

            if not clusters:
                continue

            # Pool saturation (cluster allocation)
            total = len(clusters)
            available = sum(1 for c in clusters if c.get("sandboxApiState") == "available")
            occupied = total - available
            pool_saturation_percent = int((occupied / total) * 100) if total > 0 else 0

            # Placement capacity (workshop slots)
            max_placements = spec.get("sandboxHost", {}).get("max_placements", 50)

            # Count workshops in this pool (ResourceClaims with tenantClusterPoolName label)
            workshops_deployed = 0
            try:
                core_v1 = client.CoreV1Api()
                resource_claims = api.list_cluster_custom_object(
                    group="poolboy.gpte.redhat.com",
                    version="v1",
                    plural="resourceclaims",
                    label_selector=f"babylon.gpte.redhat.com/tenantClusterPoolName={pool_name}"
                )
                workshops_deployed = len(resource_claims.get("items", []))
            except Exception as e:
                logger.debug(f"Could not count workshops for pool {pool_name}: {e}")
                # Non-fatal - continue with workshops_deployed = 0

            max_total_placements = total * max_placements
            placement_capacity_percent = int((workshops_deployed / max_total_placements) * 100) if max_total_placements > 0 else 0

            logger.info(
                f"Found tenant cluster pool {pool_name}: "
                f"Pool saturation: {pool_saturation_percent}% ({occupied}/{total} clusters), "
                f"Placement capacity: {placement_capacity_percent}% ({workshops_deployed}/{max_total_placements} workshops)"
            )

            return ClusterCapacity(
                cluster_name=pool_name,
                total_clusters=total,
                available_clusters=available,
                pool_saturation_percent=pool_saturation_percent,
                max_placements_per_cluster=max_placements,
                workshops_deployed=workshops_deployed,
                placement_capacity_percent=placement_capacity_percent
            )

        logger.debug(f"No tenant cluster pools found for {catalog_item}")
        return None

    except Exception as e:
        # Graceful failure - don't block deployments if capacity check fails
        logger.warning(f"Cluster capacity check failed (non-blocking): {e}")
        return None


def check_schedules_capacity(schedules: list[Any], ignore_warnings: bool = False) -> dict[str, Any]:
    """
    Check capacity for all tenant catalog items in schedules (read-only).

    Args:
        schedules: List of WorkshopSchedule objects
        ignore_warnings: If True, skip capacity checks

    Returns:
        Dict with:
        - warnings: List of capacity warnings
        - errors: List of critical capacity errors
        - checked_count: Number of tenant items checked
        - capacity_info: Dict mapping CI name to ClusterCapacity
    """
    if ignore_warnings:
        logger.info("Cluster capacity warnings ignored by user")
        return {
            "warnings": [],
            "errors": [],
            "checked_count": 0,
            "capacity_info": {}
        }

    warnings = []
    errors = []
    checked_count = 0
    capacity_info = {}

    for schedule in schedules:
        ci = schedule.ci

        if not is_tenant_catalog_item(ci):
            continue

        checked_count += 1
        capacity = check_cluster_capacity(ci, schedule.namespace)

        if capacity:
            capacity_info[schedule.ci_name] = capacity

            if capacity.status == "critical":
                errors.append({
                    "ci_name": schedule.ci_name,
                    "ci": ci,
                    "message": capacity.message,
                    "pool_saturation": capacity.pool_saturation_percent,
                    "placement_capacity": capacity.placement_capacity_percent
                })
            elif capacity.status == "warning":
                warnings.append({
                    "ci_name": schedule.ci_name,
                    "ci": ci,
                    "message": capacity.message,
                    "pool_saturation": capacity.pool_saturation_percent,
                    "placement_capacity": capacity.placement_capacity_percent
                })

    return {
        "warnings": warnings,
        "errors": errors,
        "checked_count": checked_count,
        "capacity_info": capacity_info
    }


def calculate_cluster_needs(schedules: list[Any]) -> dict[str, Any]:
    """
    Calculate how many cluster CIs are needed for tenant workshops.

    Groups tenant schedules by their cluster CI, counts tenants, queries pool
    capacity, and calculates cluster deficit.

    Args:
        schedules: List of WorkshopSchedule objects

    Returns:
        Dict with:
        - needs: List of dicts with cluster_ci, tenant_count, capacity_per_cluster,
                 clusters_needed, clusters_in_csv, deficit
        - total_tenant_count: Total tenant workshops
        - total_deficit: Total cluster shortage across all tenant types
    """
    import math

    needs = []
    total_tenant_count = 0
    total_deficit = 0

    # Group tenants by their detected cluster CI
    tenant_groups = {}  # cluster_ci -> list of tenant schedules
    cluster_counts = {}  # cluster_ci -> count of cluster rows in CSV

    for schedule in schedules:
        if schedule.is_tenant and schedule.detected_cluster_ci:
            cluster_ci = schedule.detected_cluster_ci
            if cluster_ci not in tenant_groups:
                tenant_groups[cluster_ci] = []
            tenant_groups[cluster_ci].append(schedule)
            total_tenant_count += 1
        elif schedule.is_cluster:
            cluster_ci = schedule.ci
            cluster_counts[cluster_ci] = cluster_counts.get(cluster_ci, 0) + 1

    # Calculate needs for each tenant type
    for cluster_ci, tenant_schedules in tenant_groups.items():
        tenant_count = len(tenant_schedules)
        clusters_in_csv = cluster_counts.get(cluster_ci, 0)

        # Try to get capacity from pool
        # Use first tenant schedule to query capacity
        first_tenant = tenant_schedules[0]
        capacity = check_cluster_capacity(first_tenant.ci, first_tenant.namespace)

        if capacity:
            capacity_per_cluster = capacity.max_placements_per_cluster
        else:
            # Fallback if can't query pool (assume conservative 20)
            capacity_per_cluster = 20
            logger.warning(f"Could not query capacity for {cluster_ci}, assuming {capacity_per_cluster} per cluster")

        clusters_needed = math.ceil(tenant_count / capacity_per_cluster)
        deficit = max(0, clusters_needed - clusters_in_csv)
        total_deficit += deficit

        needs.append({
            "cluster_ci": cluster_ci,
            "tenant_ci_example": first_tenant.ci,
            "tenant_count": tenant_count,
            "capacity_per_cluster": capacity_per_cluster,
            "clusters_needed": clusters_needed,
            "clusters_in_csv": clusters_in_csv,
            "deficit": deficit,
            "pool_available": capacity.available_clusters if capacity else None,
        })

    return {
        "needs": needs,
        "total_tenant_count": total_tenant_count,
        "total_deficit": total_deficit
    }


def _list_tenant_cluster_pools() -> set[str]:
    """
    Return the set of TenantClusterPool names that exist (cluster-wide).

    Pools are named exactly after their cluster CI, e.g.
    ``ai-quickstarts.ai-qs-rag-cluster.event``. Pools live in the
    ``shared-clusters`` namespace. Fails safe to an empty set so a missing
    pool CRD / permission issue never blocks the deploy.
    """
    import json
    import subprocess

    try:
        result = subprocess.run(
            "oc get tenantclusterpools -A -o json",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return set()
        data = json.loads(result.stdout)
        return {
            item.get("metadata", {}).get("name", "")
            for item in data.get("items", [])
            if item.get("metadata", {}).get("name")
        }
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception):
        return set()


def check_tenant_cluster_references(schedules: list[Any]) -> dict[str, Any]:
    """
    Check that each tenant workshop can actually land on a cluster.

    A tenant workshop needs somewhere to run. There are two valid ways:
      1. Modern path: the live CatalogItem links the tenant to a cluster via
         ``spec.sandboxes[].tenantCluster.componentName`` AND a matching
         TenantClusterPool exists (with ready clusters).
      2. Classic path: a ``-cluster`` provisioner is deployed in the same
         batch (CSV cluster row) so the tenant lands on that fresh cluster
         via its ``cloudSelector``.

    This function queries the LIVE catalog (not the agnosticv source) because
    that is what babylon actually deploys from. The live field names are
    camelCase (``tenantCluster.componentName``) — agnosticv's snake_case
    ``tenant_cluster.item`` is converted on sync.

    Returns a dict with tiered results:
      - ready:        tenant has a live tenantCluster ref AND a pool exists
      - ref_no_pool:  tenant has a ref but no TenantClusterPool exists yet
      - missing_refs: tenant has no tenantCluster ref in the live catalog
      - has_cluster_row: subset of the above that is covered by a cluster row
                         in this same CSV batch (classic path — will still work)
      - total_tenant_count / checked
    """
    import json
    import subprocess

    tenant_schedules = [s for s in schedules if s.is_tenant]
    if not tenant_schedules:
        return {
            "missing_refs": [], "ref_no_pool": [], "ready": [],
            "total_tenant_count": 0, "checked": True,
        }

    # Catalog namespace resolver + cluster-row set from THIS batch (classic path).
    try:
        from rhdp_flow import get_catalog_namespace, is_cluster_ci
    except Exception:
        get_catalog_namespace = None
        is_cluster_ci = None

    existing_pools = _list_tenant_cluster_pools()

    # CIs of any cluster provisioner rows present in this batch, so we can tell
    # the user "you already deploy the cluster, so this will still work".
    batch_cluster_cis = set()
    for s in schedules:
        if getattr(s, "is_cluster", False) or (is_cluster_ci and is_cluster_ci(s.ci)):
            batch_cluster_cis.add(s.ci)

    missing_refs: list[dict[str, Any]] = []
    ref_no_pool: list[dict[str, Any]] = []
    ready: list[dict[str, Any]] = []
    checked_any = False

    for schedule in tenant_schedules:
        # Resolve the catalog namespace — catalog items live in
        # babylon-catalog-{event,prod,dev}, NOT the deploy target namespace.
        if get_catalog_namespace:
            catalog_ns = get_catalog_namespace(schedule.ci, getattr(schedule, "catalog_namespace", ""))
        else:
            catalog_ns = getattr(schedule, "catalog_namespace", "") or "babylon-catalog-prod"

        try:
            result = subprocess.run(
                f"oc get catalogitem {schedule.ci} -n {catalog_ns} -o json",
                shell=True, capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                # Couldn't query this item; don't guess — skip it.
                continue
            checked_any = True
            catalog_item = json.loads(result.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception):
            continue

        spec = catalog_item.get("spec", {})
        # Live path is spec.sandboxes; fall back to raw __meta__ just in case.
        sandboxes = spec.get("sandboxes") or spec.get("__meta__", {}).get("sandboxes", [])

        cluster_ref = None
        for sandbox in sandboxes:
            if sandbox.get("kind") != "OcpSandbox":
                continue
            # Live (synced) uses camelCase tenantCluster.componentName; raw
            # agnosticv uses snake_case tenant_cluster.item — accept either.
            tc = sandbox.get("tenantCluster") or sandbox.get("tenant_cluster")
            if tc:
                cluster_ref = tc.get("componentName") or tc.get("item")
                break

        # Naming-convention fallback for pool/cluster-row matching when no ref.
        detected = getattr(schedule, "detected_cluster_ci", None)
        cluster_target = cluster_ref or detected

        # Is this tenant already covered by a cluster row in the same batch?
        covered_by_row = bool(cluster_target and cluster_target in batch_cluster_cis)
        # Does a pool exist for the referenced/derived cluster?
        pool_exists = bool(cluster_target and cluster_target in existing_pools)

        record = {
            "ci": schedule.ci,
            "namespace": catalog_ns,
            "cluster_ref": cluster_ref or "",
            "cluster_ci_from_csv": detected or "none",
            "workshop_name": schedule.ci_name,
            "pool_exists": pool_exists,
            "has_cluster_row": covered_by_row,
        }

        if not cluster_ref:
            missing_refs.append(record)
        elif not pool_exists:
            ref_no_pool.append(record)
        else:
            ready.append(record)

    return {
        "missing_refs": missing_refs,
        "ref_no_pool": ref_no_pool,
        "ready": ready,
        "total_tenant_count": len(tenant_schedules),
        "checked": checked_any,
    }
