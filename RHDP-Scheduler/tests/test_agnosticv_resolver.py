"""Unit tests for agnosticv_resolver.py."""

from __future__ import annotations

import subprocess
import time
from unittest.mock import patch, MagicMock

from rhdp_flow import RHDPConfig
from agnosticv_resolver import _ensure_repo_cloned


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

        with patch("agnosticv_resolver.subprocess.run") as mock_run:
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

        with patch("agnosticv_resolver.subprocess.run") as mock_run:
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

        with patch("agnosticv_resolver.subprocess.run") as mock_run:
            result = _ensure_repo_cloned(config)

        assert result is True
        mock_run.assert_not_called()

    def test_returns_false_on_clone_failure(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "agnosticv-cache")

        with patch("agnosticv_resolver.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=128, stdout="", stderr="Permission denied (publickey)")
            result = _ensure_repo_cloned(config)

        assert result is False

    def test_returns_false_on_subprocess_exception(self, tmp_path):
        config = RHDPConfig()
        config.agnosticv_cache_dir = str(tmp_path / "agnosticv-cache")

        with patch("agnosticv_resolver.subprocess.run", side_effect=FileNotFoundError("git not found")):
            result = _ensure_repo_cloned(config)

        assert result is False
