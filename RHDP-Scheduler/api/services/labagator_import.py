"""Transform Labagator event exports to Flow workshop schedule format."""

import csv
from datetime import datetime, timedelta
from io import StringIO
from typing import TextIO


def transform_labagator_to_flow(labagator_csv: TextIO) -> str:
    """Transform Labagator session CSV export to Flow schedule CSV format.

    Labagator exports sessions with:
    - session_code, title, room, session_date, start_time, end_time, speakers, topics

    Flow expects workshops with:
    - Workshop Name, Start (UTC), Stop (UTC), Destroy (UTC), Users,
      Enable_workshop_interface, Catalog_item, Multi_Asset, etc.

    Args:
        labagator_csv: File-like object containing Labagator session export

    Returns:
        Flow-compatible CSV as string
    """
    reader = csv.DictReader(labagator_csv)
    output = StringIO()

    # Flow CSV headers (minimal required set)
    flow_headers = [
        "Workshop Name",
        "Start (UTC)",
        "Stop (UTC)",
        "Destroy (UTC)",
        "Users",
        "Enable_workshop_interface",
        "Catalog_item",
        "Purpose",
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

        # Add 2-hour buffer for destroy
        destroy_dt = end_dt + timedelta(hours=2)

        # Format for Flow (DD/MM/YYYY HH:MM)
        start_str = start_dt.strftime("%d/%m/%Y %H:%M")
        stop_str = end_dt.strftime("%d/%m/%Y %H:%M")
        destroy_str = destroy_dt.strftime("%d/%m/%Y %H:%M")

        # Map fields
        flow_row = {
            "Workshop Name": f"{row.get('session_code', '')} - {row.get('title', '')}",
            "Start (UTC)": start_str,
            "Stop (UTC)": stop_str,
            "Destroy (UTC)": destroy_str,
            "Users": "25",  # Default, user can override
            "Enable_workshop_interface": "True",
            "Catalog_item": "",  # User must fill in
            "Purpose": row.get("topics", "").replace(";", ", "),
        }

        writer.writerow(flow_row)

    return output.getvalue()
