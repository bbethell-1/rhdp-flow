"""Tests for cluster-tenant validation logic."""

from __future__ import annotations

from datetime import datetime, timedelta

from cluster_tenant_validation import validate_cluster_before_tenant
from rhdp_flow import WorkshopSchedule


def make_schedule(ci: str, ci_name: str = None, provisioning_date: str = None, namespace: str = "test-ns") -> WorkshopSchedule:
    """Create a test schedule."""
    if ci_name is None:
        ci_name = f"Test {ci}"
    if provisioning_date is None:
        provisioning_date = datetime.now().strftime("%d/%m/%Y %H:%M")

    return WorkshopSchedule(
        ci_name=ci_name,
        ci=ci,
        namespace=namespace,
        users=10,
        enable_workshop_interface=True,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="test-workshop",
        provisioning_date=provisioning_date,
        auto_stop=(datetime.now() + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M"),
        auto_destroy=(datetime.now() + timedelta(days=1)).strftime("%d/%m/%Y %H:%M"),
    )


def test_no_tenant_items():
    """No tenant items → no errors or warnings."""
    schedules = [
        make_schedule("workshop.prod"),
        make_schedule("another.prod"),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert result["errors"] == []
    assert result["warnings"] == []
    assert result["tenants_checked"] == 0
    assert result["clusters_found"] == 0


def test_tenant_without_cluster():
    """Tenant variant without corresponding cluster → warning."""
    schedules = [
        make_schedule("workshop.prod-tenant", "Tenant Workshop"),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert len(result["errors"]) == 0
    assert len(result["warnings"]) == 1
    assert result["warnings"][0]["tenant_ci"] == "workshop.prod-tenant"
    assert "workshop.prod" in result["warnings"][0]["message"]
    assert result["tenants_checked"] == 1
    assert result["clusters_found"] == 0


def test_cluster_before_tenant_valid():
    """Cluster scheduled before tenant → no errors."""
    base_time = datetime.now()
    cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
    tenant_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")

    schedules = [
        make_schedule("workshop.prod", "Cluster Workshop", cluster_time),
        make_schedule("workshop.prod-tenant", "Tenant Workshop", tenant_time),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert len(result["errors"]) == 0
    assert len(result["warnings"]) == 0
    assert result["tenants_checked"] == 1
    assert result["clusters_found"] == 1


def test_cluster_same_time_as_tenant_valid():
    """Cluster and tenant at same time → no errors."""
    same_time = datetime.now().strftime("%d/%m/%Y %H:%M")

    schedules = [
        make_schedule("workshop.prod", "Cluster Workshop", same_time),
        make_schedule("workshop.prod-tenant", "Tenant Workshop", same_time),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert len(result["errors"]) == 0
    assert len(result["warnings"]) == 0
    assert result["tenants_checked"] == 1
    assert result["clusters_found"] == 1


def test_tenant_before_cluster_error():
    """Tenant scheduled before cluster → error."""
    base_time = datetime.now()
    tenant_time = base_time.strftime("%d/%m/%Y %H:%M")
    cluster_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")

    schedules = [
        make_schedule("workshop.prod", "Cluster Workshop", cluster_time),
        make_schedule("workshop.prod-tenant", "Tenant Workshop", tenant_time),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert len(result["errors"]) == 1
    assert len(result["warnings"]) == 0
    assert result["errors"][0]["tenant_ci"] == "workshop.prod-tenant"
    assert result["errors"][0]["cluster_ci"] == "workshop.prod"
    assert "Deploy cluster first" in result["errors"][0]["message"]
    assert result["tenants_checked"] == 1
    assert result["clusters_found"] == 1


def test_explicit_cluster_suffix():
    """Test with explicit -cluster suffix."""
    base_time = datetime.now()
    cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
    tenant_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")

    schedules = [
        make_schedule("workshop.prod-cluster", "Cluster Workshop", cluster_time),
        make_schedule("workshop.prod-tenant", "Tenant Workshop", tenant_time),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert len(result["errors"]) == 0
    assert len(result["warnings"]) == 0
    assert result["tenants_checked"] == 1
    assert result["clusters_found"] == 1


def test_multiple_tenant_variants():
    """Multiple tenant items with different validation results."""
    base_time = datetime.now()

    schedules = [
        # Valid: cluster before tenant
        make_schedule("workshop1.prod", "Workshop 1 Cluster", base_time.strftime("%d/%m/%Y %H:%M")),
        make_schedule("workshop1.prod-tenant", "Workshop 1 Tenant", (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")),
        # Error: tenant before cluster
        make_schedule("workshop2.prod", "Workshop 2 Cluster", (base_time + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M")),
        make_schedule("workshop2.prod-tenant", "Workshop 2 Tenant", base_time.strftime("%d/%m/%Y %H:%M")),
        # Warning: tenant without cluster
        make_schedule("workshop3.prod-tenant", "Workshop 3 Tenant", base_time.strftime("%d/%m/%Y %H:%M")),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert len(result["errors"]) == 1
    assert len(result["warnings"]) == 1
    assert result["errors"][0]["tenant_ci"] == "workshop2.prod-tenant"
    assert result["warnings"][0]["tenant_ci"] == "workshop3.prod-tenant"
    assert result["tenants_checked"] == 3
    assert result["clusters_found"] == 2


def test_non_tenant_suffix_ignored():
    """Items with other suffixes (e.g., -slfsrv) are not treated as tenant."""
    schedules = [
        make_schedule("workshop.prod-slfsrv", "Self-Service Workshop"),
    ]

    result = validate_cluster_before_tenant(schedules)

    assert result["errors"] == []
    assert result["warnings"] == []
    assert result["tenants_checked"] == 0
    assert result["clusters_found"] == 0
