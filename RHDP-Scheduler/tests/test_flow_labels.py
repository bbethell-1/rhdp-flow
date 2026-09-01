"""
Tests for Flow labels (flow.demo.redhat.com) on ResourceClaims, Workshops, and WorkshopProvisions.
"""
from rhdp_flow import (
    RHDPConfig,
    WorkshopSchedule,
    build_resource_claim_payload,
    build_workshop_provision_dict,
    build_workshop_resource_dict,
)


def test_cluster_item_gets_cluster_label():
    """Cluster catalog items get flow.demo.redhat.com/item-type=cluster label."""
    schedule = WorkshopSchedule(
        ci_name="OCP4 Cluster",
        ci="ocp4-cluster.prod",
        namespace="user-test",
        enable_workshop_interface=False,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Cluster",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=True,
        is_tenant=False,
        detected_cluster_ci=None,
        detection_method="naming",
    )

    config = RHDPConfig()
    payload = build_resource_claim_payload(schedule, config)

    assert payload["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "cluster"
    assert "flow.demo.redhat.com/cluster-ci" not in payload["metadata"]["labels"]


def test_tenant_item_gets_tenant_label_and_cluster_ci():
    """Tenant catalog items get flow.demo.redhat.com/item-type=tenant and cluster-ci labels."""
    schedule = WorkshopSchedule(
        ci_name="App Tenant",
        ci="app-tenant.prod",
        namespace="user-test",
        enable_workshop_interface=False,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Tenant",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=False,
        is_tenant=True,
        detected_cluster_ci="app-cluster.prod",
        detection_method="naming",
    )

    config = RHDPConfig()
    payload = build_resource_claim_payload(schedule, config)

    assert payload["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "tenant"
    assert payload["metadata"]["labels"]["flow.demo.redhat.com/cluster-ci"] == "app-cluster.prod"


def test_tenant_with_override_cluster_ci():
    """Tenant with cluster_ci_override uses override value."""
    schedule = WorkshopSchedule(
        ci_name="App Tenant",
        ci="app-tenant.prod",
        namespace="user-test",
        enable_workshop_interface=False,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Tenant",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=False,
        is_tenant=True,
        detected_cluster_ci="app-cluster.prod",
        cluster_ci_override="custom-cluster.prod",
        detection_method="naming",
    )

    config = RHDPConfig()
    payload = build_resource_claim_payload(schedule, config)

    assert payload["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "tenant"
    assert payload["metadata"]["labels"]["flow.demo.redhat.com/cluster-ci"] == "custom-cluster.prod"


def test_workshop_item_gets_workshop_label():
    """Regular workshop items get flow.demo.redhat.com/item-type=workshop label."""
    schedule = WorkshopSchedule(
        ci_name="Ansible Lab",
        ci="ansible-lab.prod",
        namespace="user-test",
        enable_workshop_interface=True,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Workshop",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=False,
        is_tenant=False,
        detected_cluster_ci=None,
        detection_method="none",
    )

    config = RHDPConfig()
    payload = build_resource_claim_payload(schedule, config)

    assert payload["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "workshop"
    assert "flow.demo.redhat.com/cluster-ci" not in payload["metadata"]["labels"]


def test_workshop_resource_inherits_flow_labels():
    """Workshop resource copies Flow labels from ResourceClaim payload."""
    schedule = WorkshopSchedule(
        ci_name="App Tenant",
        ci="app-tenant.prod",
        namespace="user-test",
        enable_workshop_interface=True,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Workshop",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=False,
        is_tenant=True,
        detected_cluster_ci="app-cluster.prod",
        detection_method="naming",
    )

    config = RHDPConfig()
    resourceclaim_payload = build_resource_claim_payload(schedule, config)

    workshop = build_workshop_resource_dict(
        "test-workshop",
        "user-test",
        resourceclaim_payload,
        config,
        redirect=True,
    )

    assert workshop["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "tenant"
    assert workshop["metadata"]["labels"]["flow.demo.redhat.com/cluster-ci"] == "app-cluster.prod"


def test_workshop_provision_inherits_flow_labels():
    """WorkshopProvision resource copies Flow labels from ResourceClaim payload."""
    schedule = WorkshopSchedule(
        ci_name="App Tenant",
        ci="app-tenant.prod",
        namespace="user-test",
        enable_workshop_interface=True,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Workshop",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=False,
        is_tenant=True,
        detected_cluster_ci="app-cluster.prod",
        detection_method="naming",
    )

    config = RHDPConfig()
    resourceclaim_payload = build_resource_claim_payload(schedule, config)

    provision = build_workshop_provision_dict(
        "test-workshop",
        "user-test",
        resourceclaim_payload,
        config,
        concurrency=1,
        count=1,
        extra_parameters=None,
        fetch_catalog_defaults=False,
    )

    assert provision["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "tenant"
    assert provision["metadata"]["labels"]["flow.demo.redhat.com/cluster-ci"] == "app-cluster.prod"


def test_cluster_flow_labels_propagate_through_all_resources():
    """Verify Flow labels propagate from ResourceClaim -> Workshop -> WorkshopProvision for cluster."""
    schedule = WorkshopSchedule(
        ci_name="OCP4 Cluster",
        ci="ocp4-cluster.prod",
        namespace="user-test",
        enable_workshop_interface=True,
        password="test123",
        activity="Admin",
        purpose="QA",
        workshop_name="Test Cluster",
        provisioning_date="01/08/2026 10:00",
        auto_stop="01/08/2026 18:00",
        auto_destroy="02/08/2026 10:00",
        is_cluster=True,
        is_tenant=False,
        detected_cluster_ci=None,
        detection_method="naming",
    )

    config = RHDPConfig()

    # Build all three resources
    resourceclaim = build_resource_claim_payload(schedule, config)
    workshop = build_workshop_resource_dict(
        "test-workshop",
        "user-test",
        resourceclaim,
        config,
        redirect=True,
    )
    provision = build_workshop_provision_dict(
        "test-workshop",
        "user-test",
        resourceclaim,
        config,
        concurrency=1,
        count=1,
        extra_parameters=None,
        fetch_catalog_defaults=False,
    )

    # All three should have the same Flow label
    assert resourceclaim["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "cluster"
    assert workshop["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "cluster"
    assert provision["metadata"]["labels"]["flow.demo.redhat.com/item-type"] == "cluster"

    # None should have cluster-ci (they ARE the cluster)
    assert "flow.demo.redhat.com/cluster-ci" not in resourceclaim["metadata"]["labels"]
    assert "flow.demo.redhat.com/cluster-ci" not in workshop["metadata"]["labels"]
    assert "flow.demo.redhat.com/cluster-ci" not in provision["metadata"]["labels"]
