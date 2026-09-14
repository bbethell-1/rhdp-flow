from unittest.mock import patch

from fastapi.testclient import TestClient

from api.server import app
from api.services.labagator_client import LabagatorError

client = TestClient(app)


@patch("api.routes.labagator_client.list_events")
def test_list_labagator_events_returns_trimmed_shape(mock_list):
    mock_list.return_value = [
        {"id": 1, "name": "Roadshow", "start_date": "2026-08-27", "end_date": "2026-08-29", "location": "Room 1"},
    ]

    response = client.get("/api/labagator/events")

    assert response.status_code == 200
    data = response.json()
    assert data["error"] is None
    assert data["events"] == [
        {"id": 1, "name": "Roadshow", "start_date": "2026-08-27", "end_date": "2026-08-29", "location": "Room 1"},
    ]


@patch("api.routes.labagator_client.list_events")
def test_list_labagator_events_returns_empty_list_with_error_on_unreachable(mock_list):
    mock_list.side_effect = LabagatorError("Labagator unreachable: connection refused")

    response = client.get("/api/labagator/events")

    assert response.status_code == 200
    data = response.json()
    assert data["events"] == []
    assert data["error"] == "labagator_unreachable"


@patch("api.routes.labagator_client.list_events")
def test_list_labagator_events_handles_malformed_data(mock_list):
    mock_list.return_value = [{"id": 1, "name": "Event"}]  # missing start_date/end_date

    response = client.get("/api/labagator/events")

    assert response.status_code == 200
    data = response.json()
    assert data["events"] == []
    assert data["error"] == "labagator_unreachable"


@patch("api.routes.labagator_client.get_deploy_handoff_csv")
def test_labagator_preview_returns_session_count_and_csv(mock_csv):
    mock_csv.return_value = "Workshop Name,Namespace\nRoadshow,ns1\nRoadshow,ns1\n"

    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 1, "namespace": "ns1", "event_name": "Roadshow"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session_count"] == 2
    assert data["event_name"] == "Roadshow"
    assert data["csv_text"] == mock_csv.return_value


def test_labagator_preview_rejects_invalid_namespace():
    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 1, "namespace": "Not Valid!", "event_name": "Roadshow"},
    )

    assert response.status_code == 400


@patch("api.routes.labagator_client.get_deploy_handoff_csv")
def test_labagator_preview_propagates_labagator_error(mock_csv):
    from api.services.labagator_client import LabagatorError
    mock_csv.side_effect = LabagatorError("Labagator returned 404: event not found")

    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 999, "namespace": "ns1", "event_name": "Roadshow"},
    )

    assert response.status_code == 502
    assert "event not found" in response.json()["detail"]


@patch("api.routes.labagator_client.get_deploy_handoff_csv")
def test_labagator_preview_handles_malformed_csv(mock_csv):
    mock_csv.return_value = None  # non-string, would break CSV parsing

    response = client.get(
        "/api/schedules/labagator-preview",
        params={"event_id": 1, "namespace": "ns1", "event_name": "Roadshow"},
    )

    assert response.status_code == 502
    assert "invalid data" in response.json()["detail"].lower()


def test_import_from_labagator_ingests_csv_text():
    csv_text = (
        "CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,"
        "Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)\n"
        "Test Workshop,babylon-catalog-prod.test-ci.prod,ns1,25,True,pass123,Admin,QA,Test Workshop,"
        "27/08/2026 09:00,27/08/2026 17:00,28/08/2026 09:00\n"
    )

    response = client.post(
        "/api/schedules/import-from-labagator",
        json={"csv_text": csv_text, "filename": "roadshow.csv"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1


def test_labagator_import_endpoint():
    """POST Labagator CSV → Flow schedules (legacy manual-upload path, still supported)."""
    labagator_csv = """session_code,title,room,session_date,start_time,end_time,speakers,topics
TEST-01,Test Workshop,Room 1,2026-08-25,10:00,12:00,Alice,testing
"""

    response = client.post(
        "/api/schedules/import-labagator",
        files={"file": ("sessions.csv", labagator_csv, "text/csv")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert "TEST-01 - Test Workshop" in str(data["schedules"])


def test_labagator_import_rejects_invalid_csv():
    """Reject CSV missing required columns."""
    invalid_csv = """wrong,headers,here
1,2,3
"""

    response = client.post(
        "/api/schedules/import-labagator",
        files={"file": ("bad.csv", invalid_csv, "text/csv")},
    )

    assert response.status_code == 400
    # Either transformation fails or CSV parser finds no valid schedules
    assert "failed" in response.json()["detail"].lower() or "no valid" in response.json()["detail"].lower()
