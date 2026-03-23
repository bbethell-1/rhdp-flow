"""Tests for derive_base_domain, build_resource_claim_payload, and related flow helpers."""

import json
import subprocess
from unittest.mock import patch, MagicMock

import pytest

from pathlib import Path

from rhdp_flow import (
    derive_base_domain,
    build_resource_claim_payload,
    export_dry_run_manifest_yaml,
    get_catalog_item_num_users_limit,
    get_catalog_item_parameter_defaults,
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


class TestGetCatalogItemNumUsersLimit:
    """Tests for get_catalog_item_num_users_limit."""

    @patch("subprocess.run")
    def test_returns_maximum_from_schema(self, mock_run):
        """Returns maximum/minimum/default from openAPIV3Schema."""
        ci_json = {
            "spec": {
                "parameters": [
                    {
                        "name": "num_users",
                        "openAPIV3Schema": {
                            "type": "integer",
                            "default": 2,
                            "minimum": 2,
                            "maximum": 40,
                        },
                    }
                ]
            }
        }
        mock_run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(ci_json), stderr=""
        )
        config = make_config()
        result = get_catalog_item_num_users_limit("test.ci.prod", config)
        assert result is not None
        assert result["has_num_users"] is True
        assert result["maximum"] == 40
        assert result["minimum"] == 2
        assert result["default"] == 2

    @patch("subprocess.run")
    def test_returns_false_when_no_num_users(self, mock_run):
        """Returns has_num_users=False when CI has no num_users parameter."""
        ci_json = {
            "spec": {
                "parameters": [
                    {"name": "other_param", "openAPIV3Schema": {"type": "string"}}
                ]
            }
        }
        mock_run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(ci_json), stderr=""
        )
        config = make_config()
        result = get_catalog_item_num_users_limit("test.ci.prod", config)
        assert result is not None
        assert result["has_num_users"] is False
        assert result["maximum"] is None

    @patch("subprocess.run")
    def test_returns_none_when_cluster_unreachable(self, mock_run):
        """Returns None when oc command fails (cluster unreachable)."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
        config = make_config()
        result = get_catalog_item_num_users_limit("test.ci.prod", config)
        assert result is None

    @patch("subprocess.run")
    def test_searches_provider_spec(self, mock_run):
        """Finds num_users in spec.providerSpec.parameterDefinitions."""
        ci_json = {
            "spec": {
                "parameters": [],
                "providerSpec": {
                    "parameterDefinitions": [
                        {
                            "name": "num_users",
                            "openAPIV3Schema": {
                                "type": "integer",
                                "maximum": 100,
                            },
                        }
                    ]
                },
            }
        }
        mock_run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(ci_json), stderr=""
        )
        config = make_config()
        result = get_catalog_item_num_users_limit("test.ci.prod", config)
        assert result is not None
        assert result["has_num_users"] is True
        assert result["maximum"] == 100


class TestGetCatalogItemParameterDefaults:
    """Tests for get_catalog_item_parameter_defaults."""

    @patch("subprocess.run")
    def test_collects_openapi_defaults(self, mock_run):
        ci_json = {
            "spec": {
                "parameters": [
                    {
                        "name": "aws_region",
                        "openAPIV3Schema": {"type": "string", "default": "us-east-2"},
                    },
                    {
                        "name": "ocp4_fips_enable",
                        "openAPIV3Schema": {"type": "boolean", "default": False},
                    },
                    {"name": "no_default", "openAPIV3Schema": {"type": "string"}},
                ],
            }
        }
        mock_run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(ci_json), stderr=""
        )
        config = make_config()
        result = get_catalog_item_parameter_defaults("test.ci.prod", config)
        assert result["aws_region"] == "us-east-2"
        assert result["ocp4_fips_enable"] is False
        assert "no_default" not in result

    @patch("subprocess.run")
    def test_provider_spec_definitions(self, mock_run):
        ci_json = {
            "spec": {
                "parameters": [],
                "providerSpec": {
                    "parameterDefinitions": [
                        {
                            "name": "aws_region",
                            "openAPIV3Schema": {"default": "eu-west-1"},
                        }
                    ]
                },
            }
        }
        mock_run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(ci_json), stderr=""
        )
        config = make_config()
        result = get_catalog_item_parameter_defaults("test.ci.prod", config)
        assert result["aws_region"] == "eu-west-1"

    @patch("subprocess.run")
    def test_returns_empty_when_unreadable(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="nope")
        config = make_config()
        assert get_catalog_item_parameter_defaults("missing.ci.prod", config) == {}


def test_export_dry_run_manifest_yaml_writes(tmp_path):
    """Dry-run YAML export writes a file and strips internal keys."""
    config = make_config(dry_run=True)
    config.dry_run_export_yaml_dir = str(tmp_path)
    config.dry_run_yaml_export_seq = 0
    manifest = {"kind": "ResourceClaim", "apiVersion": "poolboy.gpte.redhat.com/v1", "_white_glove": True}
    out = export_dry_run_manifest_yaml(config, "resourceclaim-test.ci", manifest)
    assert out and Path(out).exists()
    text = Path(out).read_text()
    assert "ResourceClaim" in text
    assert "_white_glove" not in text
    assert config.dry_run_yaml_export_seq == 1
