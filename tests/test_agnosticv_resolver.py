"""Unit tests for agnosticv_resolver.py."""

from __future__ import annotations

import shlex
import time
from unittest.mock import MagicMock, patch

from lib.agnosticv_resolver import _ensure_repo_cloned, _git_env
from rhdp_flow import RHDPConfig


class TestRHDPConfigAgnosticVFields:
    def test_default_agnosticv_config_values(self):
        config = RHDPConfig()
        assert config.agnosticv_repo_url == "git@github.com:rhpds/agnosticv.git"
        assert config.agnosticv_cache_dir == "/tmp/agnosticv-cache"
        assert config.agnosticv_ssh_key_path is None
        assert config.agnosticv_cli_path == "agnosticv"
        assert config.agnosticv_refresh_ttl_seconds == 900


class TestEnsureRepoCloned:
    def test_clones_when_cache_dir_missing(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "agnosticv-cache")

        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            result = _ensure_repo_cloned(config)

        assert result is True
        clone_call = mock_run.call_args_list[0]
        assert clone_call.args[0][:2] == ["git", "clone"]
        assert "--depth" in clone_call.args[0]

    def test_refreshes_when_stale(self, tmp_path):
        config = RHDPConfig()
        cache_dir = tmp_path / "agnosticv-cache"
        (cache_dir / ".git").mkdir(parents=True)
        config.agnosticv_cache_dir = str(cache_dir)
        config.agnosticv_refresh_ttl_seconds = 1
        old_time = time.time() - 10
        import os
        os.utime(cache_dir, (old_time, old_time))

        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            result = _ensure_repo_cloned(config)

        assert result is True
        pull_call = mock_run.call_args_list[0]
        assert pull_call.args[0][:2] == ["git", "-C"]
        assert "pull" in pull_call.args[0]

    def test_skips_refresh_when_fresh(self, tmp_path):
        config = RHDPConfig()
        cache_dir = tmp_path / "agnosticv-cache"
        (cache_dir / ".git").mkdir(parents=True)
        config.agnosticv_cache_dir = str(cache_dir)
        config.agnosticv_refresh_ttl_seconds = 900

        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            result = _ensure_repo_cloned(config)

        assert result is True
        mock_run.assert_not_called()

    def test_returns_false_on_clone_failure(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "agnosticv-cache")

        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=128, stdout="", stderr="Permission denied (publickey)")
            result = _ensure_repo_cloned(config)

        assert result is False

    def test_returns_false_on_subprocess_exception(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "agnosticv-cache")

        with patch("lib.agnosticv_resolver.subprocess.run", side_effect=FileNotFoundError("git not found")):
            result = _ensure_repo_cloned(config)

        assert result is False


class TestGitEnv:
    def test_shell_quotes_ssh_key_path_with_metacharacters(self):
        config = RHDPConfig()
        config.agnosticv_ssh_key_path = "/tmp/some key; rm -rf /"

        env = _git_env(config)

        assert "GIT_SSH_COMMAND" in env
        quoted_path = shlex.quote("/tmp/some key; rm -rf /")
        assert quoted_path in env["GIT_SSH_COMMAND"]
        assert env["GIT_SSH_COMMAND"] == f"ssh -i {quoted_path} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"


from lib.agnosticv_resolver import resolve_tenant_cluster_item


class TestResolveTenantClusterItem:
    def _config(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "agnosticv-cache")
        (tmp_path / "agnosticv-cache" / ".git").mkdir(parents=True)
        return config

    def test_resolves_item_with_explicit_stage(self, tmp_path):
        config = self._config(tmp_path)
        merged_yaml = """
__meta__:
  sandboxes:
    - name: main
      tenant_cluster:
        item: ai-quickstarts/ai-qs-rag-cluster/prod
"""
        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=merged_yaml, stderr="")
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.prod", config)

        assert result == "ai-quickstarts.ai-qs-rag-cluster.prod"

    def test_resolves_item_defaulting_stage_to_tenants_own_stage(self, tmp_path):
        config = self._config(tmp_path)
        merged_yaml = """
__meta__:
  sandboxes:
    - name: main
      tenant_cluster:
        item: ai-quickstarts/ai-qs-rag-cluster
"""
        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=merged_yaml, stderr="")
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.dev", config)

        assert result == "ai-quickstarts.ai-qs-rag-cluster.dev"

    def test_returns_none_when_no_tenant_cluster_present(self, tmp_path):
        config = self._config(tmp_path)
        merged_yaml = "__meta__:\n  sandboxes:\n    - name: main\n"
        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=merged_yaml, stderr="")
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.prod", config)

        assert result is None

    def test_returns_none_on_cli_failure(self, tmp_path):
        config = self._config(tmp_path)
        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="item not found")
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.prod", config)

        assert result is None

    def test_returns_none_on_malformed_yaml(self, tmp_path):
        config = self._config(tmp_path)
        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=": : not yaml : :", stderr="")
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.prod", config)

        assert result is None

    def test_returns_none_on_missing_cli_binary(self, tmp_path):
        config = self._config(tmp_path)
        with patch("lib.agnosticv_resolver.subprocess.run", side_effect=FileNotFoundError("agnosticv not found")):
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.prod", config)

        assert result is None

    def test_returns_none_when_clone_fails(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "does-not-exist")
        with patch("lib.agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=128, stdout="", stderr="Permission denied")
            result = resolve_tenant_cluster_item("ai-quickstarts.ai-qs-rag-tenant.prod", config)

        assert result is None

    def test_returns_none_for_malformed_ci(self, tmp_path):
        config = self._config(tmp_path)
        result = resolve_tenant_cluster_item("not-a-valid-ci", config)
        assert result is None
