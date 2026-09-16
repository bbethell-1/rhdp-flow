from api.models import LabagatorEventsResponse, LabagatorEventSummary, LabagatorImportRequest, LabagatorPreviewResponse


def test_labagator_event_summary_shape():
    e = LabagatorEventSummary(id=1, name="Roadshow", start_date="2026-08-27", end_date="2026-08-29", location="Room 1")
    assert e.id == 1
    assert e.name == "Roadshow"


def test_labagator_events_response_defaults_no_error():
    r = LabagatorEventsResponse(events=[])
    assert r.events == []
    assert r.error is None


def test_labagator_events_response_with_error():
    r = LabagatorEventsResponse(events=[], error="labagator_unreachable")
    assert r.error == "labagator_unreachable"


def test_labagator_preview_response_shape():
    r = LabagatorPreviewResponse(event_name="Roadshow", session_count=3, csv_text="a,b\n1,2\n")
    assert r.session_count == 3


def test_labagator_import_request_shape():
    r = LabagatorImportRequest(csv_text="a,b\n1,2\n")
    assert r.filename == "labagator-import.csv"
