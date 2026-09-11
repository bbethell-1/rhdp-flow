"""Unit tests for agnosticv_resolver.py."""

from __future__ import annotations

from rhdp_flow import RHDPConfig


class TestRHDPConfigAgnosticVFields:
    def test_default_agnosticv_config_values(self):
        config = RHDPConfig()
        assert config.agnosticv_repo_url == "git@github.com:rhpds/agnosticv.git"
        assert config.agnosticv_cache_dir == "/tmp/agnosticv-cache"
        assert config.agnosticv_ssh_key_path is None
        assert config.agnosticv_cli_path == "agnosticv"
        assert config.agnosticv_refresh_ttl_seconds == 900
