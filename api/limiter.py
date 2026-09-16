"""Shared SlowAPI limiter instance for RHDP-Flow.

Extracted to avoid circular imports between server.py and routes.py.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("rhdp_flow.api")

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
except ImportError:
    limiter = None  # type: ignore[assignment]
    logger.warning("slowapi not installed — per-route rate limiting disabled")
