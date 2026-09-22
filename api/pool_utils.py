"""Pool lookup utilities for checking ResourcePool availability."""

from __future__ import annotations

import json
import logging
import subprocess

logger = logging.getLogger("rhdp_flow.api.pools")


def get_pool_for_catalog_item(catalog_item: str, namespace: str = "poolboy", *, env=None) -> dict | None:
    """
    Lookup ResourcePool for a given catalog item.

    Returns pool info if found:
    {
        "pool_name": str,
        "min_available": int,
        "ready": int,
        "unclaimed": int,
        "claimed": int,
        "provisioning": int,
        "lifespan_default": str,
        "lifespan_unclaimed": str,
        "provider_name": str,
        "exists": bool
    }

    Returns None if no pool found.
    """
    try:
        # Check if pool exists with exact catalog item name
        result = subprocess.run(
            ["oc", "get", "resourcepool", "-n", namespace, catalog_item, "-o", "json"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env=env,
        )

        if result.returncode != 0:
            return None

        pool_data = json.loads(result.stdout)

        # Extract pool info
        spec = pool_data.get("spec", {})
        status = pool_data.get("status", {})
        resource_counts = status.get("resourceHandleCount", {})

        return {
            "pool_name": pool_data["metadata"]["name"],
            "min_available": spec.get("minAvailable", 0),
            "max_available": spec.get("maxAvailable"),
            "ready": resource_counts.get("ready", 0),
            "available": resource_counts.get("available", 0),
            "claimed": resource_counts.get("claimed", 0),
            "provisioning": resource_counts.get("available", 0) - resource_counts.get("ready", 0),
            "lifespan_default": spec.get("lifespan", {}).get("default", "N/A"),
            "lifespan_unclaimed": spec.get("lifespan", {}).get("unclaimed", "N/A"),
            "lifespan_maximum": spec.get("lifespan", {}).get("maximum", "N/A"),
            "provider_name": spec.get("resources", [{}])[0].get("provider", {}).get("name", catalog_item),
            "exists": True,
        }

    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        logger.warning(f"Failed to lookup pool for {catalog_item}: {e}")
        return None


def list_all_pools(namespace: str = "poolboy", *, env=None) -> list[dict]:
    """
    List all ResourcePools in the given namespace.

    Returns list of pool info dicts (same structure as get_pool_for_catalog_item).
    """
    try:
        result = subprocess.run(
            ["oc", "get", "resourcepool", "-n", namespace, "-o", "json"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=env,
        )

        if result.returncode != 0:
            logger.error(f"Failed to list pools: {result.stderr}")
            return []

        pools_data = json.loads(result.stdout)
        pools = []

        for pool in pools_data.get("items", []):
            spec = pool.get("spec", {})
            status = pool.get("status", {})
            resource_counts = status.get("resourceHandleCount", {})

            pools.append({
                "pool_name": pool["metadata"]["name"],
                "min_available": spec.get("minAvailable", 0),
                "max_available": spec.get("maxAvailable"),
                "ready": resource_counts.get("ready", 0),
                "available": resource_counts.get("available", 0),
                "claimed": resource_counts.get("claimed", 0),
                "provisioning": resource_counts.get("available", 0) - resource_counts.get("ready", 0),
                "lifespan_default": spec.get("lifespan", {}).get("default", "N/A"),
                "lifespan_unclaimed": spec.get("lifespan", {}).get("unclaimed", "N/A"),
                "lifespan_maximum": spec.get("lifespan", {}).get("maximum", "N/A"),
                "provider_name": spec.get("resources", [{}])[0].get("provider", {}).get("name", ""),
                "exists": True,
            })

        return sorted(pools, key=lambda p: p["pool_name"])

    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        logger.error(f"Failed to list pools: {e}")
        return []
