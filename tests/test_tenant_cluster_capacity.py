"""Tests for tenant cluster capacity checking."""

import json
from unittest.mock import MagicMock, patch

from lib.tenant_cluster_capacity import check_tenant_cluster_references


def test_check_refs_ready_tier(make_tenant_schedule, mock_pool_list_with_ready_pool):
    """Tenant with tenantCluster ref + ready pool appears in 'ready' tier."""
    tenant = make_tenant_schedule(ci="workshop.prod-tenant")
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
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
        result = check_tenant_cluster_references(schedules)

    assert len(result["ready"]) == 1
    assert len(result["ref_no_pool"]) == 0
    assert len(result["missing_refs"]) == 0
    assert result["ready"][0]["ci"] == "workshop.prod-tenant"
    assert result["ready"][0]["cluster_ref"] == "ocp4-cluster"
    assert result["ready"][0]["pool_exists"] is True


def test_check_refs_ref_no_pool_tier(make_tenant_schedule, mock_pool_list_empty):
    """Tenant with tenantCluster ref but no pool appears in 'ref_no_pool' tier."""
    tenant = make_tenant_schedule(ci="workshop.prod-tenant")
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
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
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        result = check_tenant_cluster_references(schedules)

    assert len(result["ready"]) == 0
    assert len(result["ref_no_pool"]) == 1
    assert len(result["missing_refs"]) == 0
    assert result["ref_no_pool"][0]["ci"] == "workshop.prod-tenant"
    assert result["ref_no_pool"][0]["pool_exists"] is False


def test_check_refs_missing_refs_tier(make_tenant_schedule, mock_pool_list_empty):
    """Tenant with no tenantCluster ref appears in 'missing_refs' tier."""
    tenant = make_tenant_schedule(ci="workshop.prod-tenant")
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
        def dispatcher(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", "")
            if "catalogitem" in str(cmd):
                # No tenantCluster in sandboxes
                catalog_item = {
                    "spec": {"sandboxes": [{"kind": "OcpSandbox"}]}
                }
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps(catalog_item),
                    stderr="",
                )
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        result = check_tenant_cluster_references(schedules)

    assert len(result["ready"]) == 0
    assert len(result["ref_no_pool"]) == 0
    assert len(result["missing_refs"]) == 1
    assert result["missing_refs"][0]["ci"] == "workshop.prod-tenant"
    assert result["missing_refs"][0]["cluster_ref"] == ""


def test_check_refs_detects_cluster_row_in_batch(
    make_tenant_schedule,
    make_cluster_schedule,
    mock_pool_list_empty,
):
    """has_cluster_row=True when matching cluster row exists in batch."""
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
                catalog_item = {
                    "spec": {"sandboxes": [{"kind": "OcpSandbox"}]}
                }
                return MagicMock(
                    returncode=0,
                    stdout=json.dumps(catalog_item),
                    stderr="",
                )
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        result = check_tenant_cluster_references(schedules)

    assert len(result["missing_refs"]) == 1
    record = result["missing_refs"][0]
    assert record["has_cluster_row"] is True
    assert record["cluster_ci_from_csv"] == "ocp4-cluster.prod"


def test_check_refs_no_cluster_row_in_batch(
    make_tenant_schedule,
    mock_pool_list_empty,
):
    """has_cluster_row=False when no matching cluster row in batch."""
    tenant = make_tenant_schedule(
        ci="workshop.prod-tenant",
        detected_cluster_ci="ocp4-cluster.prod",
    )
    schedules = [tenant]

    with patch("subprocess.run") as mock_run:
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
            if "tenantclusterpool" in str(cmd):
                return MagicMock(**mock_pool_list_empty)
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = dispatcher
        result = check_tenant_cluster_references(schedules)

    assert len(result["missing_refs"]) == 1
    record = result["missing_refs"][0]
    assert record["has_cluster_row"] is False
