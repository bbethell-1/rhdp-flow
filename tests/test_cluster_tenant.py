"""
Comprehensive unit tests for cluster-tenant logic in RHDP-Flow.

Tests the detection, analysis, and validation of cluster-tenant relationships
in workshop deployments. Covers:
- Naming pattern detection (is_cluster_ci, is_tenant_ci)
- Cluster CI resolution for tenants (get_cluster_ci_for_tenant)
- Relationship analysis (analyze_cluster_tenant_relationships)
- Temporal validation (validate_cluster_before_tenant)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import ANY, MagicMock, patch

import pytest

from rhdp_flow import (
    RHDPConfig,
    WorkshopSchedule,
    analyze_cluster_tenant_relationships,
    get_cluster_ci_for_tenant,
    is_cluster_ci,
    is_tenant_ci,
    validate_cluster_before_tenant,
)

# ============================================================================
# Helper Functions
# ============================================================================

def make_schedule(
    ci: str,
    ci_name: str = None,
    provisioning_date: str = None,
    namespace: str = "test-ns",
    item_type: str = None,
    cluster_ci_override: str = None,
) -> WorkshopSchedule:
    """
    Create a test WorkshopSchedule.

    Args:
        ci: Catalog item identifier
        ci_name: Human-readable name (defaults to "Test {ci}")
        provisioning_date: Provisioning date (defaults to now)
        namespace: Kubernetes namespace
        item_type: Optional explicit CSV Item_Type column value
        cluster_ci_override: Optional explicit CSV Cluster_CI column value
    """
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
        item_type=item_type,
        cluster_ci_override=cluster_ci_override,
    )


# ============================================================================
# Tests for is_cluster_ci() - Naming Detection
# ============================================================================

class TestIsClusterCI:
    """Tests for is_cluster_ci() cluster naming detection."""

    @pytest.mark.parametrize("ci,expected", [
        # Valid cluster patterns
        ("ocp4-cluster.prod", True),
        ("ocp4-cluster.dev", True),
        ("rosa-cluster.event", True),
        ("aro-cluster.prod", True),
        ("workshop-cluster.prod", True),
        ("openshift-cluster.dev", True),
        # Case-insensitive
        ("OCP4-CLUSTER.PROD", True),
        ("Ocp4-Cluster.Prod", True),
        # Not cluster patterns
        ("workshop.prod", False),
        ("workshop.prod-tenant", False),
        ("workshop.prod-slfsrv", False),
        ("ocp4.prod", False),  # Missing "-cluster."
        ("cluster-ocp4.prod", False),  # Wrong position
        ("ocp4-clustered.prod", False),  # Different word
    ])
    def test_cluster_naming_patterns(self, ci: str, expected: bool):
        """Test cluster CI detection by naming convention."""
        assert is_cluster_ci(ci) == expected

    def test_empty_string(self):
        """Empty string is not a cluster CI."""
        assert is_cluster_ci("") is False

    def test_none_handling(self):
        """None raises AttributeError (expected behavior)."""
        with pytest.raises(AttributeError):
            is_cluster_ci(None)


# ============================================================================
# Tests for is_tenant_ci() - Naming Detection
# ============================================================================

class TestIsTenantCI:
    """Tests for is_tenant_ci() tenant naming detection."""

    @pytest.mark.parametrize("ci,expected", [
        # Valid tenant patterns
        ("workshop.prod-tenant", True),
        ("openshift.dev-tenant", True),
        ("app-tenant.prod", True),
        ("multi-asset-tenant.event", True),
        # Case-insensitive
        ("WORKSHOP.PROD-TENANT", True),
        ("Workshop.Prod-Tenant", True),
        # Not tenant patterns
        ("workshop.prod", False),
        ("workshop.prod-cluster", False),
        ("workshop.prod-slfsrv", False),
        ("tenant-workshop.prod", False),  # Wrong position
        ("workshop-tenants.prod", False),  # Different word
        ("workshop.tenant", False),  # Missing dot before suffix
    ])
    def test_tenant_naming_patterns(self, ci: str, expected: bool):
        """Test tenant CI detection by naming convention."""
        assert is_tenant_ci(ci) == expected

    def test_empty_string(self):
        """Empty string is not a tenant CI."""
        assert is_tenant_ci("") is False


# ============================================================================
# Tests for get_cluster_ci_for_tenant() - Auto-Detect and Override
# ============================================================================

class TestGetClusterCIForTenant:
    """Tests for get_cluster_ci_for_tenant() cluster CI resolution."""

    def test_auto_detect_from_naming(self):
        """Auto-detect cluster CI by replacing -tenant. with -cluster."""
        assert get_cluster_ci_for_tenant("workshop.prod-tenant") == "workshop.prod-cluster"
        assert get_cluster_ci_for_tenant("openshift.dev-tenant") == "openshift.dev-cluster"

    def test_auto_detect_preserves_case(self):
        """Case is preserved when replacing -tenant. with -cluster."""
        result = get_cluster_ci_for_tenant("Workshop.Prod-tenant")
        assert result == "Workshop.Prod-cluster"

    def test_explicit_override(self):
        """CSV Cluster_CI column overrides auto-detection."""
        result = get_cluster_ci_for_tenant(
            "workshop.prod-tenant",
            override="custom-cluster.prod"
        )
        assert result == "custom-cluster.prod"

    def test_override_none_disables_detection(self):
        """Override='none' explicitly disables cluster CI detection."""
        result = get_cluster_ci_for_tenant(
            "workshop.prod-tenant",
            override="none"
        )
        assert result is None

    def test_override_none_case_insensitive(self):
        """Override='NONE' or 'None' also disables detection."""
        assert get_cluster_ci_for_tenant("workshop.prod-tenant", override="NONE") is None
        assert get_cluster_ci_for_tenant("workshop.prod-tenant", override="None") is None

    def test_non_tenant_returns_none(self):
        """Non-tenant CI returns None (no cluster association)."""
        assert get_cluster_ci_for_tenant("workshop.prod") is None
        assert get_cluster_ci_for_tenant("workshop.prod-slfsrv") is None

    def test_tenant_without_dot_separator(self):
        """Tenant CI without proper separator returns None."""
        # "workshop-tenant" without a dot is not matched
        assert get_cluster_ci_for_tenant("workshop-tenant") is None

    def test_empty_override_uses_auto_detect(self):
        """Empty string override falls back to auto-detection."""
        result = get_cluster_ci_for_tenant("workshop.prod-tenant", override="")
        assert result == "workshop.prod-cluster"


# ============================================================================
# Tests for analyze_cluster_tenant_relationships() - CSV Label Priority
# ============================================================================

class TestAnalyzeClusterTenantRelationships:
    """Tests for analyze_cluster_tenant_relationships() analysis."""

    def test_csv_label_cluster_priority(self):
        """CSV Item_Type=cluster takes priority over naming."""
        # CI name doesn't match pattern, but CSV label says cluster
        schedules = [make_schedule("workshop.prod", item_type="cluster")]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is True
        assert schedules[0].is_tenant is False
        assert schedules[0].detection_method == "csv_label"

    def test_csv_label_tenant_priority(self):
        """CSV Item_Type=tenant takes priority over naming."""
        # CI name doesn't match pattern, but CSV label says tenant
        schedules = [make_schedule("workshop.prod", item_type="tenant")]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is False
        assert schedules[0].is_tenant is True
        assert schedules[0].detection_method == "csv_label"

    def test_csv_label_workshop_prevents_detection(self):
        """CSV Item_Type=workshop prevents cluster/tenant detection."""
        # CI name matches tenant pattern, but CSV label says workshop
        schedules = [make_schedule("workshop.prod-tenant", item_type="workshop")]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is False
        assert schedules[0].is_tenant is False
        assert schedules[0].detection_method == "csv_label"

    def test_naming_fallback_cluster(self):
        """Naming convention detects cluster when no CSV label."""
        schedules = [make_schedule("ocp4-cluster.prod")]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is True
        assert schedules[0].is_tenant is False
        assert schedules[0].detection_method == "naming"

    def test_naming_fallback_tenant(self):
        """Naming convention detects tenant when no CSV label."""
        schedules = [make_schedule("workshop.prod-tenant")]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is False
        assert schedules[0].is_tenant is True
        assert schedules[0].detection_method == "naming"
        assert schedules[0].detected_cluster_ci == "workshop.prod-cluster"

    def test_tenant_with_cluster_override(self):
        """Tenant with CSV Cluster_CI override uses it."""
        schedules = [
            make_schedule(
                "workshop.prod-tenant",
                cluster_ci_override="custom-cluster.prod"
            )
        ]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_tenant is True
        assert schedules[0].detected_cluster_ci == "custom-cluster.prod"

    def test_tenant_with_override_none(self):
        """Tenant with Cluster_CI='none' has no cluster association."""
        schedules = [
            make_schedule(
                "workshop.prod-tenant",
                cluster_ci_override="none"
            )
        ]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_tenant is True
        assert schedules[0].detected_cluster_ci is None

    def test_standalone_workshop_ignored(self):
        """Regular workshop (no cluster/tenant pattern) is not detected."""
        schedules = [make_schedule("workshop.prod")]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is False
        assert schedules[0].is_tenant is False
        assert schedules[0].detection_method == "none"
        assert schedules[0].detected_cluster_ci is None

    def test_multiple_schedules_independent(self):
        """Analysis correctly handles multiple independent schedules."""
        schedules = [
            make_schedule("ocp4-cluster.prod"),
            make_schedule("workshop.prod-tenant"),
            make_schedule("standalone.prod"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is True
        assert schedules[1].is_tenant is True
        assert schedules[1].detected_cluster_ci == "workshop.prod-cluster"
        assert schedules[2].is_cluster is False
        assert schedules[2].is_tenant is False


# ============================================================================
# Tests for validate_cluster_before_tenant() - Valid Scheduling
# ============================================================================

class TestValidateClusterBeforeTenantSuccess:
    """Tests for validate_cluster_before_tenant() success cases."""

    def test_cluster_before_tenant_valid(self):
        """Cluster provisioned before tenant → no errors."""
        base_time = datetime.now()
        cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
        tenant_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule("workshop-cluster.prod", provisioning_date=cluster_time),
            make_schedule("workshop-tenant.prod", provisioning_date=tenant_time),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []
        assert result["warnings"] == []
        assert len(result["relationships"]) == 1
        assert result["relationships"][0]["status"] == "valid"

    def test_large_time_gap_valid(self):
        """Large time gap (days) between cluster and tenant → valid."""
        base_time = datetime.now()
        cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
        tenant_time = (base_time + timedelta(days=7)).strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule("ocp4-cluster.prod", provisioning_date=cluster_time),
            make_schedule("app-tenant.prod", provisioning_date=tenant_time),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []

    def test_no_tenant_items_valid(self):
        """No tenant items → no validation needed, always valid."""
        schedules = [
            make_schedule("workshop.prod"),
            make_schedule("another.prod"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []
        assert result["warnings"] == []
        assert result["relationships"] == []


# ============================================================================
# Tests for validate_cluster_before_tenant() - Errors
# ============================================================================

class TestValidateClusterBeforeTenantErrors:
    """Tests for validate_cluster_before_tenant() error cases."""

    def test_tenant_before_cluster_error(self):
        """Tenant provisioned before cluster → error."""
        base_time = datetime.now()
        tenant_time = base_time.strftime("%d/%m/%Y %H:%M")
        cluster_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule("workshop-cluster.prod", provisioning_date=cluster_time),
            make_schedule("workshop-tenant.prod", provisioning_date=tenant_time),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is False
        assert len(result["errors"]) == 1
        assert "scheduled before or at the same time" in result["errors"][0]
        assert result["relationships"][0]["status"] == "timing_violation"

    def test_tenant_same_time_as_cluster_error(self):
        """Tenant and cluster at same time → error (must be strictly before)."""
        same_time = datetime.now().strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule("workshop-cluster.prod", provisioning_date=same_time),
            make_schedule("workshop-tenant.prod", provisioning_date=same_time),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is False
        assert len(result["errors"]) == 1
        assert "same time" in result["errors"][0]

    def test_multiple_timing_violations(self):
        """Multiple tenant-before-cluster violations → multiple errors."""
        base_time = datetime.now()

        schedules = [
            # Violation 1
            make_schedule("workshop1-cluster.prod", provisioning_date=(base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")),
            make_schedule("workshop1-tenant.prod", provisioning_date=base_time.strftime("%d/%m/%Y %H:%M")),
            # Violation 2
            make_schedule("workshop2-cluster.prod", provisioning_date=(base_time + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M")),
            make_schedule("workshop2-tenant.prod", provisioning_date=base_time.strftime("%d/%m/%Y %H:%M")),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is False
        assert len(result["errors"]) == 2


# ============================================================================
# Tests for validate_cluster_before_tenant() - Warnings
# ============================================================================

class TestValidateClusterBeforeTenantWarnings:
    """Tests for validate_cluster_before_tenant() warning cases."""

    def test_tenant_without_cluster_in_batch_warning(self):
        """Tenant without matching cluster in batch → warning."""
        schedules = [
            make_schedule("workshop-tenant.prod"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True  # Warnings don't fail validation
        assert result["errors"] == []
        assert len(result["warnings"]) == 1
        assert "no matching cluster found" in result["warnings"][0]
        assert result["relationships"][0]["status"] == "cluster_not_in_batch"

    def test_tenant_with_override_none_warning(self):
        """Tenant with Cluster_CI='none' → warning (no cluster CI)."""
        schedules = [
            make_schedule("workshop-tenant.prod", cluster_ci_override="none"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []
        assert len(result["warnings"]) == 1
        assert "no detected cluster CI" in result["warnings"][0]

    def test_namespace_mismatch_different_tenant_cluster(self):
        """
        Tenant and cluster in different namespaces → no automatic error.

        Note: Current implementation only checks timing, not namespace matching.
        This test documents that behavior.
        """
        base_time = datetime.now()
        cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
        tenant_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule("workshop-cluster.prod", namespace="ns-a", provisioning_date=cluster_time),
            make_schedule("workshop-tenant.prod", namespace="ns-b", provisioning_date=tenant_time),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        # Currently passes - namespace check not implemented
        assert result["valid"] is True
        assert result["errors"] == []

    def test_malformed_date_warning(self):
        """Invalid date format → warning."""
        schedules = [
            make_schedule("workshop-cluster.prod", provisioning_date="invalid-date"),
            make_schedule("workshop-tenant.prod", provisioning_date="2026/07/31 10:00"),  # Wrong format
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True  # Warnings don't fail
        assert len(result["warnings"]) > 0
        assert any("Could not parse dates" in w for w in result["warnings"])


# ============================================================================
# Tests for cluster_ci_override="none" - Explicit Disable
# ============================================================================

class TestClusterCIOverrideNone:
    """Tests for explicit cluster CI override disabling."""

    def test_override_none_prevents_cluster_detection(self):
        """Cluster_CI='none' prevents auto-detection."""
        schedules = [
            make_schedule("workshop-tenant.prod", cluster_ci_override="none"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_tenant is True
        assert schedules[0].detected_cluster_ci is None

    def test_override_none_skips_validation(self):
        """Tenant with Cluster_CI='none' generates warning, not error."""
        schedules = [
            make_schedule("workshop-cluster.prod"),
            make_schedule("workshop-tenant.prod", cluster_ci_override="none"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []
        assert len(result["warnings"]) == 1


# ============================================================================
# Tests for Standalone Workshop - Ignored
# ============================================================================

class TestStandaloneWorkshopIgnored:
    """Tests that regular workshops are not treated as cluster/tenant."""

    @pytest.mark.parametrize("ci", [
        "workshop.prod",
        "ansible-lab.prod",
        "openshift-virt.prod-slfsrv",
        "summit-2026.event",
        "training.dev",
    ])
    def test_standalone_workshop_no_detection(self, ci: str):
        """Non-cluster/tenant workshops are not detected."""
        schedules = [make_schedule(ci)]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is False
        assert schedules[0].is_tenant is False
        assert schedules[0].detected_cluster_ci is None
        assert schedules[0].detection_method == "none"

    def test_standalone_workshop_no_validation(self):
        """Standalone workshops are not validated for cluster-tenant relationships."""
        schedules = [
            make_schedule("workshop.prod"),
            make_schedule("another.prod"),
        ]
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["relationships"] == []


# ============================================================================
# Edge Cases and Backward Compatibility
# ============================================================================

class TestBackwardCompatibility:
    """Tests for backward compatibility with existing CSVs."""

    def test_csv_without_item_type_column_works(self):
        """CSV without Item_Type column uses naming fallback."""
        # item_type=None simulates missing column
        schedules = [
            make_schedule("ocp4-cluster.prod", item_type=None),
            make_schedule("workshop-tenant.prod", item_type=None),
        ]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is True
        assert schedules[0].detection_method == "naming"
        assert schedules[1].is_tenant is True
        assert schedules[1].detection_method == "naming"

    def test_csv_without_cluster_ci_column_works(self):
        """CSV without Cluster_CI column uses auto-detection."""
        # cluster_ci_override=None simulates missing column
        schedules = [
            make_schedule("workshop-tenant.prod", cluster_ci_override=None),
        ]
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].detected_cluster_ci == "workshop-cluster.prod"

    def test_empty_schedules_list(self):
        """Empty schedules list doesn't crash."""
        schedules: list[WorkshopSchedule] = []
        analyze_cluster_tenant_relationships(schedules)

        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []
        assert result["warnings"] == []
        assert result["relationships"] == []


