"""Tests for auto-provision cluster functions."""

import json
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from rhdp_flow import WorkshopSchedule, auto_provision_missing_clusters


def test_auto_provision_adds_cluster_for_missing_ref_tenant(
    make_tenant_schedule,
    mock_pool_list_empty,
):
    """Auto-provision adds cluster when tenant has no pool and no cluster row."""
    tenant = make_tenant_schedule(
        ci="workshop.prod-tenant",
        ci_name="Test Tenant",
        detected_cluster_ci="ocp4-cluster.prod",
    )
    schedules = [tenant]

    # Mock check_tenant_cluster_references to return missing_refs
    with patch("subprocess.run") as mock_run:
        # Mock oc get catalogitem (tenant has no tenantCluster ref)
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
                catalog_item = {
                    "spec": {"sandboxes": [{"kind": "OcpSandbox"}]}
                }
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps(catalog_item),
                    stderr="",
                )
            # Mock oc get tenantclusterpool (no pools)
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher

        result = auto_provision_missing_clusters(schedules, buffer_hours=4.0)

    assert result["count"] == 1
    assert len(result["added"]) == 1
    assert result["added"][0]["tenant_ci"] == "workshop.prod-tenant"
    assert result["added"][0]["cluster_ci"] == "ocp4-cluster.prod"

    # Verify cluster was added to schedules
    assert len(schedules) == 2
    cluster = schedules[1]
    assert cluster.ci == "ocp4-cluster.prod"
    assert cluster.is_cluster is True
    assert cluster.auto_added is True
    assert "(Cluster — added by Flow)" in cluster.ci_name


def test_auto_provision_schedules_cluster_earlier(
    make_tenant_schedule,
    mock_pool_list_empty,
):
    """Auto-provisioned cluster is scheduled buffer_hours before tenant."""
    # Use a future date to ensure it's not shifted to now+30min
    tenant = make_tenant_schedule(
        ci="workshop.prod-tenant",
        provisioning_date="15/12/2027 11:00",
        detected_cluster_ci="ocp4-cluster.prod",
    )
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps({"spec": {"sandboxes": []}}),
                    stderr="",
                )
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        auto_provision_missing_clusters(schedules, buffer_hours=4.0)

    cluster = schedules[1]
    # Parse dates
    tenant_time = datetime.strptime(tenant.provisioning_date, "%d/%m/%Y %H:%M")
    cluster_time = datetime.strptime(cluster.provisioning_date, "%d/%m/%Y %H:%M")

    # Cluster should be 4 hours (240 minutes) earlier
    diff_minutes = (tenant_time - cluster_time).total_seconds() / 60
    assert diff_minutes == 240


def test_auto_provision_noop_when_pool_exists(
    make_tenant_schedule,
    mock_pool_list_with_ready_pool,
):
    """Auto-provision does nothing when tenant has a ready pool."""
    tenant = make_tenant_schedule(
        ci="workshop.prod-tenant",
        detected_cluster_ci="ocp4-cluster.prod",
    )
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
                # Tenant has tenantCluster ref matching the pool
                catalog_item = {
                    "spec": {
                        "sandboxes": [{
                            "kind": "OcpSandbox",
                            "tenantCluster": {"componentName": "ocp4-cluster"}
                        }]
                    }
                }
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps(catalog_item),
                    stderr="",
                )
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_with_ready_pool)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        result = auto_provision_missing_clusters(schedules, buffer_hours=4.0)

    assert result["count"] == 0
    assert len(result["added"]) == 0
    assert len(schedules) == 1  # No cluster added


def test_auto_provision_noop_when_cluster_row_exists(
    make_tenant_schedule,
    make_cluster_schedule,
    mock_pool_list_empty,
):
    """Auto-provision does nothing when matching cluster row already in batch."""
    cluster = make_cluster_schedule(ci="ocp4-cluster.prod")
    tenant = make_tenant_schedule(
        ci="workshop.prod-tenant",
        detected_cluster_ci="ocp4-cluster.prod",
    )
    schedules = [cluster, tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps({"spec": {"sandboxes": []}}),
                    stderr="",
                )
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        result = auto_provision_missing_clusters(schedules, buffer_hours=4.0)

    assert result["count"] == 0
    assert len(schedules) == 2  # No new cluster added


def test_auto_provision_idempotent_no_duplicates(
    make_tenant_schedule,
    mock_pool_list_empty,
):
    """Auto-provision never adds duplicate cluster CIs when called multiple times."""
    # Use cluster_ci_override to keep cluster CI constant across calls
    tenant = make_tenant_schedule(
        ci="openshift-cnv.prod-tenant",
        detected_cluster_ci=None,
        cluster_ci_override="openshift-cnv.prod-cluster",
    )
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps({"spec": {"sandboxes": []}}),
                    stderr="",
                )
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher

        # Call twice
        result1 = auto_provision_missing_clusters(schedules, buffer_hours=4.0)
        result2 = auto_provision_missing_clusters(schedules, buffer_hours=4.0)

    assert result1["count"] == 1
    assert result2["count"] == 0  # Second call adds nothing
    assert len(schedules) == 2  # Only one cluster added total
    # Verify the added cluster has the correct CI
    cluster = schedules[1]
    assert cluster.ci == "openshift-cnv.prod-cluster"
    assert cluster.is_cluster is True
