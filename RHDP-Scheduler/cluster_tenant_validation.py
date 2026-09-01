"""Cluster-tenant validation utilities for RHDP-Flow."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger("rhdp_flow.cluster_tenant_validation")


def validate_cluster_before_tenant(schedules: list[Any]) -> dict[str, Any]:
    """
    Validate that cluster catalog items are deployed before tenant catalog items.

    Checks schedules to ensure that if a tenant variant exists (e.g., workshop.prod-tenant),
    the cluster variant (workshop.prod) is scheduled earlier or at the same time.

    Args:
        schedules: List of WorkshopSchedule objects to validate

    Returns:
        Dict with:
        - errors: List of validation errors (tenant scheduled before cluster)
        - warnings: List of validation warnings (tenant without cluster)
        - tenants_checked: Number of tenant catalog items checked
        - clusters_found: Number of matching cluster catalog items found
    """
    errors = []
    warnings = []
    tenants_checked = 0
    clusters_found = 0

    # Group schedules by catalog item base name
    cluster_items = {}  # base_ci -> schedule
    tenant_items = {}   # base_ci -> schedule

    for schedule in schedules:
        ci = schedule.ci

        # Check if this is a tenant variant
        if ci.endswith("-tenant"):
            base_ci = ci[:-len("-tenant")]
            tenant_items[base_ci] = schedule
            tenants_checked += 1
        # Check if this is a cluster variant (could be base or explicit -cluster)
        elif ci.endswith("-cluster"):
            base_ci = ci[:-len("-cluster")]
            cluster_items[base_ci] = schedule
        else:
            # Base catalog item (no suffix) counts as cluster
            cluster_items[ci] = schedule

    # Validate tenant items have corresponding cluster items
    for base_ci, tenant_schedule in tenant_items.items():
        if base_ci in cluster_items:
            clusters_found += 1
            cluster_schedule = cluster_items[base_ci]

            # Parse provisioning dates
            try:
                tenant_date = datetime.strptime(tenant_schedule.provisioning_date, "%d/%m/%Y %H:%M")
                cluster_date = datetime.strptime(cluster_schedule.provisioning_date, "%d/%m/%Y %H:%M")

                # Error if tenant is scheduled before cluster
                if tenant_date < cluster_date:
                    errors.append({
                        "ci_name": tenant_schedule.ci_name,
                        "tenant_ci": tenant_schedule.ci,
                        "cluster_ci": cluster_schedule.ci,
                        "tenant_date": tenant_schedule.provisioning_date,
                        "cluster_date": cluster_schedule.provisioning_date,
                        "namespace": tenant_schedule.namespace,
                        "message": f"Tenant variant '{tenant_schedule.ci}' is scheduled before cluster variant '{cluster_schedule.ci}'. Deploy cluster first.",
                    })
            except ValueError as e:
                logger.warning(f"Error parsing dates for {base_ci}: {e}")
        else:
            # Warning if tenant has no cluster
            warnings.append({
                "ci_name": tenant_schedule.ci_name,
                "tenant_ci": tenant_schedule.ci,
                "namespace": tenant_schedule.namespace,
                "message": f"Tenant variant '{tenant_schedule.ci}' has no corresponding cluster variant '{base_ci}' scheduled.",
            })

    return {
        "errors": errors,
        "warnings": warnings,
        "tenants_checked": tenants_checked,
        "clusters_found": clusters_found,
    }


def auto_fix_cluster_tenant_timing(schedules: list[Any], buffer_minutes: int = 30) -> dict[str, Any]:
    """
    Auto-fix cluster/tenant timing conflicts by adjusting cluster deploy times.

    When a tenant variant is scheduled before its cluster variant, this function
    automatically adjusts the cluster's provisioning date to be `buffer_minutes`
    before the tenant's provisioning date.

    Args:
        schedules: List of WorkshopSchedule objects to fix
        buffer_minutes: Minutes buffer between cluster and tenant deploy (default: 30)

    Returns:
        Dict with:
        - fixed_count: Number of cluster schedules adjusted
        - fixed_items: List of {ci_name, cluster_ci, tenant_ci, old_date, new_date}
        - schedules: Updated list of schedules with fixes applied
    """
    fixed_items = []

    # Group schedules by catalog item base name
    cluster_items = {}  # base_ci -> schedule
    tenant_items = {}   # base_ci -> schedule

    for schedule in schedules:
        ci = schedule.ci

        if ci.endswith("-tenant"):
            base_ci = ci[:-len("-tenant")]
            tenant_items[base_ci] = schedule
        elif ci.endswith("-cluster"):
            base_ci = ci[:-len("-cluster")]
            cluster_items[base_ci] = schedule
        else:
            # Base catalog item (no suffix) counts as cluster
            cluster_items[ci] = schedule

    # Fix timing conflicts
    for base_ci, tenant_schedule in tenant_items.items():
        if base_ci in cluster_items:
            cluster_schedule = cluster_items[base_ci]

            try:
                tenant_date = datetime.strptime(tenant_schedule.provisioning_date, "%d/%m/%Y %H:%M")
                cluster_date = datetime.strptime(cluster_schedule.provisioning_date, "%d/%m/%Y %H:%M")

                # Fix if tenant is scheduled before cluster
                if tenant_date < cluster_date:
                    # Set cluster to be buffer_minutes before tenant
                    new_cluster_date = tenant_date - timedelta(minutes=buffer_minutes)
                    old_date_str = cluster_schedule.provisioning_date
                    new_date_str = new_cluster_date.strftime("%d/%m/%Y %H:%M")

                    cluster_schedule.provisioning_date = new_date_str

                    fixed_items.append({
                        "ci_name": cluster_schedule.ci_name,
                        "cluster_ci": cluster_schedule.ci,
                        "tenant_ci": tenant_schedule.ci,
                        "old_date": old_date_str,
                        "new_date": new_date_str,
                        "namespace": cluster_schedule.namespace,
                    })
            except ValueError as e:
                logger.warning(f"Error parsing dates for {base_ci} during auto-fix: {e}")

    return {
        "fixed_count": len(fixed_items),
        "fixed_items": fixed_items,
        "schedules": schedules,
    }
