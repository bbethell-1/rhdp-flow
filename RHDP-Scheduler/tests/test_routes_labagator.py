from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)

def test_labagator_import_endpoint():
    """POST Labagator CSV → Flow schedules."""
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
