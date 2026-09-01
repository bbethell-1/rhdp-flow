"""Transform Labagator event exports to Flow workshop schedule format."""

import csv
import logging
from datetime import datetime, timedelta
from io import StringIO
from typing import TextIO

logger = logging.getLogger("rhdp_flow.labagator_import")


def _estimate_user_count(session_length_hours: float, audience_level: str = None, expected_attendees: int = None) -> int:
    """
    Estimate user count based on session metadata.

    Priority:
    1. If expected_attendees is provided, use it
    2. Map audience_level to typical counts
    3. Fall back to session length heuristic
    """
    if expected_attendees and expected_attendees > 0:
        return expected_attendees

    if audience_level:
        level_map = {
            "beginner": 50,
            "intermediate": 30,
            "advanced": 20,
            "expert": 15,
        }
        return level_map.get(audience_level.lower(), 25)

    # Session length heuristic
    if session_length_hours < 1:
        return 30  # Short demos, more audience
    elif session_length_hours <= 2:
        return 25  # Standard workshop
    else:
        return 20  # Deep dive, hands-on


def _calculate_buffer_hours(session_length_hours: float, buffer_hours: int = None) -> int:
    """
    Calculate destroy buffer based on session length.

    Allows manual override, otherwise uses smart defaults.
    """
    if buffer_hours is not None:
        return buffer_hours

    if session_length_hours < 1:
        return 1
    elif session_length_hours <= 2:
        return 2
    else:
        return 3


def transform_labagator_to_flow(
    labagator_csv: TextIO,
    default_ci: str = "PLACEHOLDER_CATALOG_ITEM",
    default_users: int = None,
    default_redirect: bool = True,
    default_white_glove: bool = True,
    buffer_hours: int = None,
    timezone_offset_hours: int = 0,
) -> str:
    """Transform Labagator session CSV export to Flow schedule CSV format.

    Labagator exports sessions with:
    - session_code, title, room, session_date, start_time, end_time, speakers, topics
    - Optional: audience_level, expected_attendees, track

    Flow expects workshops with:
    - Workshop Name, Start (UTC), Stop (UTC), Destroy (UTC), Users,
      Enable_workshop_interface, Catalog_item, Multi_Asset, etc.

    Args:
        labagator_csv: File-like object containing Labagator session export
        default_ci: Default catalog item ID (user can override per session)
        default_users: Default number of users (None = smart estimation)
        default_redirect: Default redirect setting (default: True)
        default_white_glove: Default white glove setting (default: True)
        buffer_hours: Hours between session end and auto-destroy (None = smart calculation)
        timezone_offset_hours: Hours to add for timezone conversion (e.g., +4 for EDT to UTC)

    Returns:
        Flow-compatible CSV as string
    """
    reader = csv.DictReader(labagator_csv)
    output = StringIO()

    # Flow CSV headers (matching rhdp_flow.py required fields)
    flow_headers = [
        "CI Name",
        "CI",
        "Namespace",
        "Users",
        "Enable_workshop_interface",
        "Password",
        "Activity",
        "Purpose",
        "Workshop Name",
        "Provisioning Date (UTC)",
        "Auto-stop (UTC)",
        "Auto-destroy (UTC)",
        "Redirect",
        "White_Glove",
    ]

    writer = csv.DictWriter(output, fieldnames=flow_headers)
    writer.writeheader()

    for row in reader:
        # Parse Labagator date/time (YYYY-MM-DD, HH:MM)
        session_date = row.get("session_date", "")
        start_time = row.get("start_time", "")
        end_time = row.get("end_time", "")

        if not all([session_date, start_time, end_time]):
            continue  # Skip incomplete rows

        # Convert to datetime objects
        try:
            start_dt = datetime.strptime(f"{session_date} {start_time}", "%Y-%m-%d %H:%M")
            end_dt = datetime.strptime(f"{session_date} {end_time}", "%Y-%m-%d %H:%M")
        except ValueError:
            continue  # Skip row with invalid date/time format

        # Handle sessions crossing midnight
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        # Apply timezone offset if provided (convert local time to UTC)
        if timezone_offset_hours != 0:
            start_dt = start_dt + timedelta(hours=timezone_offset_hours)
            end_dt = end_dt + timedelta(hours=timezone_offset_hours)

        # Calculate session length
        session_length_hours = (end_dt - start_dt).total_seconds() / 3600

        # Smart user count estimation
        audience_level = row.get("audience_level", "")
        expected_attendees = None
        if row.get("expected_attendees"):
            try:
                expected_attendees = int(row.get("expected_attendees"))
            except (ValueError, TypeError):
                pass

        users = default_users if default_users is not None else _estimate_user_count(
            session_length_hours, audience_level, expected_attendees
        )

        # Smart buffer calculation
        smart_buffer = _calculate_buffer_hours(session_length_hours, buffer_hours)
        destroy_dt = end_dt + timedelta(hours=smart_buffer)

        # Format for Flow (DD/MM/YYYY HH:MM)
        prov_str = start_dt.strftime("%d/%m/%Y %H:%M")
        stop_str = end_dt.strftime("%d/%m/%Y %H:%M")
        destroy_str = destroy_dt.strftime("%d/%m/%Y %H:%M")

        # Map fields
        session_code = row.get('session_code', '')
        title = row.get('title', '')

        # Generate namespace from session code (user can edit later)
        namespace_base = session_code.lower().replace(" ", "-").replace("_", "-")
        namespace = f"labagator-{namespace_base}" if namespace_base else "labagator-session"

        # Enhanced Purpose field with track info
        purpose_parts = []
        if row.get("track"):
            purpose_parts.append(f"{row['track']} track")
        topics = row.get("topics", "").replace(";", ", ")
        if topics:
            purpose_parts.append(topics)
        purpose = " - ".join(purpose_parts) if purpose_parts else "Event Session"

        flow_row = {
            "CI Name": f"{session_code} - {title}",
            "CI": default_ci,
            "Namespace": namespace,
            "Users": str(users),
            "Enable_workshop_interface": "True",
            "Password": "",  # Auto-generated by Flow if blank
            "Activity": "Event",  # Default for conference sessions
            "Purpose": purpose,
            "Workshop Name": session_code.lower().replace(" ", "-") if session_code else "",
            "Provisioning Date (UTC)": prov_str,
            "Auto-stop (UTC)": stop_str,
            "Auto-destroy (UTC)": destroy_str,
            "Redirect": str(default_redirect),
            "White_Glove": str(default_white_glove),
        }

        logger.debug(
            f"Transformed {session_code}: {users} users, "
            f"{session_length_hours:.1f}h session, {smart_buffer}h buffer"
        )

        writer.writerow(flow_row)

    return output.getvalue()
