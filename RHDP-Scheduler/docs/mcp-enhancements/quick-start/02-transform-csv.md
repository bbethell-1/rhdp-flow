# Quick Start: transform_runbook_to_csv

**Priority:** #2  
**Time to Implement:** 1-2 hours  
**Impact:** Saves 2-3 hours per event day

---

## What It Does

Converts messy planning spreadsheets into clean FLOW CSV format automatically.

**Today's Manual Process (3 hours):**
1. Open planning sheet in Excel
2. Create new FLOW CSV template
3. Copy/paste columns, reformatting each
4. Convert dates BST → UTC
5. Add namespace prefixes
6. Add catalog items suffixes
7. Filter users
8. Format multi-asset workshops
9. Add workshop name prefixes
10. Validate everything

**With This Tool (2 minutes):**
```javascript
transform_runbook_to_csv({
  source_csv: "Planning Sheet.csv",
  event_name: "Summit 2026 Day 3",
  timezone: "BST"
})
// → Perfect FLOW CSV ready to upload
```

---

## Implementation

```python
# Add to ~/Joshs-IPA-MCP/tools/flow_mcp_server.py

from datetime import datetime, timedelta
import pytz

@mcp.tool()
def transform_runbook_to_csv(
    source_csv: str,
    event_config: Dict,
    user_mapping: Dict = None,
    exclude_users: List[str] = None,
    output_path: str = None
) -> Dict:
    """
    Transform planning spreadsheet to FLOW CSV format.
    
    Args:
        source_csv: Path to planning spreadsheet
        event_config: Event settings (name, timezone, catalog, etc.)
        user_mapping: Map email → namespace (e.g. {"klewis@redhat.com": "user-klewis-redhat-com"})
        exclude_users: List of usernames/emails to filter out
        output_path: Output CSV path (default: auto-generated)
        
    Returns:
        Transformation results and output path
    """
    
    # Read source CSV
    with open(source_csv, 'r') as f:
        reader = csv.DictReader(f)
        source_rows = list(reader)
    
    # Default mappings
    if not user_mapping:
        user_mapping = {
            "klewis@redhat.com": "user-klewis-redhat-com",
            "jappleii@redhat.com": "user-jappleii-redhat-com",
            "bbethell@redhat.com": "user-bbethell-redhat-com"
        }
    
    if not exclude_users:
        exclude_users = ["yordan", "yvarbev"]
    
    # Event config defaults
    event_name = event_config.get("name", "Event")
    timezone = event_config.get("timezone", "UTC")
    target_tz = event_config.get("target_timezone", "UTC")
    catalog_ns = event_config.get("catalog_namespace", "babylon-catalog-event")
    
    # Transform rows
    flow_rows = []
    transformations = []
    
    for row in source_rows:
        # Filter excluded users
        namespace = map_user_to_namespace(row, user_mapping)
        if should_exclude_user(namespace, exclude_users):
            continue
        
        # Build FLOW row
        flow_row = {
            "CI Name": clean_ci_name(row.get("Title", "")),
            "CI": transform_ci(row.get("CI (AgV Path)", ""), catalog_ns),
            "Namespace": namespace,
            "Users": "",  # Set from "Attendees" if present
            "Instances": row.get("Instances (Count)", ""),
            "Enable_workshop_interface": "True",  # Default
            "Password": row.get("Password", "password"),
            "Activity": "Brand Event",
            "Purpose": event_name,
            "Workshop Name": build_workshop_name(row, event_config),
            "Concurrency": "10",  # Default
            "Count": "1",
            "AWS_Region": "",
            "White_Glove": "False",  # Set True for multi-asset
            "Provisioning Date (UTC)": convert_datetime(
                row.get("Session Date"),
                row.get("Session Start"),
                timezone,
                target_tz
            ),
            "Auto-stop (UTC)": auto_stop_date(row, event_config),
            "Auto-destroy (UTC)": auto_destroy_date(row, event_config),
            "Multi_Asset": detect_multi_asset(row),
            "Asset_CIs": extract_asset_cis(row),
            "Catalog_Namespace": catalog_ns
        }
        
        flow_rows.append(flow_row)
        transformations.append(f"Transformed: {flow_row['CI Name']}")
    
    # Write output CSV
    if not output_path:
        output_path = source_csv.replace('.csv', '-flow.csv')
    
    flow_headers = [
        "CI Name", "CI", "Namespace", "Users", "Instances",
        "Enable_workshop_interface", "Password", "Activity", "Purpose",
        "Workshop Name", "Concurrency", "Count", "AWS_Region", "White_Glove",
        "Provisioning Date (UTC)", "Auto-stop (UTC)", "Auto-destroy (UTC)",
        "Multi_Asset", "Asset_CIs", "Catalog_Namespace"
    ]
    
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=flow_headers)
        writer.writeheader()
        writer.writerows(flow_rows)
    
    return {
        "input_rows": len(source_rows),
        "output_rows": len(flow_rows),
        "excluded_rows": len(source_rows) - len(flow_rows),
        "transformations": transformations,
        "output_csv": output_path
    }


def transform_ci(ci: str, catalog_ns: str) -> str:
    """Add catalog suffix if missing."""
    ci = ci.strip()
    
    # Check if already has suffix
    if ci.endswith('.event') or ci.endswith('.prod') or ci.endswith('.dev'):
        return ci
    
    # Add suffix based on catalog namespace
    if 'event' in catalog_ns:
        return f"{ci}.event"
    elif 'dev' in catalog_ns:
        return f"{ci}.dev"
    elif 'prod' in catalog_ns:
        return f"{ci}.prod"
    
    return ci


def convert_datetime(date_str: str, time_str: str, from_tz: str, to_tz: str) -> str:
    """
    Convert date/time from source timezone to target timezone.
    
    Example:
        convert_datetime("2026-05-14", "08:00:00", "BST", "UTC")
        → "14/05/2026 07:00"
    """
    # Parse date and time
    date_part = datetime.strptime(date_str, "%Y-%m-%d").date()
    time_part = datetime.strptime(time_str, "%H:%M:%S").time()
    dt = datetime.combine(date_part, time_part)
    
    # Apply source timezone
    if from_tz == "BST":
        # BST = UTC+1
        source_tz = pytz.timezone("Europe/London")
    else:
        source_tz = pytz.timezone(from_tz)
    
    dt_source = source_tz.localize(dt)
    
    # Convert to target timezone
    target_tz_obj = pytz.timezone(to_tz)
    dt_target = dt_source.astimezone(target_tz_obj)
    
    # Format for FLOW: DD/MM/YYYY HH:MM
    return dt_target.strftime("%d/%m/%Y %H:%M")


def build_workshop_name(row: Dict, event_config: Dict) -> str:
    """Build workshop name with template."""
    template = event_config.get("workshop_name_template", "{title}")
    
    # Extract day from event name (e.g., "Summit 2026 Day 3" → "3")
    day = event_config.get("name", "").split("Day")[-1].strip() if "Day" in event_config.get("name", "") else ""
    
    # Get title from CI Name or Title column
    title = row.get("Title", row.get("CI Name", ""))
    
    # Apply template
    name = template.format(
        day=day,
        title=title,
        ci=row.get("CI (AgV Path)", "")
    )
    
    return name


def detect_multi_asset(row: Dict) -> str:
    """Detect if workshop is multi-asset based on CI column."""
    ci_field = row.get("CI (AgV Path)", "")
    
    # Multi-asset has newlines or commas in CI column
    if "\n" in ci_field or "," in ci_field:
        return "True"
    
    # Check Multi_Asset column if present
    if row.get("Multi_Asset", "").strip().upper() == "TRUE":
        return "True"
    
    return "False"


def extract_asset_cis(row: Dict) -> str:
    """Extract comma-separated asset CIs."""
    ci_field = row.get("CI (AgV Path)", "")
    
    # Handle multi-line CIs (from Excel copy-paste)
    if "\n" in ci_field:
        cis = [ci.strip() for ci in ci_field.split("\n") if ci.strip()]
    elif "," in ci_field:
        cis = [ci.strip() for ci in ci_field.split(",") if ci.strip()]
    else:
        return ""
    
    # Ensure all have .event suffix
    cis_with_suffix = [
        ci if ci.endswith('.event') else f"{ci}.event"
        for ci in cis
    ]
    
    return ",".join(cis_with_suffix)


def map_user_to_namespace(row: Dict, user_mapping: Dict) -> str:
    """Map user email/name to namespace."""
    # Try Namespace column first
    if "Namespace" in row and row["Namespace"]:
        return row["Namespace"]
    
    # Try Collaborators column
    if "Collaborators" in row and row["Collaborators"]:
        # Extract first email
        collab = row["Collaborators"].split(",")[0].split("\n")[0].strip()
        if collab in user_mapping:
            return user_mapping[collab]
    
    # Default
    return "user-unknown"


def should_exclude_user(namespace: str, exclude_users: List[str]) -> bool:
    """Check if user should be excluded."""
    for excluded in exclude_users:
        if excluded.lower() in namespace.lower():
            return True
    return False


def auto_stop_date(row: Dict, event_config: Dict) -> str:
    """Calculate auto-stop date (event date + offset)."""
    # Default: 14 days after provisioning
    offset_days = event_config.get("auto_stop_offset_days", 14)
    
    # Parse provisioning date
    prov_date_str = convert_datetime(
        row.get("Session Date"),
        row.get("Session Start"),
        event_config.get("timezone", "UTC"),
        event_config.get("target_timezone", "UTC")
    )
    prov_date = datetime.strptime(prov_date_str, "%d/%m/%Y %H:%M")
    
    # Add offset
    stop_date = prov_date + timedelta(days=offset_days)
    
    return stop_date.strftime("%d/%m/%Y %H:%M")


def auto_destroy_date(row: Dict, event_config: Dict) -> str:
    """Calculate auto-destroy date (same as auto-stop by default)."""
    return auto_stop_date(row, event_config)


def clean_ci_name(title: str) -> str:
    """Clean CI name from title."""
    # Remove lab code prefix if present
    title = title.strip()
    
    # Extract after lab code (e.g., "LB1208 Title" → "LB1208 Title")
    return title
```

