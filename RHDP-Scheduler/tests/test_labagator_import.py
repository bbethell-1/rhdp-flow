from io import StringIO

from api.services.labagator_import import transform_labagator_to_flow


def test_transform_labagator_sessions_to_flow_csv():
    """Transform Labagator session export to Flow workshop schedule format."""
    labagator_csv = """session_code,title,room,session_date,start_time,end_time,speakers,topics
DEMO-101,Intro to OpenShift,Room A,2026-08-20,09:00,10:30,Alice,containers;kubernetes
DEMO-102,Advanced Networking,Room B,2026-08-20,11:00,12:30,Bob,networking;security
"""

    result = transform_labagator_to_flow(StringIO(labagator_csv))

    # Flow expects: Workshop Name, Start (UTC), Stop (UTC), Destroy (UTC), etc.
    assert "Workshop Name" in result
    assert "DEMO-101" in result
    assert "Intro to OpenShift" in result
    assert "20/08/2026 09:00" in result  # DD/MM/YYYY HH:MM format


def test_transform_preserves_session_codes():
    """Verify session codes are preserved in workshop names."""
    labagator_csv = """session_code,title,room,session_date,start_time,end_time,speakers,topics
RHEL-201,RHEL Automation,Hall 1,2026-09-15,14:00,16:00,Carol,ansible;automation
"""

    result = transform_labagator_to_flow(StringIO(labagator_csv))
    assert "RHEL-201 - RHEL Automation" in result
    assert "15/09/2026 14:00" in result  # Start
    assert "15/09/2026 16:00" in result  # Stop
    assert "15/09/2026 18:00" in result  # Destroy (+2h)


def test_transform_handles_midnight_crossing():
    """Verify sessions crossing midnight are handled correctly."""
    labagator_csv = """session_code,title,room,session_date,start_time,end_time,speakers,topics
NIGHT-01,Late Night Session,Room 1,2026-08-20,23:00,01:00,Dave,late;night
"""

    result = transform_labagator_to_flow(StringIO(labagator_csv))
    assert "20/08/2026 23:00" in result  # Start on 20th
    assert "21/08/2026 01:00" in result  # Stop on 21st (next day)
    assert "21/08/2026 03:00" in result  # Destroy on 21st (+2h)
