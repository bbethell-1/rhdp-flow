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
from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from rhdp_flow import RHDPConfig

logger = logging.getLogger("rhdp_flow.agnosticv_resolver")


def _git_env(config: RHDPConfig) -> dict:
    env = os.environ.copy()
    if config.agnosticv_ssh_key_path:
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {shlex.quote(config.agnosticv_ssh_key_path)} "
            "-o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
        )
    return env


def _ensure_repo_cloned(config: RHDPConfig) -> bool:
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


def _ci_to_agnosticv_path(ci: str) -> str | None:
    """Convert a Babylon CI ('account.item.stage') to an AgnosticV path ('account/item/stage')."""
    parts = ci.split(".")
    if len(parts) != 3:
        logger.warning(f"CI '{ci}' is not in 'account.item.stage' form; skipping AgnosticV resolution")
        return None
    account, item, stage = parts
    return f"{account}/{item}/{stage}"


def _agnosticv_path_to_ci(path: str, default_stage: str) -> str:
    """Convert an AgnosticV path ('account/item[/stage]') back to a Babylon CI ('account.item.stage').

    If the path omits /stage, defaults to the tenant's own stage per the
    tenant_cluster.item schema.
    """
    segments = path.strip("/").split("/")
    if len(segments) == 3:
        account, item, stage = segments
    elif len(segments) == 2:
        account, item = segments
        stage = default_stage
    else:
        raise ValueError(f"Unexpected AgnosticV path shape: {path!r}")
    return f"{account}.{item}.{stage}"


def resolve_tenant_cluster_item(ci: str, config: RHDPConfig) -> str | None:
    """Resolve the cluster CI a tenant CI binds to, via AgnosticV's tenant_cluster.item.

    Args:
        ci: Tenant catalog item identifier, e.g. "ai-quickstarts.ai-qs-rag-tenant.prod".
        config: RHDPConfig with agnosticv_* settings.

    Returns:
        The resolved cluster CI (e.g. "ai-quickstarts.ai-qs-rag-cluster.prod"),
        or None if resolution is unavailable for any reason. Never raises.
    """
    agnosticv_path = _ci_to_agnosticv_path(ci)
    if agnosticv_path is None:
        return None

    if not _ensure_repo_cloned(config):
        return None

    try:
        stage = agnosticv_path.split("/")[-1]
        result = subprocess.run(
            [config.agnosticv_cli_path, "--merge", agnosticv_path],
            cwd=config.agnosticv_cache_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning(f"agnosticv --merge failed for '{agnosticv_path}' (non-blocking): {result.stderr.strip()}")
            return None

        merged = yaml.safe_load(result.stdout)
        if not isinstance(merged, dict):
            logger.warning(f"agnosticv --merge for '{agnosticv_path}' produced no usable YAML (non-blocking)")
            return None

        sandboxes = merged.get("__meta__", {}).get("sandboxes", []) or []
        for sandbox in sandboxes:
            tenant_cluster = (sandbox or {}).get("tenant_cluster") or {}
            cluster_item_path = tenant_cluster.get("item")
            if cluster_item_path:
                return _agnosticv_path_to_ci(cluster_item_path, default_stage=stage)

        logger.debug(f"No tenant_cluster.item found for '{ci}' in AgnosticV")
        return None
    except Exception as e:
        logger.warning(f"AgnosticV resolution failed for '{ci}' (non-blocking): {e}")
        return None
