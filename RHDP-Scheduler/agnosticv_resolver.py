"""Resolve tenant->cluster catalog-item bindings from AgnosticV.

Reads the tenant_cluster.item field declared under a tenant catalog item's
__meta__.sandboxes[] in the private rhpds/agnosticv repo, by shallow-cloning
the repo and running the vendored `agnosticv` CLI to produce merged YAML.

This module is safe to fail: any error (missing git/agnosticv binary, clone
or auth failure, item not found, malformed YAML) logs a warning and returns
None. Callers must treat None as "fall back to existing detection," never as
a deploy-blocking error. See docs/superpowers/specs/2026-09-10-flow-tenant-
cluster-agnosticv-resolution-design.md for the full design.
"""

from __future__ import annotations

import logging
import os
import shlex
import subprocess
import time
from typing import Optional, TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from rhdp_flow import RHDPConfig

logger = logging.getLogger("rhdp_flow.agnosticv_resolver")


def _git_env(config: "RHDPConfig") -> dict:
    env = os.environ.copy()
    if config.agnosticv_ssh_key_path:
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {shlex.quote(config.agnosticv_ssh_key_path)} "
            "-o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
        )
    return env


def _ensure_repo_cloned(config: "RHDPConfig") -> bool:
    """Ensure a local clone of config.agnosticv_repo_url exists and is fresh.

    Returns True if the clone is ready to use, False on any failure.
    """
    cache_dir = config.agnosticv_cache_dir
    git_dir = os.path.join(cache_dir, ".git")

    try:
        if not os.path.isdir(git_dir):
            os.makedirs(os.path.dirname(cache_dir) or ".", exist_ok=True)
            result = subprocess.run(
                ["git", "clone", "--depth", "1", config.agnosticv_repo_url, cache_dir],
                capture_output=True,
                text=True,
                timeout=60,
                env=_git_env(config),
            )
            if result.returncode != 0:
                logger.warning(f"agnosticv clone failed (non-blocking): {result.stderr.strip()}")
                return False
            return True

        age_seconds = time.time() - os.path.getmtime(cache_dir)
        if age_seconds < config.agnosticv_refresh_ttl_seconds:
            return True

        result = subprocess.run(
            ["git", "-C", cache_dir, "pull", "--depth", "1"],
            capture_output=True,
            text=True,
            timeout=60,
            env=_git_env(config),
        )
        if result.returncode != 0:
            logger.warning(f"agnosticv refresh failed, using stale cache (non-blocking): {result.stderr.strip()}")
            return True  # Stale cache is still usable
        os.utime(cache_dir, None)
        return True
    except Exception as e:
        logger.warning(f"agnosticv clone/refresh failed (non-blocking): {e}")
        return False