---

## Example Usage

```javascript
mcp__flow__transform_runbook_to_csv({
  source_csv: "~/Downloads/Proposed Runbook Summit 2026 - Day 3.csv",
  event_config: {
    name: "Summit 2026 Day 3",
    timezone: "BST",
    target_timezone: "UTC",
    catalog_namespace: "babylon-catalog-event",
    workshop_name_template: "Day {day}-Test-Spiderman-{title}",
    auto_stop_offset_days: 365  // Don't auto-stop for a year
  },
  user_mapping: {
    "klewis@redhat.com": "user-klewis-redhat-com",
    "jappleii@redhat.com": "user-jappleii-redhat-com",
    "bbethell@redhat.com": "user-bbethell-redhat-com"
  },
  exclude_users: ["yordan", "yvarbev"]
})
```

**Output:**
```json
{
  "input_rows": 17,
  "output_rows": 16,
  "excluded_rows": 1,
  "transformations": [
    "Transformed: LB1208 Practical image mode",
    "Transformed: LB1390 Ansible + HashiCorp",
    ...
  ],
  "output_csv": "~/Downloads/Proposed Runbook Summit 2026 - Day 3-flow.csv"
}
```

---

## Testing

**Test CSV transformation:**
```bash
# Run with test data
mcp__flow__transform_runbook_to_csv({
  source_csv: "~/Joshs-IPA-MCP/test-data/summit-day3-input.csv",
  event_config: {name: "Test Event", timezone: "BST"}
})

# Compare output to expected
diff output.csv ~/Joshs-IPA-MCP/test-data/summit-day3-output.csv
```

---

## Next: Tool #3

Once this works, implement `pre_deployment_checklist` for comprehensive validation before deployment.

**Time saved: 3 hours → 2 minutes per event day!** 🚀
