"""Tests for the FastAPI endpoints using TestClient."""

import io
import json
import os
import sys

import pytest

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from api.server import app
from api import routes
from api.limiter import limiter as _test_limiter
from tests.conftest import BASIC_WORKSHOP_CSV, make_oc_dispatcher


@pytest.fixture(autouse=True)
def reset_state():
    """Reset module-level state between tests."""
    routes._schedules = []
    routes._deployment_results = []
    routes._qa_results = []
    routes._csv_filepath = None
    routes._current_filename = ""
    routes._sessions = []
    routes._session_counter = 0
    routes._asset_passwords = None
    routes._cached_base_domain = None
    routes._deploy_log_path = None
    routes._qa_log_path = None
    routes._destroy_check_results = []
    # Reset rate limiter storage so per-route limits don't bleed across tests
    if _test_limiter:
        _test_limiter.reset()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def uploaded_client(client):
    """Client with a CSV already uploaded."""
    resp = client.post(
        "/api/schedules/upload",
        files={"file": ("test.csv", BASIC_WORKSHOP_CSV.encode(), "text/csv")},
    )
    assert resp.status_code == 200
    return client


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@patch("subprocess.run")
def test_health_connected(mock_run, client):
    def dispatcher(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        if "version" in cmd:
            return MagicMock(returncode=0, stdout="Client Version: 4.14.0\n", stderr="")
        if "whoami" in cmd and "--show-server" in cmd:
            return MagicMock(returncode=0, stdout="https://api.cluster.example.com:6443\n", stderr="")
        if "whoami" in cmd:
            return MagicMock(returncode=0, stdout="admin\n", stderr="")
        return MagicMock(returncode=0, stdout="", stderr="")
    mock_run.side_effect = dispatcher
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["oc_connected"] is True
    assert data["oc_installed"] is True
    assert data["user"] == "admin"
    assert "cluster.example.com" in data["cluster_url"]
    assert data["status"] == "ok"


@patch("subprocess.run")
def test_health_returns_base_domain(mock_run, client):
    """Health endpoint returns base_domain derived from cluster URL."""
    routes._cached_base_domain = None  # clear cache
    def dispatcher(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        if "version" in cmd:
            return MagicMock(returncode=0, stdout="Client Version: 4.14.0\n", stderr="")
        if "whoami" in cmd and "--show-server" in cmd:
            return MagicMock(returncode=0, stdout="https://api.integration.demo.redhat.com:6443\n", stderr="")
        if "whoami" in cmd:
            return MagicMock(returncode=0, stdout="admin\n", stderr="")
        return MagicMock(returncode=0, stdout="", stderr="")
    mock_run.side_effect = dispatcher
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["base_domain"] == "integration.demo.redhat.com"


@patch("subprocess.run")
def test_health_disconnected(mock_run, client):
    def dispatcher(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        # oc version --client succeeds (binary found)
        if "version" in cmd:
            return MagicMock(returncode=0, stdout="Client Version: 4.14.0\n", stderr="")
        # oc whoami fails (cluster unreachable)
        return MagicMock(returncode=1, stdout="", stderr="connection refused")
    mock_run.side_effect = dispatcher
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["oc_installed"] is True
    assert data["oc_connected"] is False
    assert "connection refused" in data["message"]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

def test_upload_csv(client):
    resp = client.post(
        "/api/schedules/upload",
        files={"file": ("test.csv", BASIC_WORKSHOP_CSV.encode(), "text/csv")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert data["schedules"][0]["ci_name"] == "Experience OpenShift Virtualization Roadshow"


def test_upload_invalid_csv(client):
    bad_csv = "Name,Value\nfoo,bar\n"
    resp = client.post(
        "/api/schedules/upload",
        files={"file": ("bad.csv", bad_csv.encode(), "text/csv")},
    )
    assert resp.status_code == 400


def test_get_schedules_empty(client):
    resp = client.get("/api/schedules")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_schedules_after_upload(uploaded_client):
    resp = uploaded_client.get("/api/schedules")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Upload Passwords
# ---------------------------------------------------------------------------

PASSWORDS_CSV = "CI,Password\nci-one.prod,pass1\nci-two.prod,pass2\nci-three.prod,pass3\n"


def test_upload_passwords(client):
    resp = client.post(
        "/api/schedules/upload-passwords",
        files={"file": ("passwords.csv", PASSWORDS_CSV.encode(), "text/csv")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 3
    assert "3" in data["message"]


def test_upload_passwords_empty(client):
    empty_csv = "CI,Password\n"
    resp = client.post(
        "/api/schedules/upload-passwords",
        files={"file": ("passwords.csv", empty_csv.encode(), "text/csv")},
    )
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


def test_clear_resets_passwords(client):
    client.post(
        "/api/schedules/upload-passwords",
        files={"file": ("passwords.csv", PASSWORDS_CSV.encode(), "text/csv")},
    )
    assert routes._asset_passwords is not None
    client.post("/api/sessions/clear", json={})
    assert routes._asset_passwords is None


# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

def test_deploy_no_schedules(client):
    resp = client.post("/api/deploy", json={})
    assert resp.status_code == 400


def test_dry_run_deploy(uploaded_client):
    resp = uploaded_client.post("/api/deploy/dry-run", json={})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert data[0]["ci_name"] == "Experience OpenShift Virtualization Roadshow"
    assert data[0]["status"] in ("verified", "deployed_unverified", "deployed_no_url")


def test_get_results_empty(client):
    resp = client.get("/api/deploy/results")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_results_after_dry_run(uploaded_client):
    uploaded_client.post("/api/deploy/dry-run", json={})
    resp = uploaded_client.get("/api/deploy/results")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_deploy_status_not_found(client):
    resp = client.get("/api/deploy/status/nonexistent")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Operations (require loaded schedules)
# ---------------------------------------------------------------------------

def test_lock_no_schedules(client):
    resp = client.post("/api/operations/lock", json={})
    assert resp.status_code == 400


@patch("rhdp_flow.subprocess.run")
def test_lock_with_schedules(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post("/api/operations/lock", json={})
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_unlock_no_schedules(client):
    resp = client.post("/api/operations/unlock", json={})
    assert resp.status_code == 400


@patch("rhdp_flow.subprocess.run")
def test_unlock_with_schedules(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post("/api/operations/unlock", json={})
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert "Unlocked" in resp.json()["message"]


def test_extend_stop_no_days_hours(uploaded_client):
    resp = uploaded_client.post(
        "/api/operations/extend-stop", json={"days": 0, "hours": 0}
    )
    assert resp.status_code == 400


@patch("rhdp_flow.subprocess.run")
def test_extend_stop(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post(
        "/api/operations/extend-stop", json={"days": 1, "hours": 2}
    )
    assert resp.status_code == 200
    assert "Extended stop" in resp.json()["message"]


@patch("rhdp_flow.subprocess.run")
def test_extend_destroy(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post(
        "/api/operations/extend-destroy", json={"days": 1, "hours": 0}
    )
    assert resp.status_code == 200


@patch("rhdp_flow.subprocess.run")
def test_scale(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post(
        "/api/operations/scale", json={"target_count": 40}
    )
    assert resp.status_code == 200
    assert "Scaled" in resp.json()["message"]


def test_disable_autostop_no_schedules(client):
    resp = client.post("/api/operations/disable-autostop", json={})
    assert resp.status_code == 400


@patch("rhdp_flow.subprocess.run")
def test_disable_autostop(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post("/api/operations/disable-autostop", json={})
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert "Disabled auto-stop" in resp.json()["message"]


@patch("rhdp_flow.subprocess.run")
def test_disable_autostop_with_filter(mock_run, uploaded_client):
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post(
        "/api/operations/disable-autostop",
        json={"ci_filter": "openshift-cnv.ocp-virt-roadshow-multi-user.prod"},
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


# ---------------------------------------------------------------------------
# QA
# ---------------------------------------------------------------------------

def test_qa_no_schedules(client):
    resp = client.post("/api/qa/run", json={"type": "1"})
    assert resp.status_code == 400


def test_qa_results_empty(client):
    resp = client.get("/api/qa/results")
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def test_export_results_no_data(client):
    resp = client.get("/api/export/results")
    assert resp.status_code == 404


def test_export_results_after_dry_run(uploaded_client):
    uploaded_client.post("/api/deploy/dry-run", json={})
    resp = uploaded_client.get("/api/export/results")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert "ci_name" in resp.text


def test_export_students_no_data(client):
    resp = client.get("/api/export/students")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def test_sessions_empty(client):
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_clear_no_data(client):
    resp = client.post("/api/sessions/clear", json={})
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_count"] == 0


def test_clear_archives_session(uploaded_client):
    uploaded_client.post("/api/deploy/dry-run", json={})
    resp = uploaded_client.post("/api/sessions/clear", json={})
    assert resp.status_code == 200
    assert resp.json()["session_count"] == 1
    # Current state should be empty
    resp = uploaded_client.get("/api/schedules")
    assert resp.json() == []
    resp = uploaded_client.get("/api/deploy/results")
    assert resp.json() == []


def test_view_archived_session(uploaded_client):
    uploaded_client.post("/api/deploy/dry-run", json={})
    uploaded_client.post("/api/sessions/clear", json={})
    # View the archived session
    resp = uploaded_client.get("/api/sessions/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == "1"
    assert len(data["schedules"]) == 1
    assert len(data["results"]) >= 1


def test_session_not_found(client):
    resp = client.get("/api/sessions/999")
    assert resp.status_code == 404


def test_multiple_sessions(uploaded_client):
    # First session
    uploaded_client.post("/api/deploy/dry-run", json={})
    uploaded_client.post("/api/sessions/clear", json={})
    # Second upload + session
    uploaded_client.post(
        "/api/schedules/upload",
        files={"file": ("test2.csv", BASIC_WORKSHOP_CSV.encode(), "text/csv")},
    )
    uploaded_client.post("/api/sessions/clear", json={})
    # Should have 2 sessions
    resp = uploaded_client.get("/api/sessions")
    assert len(resp.json()) == 2
    assert resp.json()[0]["session_id"] == "1"
    assert resp.json()[1]["session_id"] == "2"


# ---------------------------------------------------------------------------
# Detect and Cache Base Domain
# ---------------------------------------------------------------------------

@patch("api.routes.subprocess.run")
def test_detect_and_cache_base_domain(mock_run):
    """_detect_and_cache_base_domain derives domain from oc whoami."""
    routes._cached_base_domain = None  # clear cache
    mock_run.return_value = MagicMock(
        returncode=0, stdout="https://api.staging.demo.redhat.com:6443\n"
    )
    from api.routes import _detect_and_cache_base_domain
    result = _detect_and_cache_base_domain()
    assert result == "staging.demo.redhat.com"
    routes._cached_base_domain = None  # cleanup


@patch("api.routes.subprocess.run")
def test_detect_and_cache_base_domain_caches(mock_run):
    """Second call returns cached value without calling oc."""
    routes._cached_base_domain = None
    mock_run.return_value = MagicMock(
        returncode=0, stdout="https://api.prod.demo.redhat.com:6443\n"
    )
    from api.routes import _detect_and_cache_base_domain
    first = _detect_and_cache_base_domain()
    assert first == "prod.demo.redhat.com"
    mock_run.reset_mock()
    second = _detect_and_cache_base_domain()
    assert second == "prod.demo.redhat.com"
    mock_run.assert_not_called()  # cache hit, no subprocess call
    routes._cached_base_domain = None


@patch("api.routes.subprocess.run")
def test_detect_and_cache_base_domain_fallback(mock_run):
    """Fallback to default domain when oc fails."""
    routes._cached_base_domain = None
    mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
    from api.routes import _detect_and_cache_base_domain
    result = _detect_and_cache_base_domain()
    assert result == "integration.demo.redhat.com"
    routes._cached_base_domain = None


# ---------------------------------------------------------------------------
# Deploy Settings Passthrough
# ---------------------------------------------------------------------------

def test_dry_run_deploy_settings_default(uploaded_client):
    """Dry-run deploy with default settings produces results."""
    resp = uploaded_client.post("/api/deploy/dry-run", json={})
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_dry_run_deploy_with_custom_settings(uploaded_client):
    """Dry-run deploy accepts resource_lock, enable_resource_pools, white_glove."""
    resp = uploaded_client.post("/api/deploy/dry-run", json={
        "resource_lock": False,
        "enable_resource_pools": True,
        "white_glove": False,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1


# ---------------------------------------------------------------------------
# Template Download
# ---------------------------------------------------------------------------

def test_template_download(client):
    resp = client.get("/api/templates/schedule")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert "CI Name" in resp.text
    assert "Example Workshop" in resp.text


# ---------------------------------------------------------------------------
# Retry
# ---------------------------------------------------------------------------

def test_retry_no_schedules(client):
    resp = client.post("/api/deploy/retry", json={"ci_names": ["foo"]})
    assert resp.status_code == 400


def test_retry_no_matching_ci(uploaded_client):
    resp = uploaded_client.post(
        "/api/deploy/retry", json={"ci_names": ["Nonexistent Workshop"]}
    )
    assert resp.status_code == 404


def test_retry_empty_ci_names(client):
    """Retry with empty ci_names list should fail validation."""
    resp = client.post("/api/deploy/retry", json={"ci_names": []})
    assert resp.status_code == 422  # Pydantic validation error


# ---------------------------------------------------------------------------
# Diff
# ---------------------------------------------------------------------------

def test_diff_no_schedules(client):
    resp = client.post(
        "/api/schedules/diff",
        files={"file": ("new.csv", BASIC_WORKSHOP_CSV.encode(), "text/csv")},
    )
    assert resp.status_code == 400


def test_diff_with_same_csv(uploaded_client):
    """Diffing the same CSV should show zero changes."""
    resp = uploaded_client.post(
        "/api/schedules/diff",
        files={"file": ("new.csv", BASIC_WORKSHOP_CSV.encode(), "text/csv")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["added"] == []
    assert data["removed"] == []
    assert data["changed"] == []
    assert data["unchanged"] == 1


def test_diff_detects_removal(uploaded_client):
    """Uploading an empty-data CSV shows the original as removed."""
    # An entirely different CI should show 1 added, 1 removed
    other_csv = """\
CI Name,CI,Namespace,Users,Workshop_instance_count,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC),Multi_Asset,Asset_CIs,Multi_Workshop_Name,Concurrency,Instances,Salesforce IDs
New Workshop,new-vendor.new-item.prod,user-new-ns,10,1,True,Pass1,Admin,QA,New WS,15/02/2026 11:00,15/02/2026 19:00,17/02/2026 11:00,,,,,,
"""
    resp = uploaded_client.post(
        "/api/schedules/diff",
        files={"file": ("new.csv", other_csv.encode(), "text/csv")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["added"]) == 1
    assert len(data["removed"]) == 1
    assert data["unchanged"] == 0


# ---------------------------------------------------------------------------
# Error Paths
# ---------------------------------------------------------------------------

def test_upload_non_csv_content(client):
    """Uploading non-CSV content should fail."""
    resp = client.post(
        "/api/schedules/upload",
        files={"file": ("bad.csv", b"not,a,real,csv\nno,matching,headers,here", "text/csv")},
    )
    assert resp.status_code == 400


def test_deploy_malformed_json(client):
    """Malformed JSON body should return 422."""
    resp = client.post(
        "/api/deploy",
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


@patch("rhdp_flow.subprocess.run")
def test_operations_scale_to_zero(mock_run, uploaded_client):
    """Scale to 0 is valid (removes all instances)."""
    mock_run.side_effect = make_oc_dispatcher()
    resp = uploaded_client.post(
        "/api/operations/scale", json={"target_count": 0}
    )
    assert resp.status_code == 200


def test_operations_scale_negative(uploaded_client):
    """Scale with negative count should fail validation."""
    resp = uploaded_client.post(
        "/api/operations/scale", json={"target_count": -1}
    )
    assert resp.status_code in (400, 422)


def test_qa_invalid_type(uploaded_client):
    """QA with invalid type should fail."""
    resp = uploaded_client.post("/api/qa/run", json={"type": "999"})
    assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Session List Cap
# ---------------------------------------------------------------------------

def test_session_list_cap(client):
    """Session list is capped at MAX_SESSIONS (50)."""
    for i in range(55):
        # Upload a CSV, then clear to archive a session
        client.post(
            "/api/schedules/upload",
            files={"file": ("test.csv", BASIC_WORKSHOP_CSV.encode(), "text/csv")},
        )
        client.post("/api/sessions/clear", json={})
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) <= 50


# ---------------------------------------------------------------------------
# Upload Size Limit
# ---------------------------------------------------------------------------

def test_upload_csv_size_limit(client):
    """Uploading a file > 10 MB should return 413."""
    big_content = b"x" * (10 * 1024 * 1024 + 1)  # Just over 10MB
    resp = client.post(
        "/api/schedules/upload",
        files={"file": ("big.csv", big_content, "text/csv")},
    )
    assert resp.status_code == 413


# ---------------------------------------------------------------------------
# Extend Days Cap
# ---------------------------------------------------------------------------

def test_extend_days_cap(uploaded_client):
    """Extending by more than 30 days should return 422."""
    resp = uploaded_client.post(
        "/api/operations/extend-stop", json={"days": 31, "hours": 0}
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# num_users Validation
# ---------------------------------------------------------------------------

def test_validate_num_users_no_schedules(client):
    """Should 400 when no schedules are loaded."""
    resp = client.post("/api/schedules/validate-num-users")
    assert resp.status_code == 400


@patch("api.routes.get_catalog_item_num_users_limit")
def test_validate_num_users_no_violations(mock_limit, uploaded_client):
    """No violations when users are within the catalog limit."""
    mock_limit.return_value = {"has_num_users": True, "maximum": 40, "minimum": 2, "default": 2}
    resp = uploaded_client.post("/api/schedules/validate-num-users")
    assert resp.status_code == 200
    data = resp.json()
    assert data["violations"] == []
    assert data["checked"] == 1
    assert data["limits"]["openshift-cnv.ocp-virt-roadshow-multi-user.prod"] == 40


@patch("api.routes.get_catalog_item_num_users_limit")
def test_validate_num_users_violation(mock_limit, uploaded_client):
    """Violation returned when users exceed the catalog maximum."""
    mock_limit.return_value = {"has_num_users": True, "maximum": 10, "minimum": 2, "default": 2}
    resp = uploaded_client.post("/api/schedules/validate-num-users")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["violations"]) == 1
    v = data["violations"][0]
    assert v["requested_users"] == 20
    assert v["maximum"] == 10


@patch("api.routes.get_catalog_item_num_users_limit")
def test_validate_num_users_cluster_unreachable(mock_limit, uploaded_client):
    """Gracefully skips when cluster is unreachable (returns None)."""
    mock_limit.return_value = None
    resp = uploaded_client.post("/api/schedules/validate-num-users")
    assert resp.status_code == 200
    data = resp.json()
    assert data["violations"] == []
    assert data["skipped"] == 1
    assert data["checked"] == 0


@patch("api.routes.get_catalog_item_num_users_limit")
def test_deploy_blocked_when_limit_exceeded(mock_limit, uploaded_client):
    """Live deploy returns 400 when users exceed the catalog limit."""
    mock_limit.return_value = {"has_num_users": True, "maximum": 10, "minimum": 2, "default": 2}
    resp = uploaded_client.post("/api/deploy", json={"dry_run": False})
    assert resp.status_code == 400
    assert "num_users limit exceeded" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Log Capture
# ---------------------------------------------------------------------------

@pytest.fixture
def log_dir(tmp_path, monkeypatch):
    """Redirect log output to a temp directory."""
    monkeypatch.setenv("RHDP_LOG_DIR", str(tmp_path))
    return tmp_path


def test_dry_run_creates_log_file(uploaded_client, log_dir):
    """Dry-run deploy creates a deploy log file."""
    resp = uploaded_client.post("/api/deploy/dry-run", json={})
    assert resp.status_code == 200
    log_files = list(log_dir.glob("deploy-dryrun_*.log"))
    assert len(log_files) >= 1


def test_list_logs(uploaded_client, log_dir):
    """GET /api/logs lists log files after a deploy."""
    uploaded_client.post("/api/deploy/dry-run", json={})
    resp = uploaded_client.get("/api/logs")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["files"]) >= 1
    assert data["files"][0].endswith(".log")


def test_download_log(uploaded_client, log_dir):
    """GET /api/logs/{filename} returns log content."""
    uploaded_client.post("/api/deploy/dry-run", json={})
    # Get the filename from the listing
    list_resp = uploaded_client.get("/api/logs")
    filename = list_resp.json()["files"][0]
    resp = uploaded_client.get(f"/api/logs/{filename}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/plain; charset=utf-8"


def test_download_log_traversal_protection(client, log_dir):
    """Directory traversal in log filename returns 400."""
    resp = client.get("/api/logs/..%2F..%2Fetc%2Fpasswd")
    assert resp.status_code in (400, 404)
    # Also test that a filename with .. is rejected
    resp2 = client.get("/api/logs/..secret.log")
    assert resp2.status_code == 400


def test_download_log_not_found(client, log_dir):
    """Non-existent log file returns 404."""
    resp = client.get("/api/logs/nonexistent.log")
    assert resp.status_code == 404


def test_list_logs_empty(client, log_dir):
    """GET /api/logs returns empty list when no logs exist."""
    resp = client.get("/api/logs")
    assert resp.status_code == 200
    assert resp.json()["files"] == []


def test_deploy_status_includes_log_file(uploaded_client, log_dir):
    """Deploy dry-run sets _deploy_log_path, visible via session archive."""
    uploaded_client.post("/api/deploy/dry-run", json={})
    # The log path should be set on the module state
    assert routes._deploy_log_path is not None
    assert routes._deploy_log_path.endswith(".log")


# ---------------------------------------------------------------------------
# Destroy QA
# ---------------------------------------------------------------------------

def test_destroy_check_no_csv(client):
    """POST /qa/destroy-check returns 400 when no CSV uploaded."""
    resp = client.post("/api/qa/destroy-check")
    assert resp.status_code == 400


@patch("rhdp_flow.subprocess.run")
def test_destroy_check_runs(mock_run, uploaded_client):
    """Upload CSV, mock oc get, run destroy-check, verify response structure."""
    def dispatcher(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        if not cmd:
            return MagicMock(returncode=0, stdout="", stderr="")
        # Return empty items for all oc get calls
        if "get" in cmd:
            return MagicMock(
                returncode=0,
                stdout=json.dumps({"items": []}),
                stderr="",
            )
        return MagicMock(returncode=0, stdout="", stderr="")
    mock_run.side_effect = dispatcher
    resp = uploaded_client.post("/api/qa/destroy-check")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    r = data["results"][0]
    assert "ci_name" in r
    assert "overall_status" in r
    assert "stop_status" in r
    assert "workshop" in r
    assert r["workshop"]["exists"] is False


def test_destroy_check_results_empty(client):
    """GET /qa/destroy-check/results returns empty list before any run."""
    resp = client.get("/api/qa/destroy-check/results")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0
    assert data["results"] == []


@patch("rhdp_flow.subprocess.run")
def test_destroy_check_results_after_run(mock_run, uploaded_client):
    """GET returns stored results after running destroy-check."""
    mock_run.side_effect = lambda *a, **kw: MagicMock(
        returncode=0,
        stdout=json.dumps({"items": []}),
        stderr="",
    )
    uploaded_client.post("/api/qa/destroy-check")
    resp = uploaded_client.get("/api/qa/destroy-check/results")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    assert len(data["results"]) >= 1


@patch("rhdp_flow.subprocess.run")
def test_destroy_check_in_session(mock_run, uploaded_client):
    """Verify destroy check results are included in session archive."""
    mock_run.side_effect = lambda *a, **kw: MagicMock(
        returncode=0,
        stdout=json.dumps({"items": []}),
        stderr="",
    )
    uploaded_client.post("/api/qa/destroy-check")
    uploaded_client.post("/api/sessions/clear", json={})
    resp = uploaded_client.get("/api/sessions/1")
    assert resp.status_code == 200
    data = resp.json()
    assert "destroy_check_results" in data
    assert len(data["destroy_check_results"]) >= 1
