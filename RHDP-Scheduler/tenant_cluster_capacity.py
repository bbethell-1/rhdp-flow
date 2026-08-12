"""Tenant cluster capacity checking for RHDP-Flow.

Provides read-only capacity warnings for workshops deploying to existing tenant clusters.
Only applies to catalog items ending in -tenant (existing clusters).
Fresh cluster deployments are skipped.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

logger = logging.getLogger("rhdp_flow.tenant_cluster_capacity")


@dataclass
class ClusterCapacity:
    """Cluster capacity information."""
    cluster_name: str
    total_clusters: int
    available_clusters: int
    utilization_percent: int

    @property
    def status(self) -> str:
        """Return status: healthy, warning, or critical."""
        if self.utilization_percent >= 90:
            return "critical"
        elif self.utilization_percent >= 70:
            return "warning"
        return "healthy"

    @property
    def message(self) -> str:
        """Return human-readable message."""
        if self.status == "critical":
            return f"❌ Cluster {self.cluster_name} is at {self.utilization_percent}% capacity - deployment likely to fail"
        elif self.status == "warning":
            return f"⚠️  Warning: Cluster {self.cluster_name} is at {self.utilization_percent}% capacity - may be slow"
        return f"✓ Cluster {self.cluster_name} has capacity ({self.utilization_percent}% utilized)"


def is_tenant_catalog_item(ci: str) -> bool:
    """Check if catalog item is a tenant variant (deploys to existing cluster)."""
    return ci.endswith("-tenant")


def check_cluster_capacity(catalog_item: str, namespace: str = None) -> Optional[ClusterCapacity]:
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
            status = pool.get("status", {})
            clusters = status.get("clusters", [])

            if not clusters:
                continue

            total = len(clusters)
            available = sum(1 for c in clusters if c.get("sandboxApiState") == "available")
            utilized = total - available
            utilization_percent = int((utilized / total) * 100) if total > 0 else 0

            logger.info(f"Found tenant cluster pool {pool_name}: {available}/{total} available ({utilization_percent}% utilized)")

            return ClusterCapacity(
                cluster_name=pool_name,
                total_clusters=total,
                available_clusters=available,
                utilization_percent=utilization_percent
            )

        logger.debug(f"No tenant cluster pools found for {catalog_item}")
        return None

    except Exception as e:
        # Graceful failure - don't block deployments if capacity check fails
        logger.warning(f"Cluster capacity check failed (non-blocking): {e}")
        return None


def check_schedules_capacity(schedules: List[Any], ignore_warnings: bool = False) -> Dict[str, Any]:
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
                    "utilization": capacity.utilization_percent
                })
            elif capacity.status == "warning":
                warnings.append({
                    "ci_name": schedule.ci_name,
                    "ci": ci,
                    "message": capacity.message,
                    "utilization": capacity.utilization_percent
                })

    return {
        "warnings": warnings,
        "errors": errors,
        "checked_count": checked_count,
        "capacity_info": capacity_info
    }
