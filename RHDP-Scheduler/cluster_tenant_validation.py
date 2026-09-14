"""Cluster-tenant timing auto-fix utility for RHDP-Flow.

Cluster/tenant *validation* now lives in ``rhdp_flow`` (see
``validate_cluster_before_tenant`` / ``analyze_cluster_tenant_relationships``).
This module retains only the timing auto-fix helper, which shifts cluster
provisioning earlier than the tenants that depend on it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger("rhdp_flow.cluster_tenant_validation")


def auto_fix_cluster_tenant_timing(schedules: list[Any], buffer_minutes: int = 180) -> dict[str, Any]:
    """
    Auto-fix cluster/tenant timing by ensuring clusters deploy BEFORE tenants.

    Automatically adjusts cluster provisioning times to be `buffer_minutes` before
    their associated tenant deployments. Ensures cluster infrastructure is ready
    before tenant workloads deploy.

    Pool-aware: Skips clusters that will be provided by TenantClusterPools
    (detected via pool_name or auto-detection).

    Args:
        schedules: List of WorkshopSchedule objects to fix
        buffer_minutes: Lead time for cluster before tenant (default: 180 = 3 hours)

    Returns:
        Dict with:
        - fixed_count: Number of cluster schedules adjusted
        - skipped_count: Number of pool-provided clusters skipped
        - fixed_items: List of adjusted clusters with old/new dates
        - skipped_items: List of pool-provided clusters not adjusted
        - warnings: List of warnings about adjustments
        - schedules: Updated list of schedules with fixes applied
    """
    fixed_items = []
    skipped_items = []
    warnings = []

    # Check if pool linkage is available
    try:
        from tenant_cluster_pool_linkage import find_matching_pool, is_tenant_catalog_item
        pool_detection_available = True
    except ImportError:
        pool_detection_available = False
        logger.debug("Pool detection unavailable - will adjust all clusters")

    # Use new detection from rhdp_flow if available
    # Build map of detected relationships
    cluster_for_tenant = {}  # tenant_ci -> cluster_schedule
    tenant_for_cluster = {}  # cluster_ci -> tenant_schedule

    for schedule in schedules:
        if schedule.is_tenant and schedule.detected_cluster_ci:
            # Find the cluster schedule
            for cluster_sched in schedules:
                if cluster_sched.is_cluster and cluster_sched.ci == schedule.detected_cluster_ci:
                    cluster_for_tenant[schedule.ci] = cluster_sched
                    tenant_for_cluster[cluster_sched.ci] = schedule
                    break

    # Adjust cluster timing for each tenant
    for tenant_ci, cluster_schedule in cluster_for_tenant.items():
        tenant_schedule = tenant_for_cluster.get(cluster_schedule.ci)
        if not tenant_schedule:
            continue

        # Check if this tenant will use a pool (skip cluster adjustment)
        skip_cluster = False
        skip_reason = None

        if pool_detection_available:
            # Manual pool override
            if tenant_schedule.pool_name and tenant_schedule.pool_name.lower() != "none":
                skip_cluster = True
                skip_reason = f"manual pool: {tenant_schedule.pool_name}"
            # Auto-detected pool
            elif is_tenant_catalog_item(tenant_schedule.ci):
                try:
                    pool_match = find_matching_pool(tenant_schedule.ci, tenant_schedule.namespace)
                    if pool_match:
                        skip_cluster = True
                        skip_reason = f"auto-detected pool: {pool_match.pool_name}"
                except Exception as e:
                    logger.debug(f"Pool detection failed for {tenant_schedule.ci}: {e}")

        if skip_cluster:
            skipped_items.append({
                "cluster_ci": cluster_schedule.ci,
                "tenant_ci": tenant_schedule.ci,
                "reason": skip_reason,
                "message": f"Skipping cluster '{cluster_schedule.ci}' - tenant uses {skip_reason}"
            })
            warnings.append(
                f"ℹ️ Cluster '{cluster_schedule.ci_name}' timing not adjusted - "
                f"tenant '{tenant_schedule.ci_name}' uses {skip_reason}"
            )
            continue

        # Parse dates and adjust cluster timing
        try:
            tenant_date = datetime.strptime(tenant_schedule.provisioning_date, "%d/%m/%Y %H:%M")
            cluster_date = datetime.strptime(cluster_schedule.provisioning_date, "%d/%m/%Y %H:%M")

            # Always ensure cluster is buffer_minutes BEFORE tenant
            ideal_cluster_date = tenant_date - timedelta(minutes=buffer_minutes)

            # Only adjust if cluster is too late or at same time as tenant
            time_diff = (tenant_date - cluster_date).total_seconds() / 60  # minutes

            if time_diff < buffer_minutes:
                old_date_str = cluster_schedule.provisioning_date
                new_date_str = ideal_cluster_date.strftime("%d/%m/%Y %H:%M")

                cluster_schedule.provisioning_date = new_date_str

                hours_early = buffer_minutes / 60
                fixed_items.append({
                    "ci_name": cluster_schedule.ci_name,
                    "cluster_ci": cluster_schedule.ci,
                    "tenant_ci": tenant_schedule.ci,
                    "old_date": old_date_str,
                    "new_date": new_date_str,
                    "buffer_hours": hours_early,
                    "namespace": cluster_schedule.namespace,
                })

                warnings.append(
                    f"⚙️ Adjusted cluster '{cluster_schedule.ci_name}': "
                    f"{old_date_str} → {new_date_str} "
                    f"({hours_early:.1f}h before tenant '{tenant_schedule.ci_name}')"
                )
        except ValueError as e:
            logger.warning(f"Error parsing dates for {cluster_schedule.ci} during auto-fix: {e}")

    return {
        "fixed_count": len(fixed_items),
        "skipped_count": len(skipped_items),
        "fixed_items": fixed_items,
        "skipped_items": skipped_items,
        "warnings": warnings,
        "schedules": schedules,
        "message": (
            f"Adjusted {len(fixed_items)} cluster(s) to deploy {buffer_minutes/60:.1f}h before tenants. "
            f"Skipped {len(skipped_items)} pool-provided cluster(s)."
        )
    }
