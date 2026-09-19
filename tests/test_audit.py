"""Tests for audit logging utility."""

import json
import logging

from api.audit import audit_log


def test_audit_log_writes_structured_json(caplog):
    """Audit log writes JSON with who/what/when fields."""
    caplog.set_level(logging.INFO, logger="rhdp_flow.audit")

    audit_log(
        action="auto_provision_clusters",
        user="test-api-key",
        details={"cluster_cis": ["ocp4-cluster.prod"], "count": 1}
    )

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.levelname == "INFO"

    # Parse the logged message as JSON
    log_data = json.loads(record.message)
    assert log_data["action"] == "auto_provision_clusters"
    assert log_data["user"] == "test-api-key"
    assert log_data["details"]["cluster_cis"] == ["ocp4-cluster.prod"]
    assert log_data["details"]["count"] == 1
    assert "timestamp" in log_data


def test_audit_log_handles_empty_details(caplog):
    """Audit log accepts empty details dict."""
    caplog.set_level(logging.INFO, logger="rhdp_flow.audit")

    audit_log(action="test_action", user="test-user", details={})

    assert len(caplog.records) == 1
    log_data = json.loads(caplog.records[0].message)
    assert log_data["details"] == {}