# ============================================================================
# Integration Tests - Full Workflow
# ============================================================================

class TestIntegrationFullWorkflow:
    """Integration tests covering full cluster-tenant workflow."""

    def test_typical_cluster_tenant_deployment(self):
        """
        Typical deployment: cluster first, then tenant 30 min later.

        This is the happy path for cluster-tenant deployments.
        """
        base_time = datetime.now()
        cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
        tenant_time = (base_time + timedelta(minutes=30)).strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule(
                "app-cluster.prod",
                ci_name="Application Cluster",
                provisioning_date=cluster_time,
            ),
            make_schedule(
                "app-tenant.prod",
                ci_name="Application Tenant",
                provisioning_date=tenant_time,
            ),
        ]

        # Analyze relationships
        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is True
        assert schedules[1].is_tenant is True
        assert schedules[1].detected_cluster_ci == "app-cluster.prod"

        # Validate timing
        result = validate_cluster_before_tenant(schedules)

        assert result["valid"] is True
        assert result["errors"] == []
        assert len(result["relationships"]) == 1
        assert result["relationships"][0]["status"] == "valid"

    def test_multi_tenant_single_cluster(self):
        """Multiple tenants sharing one cluster."""
        base_time = datetime.now()
        cluster_time = base_time.strftime("%d/%m/%Y %H:%M")

        schedules = [
            make_schedule("ocp4-cluster.prod", provisioning_date=cluster_time),
            make_schedule("app1-tenant.prod", provisioning_date=(base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")),
            make_schedule("app2-tenant.prod", provisioning_date=(base_time + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M")),
            make_schedule("app3-tenant.prod", provisioning_date=(base_time + timedelta(hours=3)).strftime("%d/%m/%Y %H:%M")),
        ]

        analyze_cluster_tenant_relationships(schedules)

        # All tenants should detect cluster, but naming won't auto-match
        # (they'd need cluster_ci_override="ocp4-cluster.prod" in real usage)
        assert schedules[0].is_cluster is True
        assert all(s.is_tenant for s in schedules[1:])

    def test_explicit_csv_labels_override_naming(self):
        """CSV labels override naming convention for special cases."""
        schedules = [
            # Naming says cluster, but CSV says workshop
            make_schedule("ocp4-cluster.prod", item_type="workshop"),
            # Naming says nothing, but CSV says tenant
            make_schedule("custom-app.prod", item_type="tenant", cluster_ci_override="ocp4-cluster.prod"),
        ]

        analyze_cluster_tenant_relationships(schedules)

        assert schedules[0].is_cluster is False
        assert schedules[0].is_tenant is False
        assert schedules[0].detection_method == "csv_label"

        assert schedules[1].is_cluster is False
        assert schedules[1].is_tenant is True
        assert schedules[1].detected_cluster_ci == "ocp4-cluster.prod"
        assert schedules[1].detection_method == "csv_label"


# ============================================================================
# Tests for cluster_ci_source field
# ============================================================================

class TestClusterCISourceFieldDefault:
    def test_cluster_ci_source_defaults_to_none(self):
        schedule = make_schedule("ocp4-tenant.prod")
        assert schedule.cluster_ci_source is None


# ============================================================================
# Tests for AgnosticV Resolution Tier
# ============================================================================

class TestAnalyzeClusterTenantRelationshipsAgnosticVTier:
    def test_csv_override_wins_over_agnosticv(self):
        schedule = make_schedule(
            "ocp4-tenant.prod",
            cluster_ci_override="ocp4-cluster.override",
        )
        with patch("rhdp_flow.resolve_tenant_cluster_item", return_value="ocp4-cluster.agnosticv") as mock_resolve:
            analyze_cluster_tenant_relationships([schedule])

        mock_resolve.assert_not_called()
        assert schedule.detected_cluster_ci == "ocp4-cluster.override"
        assert schedule.cluster_ci_source == "override"

    def test_agnosticv_wins_over_naming_when_no_override(self):
        schedule = make_schedule("ocp4-tenant.prod")
        with patch("rhdp_flow.resolve_tenant_cluster_item", return_value="ocp4-cluster.from-agnosticv") as mock_resolve:
            analyze_cluster_tenant_relationships([schedule])

        mock_resolve.assert_called_once_with("ocp4-tenant.prod", ANY)
        assert schedule.detected_cluster_ci == "ocp4-cluster.from-agnosticv"
        assert schedule.cluster_ci_source == "agnosticv"

    def test_naming_fallback_when_agnosticv_returns_none(self):
        schedule = make_schedule("ocp4-tenant.prod")
        with patch("rhdp_flow.resolve_tenant_cluster_item", return_value=None):
            analyze_cluster_tenant_relationships([schedule])

        assert schedule.detected_cluster_ci == "ocp4-cluster.prod"
        assert schedule.cluster_ci_source == "naming"

    def test_source_is_none_when_no_cluster_resolved_at_all(self):
        schedule = make_schedule("standalone.prod", item_type="tenant", cluster_ci_override="none")
        with patch("rhdp_flow.resolve_tenant_cluster_item", return_value=None):
            analyze_cluster_tenant_relationships([schedule])

        assert schedule.detected_cluster_ci is None
        assert schedule.cluster_ci_source is None


# ============================================================================
# Tests for find_provisioned_cluster_resourceclaim() - Live-Cluster Lookup
# ============================================================================

class TestFindProvisionedClusterResourceClaim:
    def test_returns_true_when_ready_resourceclaim_found_via_catalogitemname(self):
        from rhdp_flow import RHDPConfig as _RHDPConfigForLookup
        from rhdp_flow import find_provisioned_cluster_resourceclaim
        config = _RHDPConfigForLookup()
        ready_rc = '{"items": [{"metadata": {"name": "rc-1"}, "status": {"ready": true, "healthy": true}}]}'
        empty = '{"items": []}'
        results = [
            MagicMock(returncode=0, stdout=ready_rc),
            MagicMock(returncode=0, stdout=empty),
        ]
        with patch("rhdp_flow.subprocess.run", side_effect=results):
            found = find_provisioned_cluster_resourceclaim("ocp4-cluster.prod", config)
        assert found is True

    def test_returns_true_when_ready_resourceclaim_found_via_tenant_cluster_pool_label(self):
        from rhdp_flow import RHDPConfig as _RHDPConfigForLookup
        from rhdp_flow import find_provisioned_cluster_resourceclaim
        config = _RHDPConfigForLookup()
        empty = '{"items": []}'
        ready_rc = '{"items": [{"metadata": {"name": "rc-pool-1"}, "status": {"ready": true, "healthy": true}}]}'
        results = [
            MagicMock(returncode=0, stdout=empty),
            MagicMock(returncode=0, stdout=ready_rc),
        ]
        with patch("rhdp_flow.subprocess.run", side_effect=results):
            found = find_provisioned_cluster_resourceclaim("ocp4-cluster.prod", config)
        assert found is True

    def test_returns_false_when_cluster_exists_but_not_ready(self):
        from rhdp_flow import RHDPConfig as _RHDPConfigForLookup
        from rhdp_flow import find_provisioned_cluster_resourceclaim
        config = _RHDPConfigForLookup()
        pending_rc = '{"items": [{"metadata": {"name": "rc-1"}, "status": {"ready": false, "healthy": false}}]}'
        results = [
            MagicMock(returncode=0, stdout=pending_rc),
            MagicMock(returncode=0, stdout='{"items": []}'),
        ]
        with patch("rhdp_flow.subprocess.run", side_effect=results):
            found = find_provisioned_cluster_resourceclaim("ocp4-cluster.prod", config)
        assert found is False

    def test_returns_false_when_no_resourceclaims_found(self):
        from rhdp_flow import RHDPConfig as _RHDPConfigForLookup
        from rhdp_flow import find_provisioned_cluster_resourceclaim
        config = _RHDPConfigForLookup()
        empty = '{"items": []}'
        results = [
            MagicMock(returncode=0, stdout=empty),
            MagicMock(returncode=0, stdout=empty),
        ]
        with patch("rhdp_flow.subprocess.run", side_effect=results):
            found = find_provisioned_cluster_resourceclaim("ocp4-cluster.prod", config)
        assert found is False

    def test_returns_none_on_oc_command_failure(self):
        from rhdp_flow import RHDPConfig as _RHDPConfigForLookup
        from rhdp_flow import find_provisioned_cluster_resourceclaim
        config = _RHDPConfigForLookup()
        fake_result = MagicMock(returncode=1, stdout="", stderr="Unauthorized")
        with patch("rhdp_flow.subprocess.run", return_value=fake_result):
            found = find_provisioned_cluster_resourceclaim("ocp4-cluster.prod", config)
        assert found is None

    def test_returns_none_on_subprocess_exception(self):
        from rhdp_flow import RHDPConfig as _RHDPConfigForLookup
        from rhdp_flow import find_provisioned_cluster_resourceclaim
        config = _RHDPConfigForLookup()
        with patch("rhdp_flow.subprocess.run", side_effect=FileNotFoundError("oc not found")):
            found = find_provisioned_cluster_resourceclaim("ocp4-cluster.prod", config)
        assert found is None

class TestValidateClusterBeforeTenantOutOfBatch:
    def test_found_on_live_cluster_is_informational_not_error(self):
        tenant = make_schedule("ocp4-tenant.prod")
        tenant.is_tenant = True
        tenant.detected_cluster_ci = "ocp4-cluster.prod"

        with patch("rhdp_flow.find_provisioned_cluster_resourceclaim", return_value=True):
            result = validate_cluster_before_tenant([tenant], config=RHDPConfig())

        assert result["valid"] is True
        assert result["errors"] == []
        assert any("already provisioned outside this batch" in w for w in result["warnings"]) is False
        assert result["relationships"][0]["status"] == "found_on_cluster"

    def test_not_found_anywhere_is_error(self):
        tenant = make_schedule("ocp4-tenant.prod")
        tenant.is_tenant = True
        tenant.detected_cluster_ci = "ocp4-cluster.prod"

        with patch("rhdp_flow.find_provisioned_cluster_resourceclaim", return_value=False):
            result = validate_cluster_before_tenant([tenant], config=RHDPConfig())

        assert result["valid"] is False
        assert len(result["errors"]) == 1
        assert "neither in this batch nor already provisioned" in result["errors"][0]
        assert result["relationships"][0]["status"] == "not_found_anywhere"

    def test_lookup_failure_falls_back_to_legacy_warning(self):
        tenant = make_schedule("ocp4-tenant.prod")
        tenant.is_tenant = True
        tenant.detected_cluster_ci = "ocp4-cluster.prod"

        with patch("rhdp_flow.find_provisioned_cluster_resourceclaim", return_value=None):
            result = validate_cluster_before_tenant([tenant], config=RHDPConfig())

        assert result["valid"] is True
        assert len(result["warnings"]) == 1
        assert "no matching cluster found in this deployment batch" in result["warnings"][0]
        assert result["relationships"][0]["status"] == "cluster_not_in_batch"

    def test_config_none_skips_live_lookup_like_legacy_behavior(self):
        tenant = make_schedule("ocp4-tenant.prod")
        tenant.is_tenant = True
        tenant.detected_cluster_ci = "ocp4-cluster.prod"

        result = validate_cluster_before_tenant([tenant])

        assert result["valid"] is True
        assert len(result["warnings"]) == 1
        assert result["relationships"][0]["status"] == "cluster_not_in_batch"


class TestValidateClusterBeforeTenantStructuredDetails:
    def test_error_details_additive_alongside_string_errors(self):
        cluster = make_schedule("ocp4-cluster.prod", provisioning_date="10/09/2026 12:00")
        cluster.is_cluster = True
        tenant = make_schedule("ocp4-tenant.prod", provisioning_date="10/09/2026 10:00")
        tenant.is_tenant = True
        tenant.detected_cluster_ci = "ocp4-cluster.prod"

        result = validate_cluster_before_tenant([cluster, tenant])

        assert isinstance(result["errors"][0], str)
        assert "scheduled before or at the same time" in result["errors"][0]
        assert result["error_details"][0]["tenant_ci"] == "ocp4-tenant.prod"
        assert result["error_details"][0]["cluster_ci"] == "ocp4-cluster.prod"
        assert result["error_details"][0]["tenant_date"] == "10/09/2026 10:00"
        assert result["error_details"][0]["cluster_date"] == "10/09/2026 12:00"
        assert result["error_details"][0]["namespace"] == tenant.namespace
        assert result["error_details"][0]["message"] == result["errors"][0]

    def test_warning_details_additive_for_not_in_batch(self):
        tenant = make_schedule("ocp4-tenant.prod")
        tenant.is_tenant = True
        tenant.detected_cluster_ci = "ocp4-cluster.prod"

        with patch("rhdp_flow.find_provisioned_cluster_resourceclaim", return_value=None):
            result = validate_cluster_before_tenant([tenant], config=RHDPConfig())

        assert isinstance(result["warnings"][0], str)
        assert result["warning_details"][0]["tenant_ci"] == "ocp4-tenant.prod"
        assert result["warning_details"][0]["namespace"] == tenant.namespace
        assert result["warning_details"][0]["message"] == result["warnings"][0]
