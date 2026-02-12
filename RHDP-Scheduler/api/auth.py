"""Optional API key authentication for RHDP-Flow.

When RHDP_API_KEY is set in the environment, all mutation endpoints
require the X-API-Key header to match. Read-only endpoints (GET) are
not protected. When the env var is unset, auth is bypassed entirely.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _get_required_key() -> Optional[str]:
    """Return the configured API key, or None if auth is disabled."""
    return os.environ.get("RHDP_API_KEY")


async def verify_api_key(
    api_key: Optional[str] = Security(_api_key_header),
) -> Optional[str]:
    """Dependency that enforces API key auth when RHDP_API_KEY is set."""
    required = _get_required_key()
    if required is None:
        # Auth not configured — allow all requests
        return None
    if not api_key or api_key != required:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")
    return api_key
