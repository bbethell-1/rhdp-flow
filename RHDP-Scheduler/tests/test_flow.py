"""Tests for derive_base_domain, build_resource_claim_payload, and related flow helpers."""

import pytest

from rhdp_flow import (
    derive_base_domain,
    build_resource_claim_payload,
    WorkshopSchedule,
    RHDPConfig,
)
from tests.conftest import make_schedule, make_config


class TestDeriveBaseDomain:
    """Tests for derive_base_domain."""

    def test_api_integration_demo_redhat(self):
        """Standard integration cluster URL."""
        url = "https://api.integration.demo.redhat.com:6443"
        assert derive_base_domain(url) == "integration.demo.redhat.com"

    def test_api_with_trailing_slash(self):
        """Trailing slash is stripped."""
        url = "https://api.integration.demo.redhat.com:6443/"
        assert derive_base_domain(url) == "integration.demo.redhat.com"

    def test_ocp_infra_open_redhat_com(self):
        """ocp-*.infra.open.redhat.com is converted to *.demo.redhat.com."""
        url = "https://api.ocp-integration.infra.open.redhat.com:6443"
        assert derive_base_domain(url) == "integration.demo.redhat.com"

    def test_empty_returns_fallback(self):
        """Empty or None returns fallback."""
        assert derive_base_domain("") == "integration.demo.redhat.com"
        assert derive_base_domain(None) == "integration.demo.redhat.com"

    def test_unknown_host_returns_host_without_api_prefix(self):
        """Unknown host without api. prefix is returned as-is (or fallback if empty)."""
        url = "https://api.custom.openshift.com:6443"
        assert derive_base_domain(url) == "custom.openshift.com"


class TestBuildResourceClaimPayload:
    """Tests for build_resource_claim_payload."""

    def test_minimal_schedule_produces_valid_payload(self):
        """Minimal WorkshopSchedule produces a payload with required fields."""
        schedule = make_schedule(
            ci_name="Test Workshop",
            ci="openshift-cnv.ocp-virt-roadshow-multi-user.prod",
            namespace="user-bbethell-redhat-com",
            provisioning_date="15/02/2026 11:00",
            auto_stop="15/02/2026 19:00",
            auto_destroy="17/02/2026 11:00",
        )
        payload = build_resource_claim_payload(schedule)
        assert payload.get("kind") == "ResourceClaim"
        assert payload.get("apiVersion", "").startswith("poolboy")
        meta = payload.get("metadata", {})
        assert meta.get("generateName", "").startswith("openshift-cnv")
        assert meta.get("namespace") == "user-bbethell-redhat-com"
        ann = meta.get("annotations", {})
        assert "demo.redhat.com/requester" in ann
        spec = payload.get("spec", {})
        assert "provider" in spec
        assert spec["provider"].get("name") == schedule.ci
        assert "lifespan" in spec

    def test_namespace_drives_requester_email(self):
        """Requester email is derived from namespace user-*-*-* format."""
        schedule = make_schedule(namespace="user-jdoe-redhat-com")
        payload = build_resource_claim_payload(schedule)
        ann = payload.get("metadata", {}).get("annotations", {})
        assert ann.get("demo.redhat.com/requester") == "jdoe@redhat.com"
        assert ann.get("demo.redhat.com/orderedBy") == "jdoe@redhat.com"
