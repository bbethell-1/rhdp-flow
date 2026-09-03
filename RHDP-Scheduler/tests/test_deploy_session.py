"""Tests for POST /api/deploy/session — per-session deploy.

The endpoint parses an explicitly-uploaded CSV into a LOCAL schedule list and
deploys THAT list (deploy correctness never depends on the shared global). It
also mirrors the parsed schedules into ``routes._schedules`` for Flow-dashboard
visibility (Upload tab).
"""

import io
import os
import sys

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch

from fastapi.testclient import TestClient

from api import routes
from api.jobs import Job, Status
from api.server import app

client = TestClient(app)

CSV = (
    "CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,"
    "Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)\n"
    "My Lab,my.ci.prod,user-ns,10,true,pw,Workshop,Demo,"
    "01/06/2026 14:00,01/06/2026 22:00,15/06/2026 14:00\n"
)


def test_deploy_session_mirrors_schedules_for_visibility():
    routes._schedules = []
    with patch.object(routes.jobs, "create_job", return_value=Job(job_id="abc123def456", status=Status.pending)), \
         patch.object(routes.asyncio, "create_task"):  # don't actually run the background deploy
        resp = client.post(
            "/api/deploy/session",
            files={"file": ("s.csv", io.BytesIO(CSV.encode()), "text/csv")},
            data={"dry_run": "true"},
        )
    assert resp.status_code == 200
    assert resp.json()["job_id"] == "abc123def456"
    # Parsed schedules are mirrored into the global for Flow-dashboard visibility.
    assert len(routes._schedules) == 1
    assert routes._schedules[0].ci == "my.ci.prod"


def test_deploy_session_requires_api_key(monkeypatch):
    monkeypatch.setenv("RHDP_API_KEY", "secret")
    resp = client.post(
        "/api/deploy/session",
        files={"file": ("s.csv", io.BytesIO(CSV.encode()), "text/csv")},
    )
    # Repo convention: verify_api_key raises 403 (not 401) on a missing key.
    assert resp.status_code == 403  # missing X-API-Key
