"""TenantClusterPool linkage for RHDP-Flow.

Auto-detects which TenantClusterPool a catalog item should link to,
and adds the appropriate Babylon labels for pool placement.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger("rhdp_flow.tenant_cluster_pool_linkage")


@dataclass
class PoolMatch:
    """Represents a matched TenantClusterPool for a catalog item."""
    pool_name: str
    pool_namespace: str
    catalog_item_base: str
    environment: str
    confidence: str  # "high", "medium", "low"


def is_tenant_catalog_item(ci: str) -> bool:
    """Check if catalog item is a tenant variant (deploys to existing cluster).

    Patterns:
        - workshop.prod-tenant (ends with -tenant)
        - workshop-tenant.dev (has -tenant. before environment)
        - workshop.tenant.prod (has .tenant. infix)
    """
    return ci.endswith("-tenant") or "-tenant." in ci or ".tenant." in ci


def get_catalog_item_base(ci: str) -> str:
    """
    Extract base catalog item name from a tenant variant.

    Examples:
        openshift-virt.prod-tenant -> openshift-virt.prod
        agd-v2.ocp4-getting-started-module-1-tenant.dev -> agd-v2.ocp4-getting-started-module-1.dev
        ai-quickstarts.ai-qs-rag-tenant.prod -> ai-quickstarts.ai-qs-rag.prod
    """
    # First check for -tenant suffix before the environment
    # Pattern: {name}-tenant.{env} -> {name}.{env}
    if "-tenant." in ci:
        return ci.replace("-tenant.", ".")

    # Then check for -tenant at the end
    if ci.endswith("-tenant"):
        return ci[:-len("-tenant")]

    # Handle .tenant. in the middle (e.g., catalog.tenant.dev)
    if ".tenant." in ci:
        return ci.replace(".tenant.", ".")

    return ci


def find_matching_pool(catalog_item: str, namespace: str = None) -> PoolMatch | None:
    """
    Find the best matching TenantClusterPool for a catalog item.

    Args:
        catalog_item: Catalog item name (e.g., "agd-v2.ocp4-getting-started-module-1-tenant.dev")
        namespace: Optional namespace hint

    Returns:
        PoolMatch if found, None otherwise

    Strategy:
        1. Extract base catalog item (remove -tenant suffix)
        2. Query TenantClusterPools from cluster
        3. Match by naming convention: {catalog-item-base}-cluster.{environment}
        4. If multiple matches, prefer pools with available capacity
    """
    if not is_tenant_catalog_item(catalog_item):
        logger.debug(f"Skipping pool matching for non-tenant catalog item: {catalog_item}")
        return None

    base_ci = get_catalog_item_base(catalog_item)
    logger.debug(f"Finding pool for catalog item {catalog_item} (base: {base_ci})")

    try:
        # Import kubernetes client only when needed
        try:
            from kubernetes import client, config
        except ImportError:
            logger.warning("kubernetes client not installed - skipping pool matching")
            return None

        # Try to load kube config
        try:
            config.load_incluster_config()
        except config.ConfigException:
            try:
                config.load_kube_config()
            except config.ConfigException:
                logger.warning("Could not load kubernetes config - skipping pool matching")
                return None

        # Query TenantClusterPools
        api = client.CustomObjectsApi()

        try:
            pools = api.list_cluster_custom_object(
                group="babylon.gpte.redhat.com",
                version="v1",
                plural="tenantclusterpools"
            )
        except client.exceptions.ApiException as e:
            if e.status == 404:
                logger.debug("TenantClusterPool CRD not found")
            else:
                logger.warning(f"Error querying TenantClusterPools: {e}")
            return None

        # Match pools by naming convention
        # Pool names follow pattern: {catalog-base}-cluster.{environment}
        # Example: agd-v2.ocp4-getting-started-cluster.dev

        matches = []
        for pool in pools.get("items", []):
            pool_name = pool.get("metadata", {}).get("name", "")
            pool_namespace = pool.get("metadata", {}).get("namespace", "shared-clusters")

            # Try exact match: base_ci contains the pool base
            # e.g., agd-v2.ocp4-getting-started-module-1.dev matches agd-v2.ocp4-getting-started-cluster.dev
            if base_ci in pool_name or pool_name.replace("-cluster", "") in base_ci:
                spec = pool.get("spec", {})
                status = pool.get("status", {})
                clusters = status.get("clusters", [])

                # Check if pool has capacity
                available = sum(1 for c in clusters if c.get("sandboxApiState") == "available")
                total = len(clusters)

                confidence = "high" if base_ci in pool_name else "medium"

                matches.append({
                    "pool_name": pool_name,
                    "pool_namespace": pool_namespace,
                    "catalog_item_base": base_ci,
                    "environment": pool_name.split(".")[-1] if "." in pool_name else "unknown",
                    "confidence": confidence,
                    "available_clusters": available,
                    "total_clusters": total
                })

        if not matches:
            logger.debug(f"No matching TenantClusterPool found for {catalog_item}")
            return None

        # Prefer pools with available capacity, then by confidence
        matches.sort(key=lambda m: (
            m["confidence"] == "high",
            m["available_clusters"] > 0,
            m["available_clusters"]
        ), reverse=True)

        best_match = matches[0]
        logger.info(
            f"Matched {catalog_item} to pool {best_match['pool_name']} "
            f"({best_match['available_clusters']}/{best_match['total_clusters']} clusters available, "
            f"confidence: {best_match['confidence']})"
        )

        return PoolMatch(
            pool_name=best_match["pool_name"],
            pool_namespace=best_match["pool_namespace"],
            catalog_item_base=best_match["catalog_item_base"],
            environment=best_match["environment"],
            confidence=best_match["confidence"]
        )

    except Exception as e:
        # Graceful failure - don't block deployments if pool matching fails
        logger.warning(f"Pool matching failed (non-blocking): {e}")
        return None


def add_pool_linkage_to_payload(payload: dict, catalog_item: str, namespace: str = None, pool_name_override: str = None) -> dict:
    """
    Add TenantClusterPool linkage labels to a ResourceClaim payload if appropriate.

    Args:
        payload: ResourceClaim payload dict
        catalog_item: Catalog item name
        namespace: Optional namespace hint
        pool_name_override: Manual pool name from CSV (skips auto-detection)

    Returns:
        Modified payload with pool linkage labels added (if applicable)
    """
    # If manual pool override specified, use it directly
    if pool_name_override:
        payload["metadata"]["labels"]["babylon.gpte.redhat.com/tenant-cluster-pool"] = pool_name_override
        payload["metadata"]["annotations"]["babylon.gpte.redhat.com/tenant-cluster-pool"] = (
            f'{{"name":"{pool_name_override}","role":"tenant"}}'
        )
        payload["metadata"]["labels"]["rhdp-flow.gpte.redhat.com/pool-matched"] = "manual"
        logger.info(f"Added manual pool linkage: {catalog_item} -> {pool_name_override}")
        return payload

    # Auto-detect pool
    pool_match = find_matching_pool(catalog_item, namespace)

    if pool_match:
        # Add Babylon's linkage label
        payload["metadata"]["labels"]["babylon.gpte.redhat.com/tenant-cluster-pool"] = pool_match.pool_name

        # Add annotation with role metadata (matching Babylon's pattern)
        payload["metadata"]["annotations"]["babylon.gpte.redhat.com/tenant-cluster-pool"] = (
            f'{{"name":"{pool_match.pool_name}","role":"tenant"}}'
        )

        # Add Flow tracking labels
        payload["metadata"]["labels"]["rhdp-flow.gpte.redhat.com/pool-matched"] = "true"
        payload["metadata"]["labels"]["rhdp-flow.gpte.redhat.com/pool-confidence"] = pool_match.confidence

        logger.info(f"Added pool linkage: {catalog_item} -> {pool_match.pool_name}")
    else:
        logger.debug(f"No pool linkage added for {catalog_item}")

    return payload
