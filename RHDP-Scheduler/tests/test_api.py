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
