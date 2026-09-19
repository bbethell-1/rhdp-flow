"""Audit logging utility for tracking high-risk operations."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("rhdp_flow.audit")


def audit_log(action: str, user: str, details: dict[str, Any]) -> None:
    """
    Log a structured audit record.

    Args:
        action: Operation name (e.g., "auto_provision_clusters", "remove_auto_provisioned")
        user: User or API key identifier
        details: Operation-specific data (cluster CIs, counts, etc.)
    """
    record = {
        "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        "action": action,
        "user": user,
        "details": details,
    }
    logger.info(json.dumps(record))
