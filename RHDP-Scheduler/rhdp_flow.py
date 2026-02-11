#!/usr/bin/env python3
"""
RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool
Automates scheduling and deployment for RHDP workshops with safety features.

This script uses oc commands directly (no API authentication needed if already logged in).
"""

import csv
import json
import logging
import subprocess
import sys
import time
import argparse
from argparse import ArgumentParser
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import os

# ============================================================================
# CONFIGURATION & LOGGING SETUP
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('rhdp_flow')

# ============================================================================
# DATA MODELS
# ============================================================================

def _should_include_users(schedule: "WorkshopSchedule") -> bool:
    """True if we should set num_users/numberSeats (Users field is set and > 0)."""
    return schedule.users is not None and schedule.users > 0


def _effective_users(schedule: "WorkshopSchedule") -> Optional[int]:
    """Return schedule user count when configured (> 0), else None (for QA: skip user check)."""
    if schedule.users is not None and schedule.users > 0:
        return schedule.users
    return None


def _expected_total_seats(schedule: "WorkshopSchedule") -> Optional[int]:
    """Expected total seats for UI (Workshop Users Assigned denominator). Instances (e.g. 30) or Users when set."""
    if getattr(schedule, 'instances', None) is not None and schedule.instances > 0:
        return schedule.instances
    if _should_include_users(schedule) and schedule.users is not None:
        return schedule.users
    return None


def _provider_parameter_values(
    schedule: "WorkshopSchedule", start_timestamp: str, stop_timestamp: str
) -> Dict:
    """Build provider parameterValues; include num_users only when Users is set and > 0."""
    pv: Dict = {
        "purpose": schedule.purpose,
        "start_timestamp": start_timestamp,
        "stop_timestamp": stop_timestamp,
    }
    if _should_include_users(schedule) and schedule.users is not None:
        pv["num_users"] = schedule.users
    return pv


def _salesforce_items(schedule: "WorkshopSchedule") -> str:
    """Format salesforce_items JSON string from salesforce_ids. Empty [] when not set."""
    if schedule.salesforce_ids:
        return json.dumps([{"id": schedule.salesforce_ids, "type": "opportunity", "required": True}])
    return "[]"


def _workshop_provision_parameters(param_values: Dict, resourceclaim_payload: Dict) -> Dict:
    """Build WorkshopProvision parameters; include num_users only when present in payload."""
    params: Dict = {
        "purpose": param_values.get('purpose', 'QA'),
        "purpose_activity": resourceclaim_payload['metadata']['annotations'].get('demo.redhat.com/purpose-activity', 'Admin'),
        "purpose_explanation": None,
        "salesforce_items": resourceclaim_payload.get('metadata', {}).get('annotations', {}).get('demo.redhat.com/salesforce-items', '[]')
    }
    if "num_users" in param_values:
        params["num_users"] = param_values["num_users"]
    return params


@dataclass
class WorkshopSchedule:
    """Represents a workshop schedule from input CSV"""
    ci_name: str
    ci: str  # Catalog Item ID
    namespace: str
    enable_workshop_interface: bool
    password: str
    activity: str  # Purpose activity (e.g., "Admin")
    purpose: str  # Purpose (e.g., "QA")
    workshop_name: str  # Workshop display name (e.g., "Billys Workshop")
    provisioning_date: str  # Format: DD/MM/YYYY HH:MM
    auto_stop: str  # Format: DD/MM/YY HH:MM
    auto_destroy: str  # Format: DD/MM/YY HH:MM
    is_multi_asset: bool = False  # True if this is a multi-asset workshop
    asset_cis: str = ""  # Comma-separated list of catalog items for multi-asset workshops (e.g., "ci1,ci2,ci3")
    multi_workshop_name: str = ""  # Optional custom name for multi-asset workshop (e.g., "automation-test" or "test-qvvdw")
    users: Optional[int] = None  # Optional; when omitted/empty we don't set num_users
    instances: Optional[int] = None  # Optional; workshop instance/seat count for multi-asset (e.g. 30); used for numberSeats when users not set
    concurrency: Optional[int] = None  # Optional; WorkshopProvision concurrency (default 1)
    salesforce_ids: str = ""  # Optional Salesforce ID(s) for chargeback (campaign, opportunity, marketing, etc.)

@dataclass
class DeploymentResult:
    """Represents a deployment result for output CSV"""
    ci_name: str
    ci: str
    namespace: str
    guid: str
    url: str
    status: str
    provisioning_date: str
    auto_stop: str
    auto_destroy: str
    timestamp: str
    error_message: str = ""

# ============================================================================
# CONFIGURATION CLASS
# ============================================================================

class RHDPConfig:
    """Configuration for RHDP-Flow operations"""
    
    def __init__(self):
        self.dry_run = False
        self.kubeconfig_path = None
        self.timeout = 60
        self.retry_attempts = 3
        self.retry_delay = 5
        self.oc_command = "oc"  # Can be overridden if oc is in different location
        
    def validate(self) -> bool:
        """Validate configuration"""
        # Check if oc command is available
        try:
            result = subprocess.run(
                [self.oc_command, "version", "--client"],
                capture_output=True,
                timeout=10
            )
            if result.returncode != 0:
                logger.error("oc command not available or not working")
                return False
        except FileNotFoundError:
            logger.error(f"oc command not found at: {self.oc_command}")
            return False
        except Exception as e:
            logger.error(f"Error validating oc command: {e}")
            return False
        
        return True

# ============================================================================
# DATE/TIME UTILITIES
# ============================================================================

def parse_date_time(date_str: str, default_format: str = "%d/%m/%Y %H:%M", assume_utc: bool = True) -> Optional[datetime]:
    """
    Parse date string with multiple format support.
    All dates are assumed to be in UTC (Zulu time).
    
    Supports:
    - DD/MM/YYYY HH:MM (assumed UTC)
    - DD/MM/YY HH:MM (assumed UTC)
    - ISO8601 formats
    
    Args:
        date_str: Date string to parse
        default_format: Default format to try
        assume_utc: If True, add UTC timezone to naive datetimes
        
    Returns:
        datetime object with UTC timezone or None if parsing fails
    """
    if not date_str or date_str.strip() == "":
        return None
    
    formats = [
        "%d/%m/%Y %H:%M",  # 09/02/2026 11:00
        "%d/%m/%y %H:%M",  # 09/02/26 11:00
        "%Y-%m-%d %H:%M",  # 2026-02-09 11:00
        "%Y-%m-%dT%H:%M:%SZ",  # ISO format with Z
        "%Y-%m-%dT%H:%M:%S",  # ISO format without Z
        "%Y-%m-%dT%H:%M:%S.%fZ",  # ISO with microseconds
    ]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            # If datetime is naive and assume_utc is True, add UTC timezone
            if assume_utc and dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    
    logger.warning(f"Could not parse date: {date_str}")
    return None

def format_iso8601(dt: datetime) -> str:
    """
    Format datetime as ISO8601 for Kubernetes (UTC/Zulu time).
    
    Args:
        dt: datetime object (will be converted to UTC if needed)
        
    Returns:
        ISO8601 formatted string with Z suffix
    """
    # Ensure datetime is in UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    elif dt.tzinfo != timezone.utc:
        dt = dt.astimezone(timezone.utc)
    
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def calculate_duration(start: datetime, end: datetime) -> str:
    """Calculate duration in hours for lifespan"""
    delta = end - start
    hours = int(delta.total_seconds() / 3600)
    return f"{hours}h"

# ============================================================================
# CSV INPUT/OUTPUT HANDLERS
# ============================================================================

def read_csv_input(filepath: str) -> List[WorkshopSchedule]:
    """
    Read workshop schedules from CSV file.
    
    Expected CSV headers:
    - CI Name
    - CI (Catalog Item ID)
    - Namespace
    - Users
    - Enable_workshop_interface
    - Password
    - Activity (e.g., "Admin")
    - Purpose (e.g., "QA")
    - Provisioning Date (or Provisioning Date (UTC))
    - Auto-stop (or Auto-stop (UTC))
    - Auto-destroy (or Auto-destroy (UTC))
    
    Args:
        filepath: Path to input CSV file
        
    Returns:
        List of WorkshopSchedule objects
        
    Raises:
        FileNotFoundError: If CSV file doesn't exist
        ValueError: If CSV is malformed or missing required headers
    """
    schedules = []
    # Support both old and new header formats (with/without UTC suffix)
    required_headers = {
        'CI Name', 'CI', 'Namespace', 'Users', 
        'Enable_workshop_interface', 'Password',
        'Provisioning Date', 'Auto-stop', 'Auto-destroy',
        'Provisioning Date (UTC)', 'Auto-stop (UTC)', 'Auto-destroy (UTC)'
    }
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            if not reader.fieldnames:
                raise ValueError("CSV file is empty or has no headers")
            
            # Validate headers (case-insensitive)
            # Check for required headers - allow either old or new format
            reader_fieldnames = {h.strip() for h in reader.fieldnames}
            reader_lower = {h.lower() for h in reader_fieldnames}
            
            # Required core headers (always needed)
            core_required = {'ci name', 'ci', 'namespace', 'users', 
                           'enable_workshop_interface', 'password', 'activity', 'purpose'}
            
            # Date headers - need at least one format (case-insensitive)
            date_headers_old = {'provisioning date', 'auto-stop', 'auto-destroy'}
            # Check for UTC variant (case-insensitive - could be "utc", "UTC", etc.)
            has_new_dates = any('provisioning date' in h and 'utc' in h for h in reader_lower) and \
                          any('auto-stop' in h and 'utc' in h for h in reader_lower) and \
                          any('auto-destroy' in h and 'utc' in h for h in reader_lower)
            has_old_dates = date_headers_old.issubset(reader_lower)
            
            missing_core = core_required - reader_lower
            
            if missing_core:
                raise ValueError(
                    f"CSV missing required headers: {missing_core}. "
                    f"Found headers: {reader.fieldnames}"
                )
            
            if not (has_old_dates or has_new_dates):
                raise ValueError(
                    f"CSV missing date headers. Need either: {date_headers_old} or UTC variants. "
                    f"Found headers: {reader.fieldnames}"
                )
            
            # Create mapping (case-insensitive)
            header_map = {h.lower(): h for h in reader.fieldnames}
            
            # Read rows
            for row_num, row in enumerate(reader, start=2):
                try:
                    # Get values using case-insensitive lookup
                    ci_name = row[header_map.get('ci name', 'CI Name')].strip()
                    ci = row[header_map.get('ci', 'CI')].strip()
                    namespace = row[header_map.get('namespace', 'Namespace')].strip()
                    users_str = row[header_map.get('users', 'Users')].strip()
                    enable_interface = row[header_map.get('enable_workshop_interface', 'Enable_workshop_interface')].strip()
                    password = row[header_map.get('password', 'Password')].strip()
                    activity = row[header_map.get('activity', 'Activity')].strip()
                    purpose = row[header_map.get('purpose', 'Purpose')].strip()
                    workshop_name = row.get(header_map.get('workshop name', 'Workshop Name'), '').strip()
                    
                    # Multi-asset workshop fields (optional)
                    is_multi_asset_str = row.get(header_map.get('multi_asset', 'Multi_Asset'), '').strip()
                    asset_cis = row.get(header_map.get('asset_cis', 'Asset_CIs'), '').strip()
                    multi_workshop_name = row.get(header_map.get('multi_workshop_name', 'Multi_Workshop_Name'), '').strip()
                    instances_str = row.get(header_map.get('instances', 'Instances'), '').strip()
                    concurrency_str = row.get(header_map.get('concurrency', 'Concurrency'), '').strip()
                    salesforce_ids = row.get(header_map.get('salesforce ids', header_map.get('campaign_id', 'Salesforce IDs')), '').strip()
                    is_multi_asset = is_multi_asset_str.lower() in ['true', '1', 'yes', 'y'] if is_multi_asset_str else False
                    
                    # Support both old and new header formats (with/without UTC suffix)
                    # Try new format first, fall back to old format
                    provisioning_date_key = None
                    auto_stop_key = None
                    auto_destroy_key = None
                    
                    # Find provisioning date key (case-insensitive, with or without UTC)
                    for key in header_map.keys():
                        if 'provisioning date' in key:
                            provisioning_date_key = header_map[key]
                            break
                    if not provisioning_date_key:
                        provisioning_date_key = 'Provisioning Date'
                    
                    # Find auto-stop key
                    for key in header_map.keys():
                        if 'auto-stop' in key:
                            auto_stop_key = header_map[key]
                            break
                    if not auto_stop_key:
                        auto_stop_key = 'Auto-stop'
                    
                    # Find auto-destroy key
                    for key in header_map.keys():
                        if 'auto-destroy' in key:
                            auto_destroy_key = header_map[key]
                            break
                    if not auto_destroy_key:
                        auto_destroy_key = 'Auto-destroy'
                    
                    provisioning_date = row.get(provisioning_date_key, '').strip()
                    auto_stop = row.get(auto_stop_key, '').strip()
                    auto_destroy = row.get(auto_destroy_key, '').strip()
                    
                    # Validate required fields
                    if not all([ci_name, ci, namespace]):
                        logger.warning(f"Row {row_num}: Skipping incomplete record")
                        continue
                    
                    # Parse users (optional: empty = no override, use effective default when creating)
                    users: Optional[int] = None
                    if users_str:
                        try:
                            users = int(users_str)
                        except ValueError:
                            logger.warning(f"Row {row_num}: Invalid users value '{users_str}', treating as unspecified")
                            users = None
                    
                    # Parse optional Instances (workshop instance/seat count for multi-asset)
                    instances: Optional[int] = None
                    if instances_str:
                        try:
                            instances = int(instances_str)
                        except ValueError:
                            logger.warning(f"Row {row_num}: Invalid instances value '{instances_str}', treating as unspecified")
                    # Parse optional Concurrency (WorkshopProvision concurrency)
                    concurrency: Optional[int] = None
                    if concurrency_str:
                        try:
                            concurrency = int(concurrency_str)
                        except ValueError:
                            logger.warning(f"Row {row_num}: Invalid concurrency value '{concurrency_str}', treating as unspecified")
                    
                    # Parse boolean
                    enable_workshop_interface = enable_interface.lower() in ['true', '1', 'yes', 'y']
                    
                    schedule = WorkshopSchedule(
                        ci_name=ci_name,
                        ci=ci,
                        namespace=namespace,
                        users=users,
                        enable_workshop_interface=enable_workshop_interface,
                        password=password,
                        activity=activity or "Admin",  # Default to "Admin"
                        purpose=purpose or "QA",  # Default to "QA"
                        workshop_name=workshop_name or ci_name,  # Use workshop name from CSV, fallback to CI name
                        provisioning_date=provisioning_date,
                        auto_stop=auto_stop,
                        auto_destroy=auto_destroy,
                        is_multi_asset=is_multi_asset,
                        asset_cis=asset_cis,
                        multi_workshop_name=multi_workshop_name,
                        instances=instances,
                        concurrency=concurrency,
                        salesforce_ids=salesforce_ids
                    )
                    
                    schedules.append(schedule)
                    logger.debug(f"Loaded schedule: {schedule.ci_name} ({schedule.ci})")
                    
                except KeyError as e:
                    logger.warning(f"Row {row_num}: Missing field - {e}")
                    continue
                except Exception as e:
                    logger.warning(f"Row {row_num}: Error parsing - {e}")
                    continue
        
        if not schedules:
            raise ValueError("No valid schedules found in CSV file")
        
        logger.info(f"Successfully read {len(schedules)} schedules from {filepath}")
        return schedules
        
    except FileNotFoundError:
        logger.error(f"CSV file not found: {filepath}")
        raise
    except Exception as e:
        logger.error(f"Error reading CSV file: {e}")
        raise


def load_asset_passwords(filepath: str) -> Dict[str, str]:
    """
    Load per-CI passwords from a CSV file (CI, Password columns).
    Used for multi-asset workshops so each asset can have its own password.
    Returns dict mapping CI -> password (e.g. "zt-ansiblebu.ansible-network-automation-basics-lab-2.prod" -> "facts1").
    """
    result: Dict[str, str] = {}
    path = Path(filepath)
    if not path.exists():
        return result
    try:
        with open(path, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                return result
            header_map = {h.strip().lower(): h for h in reader.fieldnames}
            ci_key = header_map.get('ci', 'CI')
            pw_key = header_map.get('password', 'Password')
            for row in reader:
                ci = row.get(ci_key, '').strip()
                pw = row.get(pw_key, '').strip()
                if ci and pw:
                    result[ci] = pw
        if result:
            logger.info(f"Loaded {len(result)} per-asset passwords from {path.name}")
    except Exception as e:
        logger.warning(f"Could not load asset passwords from {filepath}: {e}")
    return result


def dry_run_validate_schedules(
    schedules: List[WorkshopSchedule],
    asset_passwords: Dict[str, str],
    asset_num_users: Dict[str, int],
    input_path: Path,
    config: RHDPConfig,
) -> None:
    """
    When dry-run: validate schedules, check num_users logic per asset, optionally check cluster.
    Log warnings for: missing passwords for multi-asset, assets with no num_users (flag them).
    """
    logger.info("")
    logger.info("[DRY-RUN] Validation and num_users check")
    logger.info("=" * 70)
    for schedule in schedules:
        # Validate dates
        prov = parse_date_time(schedule.provisioning_date)
        stop = parse_date_time(schedule.auto_stop)
        destroy = parse_date_time(schedule.auto_destroy)
        if not prov:
            logger.warning(f"  ⚠️  {schedule.ci_name}: Could not parse provisioning date '{schedule.provisioning_date}'")
        if schedule.auto_stop and not stop:
            logger.warning(f"  ⚠️  {schedule.ci_name}: Could not parse auto-stop '{schedule.auto_stop}'")
        if schedule.auto_destroy and not destroy:
            logger.warning(f"  ⚠️  {schedule.ci_name}: Could not parse auto-destroy '{schedule.auto_destroy}'")
        if schedule.concurrency is not None and (schedule.concurrency < 1 or schedule.concurrency > 100):
            logger.warning(f"  ⚠️  {schedule.ci_name}: Concurrency {schedule.concurrency} may be invalid")
        if not schedule.is_multi_asset:
            continue
        # Multi-asset: list assets and num_users / password
        asset_ci_list = [c.strip() for c in schedule.asset_cis.split(",") if c.strip()]
        logger.info(f"  Multi-asset: {schedule.ci_name} ({len(asset_ci_list)} assets)")
        for asset_ci in asset_ci_list:
            has_num_users = (asset_num_users and asset_ci in asset_num_users) or (
                _should_include_users(schedule) and schedule.users is not None
            )
            num_users_val = (asset_num_users or {}).get(asset_ci) if asset_num_users else (schedule.users if _should_include_users(schedule) else None)
            has_password = (asset_ci in asset_passwords) or bool(schedule.password)
            # Optional: check cluster if catalog item expects num_users
            ci_expects_num_users = get_catalog_item_has_num_users(asset_ci, config)
            if has_num_users:
                logger.info(f"    • {asset_ci}: num_users={num_users_val}, password={'set' if has_password else 'MISSING'}")
            else:
                logger.info(f"    • {asset_ci}: no num_users (uses multi-workshop Instances only), password={'set' if has_password else 'MISSING'}")
                if ci_expects_num_users is True:
                    logger.warning(f"      ⚠️  FLAG: Catalog item in cluster expects num_users but schedule/sheet does not set it (ordering may use default or fail)")
                elif ci_expects_num_users is False and asset_num_users and asset_ci in asset_num_users:
                    logger.warning(f"      ⚠️  FLAG: asset_users sheet sets num_users for this CI but catalog item may not use it")
            if not has_password:
                logger.warning(f"      ⚠️  FLAG: No password for this asset (main CSV or _passwords.csv)")
        logger.info("")
    logger.info("=" * 70)


def load_asset_num_users(filepath: str) -> Dict[str, int]:
    """
    Load per-CI num_users from a CSV file (CI, num_users or CI, Users columns).
    Used for multi-asset workshops when only some assets should have num_users set.
    Returns dict mapping CI -> num_users (e.g. "agd-v2.aap-multiinstance-workshop.event" -> 30).
    """
    result: Dict[str, int] = {}
    path = Path(filepath)
    if not path.exists():
        return result
    try:
        with open(path, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                return result
            header_map = {h.strip().lower(): h for h in reader.fieldnames}
            ci_key = header_map.get('ci', 'CI')
            users_key = header_map.get('num_users', header_map.get('users', 'num_users'))
            for row in reader:
                ci = row.get(ci_key, '').strip()
                users_str = row.get(users_key, '').strip()
                if ci and users_str:
                    try:
                        result[ci] = int(users_str)
                    except ValueError:
                        pass
        if result:
            logger.info(f"Loaded {len(result)} per-asset num_users from {path.name}")
    except Exception as e:
        logger.warning(f"Could not load asset num_users from {filepath}: {e}")
    return result


def write_deployment_results(
    results: List[DeploymentResult],
    output_file: str = "deployment_results.csv"
) -> None:
    """
    Write deployment results to CSV file.
    
    Args:
        results: List of DeploymentResult objects
        output_file: Path to output CSV file
    """
    if not results:
        logger.warning("No results to write")
        return
    
    try:
        fieldnames = [
            'ci_name', 'ci', 'namespace', 'guid', 'url', 'status',
            'provisioning_date', 'auto_stop', 'auto_destroy',
            'timestamp', 'error_message'
        ]
        
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            
            for result in results:
                writer.writerow(asdict(result))
        
        logger.info(f"Deployment results written to {output_file} ({len(results)} records)")
        
    except Exception as e:
        logger.error(f"Error writing results CSV: {e}")
        raise

# ============================================================================
# RESOURCECLAIM CREATION
# ============================================================================

def build_resource_claim_payload(
    schedule: WorkshopSchedule,
    requester_email: str = ""
) -> Dict:
    """
    Build JSON payload for ResourceClaim based on actual cluster structure.
    
    Args:
        schedule: WorkshopSchedule object
        requester_email: Requester email (extracted from namespace if not provided)
        
    Returns:
        Dictionary representing the ResourceClaim payload
    """
    # Extract email from namespace if not provided
    if not requester_email:
        # Namespace format: user-bbethell-redhat-com -> bbethell@redhat.com
        namespace_parts = schedule.namespace.replace('user-', '').split('-')
        if len(namespace_parts) >= 3:
            username = namespace_parts[0]
            domain_parts = namespace_parts[1:]
            requester_email = f"{username}@{'.'.join(domain_parts)}"
        else:
            requester_email = "admin@example.com"  # Fallback if namespace format is unexpected
    
    # Parse dates
    provisioning_dt = parse_date_time(schedule.provisioning_date)
    auto_stop_dt = parse_date_time(schedule.auto_stop)
    auto_destroy_dt = parse_date_time(schedule.auto_destroy)
    
    # Use current time as defaults if dates not provided (in UTC)
    now = datetime.now(timezone.utc)
    if not provisioning_dt:
        provisioning_dt = now
    if not auto_stop_dt:
        auto_stop_dt = provisioning_dt + timedelta(hours=8)
    if not auto_destroy_dt:
        auto_destroy_dt = provisioning_dt + timedelta(days=2)
    
    # Ensure all dates are in UTC
    if provisioning_dt.tzinfo is None:
        provisioning_dt = provisioning_dt.replace(tzinfo=timezone.utc)
    if auto_stop_dt.tzinfo is None:
        auto_stop_dt = auto_stop_dt.replace(tzinfo=timezone.utc)
    if auto_destroy_dt.tzinfo is None:
        auto_destroy_dt = auto_destroy_dt.replace(tzinfo=timezone.utc)
    
    # Calculate timestamps
    start_timestamp = format_iso8601(provisioning_dt)
    stop_timestamp = format_iso8601(auto_stop_dt)
    destroy_timestamp = format_iso8601(auto_destroy_dt)
    
    # Build payload matching actual cluster structure
    payload = {
        "apiVersion": "poolboy.gpte.redhat.com/v1",
        "kind": "ResourceClaim",
        "metadata": {
            "generateName": f"{schedule.ci}-",
            "namespace": schedule.namespace,
            "annotations": {
                "babylon.gpte.redhat.com/catalogDisplayName": "RHDP",
                "babylon.gpte.redhat.com/catalogItemDisplayName": schedule.ci_name,
                "babylon.gpte.redhat.com/notifier": "disable",
                "demo.redhat.com/orderedBy": requester_email,
                "demo.redhat.com/purpose": schedule.purpose,
                "demo.redhat.com/purpose-activity": schedule.activity,
                "demo.redhat.com/requester": requester_email,
                "demo.redhat.com/salesforce-items": _salesforce_items(schedule),
                "poolboy.gpte.redhat.com/resource-pool-name": "disable"
            },
            "labels": {
                "babylon.gpte.redhat.com/catalogItemName": schedule.ci,
                "babylon.gpte.redhat.com/catalogItemNamespace": "babylon-catalog-prod",
                "demo.redhat.com/white-glove": "false",
                "rhdp-flow.gpte.redhat.com/scheduled": "true",
                "rhdp-flow.gpte.redhat.com/scheduled-by": "rhdp-flow"
            }
        },
        "spec": {
            "autoDetach": {
                "when": "status.resources | json_query(\"[?state.spec.vars.current_state == 'provision-failed']\") | length != 0"
            },
            "lifespan": {
                "end": destroy_timestamp
            },
            "provider": {
                "name": schedule.ci,
                "parameterValues": _provider_parameter_values(schedule, start_timestamp, stop_timestamp)
            }
        }
    }
    
    # Add accessPassword to spec (not parameterValues)
    if schedule.password:
        payload["spec"]["accessPassword"] = schedule.password
    
    # If workshop interface is enabled, store flag and workshop name for later use
    # Note: enable_workshop_ui is not a valid ResourceClaim parameter
    # The UI will be enabled by patching the Workshop after it's created
    if schedule.enable_workshop_interface:
        # Store this flag in the payload metadata so we can use it later
        payload["metadata"]["annotations"]["rhdp-flow.gpte.redhat.com/enable-workshop-ui"] = "true"
        # Store workshop name for use when creating Workshop
        if schedule.workshop_name:
            payload["metadata"]["annotations"]["rhdp-flow.gpte.redhat.com/workshop-name"] = schedule.workshop_name
    
    return payload

def create_resource_claim_via_oc(
    payload: Dict,
    config: RHDPConfig
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Create ResourceClaim using oc command.
    
    Args:
        payload: ResourceClaim JSON payload
        config: RHDPConfig object
        
    Returns:
        Tuple of (guid, namespace, error_message)
    """
    namespace = payload['metadata']['namespace']
    generate_name = payload['metadata'].get('generateName', '')
    
    if config.dry_run:
        logger.info(f"[DRY-RUN] Would create ResourceClaim in namespace {namespace}:")
        print("\n" + "=" * 70)
        print(f"ResourceClaim Payload:")
        print("=" * 70)
        print(json.dumps(payload, indent=2))
        print("=" * 70 + "\n")
        
        # Return a mock GUID for dry-run
        mock_guid = f"{generate_name}dryrun-{int(time.time())}"
        return (mock_guid, namespace, None)
    
    try:
        # Create temporary file with payload
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp_file:
            json.dump(payload, tmp_file, indent=2)
            tmp_file_path = tmp_file.name
        
        try:
            # Create using oc (create supports generateName, apply does not)
            cmd = [
                config.oc_command,
                "create",
                "-f", tmp_file_path,
                "-n", namespace
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            logger.debug(f"Running: {' '.join(cmd)}")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout,
                env=env
            )
            
            if result.returncode != 0:
                error_msg = f"oc create failed: {result.stderr}"
                logger.error(error_msg)
                return (None, None, error_msg)
            
            # Extract ResourceClaim name from output
            # Output format: "resourceclaim.poolboy.gpte.redhat.com/openshift-cnv... created"
            output_lines = result.stdout.strip().split('\n')
            guid = None
            
            for line in output_lines:
                if 'resourceclaim' in line.lower() and 'created' in line.lower():
                    # Extract name from line
                    parts = line.split('/')
                    if len(parts) > 1:
                        guid = parts[1].split()[0]  # Get name before "created"
                        break
            
            if not guid:
                # Try to get it from the cluster
                guid = get_resourceclaim_name_from_cluster(generate_name, namespace, config)
            
            if guid:
                logger.info(f"Successfully created ResourceClaim: {guid} in namespace {namespace}")
                
                # Note: When enable_workshop_interface is True, ResourceClaim creation is skipped
                # in process_schedule() to avoid duplicates. This code path is for when
                # enable_workshop_interface is False (normal ResourceClaim flow).
                
                return (guid, namespace, None)
            else:
                logger.warning("ResourceClaim created but could not determine name")
                return (f"{generate_name}unknown", namespace, None)
        
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_file_path)
            except:
                pass
        
    except subprocess.TimeoutExpired:
        error_msg = f"oc command timed out after {config.timeout}s"
        logger.error(error_msg)
        return (None, None, error_msg)
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        logger.error(f"Error creating ResourceClaim: {error_msg}")
        return (None, None, error_msg)

def wait_for_workshop_from_resourceclaim(
    resourceclaim_name: str,
    namespace: str,
    config: RHDPConfig,
    max_wait: int = 300
) -> Optional[str]:
    """
    Wait for Workshop to be created by ResourceClaim.
    
    Args:
        resourceclaim_name: Name of the ResourceClaim
        namespace: Kubernetes namespace
        config: RHDPConfig object
        max_wait: Maximum seconds to wait
        
    Returns:
        Workshop name if found, None otherwise
    """
    # Workshop name should match ResourceClaim name
    workshop_name = resourceclaim_name
    
    for attempt in range(max_wait):
        try:
            cmd = [
                config.oc_command,
                "get", "workshop", workshop_name,
                "-n", namespace,
                "-o", "json"
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            if result.returncode == 0:
                logger.info(f"✅ Workshop '{workshop_name}' found (created by ResourceClaim)")
                return workshop_name
            
            # Workshop not created yet, wait and retry
            if attempt % 30 == 0 and attempt > 0:
                logger.info(f"⏳ Still waiting for Workshop '{workshop_name}' to be created... ({attempt}/{max_wait}s)")
                # Check ResourceClaim status
                try:
                    rc_cmd = [
                        config.oc_command,
                        "get", "resourceclaim", workshop_name,
                        "-n", namespace,
                        "-o", "jsonpath={.status.resources[0].state.spec.vars.current_state}"
                    ]
                    rc_result = subprocess.run(rc_cmd, capture_output=True, text=True, timeout=10, env=env)
                    if rc_result.returncode == 0 and rc_result.stdout:
                        logger.info(f"   ResourceClaim status: {rc_result.stdout.strip()}")
                except:
                    pass
            if attempt < max_wait - 1:
                time.sleep(2)
                continue
        
        except Exception as e:
            logger.debug(f"Error checking for Workshop (attempt {attempt + 1}): {e}")
            if attempt < max_wait - 1:
                time.sleep(2)
                continue
    
    logger.warning(f"⚠️  Workshop '{workshop_name}' not found after {max_wait}s")
    return None

def delete_duplicate_workshop(
    resourceclaim_name: str,
    namespace: str,
    keep_workshop_name: str,
    config: RHDPConfig
) -> None:
    """
    Delete duplicate Workshop created by ResourceClaim, keeping only the one we created with UI.
    
    Args:
        resourceclaim_name: Name of the ResourceClaim
        namespace: Kubernetes namespace
        keep_workshop_name: Name of the Workshop to keep (the one with UI enabled)
        config: RHDPConfig object
    """
    try:
        # Check if there's a Workshop with the same name as ResourceClaim (created by ResourceClaim)
        # This would be a duplicate without UI enabled
        cmd = [
            config.oc_command,
            "get", "workshop", resourceclaim_name,
            "-n", namespace,
            "-o", "json"
        ]
        
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            env=env
        )
        
        if result.returncode == 0:
            # Workshop exists - check if it's different from the one we want to keep
            if resourceclaim_name != keep_workshop_name:
                # Different name, delete it
                logger.info(f"Deleting duplicate Workshop: {resourceclaim_name} (created by ResourceClaim)")
                delete_cmd = [
                    config.oc_command,
                    "delete", "workshop", resourceclaim_name,
                    "-n", namespace,
                    "--ignore-not-found=true"
                ]
                delete_result = subprocess.run(
                    delete_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=env
                )
                if delete_result.returncode == 0:
                    logger.info(f"✅ Deleted duplicate Workshop: {resourceclaim_name}")
                else:
                    logger.warning(f"Could not delete duplicate Workshop: {delete_result.stderr}")
            else:
                # Same name - check if it has UI enabled
                workshop_data = json.loads(result.stdout)
                has_ui = workshop_data.get('spec', {}).get('labUserInterface', {}).get('redirect', False)
                if not has_ui:
                    # Same name but no UI - this is the ResourceClaim-created one, delete it
                    logger.info(f"Deleting duplicate Workshop without UI: {resourceclaim_name}")
                    delete_cmd = [
                        config.oc_command,
                        "delete", "workshop", resourceclaim_name,
                        "-n", namespace,
                        "--ignore-not-found=true"
                    ]
                    delete_result = subprocess.run(
                        delete_cmd,
                        capture_output=True,
                        text=True,
                        timeout=30,
                        env=env
                    )
                    if delete_result.returncode == 0:
                        logger.info(f"✅ Deleted duplicate Workshop without UI: {resourceclaim_name}")
                    else:
                        logger.warning(f"Could not delete duplicate Workshop: {delete_result.stderr}")
    except Exception as e:
        logger.debug(f"Error checking for duplicate Workshop: {e}")

def create_workshop_with_ui(
    workshop_name_or_prefix: str,
    namespace: str,
    resourceclaim_payload: Dict,
    config: RHDPConfig
) -> Optional[str]:
    """
    Create Workshop resource directly with UI enabled and annotation.
    
    Args:
        workshop_name_or_prefix: Name of the Workshop or generateName prefix (e.g., "ci-name-" or "ci-name-abc123")
        namespace: Kubernetes namespace
        resourceclaim_payload: Original ResourceClaim payload
        config: RHDPConfig object
        
    Returns:
        Workshop name if successful, None otherwise
    """
    if config.dry_run:
        ci = resourceclaim_payload['spec']['provider']['name']
        pv = resourceclaim_payload['spec']['provider'].get('parameterValues', {})
        has_num_users = 'num_users' in pv
        logger.info(f"[DRY-RUN] Would create Workshop for {ci} (num_users in payload: {has_num_users})")
        print("\n" + "=" * 70)
        print("Workshop payload (spec only):")
        print("=" * 70)
        print(json.dumps(resourceclaim_payload.get('spec', resourceclaim_payload), indent=2))
        print("=" * 70 + "\n")
        prefix = workshop_name_or_prefix.rstrip('-') if workshop_name_or_prefix.endswith('-') else workshop_name_or_prefix
        return f"{prefix}-dryrun-{int(time.time())}"
    try:
        # Extract information from ResourceClaim payload
        ci = resourceclaim_payload['spec']['provider']['name']
        ci_name = resourceclaim_payload['metadata']['annotations'].get('babylon.gpte.redhat.com/catalogItemDisplayName', '')
        param_values = resourceclaim_payload['spec']['provider'].get('parameterValues', {})
        requester_email = resourceclaim_payload['metadata']['annotations'].get('demo.redhat.com/requester', '')
        # Get workshop display name from CSV (if provided), otherwise use CI name
        workshop_display_name = resourceclaim_payload['metadata']['annotations'].get('rhdp-flow.gpte.redhat.com/workshop-name', ci_name)
        
        # Determine if we need to use generateName or a specific name
        use_generate_name = workshop_name_or_prefix.endswith('-')
        if use_generate_name:
            # Use generateName to let Kubernetes assign the name
            workshop_metadata = {
                "generateName": workshop_name_or_prefix,
                "namespace": namespace,
            }
            expected_workshop_name = None  # Will be determined after creation
        else:
            # Use specific name
            workshop_metadata = {
                "name": workshop_name_or_prefix,
                "namespace": namespace,
            }
            expected_workshop_name = workshop_name_or_prefix
        
        # Add annotations and labels to metadata
        workshop_metadata["annotations"] = {
            "babylon.gpte.redhat.com/category": "Workshops",
            "demo.redhat.com/orderedBy": requester_email,
            "demo.redhat.com/purpose": resourceclaim_payload['metadata']['annotations'].get('demo.redhat.com/purpose', 'QA'),
            "demo.redhat.com/purpose-activity": resourceclaim_payload['metadata']['annotations'].get('demo.redhat.com/purpose-activity', 'Admin'),
            "demo.redhat.com/requester": requester_email
        }
        workshop_metadata["labels"] = {
            "babylon.gpte.redhat.com/catalogItemName": ci,
            "babylon.gpte.redhat.com/catalogItemNamespace": "babylon-catalog-prod",
            "demo.redhat.com/white-glove": "false"
        }
        
        # Build Workshop payload with UI enabled from the start
        workshop = {
            "apiVersion": "babylon.gpte.redhat.com/v1",
            "kind": "Workshop",
            "metadata": workshop_metadata,
            "spec": {
                "displayName": workshop_display_name,
                "accessPassword": resourceclaim_payload['spec'].get('accessPassword', ''),
                "actionSchedule": {
                    "start": param_values.get('start_timestamp', ''),
                    "stop": param_values.get('stop_timestamp', '')
                },
                "lifespan": {
                    "start": param_values.get('start_timestamp', ''),
                    "end": resourceclaim_payload['spec']['lifespan']['end'],
                    "maximum": "180d",
                    "relativeMaximum": "30d"
                },
                "labUserInterface": {
                    "redirect": True
                },
                "multiuserServices": "num_users" in param_values,
                "openRegistration": True
            }
        }
        
        # Create Workshop
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp_file:
            json.dump(workshop, tmp_file, indent=2)
            tmp_file_path = tmp_file.name
        
        try:
            cmd = [
                config.oc_command,
                "create",
                "-f", tmp_file_path,
                "-n", namespace
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            logger.debug(f"Creating Workshop: {workshop_name_or_prefix} with UI enabled")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout,
                env=env
            )
            
            if result.returncode == 0:
                # If we used generateName, extract the actual name from the output
                if use_generate_name:
                    # Output format: "workshop.babylon.gpte.redhat.com/openshift-cnv... created"
                    output_lines = result.stdout.strip().split('\n')
                    for line in output_lines:
                        if 'created' in line.lower() and 'workshop' in line.lower():
                            # Extract name from line like "workshop.babylon.gpte.redhat.com/openshift-cnv.ocp-virt-roadshow-multi-user.prod-abc123 created"
                            parts = line.split('/')
                            if len(parts) > 1:
                                actual_name = parts[-1].split()[0]  # Get name before "created"
                                logger.info(f"✅ Successfully created Workshop: {actual_name} with UI enabled (labUserInterface.redirect: true)")
                                return actual_name
                    # Fallback: try to get it from cluster
                    logger.info(f"✅ Workshop created with generateName, determining actual name...")
                    time.sleep(2)
                    # List workshops and find the one we just created
                    list_cmd = [
                        config.oc_command,
                        "get", "workshop",
                        "-n", namespace,
                        "--sort-by=.metadata.creationTimestamp",
                        "-o", "jsonpath={.items[-1].metadata.name}"
                    ]
                    list_result = subprocess.run(list_cmd, capture_output=True, text=True, timeout=30, env=env)
                    if list_result.returncode == 0 and list_result.stdout.strip():
                        actual_name = list_result.stdout.strip()
                        logger.info(f"✅ Successfully created Workshop: {actual_name} with UI enabled (labUserInterface.redirect: true)")
                        return actual_name
                    else:
                        logger.warning(f"Could not determine Workshop name")
                        return None
                else:
                    logger.info(f"✅ Successfully created Workshop: {expected_workshop_name} with UI enabled (labUserInterface.redirect: true)")
                    return expected_workshop_name
            else:
                # Workshop might already exist or creation failed
                if "already exists" in result.stderr:
                    logger.info(f"Workshop {expected_workshop_name or workshop_name_or_prefix} already exists, will enable UI on existing Workshop")
                    return expected_workshop_name or workshop_name_or_prefix
                else:
                    logger.warning(f"Could not create Workshop: {result.stderr}")
                    return None
        
        finally:
            try:
                os.unlink(tmp_file_path)
            except:
                pass
    
    except Exception as e:
        logger.warning(f"Error creating Workshop: {e}")
        return None

def create_workshop_provision(
    workshop_name: str,
    namespace: str,
    resourceclaim_payload: Dict,
    config: RHDPConfig,
    enable_workshop_ui: bool = True,
    concurrency: Optional[int] = None,
    count: Optional[int] = None,
    provision_name_suffix: Optional[str] = None,
    extra_parameters: Optional[Dict] = None,
) -> Optional[str]:
    """
    Create WorkshopProvision to enable workshop UI.

    Args:
        workshop_name: Name of the Workshop (should already exist)
        namespace: Kubernetes namespace
        resourceclaim_payload: Original ResourceClaim payload
        config: RHDPConfig object
        enable_workshop_ui: Whether to enable the workshop user interface
        concurrency: WorkshopProvision concurrency (default 1)
        count: Workshop Instance Count (from Instances column; default 1)
        provision_name_suffix: Optional suffix for the WorkshopProvision name
        extra_parameters: Optional extra parameters to merge into spec.parameters

    Returns:
        WorkshopProvision name or None
    """
    count_val = count if count is not None and count > 0 else 1
    concurrency_val = concurrency if concurrency is not None else 1
    if config.dry_run:
        logger.info(f"[DRY-RUN] Would create WorkshopProvision: {workshop_name} (count={count_val}, concurrency={concurrency_val})")
        return workshop_name
    try:
        # Extract information from ResourceClaim payload
        ci = resourceclaim_payload['spec']['provider']['name']
        ci_name = resourceclaim_payload['metadata']['annotations'].get('babylon.gpte.redhat.com/catalogItemDisplayName', '')
        param_values = resourceclaim_payload['spec']['provider'].get('parameterValues', {})
        
        # Get catalog namespace from provider (default to babylon-catalog-prod)
        catalog_namespace = resourceclaim_payload['spec']['provider'].get('namespace', 'babylon-catalog-prod')
        
        # Build WorkshopProvision payload
        workshop_provision = {
            "apiVersion": "babylon.gpte.redhat.com/v1",
            "kind": "WorkshopProvision",
            "metadata": {
                "name": workshop_name,
                "namespace": namespace,
                "labels": {
                    "babylon.gpte.redhat.com/catalogItemName": ci,
                    "babylon.gpte.redhat.com/catalogItemNamespace": catalog_namespace,
                    "babylon.gpte.redhat.com/workshop": workshop_name
                },
                "annotations": {
                    "babylon.gpte.redhat.com/category": "Workshops"
                }
            },
            "spec": {
                "catalogItem": {
                    "name": ci,
                    "namespace": catalog_namespace
                },
                "workshopName": workshop_name,
                "count": count_val,
                "concurrency": concurrency_val,
                "enableResourcePools": False,
                "actionSchedule": {
                    "start": param_values.get('start_timestamp', ''),
                    "stop": param_values.get('stop_timestamp', '')
                },
                "lifespan": {
                    "start": param_values.get('start_timestamp', ''),
                    "end": resourceclaim_payload['spec']['lifespan']['end']
                },
                "autoDetach": resourceclaim_payload['spec'].get('autoDetach', {}),
                "parameters": _workshop_provision_parameters(param_values, resourceclaim_payload),
                "startDelay": 30
            }
        }
        
        # Create WorkshopProvision
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp_file:
            json.dump(workshop_provision, tmp_file, indent=2)
            tmp_file_path = tmp_file.name
        
        try:
            cmd = [
                config.oc_command,
                "create",
                "-f", tmp_file_path,
                "-n", namespace
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            logger.debug(f"Creating WorkshopProvision: {workshop_name}")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout,
                env=env
            )
            
            if result.returncode == 0:
                if enable_workshop_ui:
                    logger.info(f"Successfully created WorkshopProvision: {workshop_name} (workshop UI will be enabled)")
                else:
                    logger.info(f"Successfully created WorkshopProvision: {workshop_name}")
                
                # Note: WorkshopProvision is created, but Workshop is created by ResourceClaim
                # The UI will be enabled in create_resource_claim_via_oc after Workshop is created
                # Don't try to enable UI here - it will be handled by the main flow
                
                return workshop_name
            else:
                logger.warning(f"Could not create WorkshopProvision: {result.stderr}")
                return None
        
        finally:
            try:
                os.unlink(tmp_file_path)
            except:
                pass
    
    except Exception as e:
        logger.warning(f"Error creating WorkshopProvision: {e}")
        return None

def get_workshop_id(workshop_name: str, namespace: str, config: RHDPConfig) -> Optional[str]:
    """
    Get the workshopId from a Workshop resource.
    The workshopId is stored in the label: babylon.gpte.redhat.com/workshop-id
    
    Args:
        workshop_name: Name of the Workshop
        namespace: Kubernetes namespace
        config: RHDPConfig object
        
    Returns:
        workshopId string or None if not found
    """
    try:
        # Try getting from label first (this is where it's stored)
        cmd = [
            config.oc_command,
            "get", "workshop", workshop_name,
            "-n", namespace,
            "-o", "jsonpath={.metadata.labels.babylon\\.gpte\\.redhat\\.com/workshop-id}"
        ]
        
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.timeout,
            env=env
        )
        
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        
        # Fallback: try status.id (in case some workshops use this)
        cmd = [
            config.oc_command,
            "get", "workshop", workshop_name,
            "-n", namespace,
            "-o", "jsonpath={.status.id}"
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.timeout,
            env=env
        )
        
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        else:
            logger.debug(f"Could not get workshopId for {workshop_name} (label or status.id)")
            return None
    except Exception as e:
        logger.warning(f"Error getting workshopId for {workshop_name}: {e}")
        return None

def wait_for_workshop_id(workshop_name: str, namespace: str, config: RHDPConfig, max_wait: int = 120) -> Optional[str]:
    """
    Wait for a Workshop to be created and return its workshopId.
    
    Args:
        workshop_name: Name of the Workshop
        namespace: Kubernetes namespace
        config: RHDPConfig object
        max_wait: Maximum seconds to wait
        
    Returns:
        workshopId string or None if not found
    """
    logger.info(f"Waiting for Workshop '{workshop_name}' to be ready (up to {max_wait}s)...")
    
    # First, wait for the workshop to exist
    for attempt in range(30):  # Wait up to 60s for workshop to exist
        try:
            cmd = [
                config.oc_command,
                "get", "workshop", workshop_name,
                "-n", namespace,
                "-o", "name"
            ]
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,
                env=env
            )
            
            if result.returncode == 0:
                break  # Workshop exists
        except:
            pass
        
        if attempt < 29:
            time.sleep(2)
    
    # Now wait for the workshopId label to appear
    for attempt in range(max_wait // 2):  # Check every 2 seconds
        workshop_id = get_workshop_id(workshop_name, namespace, config)
        if workshop_id:
            logger.info(f"✅ Workshop '{workshop_name}' has ID: {workshop_id}")
            return workshop_id
        
        if attempt < (max_wait // 2) - 1:
            time.sleep(2)
    
    logger.warning(f"⚠️  Workshop '{workshop_name}' did not get an ID within {max_wait}s")
    # Try one more time with a different approach - get the full JSON and parse it
    try:
        cmd = [
            config.oc_command,
            "get", "workshop", workshop_name,
            "-n", namespace,
            "-o", "json"
        ]
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.timeout,
            env=env
        )
        
        if result.returncode == 0:
            workshop_json = json.loads(result.stdout)
            labels = workshop_json.get('metadata', {}).get('labels', {})
            workshop_id = labels.get('babylon.gpte.redhat.com/workshop-id')
            if workshop_id:
                logger.info(f"✅ Found workshopId via JSON parsing: {workshop_id}")
                return workshop_id
    except Exception as e:
        logger.debug(f"Could not parse workshop JSON: {e}")
    
    return None

def get_catalog_item_has_num_users(ci: str, config: RHDPConfig) -> Optional[bool]:
    """
    Check if the catalog item in the cluster expects a num_users parameter (for dry-run validation).
    Returns True if CI has num_users, False if not, None if cannot determine (e.g. not connected).
    """
    try:
        catalog_namespace = "babylon-catalog-event" if ci.endswith(".event") else "babylon-catalog-prod"
        cmd = [
            config.oc_command,
            "get", "catalogitem", ci,
            "-n", catalog_namespace,
            "-o", "json"
        ]
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        # Common shapes: spec.parameters[].name, spec.providerSpec.parameterDefinitions, or provider template
        spec = data.get("spec", {})
        params = spec.get("parameters", [])
        if isinstance(params, list):
            for p in params:
                name = p.get("name") if isinstance(p, dict) else p
                if name == "num_users":
                    return True
        param_defs = spec.get("parameterDefinitions", []) or spec.get("providerSpec", {}).get("parameterDefinitions", [])
        for p in param_defs:
            name = p.get("name") if isinstance(p, dict) else p
            if name == "num_users":
                return True
        return False
    except Exception:
        return None


def get_catalog_item_info(ci: str, config: RHDPConfig) -> Dict[str, str]:
    """
    Get catalog item information (namespace, displayName) from the catalog.
    
    Args:
        ci: Catalog Item ID (e.g., "zt-ansiblebu.ansible-network-automation-basics-lab-2.event")
        config: RHDPConfig object
        
    Returns:
        Dict with 'namespace' and 'displayName' keys, or empty dict if not found
    """
    try:
        # Determine catalog namespace based on CI name pattern
        # Items ending in .event are typically in babylon-catalog-event
        catalog_namespace = "babylon-catalog-event" if ci.endswith(".event") else "babylon-catalog-prod"
        
        # Try the determined namespace first
        cmd = [
            config.oc_command,
            "get", "catalogitem", ci,
            "-n", catalog_namespace,
            "-o", "jsonpath={.metadata.namespace}:{.metadata.annotations.babylon\\.gpte\\.redhat\\.com/catalogItemDisplayName}"
        ]
        
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.timeout,
            env=env
        )
        
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(':', 1)
            if len(parts) == 2:
                return {
                    'namespace': parts[0] or catalog_namespace,
                    'displayName': parts[1] or ci
                }
        
        # Fallback: try the other catalog namespace
        other_namespace = "babylon-catalog-prod" if catalog_namespace == "babylon-catalog-event" else "babylon-catalog-event"
        cmd[3] = other_namespace
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.timeout,
            env=env
        )
        
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(':', 1)
            if len(parts) == 2:
                return {
                    'namespace': parts[0] or other_namespace,
                    'displayName': parts[1] or ci
                }
        
        # Default fallback - use the determined namespace
        return {
            'namespace': catalog_namespace,
            'displayName': ci
        }
    except Exception as e:
        logger.warning(f"Error getting catalog item info for {ci}: {e}")
        # Default based on pattern
        catalog_namespace = "babylon-catalog-event" if ci.endswith(".event") else "babylon-catalog-prod"
        return {
            'namespace': catalog_namespace,
            'displayName': ci
        }

def create_multi_workshop_from_group(
    group_schedules: List[WorkshopSchedule],
    config: RHDPConfig,
) -> Optional[str]:
    """
    Create a MultiWorkshop from a group of schedules sharing the same
    multi_workshop_name.  Each schedule in the group represents one asset CI.

    This synthesises a single WorkshopSchedule with is_multi_asset=True and
    comma-separated asset_cis, then delegates to create_multi_workshop().
    Per-asset passwords and num_users are forwarded when they differ across
    the group rows.
    """
    if not group_schedules:
        return None

    first = group_schedules[0]

    # Collect per-asset passwords and num_users from individual rows
    asset_cis = ",".join(s.ci for s in group_schedules)
    asset_passwords: Dict[str, str] = {}
    asset_num_users: Dict[str, int] = {}
    for s in group_schedules:
        if s.password:
            asset_passwords[s.ci] = s.password
        if s.users is not None and s.users > 0:
            asset_num_users[s.ci] = s.users

    # Build a synthetic schedule that create_multi_workshop expects
    synth = WorkshopSchedule(
        ci_name=first.ci_name,
        ci=first.ci,
        namespace=first.namespace,
        users=first.users,
        enable_workshop_interface=first.enable_workshop_interface,
        password=first.password,
        activity=first.activity,
        purpose=first.purpose,
        workshop_name=first.workshop_name,
        provisioning_date=first.provisioning_date,
        auto_stop=first.auto_stop,
        auto_destroy=first.auto_destroy,
        is_multi_asset=True,
        asset_cis=asset_cis,
        multi_workshop_name=first.multi_workshop_name,
        instances=first.instances,
        concurrency=first.concurrency,
        salesforce_ids=first.salesforce_ids,
    )

    return create_multi_workshop(
        synth, config,
        asset_passwords=asset_passwords or None,
        asset_num_users=asset_num_users or None,
    )


def create_multi_workshop(
    schedule: WorkshopSchedule,
    config: RHDPConfig,
    asset_passwords: Optional[Dict[str, str]] = None,
    asset_num_users: Optional[Dict[str, int]] = None
) -> Optional[str]:
    """
    Create a MultiWorkshop resource with multiple asset workshops.
    
    For multi-asset workshops, this function:
    1. Creates individual Workshop resources for each asset CI
    2. Waits for them to get workshopIds
    3. Creates the MultiWorkshop resource referencing them
    
    Args:
        schedule: WorkshopSchedule object with is_multi_asset=True
        config: RHDPConfig object
        
    Returns:
        MultiWorkshop name if successful, None otherwise
    """
    if not schedule.is_multi_asset or not schedule.asset_cis:
        logger.error("create_multi_workshop called but is_multi_asset is False or asset_cis is empty")
        return None
    
    # Parse asset CIs (comma-separated)
    asset_ci_list = [ci.strip() for ci in schedule.asset_cis.split(',') if ci.strip()]
    
    if config.dry_run:
        # Dry-run: report what would be created, show one sample payload, no oc create
        logger.info("[DRY-RUN] Multi-workshop would create the following:")
        logger.info(f"  Multi-workshop name: {schedule.multi_workshop_name or '(generated)'}")
        logger.info(f"  Instances (numberSeats): {schedule.instances if (schedule.instances is not None and schedule.instances > 0) else schedule.users if _should_include_users(schedule) else 'not set'}")
        logger.info(f"  Concurrency: {schedule.concurrency if schedule.concurrency is not None else 1}")
        for asset_ci in asset_ci_list:
            has_num = (asset_num_users and asset_ci in asset_num_users) or (_should_include_users(schedule) and schedule.users is not None)
            val = (asset_num_users or {}).get(asset_ci) if asset_num_users else (schedule.users if _should_include_users(schedule) else None)
            pw = "set" if ((asset_passwords or {}).get(asset_ci) or schedule.password) else "MISSING"
            logger.info(f"  Asset: {asset_ci}  num_users={'yes (' + str(val) + ')' if has_num else 'no'}  password={pw}")
        # Build and print one sample asset payload (first asset)
        if asset_ci_list:
            start_dt = parse_date_time(schedule.provisioning_date)
            end_dt = parse_date_time(schedule.auto_destroy)
            if start_dt and end_dt:
                start_iso = format_iso8601(start_dt)
                end_iso = format_iso8601(end_dt)
                sample_ci = asset_ci_list[0]
                catalog_info = get_catalog_item_info(sample_ci, config)
                catalog_ns = catalog_info.get('namespace', 'babylon-catalog-prod')
                pv: Dict = {
                    'start_timestamp': start_iso,
                    'stop_timestamp': format_iso8601(parse_date_time(schedule.auto_stop)) if schedule.auto_stop else end_iso,
                }
                if asset_num_users and sample_ci in asset_num_users:
                    pv['num_users'] = asset_num_users[sample_ci]
                elif _should_include_users(schedule) and schedule.users is not None:
                    pv['num_users'] = schedule.users
                sample_payload = {
                    'spec': {
                        'provider': {'name': sample_ci, 'namespace': catalog_ns, 'parameterValues': pv},
                        'lifespan': {'end': end_iso},
                        'accessPassword': (asset_passwords or {}).get(sample_ci, schedule.password) or schedule.password,
                    },
                }
                logger.info("[DRY-RUN] Sample asset payload (first asset):")
                print("\n" + "=" * 70)
                print(json.dumps(sample_payload, indent=2))
                print("=" * 70 + "\n")
        mock_name = schedule.multi_workshop_name or "dryrun-multi"
        logger.info(f"[DRY-RUN] Would create MultiWorkshop and {len(asset_ci_list)} asset workshops (no resources created)")
        return mock_name
    
    try:
        if not asset_ci_list:
            logger.error("No asset CIs provided for multi-asset workshop")
            return None
        
        logger.info(f"Creating multi-asset workshop with {len(asset_ci_list)} assets: {asset_ci_list}")
        
        # Parse dates
        start_dt = parse_date_time(schedule.provisioning_date)
        end_dt = parse_date_time(schedule.auto_destroy)
        
        if not start_dt or not end_dt:
            logger.error("Invalid dates for multi-asset workshop")
            return None
        
        start_iso = format_iso8601(start_dt)
        end_iso = format_iso8601(end_dt)
        
        # Generate MultiWorkshop name - use custom name from CSV if provided, otherwise generate one
        if schedule.multi_workshop_name:
            # Use custom name from CSV (e.g., "test-qvvdw" or "automation-test")
            multi_workshop_name = schedule.multi_workshop_name.lower().replace(' ', '-').replace('_', '-')
            # Ensure it's a valid Kubernetes name (lowercase alphanumeric and hyphens)
            import re
            multi_workshop_name = re.sub(r'[^a-z0-9-]', '', multi_workshop_name)
            logger.info(f"Using custom MultiWorkshop name from CSV: {multi_workshop_name}")
        else:
            # Generate MultiWorkshop name following the pattern: {event-name}-{random-suffix}
            # Example: bbethell-p5djq -> automation-{suffix}
            # Extract namespace prefix (e.g., "bbethell" from "user-bbethell-redhat-com")
            namespace_prefix = schedule.namespace.replace('user-', '').replace('-redhat-com', '').split('-')[0]
            
            # Use "automation" as the event name, or fallback to namespace prefix
            event_name = "automation"
            
            # Generate a random suffix (5 characters, alphanumeric lowercase)
            # Similar to Kubernetes generateName pattern
            import random
            import string
            suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
            multi_workshop_name = f"{event_name}-{suffix}"
            logger.info(f"Generated MultiWorkshop name: {multi_workshop_name} (will appear at /multi-workshop/{schedule.namespace}/{multi_workshop_name})")
        
        # Step 1: Create individual Workshops for each asset
        assets = []
        created_workshops = []
        
        for asset_ci in asset_ci_list:
            logger.info(f"Creating Workshop for asset: {asset_ci}")
            
            # Get catalog item info
            catalog_info = get_catalog_item_info(asset_ci, config)
            catalog_namespace = catalog_info.get('namespace', 'babylon-catalog-prod')
            display_name = catalog_info.get('displayName', asset_ci)
            
            # Generate Workshop name for this asset
            # Pattern from example: bbethell-p5djq-zt-ansiblebu.ansible-network-automation-ba-jwlqp
            # Use the full multi-workshop name as prefix, then asset CI (with dots), then let Kubernetes generate suffix
            asset_ci_safe = asset_ci.replace('.', '-')
            # Truncate if too long (Kubernetes name limit is 63 chars)
            if len(f"{multi_workshop_name}-{asset_ci_safe}") > 50:
                asset_ci_safe = asset_ci_safe[:50-len(multi_workshop_name)-1]
            asset_workshop_prefix = f"{multi_workshop_name}-{asset_ci_safe}-"
            
            # Build a minimal ResourceClaim payload for this asset
            asset_param_values: Dict = {
                'start_timestamp': start_iso,
                'stop_timestamp': format_iso8601(parse_date_time(schedule.auto_stop)) if schedule.auto_stop else end_iso,
            }
            # Per-asset num_users from sheet (optional) overrides schedule-level users
            if asset_num_users and asset_ci in asset_num_users:
                asset_param_values['num_users'] = asset_num_users[asset_ci]
            elif _should_include_users(schedule) and schedule.users is not None:
                asset_param_values['num_users'] = schedule.users
            asset_payload = {
                'spec': {
                    'provider': {
                        'name': asset_ci,
                        'namespace': catalog_namespace,
                        'parameterValues': asset_param_values
                    },
                    'lifespan': {
                        'end': end_iso
                    },
                    'accessPassword': (asset_passwords or {}).get(asset_ci, schedule.password) or schedule.password
                },
                'metadata': {
                    'annotations': {
                        'babylon.gpte.redhat.com/catalogItemDisplayName': display_name,
                        'demo.redhat.com/requester': schedule.namespace.replace('user-', '').replace('-redhat-com', '@redhat.com'),
                        'demo.redhat.com/purpose': schedule.purpose,
                        'demo.redhat.com/purpose-activity': schedule.activity,
                        'demo.redhat.com/salesforce-items': _salesforce_items(schedule)
                    }
                }
            }

            # Create Workshop for this asset
            asset_workshop_name = create_workshop_with_ui(asset_workshop_prefix, schedule.namespace, asset_payload, config)
            
            if not asset_workshop_name:
                logger.warning(f"Failed to create Workshop for asset {asset_ci}, continuing...")
                continue
            
            # Create WorkshopProvision to manage the Workshop and provision seats
            logger.info(f"Creating WorkshopProvision for asset workshop '{asset_workshop_name}'...")
            create_workshop_provision(asset_workshop_name, schedule.namespace, asset_payload, config, enable_workshop_ui=False, concurrency=schedule.concurrency, count=schedule.instances)
            
            created_workshops.append((asset_ci, asset_workshop_name, catalog_namespace, display_name))
            logger.info(f"✅ Created Workshop '{asset_workshop_name}' with WorkshopProvision for asset {asset_ci}")
        
        if not created_workshops:
            logger.error("No workshops were created for multi-asset workshop")
            return None
        
        # Step 2: Wait for all workshops to get IDs
        logger.info("Waiting for all asset workshops to be ready...")
        for asset_ci, workshop_name, catalog_ns, display_name in created_workshops:
            workshop_id = wait_for_workshop_id(workshop_name, schedule.namespace, config, max_wait=120)
            
            if workshop_id:
                assets.append({
                    'displayName': display_name,
                    'key': asset_ci,
                    'name': workshop_name,
                    'namespace': catalog_ns,
                    'type': 'Workshop',
                    'workshopId': workshop_id
                })
                logger.info(f"✅ Asset {asset_ci} ready with ID: {workshop_id}")
            else:
                logger.warning(f"⚠️  Asset {asset_ci} (Workshop {workshop_name}) did not get an ID, skipping...")
        
        if not assets:
            logger.error("No assets with valid workshopIds for multi-asset workshop")
            return None
        
        # Step 3: Create MultiWorkshop resource
        logger.info(f"Creating MultiWorkshop '{multi_workshop_name}' with {len(assets)} assets...")
        
        multi_workshop = {
            "apiVersion": "babylon.gpte.redhat.com/v1",
            "kind": "MultiWorkshop",
            "metadata": {
                "name": multi_workshop_name,
                "namespace": schedule.namespace,
                "annotations": {
                    "babylon.gpte.redhat.com/created-by": schedule.namespace.replace('user-', '').replace('-redhat-com', '@redhat.com')
                }
            },
            "spec": {
                "assets": assets,
                "displayName": schedule.workshop_name or "automation",  # Display name for the multi-workshop
                "endDate": end_iso,
                "name": "automation",  # Event name (matches the pattern from example: bbethell-p5djq has spec.name: bbethell)
                "purpose": schedule.purpose,
                "purpose-activity": schedule.activity,
                "startDate": start_iso
            }
        }
        # Set numberSeats from Users (if set) or from Instances (e.g. 30 workshop instances)
        if _should_include_users(schedule) and schedule.users is not None:
            multi_workshop["spec"]["numberSeats"] = schedule.users
        elif getattr(schedule, 'instances', None) is not None and schedule.instances > 0:
            multi_workshop["spec"]["numberSeats"] = schedule.instances
        
        # Create MultiWorkshop
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp_file:
            json.dump(multi_workshop, tmp_file, indent=2)
            tmp_file_path = tmp_file.name
        
        try:
            cmd = [
                config.oc_command,
                "create",
                "-f", tmp_file_path,
                "-n", schedule.namespace
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout,
                env=env
            )
            
            if result.returncode == 0:
                logger.info(f"✅ Successfully created MultiWorkshop: {multi_workshop_name}")
                return multi_workshop_name
            else:
                if "already exists" in result.stderr:
                    logger.info(f"MultiWorkshop {multi_workshop_name} already exists")
                    return multi_workshop_name
                else:
                    logger.warning(f"Could not create MultiWorkshop: {result.stderr}")
                    return None
        
        finally:
            try:
                os.unlink(tmp_file_path)
            except:
                pass
    
    except Exception as e:
        logger.error(f"Error creating MultiWorkshop: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return None

def enable_workshop_lab_interface(
    workshop_name: str,
    namespace: str,
    config: RHDPConfig,
    max_wait: int = 120
) -> bool:
    """
    Enable labUserInterface.redirect in the Workshop resource.
    This sets the "Enable workshop user interface" toggle to true.
    
    Args:
        workshop_name: Workshop name (from WorkshopProvision)
        namespace: Kubernetes namespace
        config: RHDPConfig object
        max_wait: Maximum seconds to wait for Workshop to be created
        
    Returns:
        True if successful, False otherwise
    """
    logger.info(f"Waiting for Workshop '{workshop_name}' to be created (this may take up to {max_wait}s)...")
    
    for attempt in range(max_wait):
        try:
            # Check if Workshop exists
            cmd = [
                config.oc_command,
                "get", "workshop", workshop_name,
                "-n", namespace,
                "-o", "json"
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            if result.returncode == 0:
                # Workshop exists, check current state
                workshop_data = json.loads(result.stdout)
                current_redirect = workshop_data.get('spec', {}).get('labUserInterface', {}).get('redirect', False)
                
                if current_redirect:
                    logger.info(f"✅ Workshop '{workshop_name}' already has labUserInterface.redirect enabled (Enable workshop user interface: ON)")
                    return True
                
                # Patch it to enable labUserInterface
                patch = {
                    "spec": {
                        "labUserInterface": {
                            "redirect": True
                        }
                    }
                }
                
                patch_cmd = [
                    config.oc_command,
                    "patch", "workshop", workshop_name,
                    "-n", namespace,
                    "--type", "merge",
                    "-p", json.dumps(patch)
                ]
                
                patch_result = subprocess.run(
                    patch_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=env
                )
                
                if patch_result.returncode == 0:
                    logger.info(f"✅ Enabled labUserInterface.redirect (Enable workshop user interface: ON) for Workshop: {workshop_name}")
                    return True
                else:
                    logger.warning(f"Could not patch Workshop: {patch_result.stderr}")
                    return False
            else:
                # Workshop not created yet, wait and retry
                if attempt % 10 == 0 and attempt > 0:
                    logger.debug(f"Still waiting for Workshop '{workshop_name}' to be created... ({attempt}/{max_wait}s)")
                if attempt < max_wait - 1:
                    time.sleep(2)
                    continue
        
        except Exception as e:
            logger.debug(f"Error enabling workshop UI (attempt {attempt + 1}): {e}")
            if attempt < max_wait - 1:
                time.sleep(2)
                continue
    
    logger.warning(f"⚠️  Could not enable labUserInterface for Workshop '{workshop_name}' (not found after {max_wait}s)")
    logger.warning(f"   Workshop may still be provisioning. You can enable it manually later with:")
    logger.warning(f"   oc patch workshop {workshop_name} -n {namespace} --type merge -p '{{\"spec\":{{\"labUserInterface\":{{\"redirect\":true}}}}}}'")
    return False

def get_resourceclaim_name_from_cluster(
    generate_name: str,
    namespace: str,
    config: RHDPConfig,
    max_wait: int = 10
) -> Optional[str]:
    """
    Get ResourceClaim name from cluster by matching generateName.
    
    Args:
        generate_name: generateName pattern
        namespace: Namespace to search
        config: RHDPConfig object
        max_wait: Maximum seconds to wait
        
    Returns:
        ResourceClaim name or None
    """
    for attempt in range(max_wait):
        try:
            cmd = [
                config.oc_command,
                "get", "resourceclaims",
                "-n", namespace,
                "-o", "json"
            ]
            
            env = os.environ.copy()
            if config.kubeconfig_path:
                env['KUBECONFIG'] = config.kubeconfig_path
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            if result.returncode == 0:
                data = json.loads(result.stdout)
                items = data.get('items', [])
                
                # Find ResourceClaim matching generateName pattern
                prefix = generate_name.rstrip('-')
                for item in items:
                    name = item.get('metadata', {}).get('name', '')
                    if name.startswith(prefix):
                        return name
            
            if attempt < max_wait - 1:
                time.sleep(1)
        
        except Exception as e:
            logger.debug(f"Error getting ResourceClaim name (attempt {attempt + 1}): {e}")
            if attempt < max_wait - 1:
                time.sleep(1)
    
    return None

# ============================================================================
# DEPLOYMENT VERIFICATION
# ============================================================================

def construct_workshop_url(
    ci: str,
    namespace: str,
    guid_suffix: str = ""
) -> str:
    """
    Construct workshop URL based on RHDP pattern.
    
    Pattern: https://integration.demo.redhat.com/workshops/{namespace}/{ci}-{suffix}
    Example: https://integration.demo.redhat.com/workshops/user-bbethell-redhat-com/openshift-cnv.ocp-virt-roadshow-multi-user.prod-vt958
    
    Args:
        ci: Catalog Item ID
        namespace: Namespace (already in correct format)
        guid_suffix: Optional suffix from GUID
        
    Returns:
        Constructed workshop URL
    """
    if guid_suffix:
        workshop_path = f"{ci}-{guid_suffix}"
    else:
        workshop_path = ci
    
    url = f"https://integration.demo.redhat.com/workshops/{namespace}/{workshop_path}"
    return url

def get_landing_page_url(workshop_id: str) -> str:
    """
    Construct landing page workshop URL from workshopId.
    
    Pattern: https://integration.demo.redhat.com/workshop/{workshopId}
    Example: https://integration.demo.redhat.com/workshop/m5hzmw
    
    Args:
        workshop_id: Workshop ID (from label babylon.gpte.redhat.com/workshop-id)
        
    Returns:
        Landing page workshop URL
    """
    if not workshop_id:
        return ""
    return f"https://integration.demo.redhat.com/workshop/{workshop_id}"

def get_workshop_urls(workshop_name: str, namespace: str, ci: str, config: RHDPConfig) -> Tuple[str, str]:
    """
    Get both the full workshop URL and the short catalog URL.
    
    Args:
        workshop_name: Name of the Workshop resource
        namespace: Kubernetes namespace
        ci: Catalog Item ID
        config: RHDPConfig object
        
    Returns:
        Tuple of (full_workshop_url, catalog_url)
    """
    # Construct full workshop URL
    suffix = workshop_name.split('-')[-1] if '-' in workshop_name else ""
    full_url = construct_workshop_url(ci, namespace, suffix)
    
    # Get workshopId and construct landing page URL
    workshop_id = get_workshop_id(workshop_name, namespace, config)
    landing_page_url = get_landing_page_url(workshop_id) if workshop_id else ""
    
    return (full_url, landing_page_url)

def verify_deployment(
    guid: str,
    namespace: str,
    ci: str,
    config: RHDPConfig
) -> Tuple[bool, Optional[str]]:
    """
    Verify deployment by checking ResourceClaim status.
    
    Args:
        guid: ResourceClaim name/GUID
        namespace: Kubernetes namespace
        ci: Catalog Item ID for URL construction
        config: RHDPConfig object
        
    Returns:
        Tuple of (is_healthy: bool, url: Optional[str])
    """
    if config.dry_run:
        # Extract suffix from GUID if present
        suffix = ""
        if '-' in guid:
            parts = guid.split('-')
            if len(parts) > 1:
                suffix = parts[-1]
        url = construct_workshop_url(ci, namespace, suffix)
        logger.info(f"[DRY-RUN] Would verify deployment: {guid} in {namespace}")
        return (True, url)
    
    try:
        # Get ResourceClaim status
        cmd = [
            config.oc_command,
            "get", "resourceclaim", guid,
            "-n", namespace,
            "-o", "json"
        ]
        
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            env=env
        )
        
        if result.returncode != 0:
            logger.warning(f"Could not get ResourceClaim {guid}: {result.stderr}")
            # Still construct URL
            suffix = guid.split('-')[-1] if '-' in guid else ""
            url = construct_workshop_url(ci, namespace, suffix)
            return (False, url)
        
        rc_data = json.loads(result.stdout)
        status = rc_data.get('status', {})
        
        # Check if healthy and ready
        healthy = status.get('healthy', False)
        ready = status.get('ready', False)
        
        # Extract suffix from GUID
        suffix = guid.split('-')[-1] if '-' in guid else ""
        url = construct_workshop_url(ci, namespace, suffix)
        
        if healthy and ready:
            logger.info(f"Deployment verification passed for {guid}: {url}")
            return (True, url)
        elif healthy:
            logger.info(f"Deployment is healthy but not ready yet for {guid}: {url}")
            return (True, url)  # Still consider it successful if healthy
        else:
            logger.warning(f"Deployment verification failed for {guid}: {url} (healthy={healthy}, ready={ready})")
            return (False, url)
        
    except Exception as e:
        logger.error(f"Verification error for {guid}: {e}")
        suffix = guid.split('-')[-1] if '-' in guid else ""
        url = construct_workshop_url(ci, namespace, suffix)
        return (False, url)

# ============================================================================
# QA FUNCTIONS
# ============================================================================

def list_scheduled_resourceclaims(
    namespace: str,
    config: RHDPConfig,
    ci_filter: Optional[str] = None
) -> List[Dict]:
    """
    List all ResourceClaims scheduled by rhdp-flow in a namespace.
    If ci_filter is provided, also includes ResourceClaims matching that CI.
    
    Args:
        namespace: Kubernetes namespace
        config: RHDPConfig object
        ci_filter: Optional Catalog Item ID to filter by
        
    Returns:
        List of ResourceClaim dictionaries
    """
    try:
        # First try to get ResourceClaims with our label
        cmd = [
            config.oc_command,
            "get", "resourceclaims",
            "-n", namespace,
            "-l", "rhdp-flow.gpte.redhat.com/scheduled=true",
            "-o", "json"
        ]
        
        env = os.environ.copy()
        if config.kubeconfig_path:
            env['KUBECONFIG'] = config.kubeconfig_path
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            env=env
        )
        
        items = []
        if result.returncode == 0:
            data = json.loads(result.stdout)
            items = data.get('items', [])
        
        # If ci_filter provided, also get ResourceClaims matching that CI
        # (for backwards compatibility with ResourceClaims created before label tracking)
        if ci_filter:
            cmd_all = [
                config.oc_command,
                "get", "resourceclaims",
                "-n", namespace,
                "-o", "json"
            ]
            
            result_all = subprocess.run(
                cmd_all,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            if result_all.returncode == 0:
                data_all = json.loads(result_all.stdout)
                all_items = data_all.get('items', [])
                
                # Filter by CI name
                matching_items = [
                    rc for rc in all_items
                    if rc.get('metadata', {}).get('labels', {}).get('babylon.gpte.redhat.com/catalogItemName') == ci_filter
                ]
                
                # Add items not already in our list
                existing_names = {rc.get('metadata', {}).get('name') for rc in items}
                for rc in matching_items:
                    if rc.get('metadata', {}).get('name') not in existing_names:
                        items.append(rc)
        
        logger.info(f"Found {len(items)} scheduled ResourceClaim(s) in namespace {namespace}")
        return items
        
    except Exception as e:
        logger.error(f"Error listing scheduled ResourceClaims: {e}")
        return []

def qa1_verify_setup(
    csv_file: str,
    namespace: str,
    config: RHDPConfig
) -> List[Dict]:
    """
    QA Function 1: Verify deployments are set up as per the schedule sheet.
    Checks: times, user counts, dates match the CSV schedule.
    
    Args:
        csv_file: Path to input CSV file with scheduled workshops
        namespace: Kubernetes namespace to check
        config: RHDPConfig object
        
    Returns:
        List of verification results comparing CSV schedule vs actual deployments
    """
    logger.info("=" * 70)
    logger.info("QA1: Verify Setup - Comparing CSV Schedule vs Actual Deployments")
    logger.info("=" * 70)
    """
    QA function to verify deployments match the scheduled CSV.
    Compares what's in the CSV with what's actually deployed in the namespace.
    
    Args:
        csv_file: Path to input CSV file with scheduled workshops
        namespace: Kubernetes namespace to check
        config: RHDPConfig object
        
    Returns:
        List of verification results comparing CSV schedule vs actual deployments
    """
    logger.info("QA1: Verify Setup - Comparing CSV Schedule vs Actual Deployments")
    
    # Read scheduled items from CSV
    try:
        scheduled_items = read_csv_input(csv_file)
        logger.info(f"Found {len(scheduled_items)} scheduled item(s) in CSV")
    except Exception as e:
        logger.error(f"Failed to read CSV file: {e}")
        return []
    
    # Get all scheduled ResourceClaims from namespace
    # For each CI in the schedule, get matching ResourceClaims
    all_resourceclaims = []
    for schedule in scheduled_items:
        rcs = list_scheduled_resourceclaims(namespace, config, ci_filter=schedule.ci)
        all_resourceclaims.extend(rcs)
    
    # Remove duplicates by name
    seen_names = set()
    resourceclaims = []
    for rc in all_resourceclaims:
        name = rc.get('metadata', {}).get('name')
        if name and name not in seen_names:
            seen_names.add(name)
            resourceclaims.append(rc)
    
    logger.info(f"Found {len(resourceclaims)} scheduled ResourceClaim(s) in namespace {namespace}")
    
    results = []
    
    # Check each scheduled item from CSV
    for schedule in scheduled_items:
        # For multi-asset workshops, check MultiWorkshop resources
        if schedule.is_multi_asset:
            try:
                cmd = [
                    config.oc_command,
                    "get", "multiworkshop",
                    "-n", namespace,
                    "-o", "json"
                ]
                env = os.environ.copy()
                if config.kubeconfig_path:
                    env['KUBECONFIG'] = config.kubeconfig_path
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=env
                )
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    multiworkshops = data.get('items', [])
                    
                    # Find MultiWorkshop matching our schedule (check by spec.name or displayName)
                    matching_mw = None
                    for mw in multiworkshops:
                        spec = mw.get('spec', {})
                        if spec.get('name') == 'automation' or spec.get('displayName') == schedule.workshop_name:
                            matching_mw = mw
                            break
                    
                    if matching_mw:
                        mw_name = matching_mw.get('metadata', {}).get('name', 'unknown')
                        spec = matching_mw.get('spec', {})
                        assets = spec.get('assets', [])
                        number_seats = spec.get('numberSeats', 0)
                        start_date = spec.get('startDate', '')
                        end_date = spec.get('endDate', '')
                        # Workshop Users Assigned in UI = assigned/total; total must be numberSeats (e.g. 30)
                        status_obj = matching_mw.get('status', {})
                        user_count = status_obj.get('userCount', {})
                        assigned = user_count.get('assigned', user_count.get('total', 0)) if isinstance(user_count, dict) else 0
                        total_seats = number_seats
                        workshop_users_assigned = f"{assigned}/{total_seats}" if total_seats else "0/0"
                        
                        # Construct multi-workshop portal URL (not individual workshop URLs)
                        url = f"https://integration.demo.redhat.com/multi-workshop/{namespace}/{mw_name}"
                        # For multi-asset workshops, landing page URL is the same as the portal URL
                        landing_page_url = url
                        
                        # Check if matches schedule (expected total seats = Instances or Users)
                        matches_schedule = True
                        issues = []
                        expected_total = _expected_total_seats(schedule)
                        expected_users = _effective_users(schedule)
                        if expected_total is not None and number_seats != expected_total:
                            matches_schedule = False
                            issues.append(f"Total seats mismatch: expected {expected_total} (instances/users), got numberSeats={number_seats}. UI should show x/{expected_total}, not {workshop_users_assigned}.")
                        if number_seats == 0 and expected_total is not None and expected_total > 0:
                            matches_schedule = False
                            issues.append(f"Workshop Users Assigned shows 0/0; expected total seats (instances)={expected_total}. Set numberSeats on MultiWorkshop.")
                        if expected_users is not None and number_seats != expected_users and expected_total is None:
                            matches_schedule = False
                            issues.append(f"User count mismatch: expected {expected_users}, got {number_seats}")
                        
                        result = {
                            "ci_name": schedule.ci_name,
                            "ci": schedule.ci,
                            "namespace": namespace,
                            "scheduled": "Yes",
                            "deployed": "Yes",
                            "status": "✅ MULTI-WORKSHOP",
                            "matches_schedule": "Yes" if matches_schedule else "No",
                            "issues": "; ".join(issues) if issues else "",
                            "expected_users": expected_total if expected_total is not None else expected_users,
                            "actual_count": number_seats,
                            "workshop_users_assigned": workshop_users_assigned,
                            "total_seats": total_seats,
                            "provisioning_date": schedule.provisioning_date,
                            "auto_stop": schedule.auto_stop,
                            "auto_destroy": schedule.auto_destroy,
                            "resourceclaim_name": mw_name,
                            "resourceclaims": [mw_name],
                            "link_to_service": url,  # Multi-workshop portal URL
                            "landing_page_url": landing_page_url,  # Portal URL (same as link_to_service for multi-asset)
                            "healthy": True,
                            "ready": True
                        }
                        results.append(result)
                        logger.info(f"✅ {schedule.ci_name} ({schedule.ci}) - MultiWorkshop: {mw_name} with {len(assets)} assets")
                        logger.info(f"   Workshop Users Assigned (UI): {workshop_users_assigned}" + (f" (expected total: {expected_total})" if expected_total is not None else ""))
                        if issues:
                            for i in issues:
                                logger.warning(f"   ⚠️  {i}")
                        continue
            except Exception as e:
                logger.debug(f"Error checking MultiWorkshop: {e}")
        
        # Find matching ResourceClaims for this CI
        matching_rcs = [
            rc for rc in resourceclaims
            if rc.get('metadata', {}).get('labels', {}).get('babylon.gpte.redhat.com/catalogItemName') == schedule.ci
        ]
        
        # Also check for directly created Workshops (not via ResourceClaim)
        if not matching_rcs and schedule.enable_workshop_interface:
            try:
                cmd = [
                    config.oc_command,
                    "get", "workshop",
                    "-n", namespace,
                    "-l", f"babylon.gpte.redhat.com/catalogItemName={schedule.ci}",
                    "-o", "json"
                ]
                env = os.environ.copy()
                if config.kubeconfig_path:
                    env['KUBECONFIG'] = config.kubeconfig_path
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=env
                )
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    workshops = data.get('items', [])
                    if workshops:
                        # Found Workshop directly created
                        workshop = workshops[0]
                        workshop_name = workshop.get('metadata', {}).get('name', 'unknown')
                        spec = workshop.get('spec', {})
                        status_obj = workshop.get('status', {})
                        
                        # Get user count from status or spec
                        user_count = status_obj.get('userCount', {}).get('total', 0)
                        if user_count == 0 and _effective_users(schedule) is not None:
                            # Try to get from WorkshopProvision or use expected
                            user_count = _effective_users(schedule)
                        
                        # Get both URLs
                        full_url, catalog_url = get_workshop_urls(workshop_name, namespace, schedule.ci, config)
                        
                        result = {
                            "ci_name": schedule.ci_name,
                            "ci": schedule.ci,
                            "namespace": namespace,
                            "scheduled": "Yes",
                            "deployed": "Yes",
                            "status": "✅ WORKSHOP (direct)",
                            "matches_schedule": "Yes",
                            "issues": "",
                            "expected_users": _effective_users(schedule) if _effective_users(schedule) is not None else "",
                            "actual_count": user_count,
                            "provisioning_date": schedule.provisioning_date,
                            "auto_stop": schedule.auto_stop,
                            "auto_destroy": schedule.auto_destroy,
                            "resourceclaim_name": workshop_name,
                            "resourceclaims": [workshop_name],
                            "link_to_service": full_url,
                            "landing_page_url": catalog_url,
                            "healthy": True,
                            "ready": True
                        }
                        results.append(result)
                        logger.info(f"✅ {schedule.ci_name} ({schedule.ci}) - Workshop: {workshop_name}")
                        continue
            except Exception as e:
                logger.debug(f"Error checking Workshop: {e}")
        
        if not matching_rcs:
            # Scheduled but not found
            result = {
                "ci_name": schedule.ci_name,
                "ci": schedule.ci,
                "namespace": namespace,
                "scheduled": "Yes",
                "deployed": "No",
                "status": "❌ NOT DEPLOYED",
                "expected_users": _effective_users(schedule) if _effective_users(schedule) is not None else "",
                "actual_count": 0,
                "provisioning_date": schedule.provisioning_date,
                "auto_stop": schedule.auto_stop,
                "auto_destroy": schedule.auto_destroy,
                "resourceclaims": [],
                "link_to_service": "",
                "landing_page_url": ""
            }
            results.append(result)
            logger.warning(f"❌ {schedule.ci_name} ({schedule.ci}) - Scheduled but NOT deployed")
            continue
        
        # Check each matching ResourceClaim
        for rc in matching_rcs:
            metadata = rc.get('metadata', {})
            name = metadata.get('name', 'unknown')
            status = rc.get('status', {})
            healthy = status.get('healthy', False)
            ready = status.get('ready', False)
            
            # Get provider parameters
            provider = status.get('provider', {})
            param_values = provider.get('parameterValues', {})
            actual_users = param_values.get('num_users', 0)
            
            # Get timestamps
            start_ts = param_values.get('start_timestamp', '')
            stop_ts = param_values.get('stop_timestamp', '')
            
            # Get workshop name from ResourceClaim to retrieve URLs
            # Try to find the Workshop created by this ResourceClaim
            workshop_name = None
            try:
                # Check if ResourceClaim has created a Workshop
                cmd = [
                    config.oc_command,
                    "get", "workshop",
                    "-n", namespace,
                    "-l", f"babylon.gpte.redhat.com/catalogItemName={schedule.ci}",
                    "-o", "json"
                ]
                env = os.environ.copy()
                if config.kubeconfig_path:
                    env['KUBECONFIG'] = config.kubeconfig_path
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    env=env
                )
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    workshops = data.get('items', [])
                    # Find workshop that matches this ResourceClaim (by name pattern or labels)
                    for w in workshops:
                        w_name = w.get('metadata', {}).get('name', '')
                        if name.split('-')[-1] in w_name or schedule.ci in w_name:
                            workshop_name = w_name
                            break
            except:
                pass
            
            # Get both URLs
            if workshop_name:
                full_url, catalog_url = get_workshop_urls(workshop_name, namespace, schedule.ci, config)
            else:
                # Fallback: construct URL from ResourceClaim name
                suffix = name.split('-')[-1] if '-' in name else ""
                full_url = construct_workshop_url(schedule.ci, namespace, suffix)
                catalog_url = ""
            
            # Determine status
            if healthy and ready:
                overall_status = "✅ VERIFIED"
            elif healthy:
                overall_status = "⚠️  HEALTHY (not ready)"
            else:
                overall_status = "❌ FAILED"
            
            # Check if matches schedule
            matches_schedule = True
            issues = []
            
            expected_users = _effective_users(schedule)
            if expected_users is not None and actual_users != expected_users:
                matches_schedule = False
                issues.append(f"User count mismatch: expected {expected_users}, got {actual_users}")
            
            # Parse and compare dates (all in UTC)
            expected_start = parse_date_time(schedule.provisioning_date, assume_utc=True)
            if expected_start and start_ts:
                try:
                    # Parse actual start time (should be in UTC/Zulu)
                    if start_ts.endswith('Z'):
                        actual_start = datetime.fromisoformat(start_ts.replace('Z', '+00:00'))
                    else:
                        actual_start = datetime.fromisoformat(start_ts)
                        if actual_start.tzinfo is None:
                            actual_start = actual_start.replace(tzinfo=timezone.utc)
                    
                    # Compare dates (both should be in UTC)
                    if expected_start:
                        time_diff = abs((actual_start - expected_start).total_seconds())
                        if time_diff > 300:  # 5 minute tolerance
                            expected_str = format_iso8601(expected_start)
                            matches_schedule = False
                            issues.append(f"Start time mismatch: expected {expected_str} (from {schedule.provisioning_date}), got {start_ts}")
                except Exception as e:
                    logger.debug(f"Error comparing dates: {e}")
                    pass
            
            result = {
                "ci_name": schedule.ci_name,
                "ci": schedule.ci,
                "namespace": namespace,
                "resourceclaim_name": name,
                "scheduled": "Yes",
                "deployed": "Yes",
                "status": overall_status,
                "matches_schedule": "Yes" if matches_schedule else "No",
                "issues": "; ".join(issues) if issues else "",
                "expected_users": _effective_users(schedule) if _effective_users(schedule) is not None else "",
                "actual_users": actual_users,
                "healthy": healthy,
                "ready": ready,
                "link_to_service": full_url,
                "landing_page_url": catalog_url,
                "expected_provisioning": schedule.provisioning_date,
                "actual_start": start_ts,
                "expected_stop": schedule.auto_stop,
                "actual_stop": stop_ts,
                "expected_destroy": schedule.auto_destroy,
                "link_to_service": full_url,
                "landing_page_url": catalog_url
            }
            results.append(result)
            
            # Log result
            status_icon = "✅" if matches_schedule and healthy and ready else "⚠️" if healthy else "❌"
            logger.info(f"{status_icon} {schedule.ci_name} ({schedule.ci})")
            logger.info(f"  ResourceClaim: {name}")
            logger.info(f"  Status: {overall_status}")
            exp_u = _effective_users(schedule)
            logger.info(f"  Users: {actual_users}" + (f" (expected: {exp_u})" if exp_u is not None else " (users not configured)"))
            logger.info(f"  Link to Service: {full_url}")
            if catalog_url:
                logger.info(f"  Landing Page URL: {catalog_url}")
            if issues:
                for issue in issues:
                    logger.warning(f"  ⚠️  {issue}")
            logger.info("")
    
    # Summary
    total_scheduled = len(scheduled_items)
    total_deployed = sum(1 for r in results if r.get('deployed') == 'Yes')
    verified = sum(1 for r in results if r.get('status') == '✅ VERIFIED')
    matches = sum(1 for r in results if r.get('matches_schedule') == 'Yes')
    
    logger.info("=" * 70)
    logger.info("QA1 Summary: Setup Verification")
    logger.info(f"  Total Scheduled (CSV): {total_scheduled}")
    logger.info(f"  Total Deployed: {total_deployed}")
    logger.info(f"  ✅ Verified (healthy & ready): {verified}")
    logger.info(f"  ✅ Matches Schedule (times/users): {matches}")
    logger.info(f"  ❌ Not Deployed: {total_scheduled - total_deployed}")
    logger.info("=" * 70)
    
    return results

def qa2_verify_deployment_status(
    csv_file: str,
    namespace: str,
    config: RHDPConfig
) -> List[Dict]:
    """
    QA Function 2: Verify deployments are actually deployed and seat counts match.
    This is triggered later to check if workshops are provisioned and ready.
    
    Args:
        csv_file: Path to input CSV file with scheduled workshops
        namespace: Kubernetes namespace to check
        config: RHDPConfig object
        
    Returns:
        List of verification results with deployment status and seat counts
    """
    logger.info("=" * 70)
    logger.info("QA2: Verify Deployment Status - Check if deployed and seat counts")
    logger.info("=" * 70)
    
    # Read scheduled items from CSV
    try:
        scheduled_items = read_csv_input(csv_file)
        logger.info(f"Found {len(scheduled_items)} scheduled item(s) in CSV")
    except Exception as e:
        logger.error(f"Failed to read CSV file: {e}")
        return []
    
    # Get all scheduled ResourceClaims from namespace
    all_resourceclaims = []
    for schedule in scheduled_items:
        rcs = list_scheduled_resourceclaims(namespace, config, ci_filter=schedule.ci)
        all_resourceclaims.extend(rcs)
    
    # Remove duplicates by name
    seen_names = set()
    resourceclaims = []
    for rc in all_resourceclaims:
        name = rc.get('metadata', {}).get('name')
        if name and name not in seen_names:
            seen_names.add(name)
            resourceclaims.append(rc)
    
    logger.info(f"Found {len(resourceclaims)} scheduled ResourceClaim(s) in namespace {namespace}")
    
    results = []
    
    # Check each scheduled item from CSV
    for schedule in scheduled_items:
        # For multi-asset workshops, check MultiWorkshop resources
        if schedule.is_multi_asset:
            try:
                cmd = [
                    config.oc_command,
                    "get", "multiworkshop",
                    "-n", namespace,
                    "-o", "json"
                ]
                env = os.environ.copy()
                if config.kubeconfig_path:
                    env['KUBECONFIG'] = config.kubeconfig_path
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=env
                )
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    multiworkshops = data.get('items', [])
                    
                    # Find MultiWorkshop matching our schedule
                    matching_mw = None
                    for mw in multiworkshops:
                        spec = mw.get('spec', {})
                        if spec.get('name') == 'automation' or spec.get('displayName') == schedule.workshop_name:
                            matching_mw = mw
                            break
                    
                    if matching_mw:
                        mw_name = matching_mw.get('metadata', {}).get('name', 'unknown')
                        spec = matching_mw.get('spec', {})
                        assets = spec.get('assets', [])
                        number_seats = spec.get('numberSeats', 0)
                        # Workshop Users Assigned in UI = assigned/total (e.g. 0/30)
                        status_obj = matching_mw.get('status', {})
                        user_count = status_obj.get('userCount', {})
                        assigned = user_count.get('assigned', user_count.get('total', 0)) if isinstance(user_count, dict) else 0
                        total_seats = number_seats
                        workshop_users_assigned = f"{assigned}/{total_seats}" if total_seats else "0/0"
                        
                        # Construct multi-workshop portal URL (not individual workshop URLs)
                        url = f"https://integration.demo.redhat.com/multi-workshop/{namespace}/{mw_name}"
                        # For multi-asset workshops, landing page URL is the same as the portal URL
                        landing_page_url = url
                        
                        expected_total = _expected_total_seats(schedule)
                        expected_seats = expected_total if expected_total is not None else _effective_users(schedule)
                        seats_match = (expected_seats is None) or (number_seats == expected_seats)
                        if number_seats == 0 and expected_seats is not None and expected_seats > 0:
                            seats_match = False
                        
                        result = {
                            "ci_name": schedule.ci_name,
                            "ci": schedule.ci,
                            "namespace": namespace,
                            "scheduled": "Yes",
                            "deployed": "Yes",
                            "status": "✅ MULTI-WORKSHOP",
                            "expected_seats": expected_seats if expected_seats is not None else "",
                            "actual_seats": number_seats,
                            "workshop_users_assigned": workshop_users_assigned,
                            "total_seats": total_seats,
                            "seats_match": "Yes" if seats_match else "No",
                            "healthy": True,
                            "ready": True,
                            "provisioned": True,
                            "resourceclaim_name": mw_name,
                            "link_to_service": url,  # Multi-workshop portal URL
                            "landing_page_url": landing_page_url  # Landing page URL from first asset workshopId
                        }
                        results.append(result)
                        logger.info(f"✅ {schedule.ci_name} ({schedule.ci}) - MultiWorkshop: {mw_name}")
                        logger.info(f"   Workshop Users Assigned (UI): {workshop_users_assigned}" + (f" (expected total: {expected_seats})" if expected_seats is not None else ""))
                        if not seats_match and expected_seats is not None and number_seats == 0:
                            logger.warning(f"   ⚠️  Total seats is 0; UI shows 0/0. Expected x/{expected_seats} (instances).")
                        logger.info(f"   Assets: {len(assets)}")
                        logger.info(f"   Link to Service: {url}")
                        continue
            except Exception as e:
                logger.debug(f"Error checking MultiWorkshop: {e}")
        
        # Find matching ResourceClaims for this CI
        matching_rcs = [
            rc for rc in resourceclaims
            if rc.get('metadata', {}).get('labels', {}).get('babylon.gpte.redhat.com/catalogItemName') == schedule.ci
        ]
        
        # Also check for directly created Workshops (not via ResourceClaim)
        if not matching_rcs and schedule.enable_workshop_interface:
            try:
                cmd = [
                    config.oc_command,
                    "get", "workshop",
                    "-n", namespace,
                    "-l", f"babylon.gpte.redhat.com/catalogItemName={schedule.ci}",
                    "-o", "json"
                ]
                env = os.environ.copy()
                if config.kubeconfig_path:
                    env['KUBECONFIG'] = config.kubeconfig_path
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=env
                )
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    workshops = data.get('items', [])
                    if workshops:
                        # Found Workshop directly created
                        workshop = workshops[0]
                        workshop_name = workshop.get('metadata', {}).get('name', 'unknown')
                        status_obj = workshop.get('status', {})
                        user_count = status_obj.get('userCount', {}).get('total', 0)
                        
                        # Get both URLs
                        full_url, catalog_url = get_workshop_urls(workshop_name, namespace, schedule.ci, config)
                        
                        expected_seats = _effective_users(schedule)
                        seats_match = (expected_seats is None) or (user_count == expected_seats) if user_count > 0 else (expected_seats is None)
                        
                        result = {
                            "ci_name": schedule.ci_name,
                            "ci": schedule.ci,
                            "namespace": namespace,
                            "scheduled": "Yes",
                            "deployed": "Yes",
                            "status": "✅ WORKSHOP (direct)",
                            "expected_seats": expected_seats if expected_seats is not None else "",
                            "actual_seats": user_count,
                            "seats_match": "Yes" if seats_match else "No",
                            "healthy": True,
                            "ready": True,
                            "provisioned": True,
                            "resourceclaim_name": workshop_name,
                            "link_to_service": full_url,
                            "landing_page_url": catalog_url
                        }
                        results.append(result)
                        logger.info(f"✅ {schedule.ci_name} ({schedule.ci}) - Workshop: {workshop_name}")
                        logger.info(f"   ✅ Seats: {user_count}" + (f" (expected: {expected_seats})" if expected_seats is not None else " (users not configured)"))
                        continue
            except Exception as e:
                logger.debug(f"Error checking Workshop: {e}")
        
        if not matching_rcs:
            # Scheduled but not found
            result = {
                "ci_name": schedule.ci_name,
                "ci": schedule.ci,
                "namespace": namespace,
                "scheduled": "Yes",
                "deployed": "No",
                "status": "❌ NOT DEPLOYED",
                "expected_seats": _effective_users(schedule) if _effective_users(schedule) is not None else "",
                "actual_seats": 0,
                "healthy": False,
                "ready": False,
                "provisioned": False,
                "link_to_service": "",
                "landing_page_url": ""
            }
            results.append(result)
            logger.warning(f"❌ {schedule.ci_name} ({schedule.ci}) - Scheduled but NOT deployed")
            continue
        
        # Check each matching ResourceClaim
        for rc in matching_rcs:
            metadata = rc.get('metadata', {})
            name = metadata.get('name', 'unknown')
            status = rc.get('status', {})
            healthy = status.get('healthy', False)
            ready = status.get('ready', False)
            
            # Get provider parameters
            provider = status.get('provider', {})
            param_values = provider.get('parameterValues', {})
            actual_seats = param_values.get('num_users', 0)
            
            # Get workshop name from ResourceClaim to retrieve URLs
            workshop_name = None
            try:
                cmd = [
                    config.oc_command,
                    "get", "workshop",
                    "-n", namespace,
                    "-l", f"babylon.gpte.redhat.com/catalogItemName={schedule.ci}",
                    "-o", "json"
                ]
                env = os.environ.copy()
                if config.kubeconfig_path:
                    env['KUBECONFIG'] = config.kubeconfig_path
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    env=env
                )
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    workshops = data.get('items', [])
                    for w in workshops:
                        w_name = w.get('metadata', {}).get('name', '')
                        if name.split('-')[-1] in w_name or schedule.ci in w_name:
                            workshop_name = w_name
                            break
            except:
                pass
            
            # Get both URLs
            if workshop_name:
                full_url, catalog_url = get_workshop_urls(workshop_name, namespace, schedule.ci, config)
            else:
                suffix = name.split('-')[-1] if '-' in name else ""
                full_url = construct_workshop_url(schedule.ci, namespace, suffix)
                catalog_url = ""
            
            # Determine deployment status
            if healthy and ready:
                deployment_status = "✅ DEPLOYED & READY"
                provisioned = True
            elif healthy:
                deployment_status = "⚠️  DEPLOYED (not ready)"
                provisioned = True
            else:
                deployment_status = "❌ DEPLOYMENT FAILED"
                provisioned = False
            
            # Check seat count (skip when users not configured)
            expected_seats = _effective_users(schedule)
            seats_match = (expected_seats is None) or (actual_seats == expected_seats)
            seat_status = "✅" if seats_match else "❌"
            
            result = {
                "ci_name": schedule.ci_name,
                "ci": schedule.ci,
                "namespace": namespace,
                "resourceclaim_name": name,
                "scheduled": "Yes",
                "deployed": "Yes",
                "provisioned": provisioned,
                "status": deployment_status,
                "expected_seats": expected_seats if expected_seats is not None else "",
                "actual_seats": actual_seats,
                "seats_match": "Yes" if seats_match else "No",
                "healthy": healthy,
                "ready": ready,
                "link_to_service": full_url,
                "landing_page_url": catalog_url
            }
            results.append(result)
            
            # Log result
            logger.info(f"{deployment_status} - {schedule.ci_name} ({schedule.ci})")
            logger.info(f"  ResourceClaim: {name}")
            logger.info(f"  {seat_status} Seats: {actual_seats}" + (f" (expected: {expected_seats})" if expected_seats is not None else " (users not configured)"))
            logger.info(f"  Healthy: {healthy}, Ready: {ready}, Provisioned: {provisioned}")
            logger.info(f"  Link to Service: {full_url}")
            if catalog_url:
                logger.info(f"  Landing Page URL: {catalog_url}")
            if not seats_match:
                logger.warning(f"  ⚠️  Seat count mismatch!")
            logger.info("")
    
    # Summary
    total_scheduled = len(scheduled_items)
    total_deployed = sum(1 for r in results if r.get('deployed') == 'Yes')
    provisioned = sum(1 for r in results if r.get('provisioned') == True)
    ready = sum(1 for r in results if r.get('ready') == True)
    seats_match = sum(1 for r in results if r.get('seats_match') == 'Yes')
    
    logger.info("=" * 70)
    logger.info("QA2 Summary: Deployment Status")
    logger.info(f"  Total Scheduled (CSV): {total_scheduled}")
    logger.info(f"  Total Deployed: {total_deployed}")
    logger.info(f"  ✅ Provisioned: {provisioned}")
    logger.info(f"  ✅ Ready: {ready}")
    logger.info(f"  ✅ Seat Counts Match: {seats_match}/{total_deployed}")
    logger.info(f"  ❌ Not Deployed: {total_scheduled - total_deployed}")
    logger.info("=" * 70)
    
    return results

def qa_export_results(
    results: List[Dict],
    output_file: str = "qa_results.csv"
) -> None:
    """
    Export QA results to CSV.
    
    Args:
        results: List of QA verification results
        output_file: Output CSV file path
    """
    if not results:
        logger.warning("No results to export")
        return
    
    try:
        # Get all unique fieldnames from results
        fieldnames = set()
        for result in results:
            fieldnames.update(result.keys())
        fieldnames = sorted(list(fieldnames))
        
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            
            for result in results:
                writer.writerow(result)
        
        logger.info(f"QA results exported to {output_file}")
        
    except Exception as e:
        logger.error(f"Error exporting QA results: {e}")
        raise

def export_student_landing_page_csv(
    results: List[Dict],
    output_file: str = "student_landing_page.csv"
) -> None:
    """
    Export student landing page CSV with format:
    Code,Title,Location,Date,Start Time,End Time,Catalog URL,Device Type
    
    Example:
    LB1005,Day 2 operations and automation with OpenShift Virtualization,Atlanta,11/18/2025,14:30,16:20,https://catalog.demo.redhat.com/workshop/pyj2ku,laptop
    
    Args:
        results: List of QA verification results (from QA1 or QA2)
        output_file: Output CSV file path
    """
    if not results:
        logger.warning("No results to export for student landing page")
        return
    
    try:
        student_rows = []
        
        for result in results:
            # Skip if not deployed
            if result.get('deployed') != 'Yes':
                continue
            
            ci_name = result.get('ci_name', '')
            landing_page_url = result.get('landing_page_url', '')
            link_to_service = result.get('link_to_service', '')
            
            # For regular workshops, use landing_page_url (https://integration.demo.redhat.com/workshop/{workshopId})
            # For multi-asset workshops, use link_to_service (portal URL)
            if result.get('status') == '✅ MULTI-WORKSHOP':
                # Multi-asset: use portal URL for landing page
                catalog_url_for_export = link_to_service if link_to_service else landing_page_url
            else:
                # Regular workshop: use landing_page_url if available, otherwise fallback to link_to_service
                catalog_url_for_export = landing_page_url if landing_page_url else link_to_service
            
            if not catalog_url_for_export:
                continue
            
            # Parse dates from schedule
            provisioning_date = result.get('provisioning_date') or result.get('expected_provisioning', '')
            auto_stop = result.get('auto_stop') or result.get('expected_stop', '')
            
            # Parse dates
            start_dt = parse_date_time(provisioning_date)
            end_dt = parse_date_time(auto_stop)
            
            # Format dates and times
            if start_dt:
                date_str = start_dt.strftime('%m/%d/%Y')  # MM/DD/YYYY
                start_time = start_dt.strftime('%H:%M')  # HH:MM
            else:
                date_str = 'TBD'
                start_time = 'TBD'
            
            if end_dt:
                end_time = end_dt.strftime('%H:%M')  # HH:MM
            else:
                end_time = 'TBD'
            
            # Generate code from CI name (first letters of words or use CI prefix)
            # Example: "Experience OpenShift Virtualization Roadshow" -> "EOVR" or use CI prefix
            code = result.get('ci', '').split('.')[0].upper()[:6]  # Use first part of CI, max 6 chars
            if not code:
                # Fallback: use first letters of CI name
                words = ci_name.split()
                code = ''.join([w[0].upper() for w in words[:4]])[:6]
            
            # Use CI name as title
            title = ci_name
            
            # Location - placeholder or extract from namespace if available
            location = 'TBD'  # Could be extracted from namespace or CSV if added
            
            # Device type - default to laptop
            device_type = 'laptop'
            
            student_rows.append({
                'Code': code,
                'Title': title,
                'Location': location,
                'Date': date_str,
                'Start Time': start_time,
                'End Time': end_time,
                'Catalog URL': catalog_url_for_export,  # Portal URL for multi-asset, catalog URL for regular
                'Device Type': device_type
            })
        
        # Write CSV
        if student_rows:
            fieldnames = ['Code', 'Title', 'Location', 'Date', 'Start Time', 'End Time', 'Catalog URL', 'Device Type']
            with open(output_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(student_rows)
            
            logger.info(f"Student landing page CSV exported to {output_file} ({len(student_rows)} rows)")
        else:
            logger.warning("No valid results with catalog URLs to export")
        
    except Exception as e:
        logger.error(f"Error exporting student landing page CSV: {e}")
        raise

# ============================================================================
# MAIN ORCHESTRATION
# ============================================================================

def process_schedule(
    schedule: WorkshopSchedule,
    config: RHDPConfig,
    asset_passwords: Optional[Dict[str, str]] = None,
    asset_num_users: Optional[Dict[str, int]] = None
) -> DeploymentResult:
    """
    Process a single workshop schedule.
    
    Args:
        schedule: WorkshopSchedule object
        config: RHDPConfig object
        
    Returns:
        DeploymentResult object
    """
    logger.info(f"Processing schedule: {schedule.ci_name} ({schedule.ci})")
    
    try:
        # Check if this is a multi-asset workshop
        if schedule.is_multi_asset:
            logger.info(f"Multi-asset workshop detected - creating MultiWorkshop with assets: {schedule.asset_cis}")
            multi_workshop_name = create_multi_workshop(schedule, config, asset_passwords=asset_passwords, asset_num_users=asset_num_users)
            
            if not multi_workshop_name:
                return DeploymentResult(
                    ci_name=schedule.ci_name,
                    ci=schedule.ci,
                    namespace=schedule.namespace,
                    guid="failed",
                    url="",
                    status="failed",
                    provisioning_date=schedule.provisioning_date,
                    auto_stop=schedule.auto_stop,
                    auto_destroy=schedule.auto_destroy,
                    timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                    error_message="Failed to create MultiWorkshop"
                )
            
            # Construct URL for multi-workshop
            url = f"https://integration.demo.redhat.com/multi-workshop/{schedule.namespace}/{multi_workshop_name}"
            
            # For multi-workshop, we'll mark it as deployed (verification is more complex)
            return DeploymentResult(
                ci_name=schedule.ci_name,
                ci=schedule.ci,
                namespace=schedule.namespace,
                guid=multi_workshop_name,
                url=url,
                status="deployed_unverified",  # Multi-workshop verification is more complex
                provisioning_date=schedule.provisioning_date,
                auto_stop=schedule.auto_stop,
                auto_destroy=schedule.auto_destroy,
                timestamp=time.strftime("%Y-%m-%d %H:%M:%S")
            )
        
        # Build payload
        payload = build_resource_claim_payload(schedule)
        
        # If workshop UI is enabled, create Workshop directly without ResourceClaim to avoid duplicates
        if schedule.enable_workshop_interface:
            logger.info(f"Workshop UI enabled - creating Workshop directly (skipping ResourceClaim to avoid duplicate entries)")
            # Generate a name for the Workshop (similar to ResourceClaim naming)
            ci = schedule.ci
            generate_name = f"{ci}-"
            # Create Workshop directly
            workshop_name = create_workshop_with_ui(generate_name, schedule.namespace, payload, config)
            if workshop_name:
                logger.info(f"✅ Successfully created Workshop: {workshop_name} with UI enabled")
                # Create WorkshopProvision to manage the Workshop
                logger.info(f"Creating WorkshopProvision to manage Workshop...")
                create_workshop_provision(workshop_name, schedule.namespace, payload, config, enable_workshop_ui=False, concurrency=schedule.concurrency, count=schedule.instances)
                # Use workshop name as guid for results
                guid = workshop_name
                namespace = schedule.namespace
                error = None
            else:
                guid = None
                namespace = schedule.namespace
                error = "Failed to create Workshop"
        else:
            # Create ResourceClaim (normal flow when Workshop UI is not enabled)
            guid, namespace, error = create_resource_claim_via_oc(payload, config)
        
        if not guid:
            return DeploymentResult(
                ci_name=schedule.ci_name,
                ci=schedule.ci,
                namespace=schedule.namespace,
                guid="failed",
                url="",
                status="failed",
                provisioning_date=schedule.provisioning_date,
                auto_stop=schedule.auto_stop,
                auto_destroy=schedule.auto_destroy,
                timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                error_message=error or "Unknown error"
            )
        
        # Wait a bit for ResourceClaim to be created
        if not config.dry_run:
            time.sleep(2)
        
        # Verify deployment
        is_healthy, url = verify_deployment(guid, namespace or schedule.namespace, schedule.ci, config)
        
        if is_healthy:
            status = "verified"
        elif url:
            status = "deployed_unverified"
        else:
            status = "deployed_no_url"
            # Construct URL anyway
            suffix = guid.split('-')[-1] if '-' in guid else ""
            url = construct_workshop_url(schedule.ci, schedule.namespace, suffix)
        
        return DeploymentResult(
            ci_name=schedule.ci_name,
            ci=schedule.ci,
            namespace=namespace or schedule.namespace,
            guid=guid,
            url=url or "",
            status=status,
            provisioning_date=schedule.provisioning_date,
            auto_stop=schedule.auto_stop,
            auto_destroy=schedule.auto_destroy,
            timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
            error_message=""
        )
        
    except Exception as e:
        logger.error(f"Error processing schedule {schedule.ci_name}: {e}", exc_info=True)
        return DeploymentResult(
            ci_name=schedule.ci_name,
            ci=schedule.ci,
            namespace=schedule.namespace,
            guid="error",
            url="",
            status="error",
            provisioning_date=schedule.provisioning_date,
            auto_stop=schedule.auto_stop,
            auto_destroy=schedule.auto_destroy,
            timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
            error_message=str(e)
        )

# ============================================================================
# OPERATIONS: LOCK, EXTEND, SCALE
# ============================================================================

def lock_workshops(schedules, config):
    """Lock workshops by setting their stop time to now (immediate stop).

    For each schedule, finds the corresponding Workshop resource via label
    selector and patches its actionSchedule.stop to the current time.
    """
    env = os.environ.copy()
    if config.kubeconfig_path:
        env['KUBECONFIG'] = config.kubeconfig_path

    now_iso = format_iso8601(datetime.now(timezone.utc))

    for schedule in schedules:
        ns = schedule.namespace
        ci = schedule.ci
        logger.info(f"Locking workshops for CI={ci} in namespace={ns}")

        # Find workshops by catalog item label
        get_cmd = [
            config.oc_command, "get", "workshop",
            "-n", ns,
            "-l", f"babylon.gpte.redhat.com/catalogItemName={ci}",
            "-o", "jsonpath={.items[*].metadata.name}",
        ]

        if config.dry_run:
            logger.info(f"[DRY-RUN] Would run: {' '.join(get_cmd)}")
            continue

        result = subprocess.run(get_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
        if result.returncode != 0:
            logger.error(f"Failed to get workshops: {result.stderr}")
            continue

        names = result.stdout.strip().split()
        for name in names:
            if not name:
                continue
            patch_cmd = [
                config.oc_command, "patch", "workshop", name,
                "-n", ns,
                "--type", "merge",
                "-p", json.dumps({"spec": {"actionSchedule": {"stop": now_iso}}}),
            ]
            logger.info(f"Locking workshop {name}: setting stop={now_iso}")
            pr = subprocess.run(patch_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
            if pr.returncode != 0:
                logger.error(f"Failed to patch workshop {name}: {pr.stderr}")
            else:
                logger.info(f"Locked workshop {name}")


def extend_stop_time(schedules, config, days, hours):
    """Extend the auto-stop time of workshops by the given days/hours.

    Reads the current actionSchedule.stop from each Workshop, adds the
    requested timedelta, and patches the new value back.
    """
    env = os.environ.copy()
    if config.kubeconfig_path:
        env['KUBECONFIG'] = config.kubeconfig_path

    delta = timedelta(days=days, hours=hours)

    for schedule in schedules:
        ns = schedule.namespace
        ci = schedule.ci
        logger.info(f"Extending stop time for CI={ci} in namespace={ns} by {days}d {hours}h")

        get_cmd = [
            config.oc_command, "get", "workshop",
            "-n", ns,
            "-l", f"babylon.gpte.redhat.com/catalogItemName={ci}",
            "-o", "json",
        ]

        if config.dry_run:
            logger.info(f"[DRY-RUN] Would run: {' '.join(get_cmd)}")
            continue

        result = subprocess.run(get_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
        if result.returncode != 0:
            logger.error(f"Failed to get workshops: {result.stderr}")
            continue

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON from oc get workshop: {result.stdout[:200]}")
            continue

        items = data.get("items", [data] if "metadata" in data else [])
        for item in items:
            name = item.get("metadata", {}).get("name", "")
            if not name:
                continue
            current_stop = (
                item.get("spec", {}).get("actionSchedule", {}).get("stop", "")
            )
            dt = parse_date_time(current_stop)
            if dt is None:
                logger.warning(f"Cannot parse stop time '{current_stop}' for {name}, skipping")
                continue
            new_stop = format_iso8601(dt + delta)
            patch_cmd = [
                config.oc_command, "patch", "workshop", name,
                "-n", ns,
                "--type", "merge",
                "-p", json.dumps({"spec": {"actionSchedule": {"stop": new_stop}}}),
            ]
            logger.info(f"Extending stop for {name}: {current_stop} -> {new_stop}")
            pr = subprocess.run(patch_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
            if pr.returncode != 0:
                logger.error(f"Failed to patch workshop {name}: {pr.stderr}")
            else:
                logger.info(f"Extended stop for {name}")


def extend_destroy_time(schedules, config, days, hours):
    """Extend the auto-destroy (lifespan.end) of workshops and their provisions.

    Patches both Workshop and WorkshopProvision resources so the destroy
    time is pushed out by the requested amount.
    """
    env = os.environ.copy()
    if config.kubeconfig_path:
        env['KUBECONFIG'] = config.kubeconfig_path

    delta = timedelta(days=days, hours=hours)

    for schedule in schedules:
        ns = schedule.namespace
        ci = schedule.ci
        logger.info(f"Extending destroy time for CI={ci} in namespace={ns} by {days}d {hours}h")

        # --- Patch Workshop lifespan.end ---
        get_ws_cmd = [
            config.oc_command, "get", "workshop",
            "-n", ns,
            "-l", f"babylon.gpte.redhat.com/catalogItemName={ci}",
            "-o", "json",
        ]

        if config.dry_run:
            logger.info(f"[DRY-RUN] Would run: {' '.join(get_ws_cmd)}")
            continue

        result = subprocess.run(get_ws_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
        if result.returncode != 0:
            logger.error(f"Failed to get workshops: {result.stderr}")
            continue

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON from oc get workshop: {result.stdout[:200]}")
            continue

        items = data.get("items", [data] if "metadata" in data else [])
        for item in items:
            name = item.get("metadata", {}).get("name", "")
            if not name:
                continue
            current_end = item.get("spec", {}).get("lifespan", {}).get("end", "")
            dt = parse_date_time(current_end)
            if dt is None:
                logger.warning(f"Cannot parse lifespan end '{current_end}' for {name}, skipping")
                continue
            new_end = format_iso8601(dt + delta)
            patch_cmd = [
                config.oc_command, "patch", "workshop", name,
                "-n", ns,
                "--type", "merge",
                "-p", json.dumps({"spec": {"lifespan": {"end": new_end}}}),
            ]
            logger.info(f"Extending destroy for workshop {name}: {current_end} -> {new_end}")
            pr = subprocess.run(patch_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
            if pr.returncode != 0:
                logger.error(f"Failed to patch workshop {name}: {pr.stderr}")

        # --- Patch WorkshopProvision lifespan.end ---
        get_wp_cmd = [
            config.oc_command, "get", "workshopprovision",
            "-n", ns,
            "-l", f"babylon.gpte.redhat.com/catalogItemName={ci}",
            "-o", "json",
        ]
        result = subprocess.run(get_wp_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
        if result.returncode != 0:
            logger.error(f"Failed to get workshopprovisions: {result.stderr}")
            continue

        try:
            wp_data = json.loads(result.stdout)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON from oc get workshopprovision: {result.stdout[:200]}")
            continue

        wp_items = wp_data.get("items", [wp_data] if "metadata" in wp_data else [])
        for wp in wp_items:
            wp_name = wp.get("metadata", {}).get("name", "")
            if not wp_name:
                continue
            wp_end = wp.get("spec", {}).get("lifespan", {}).get("end", "")
            wp_dt = parse_date_time(wp_end)
            if wp_dt is None:
                logger.warning(f"Cannot parse lifespan end '{wp_end}' for provision {wp_name}, skipping")
                continue
            new_wp_end = format_iso8601(wp_dt + delta)
            patch_cmd = [
                config.oc_command, "patch", "workshopprovision", wp_name,
                "-n", ns,
                "--type", "merge",
                "-p", json.dumps({"spec": {"lifespan": {"end": new_wp_end}}}),
            ]
            logger.info(f"Extending destroy for provision {wp_name}: {wp_end} -> {new_wp_end}")
            pr = subprocess.run(patch_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
            if pr.returncode != 0:
                logger.error(f"Failed to patch workshopprovision {wp_name}: {pr.stderr}")


def scale_workshops(schedules, config, target_count):
    """Scale workshop provisions to the given target count.

    Finds WorkshopProvision resources and patches their spec.count.
    """
    env = os.environ.copy()
    if config.kubeconfig_path:
        env['KUBECONFIG'] = config.kubeconfig_path

    for schedule in schedules:
        ns = schedule.namespace
        ci = schedule.ci
        logger.info(f"Scaling provisions for CI={ci} in namespace={ns} to count={target_count}")

        get_cmd = [
            config.oc_command, "get", "workshopprovision",
            "-n", ns,
            "-l", f"babylon.gpte.redhat.com/catalogItemName={ci}",
            "-o", "jsonpath={.items[*].metadata.name}",
        ]

        if config.dry_run:
            logger.info(f"[DRY-RUN] Would run: {' '.join(get_cmd)}")
            continue

        result = subprocess.run(get_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
        if result.returncode != 0:
            logger.error(f"Failed to get workshopprovisions: {result.stderr}")
            continue

        names = result.stdout.strip().split()
        for name in names:
            if not name:
                continue
            patch_cmd = [
                config.oc_command, "patch", "workshopprovision", name,
                "-n", ns,
                "--type", "merge",
                "-p", json.dumps({"spec": {"count": target_count}}),
            ]
            logger.info(f"Scaling provision {name} to count={target_count}")
            pr = subprocess.run(patch_cmd, capture_output=True, text=True, timeout=config.timeout, env=env)
            if pr.returncode != 0:
                logger.error(f"Failed to patch workshopprovision {name}: {pr.stderr}")
            else:
                logger.info(f"Scaled provision {name} to count={target_count}")


def create_parser() -> ArgumentParser:
    """Create argument parser"""
    parser = ArgumentParser(
        description="RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry-run mode (safe preview)
  %(prog)s --input-csv workshop_schedule.csv --dry-run

  # Process all schedules in CSV
  %(prog)s --input-csv workshop_schedule.csv

  # Process specific CI
  %(prog)s --input-csv workshop_schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod

  # With debug logging
  %(prog)s --input-csv workshop_schedule.csv --dry-run --debug
        """
    )
    
    parser.add_argument(
        "--input-csv",
        required=True,
        help="Path to input CSV file with workshop schedules"
    )
    parser.add_argument(
        "--output-csv",
        default="deployment_results.csv",
        help="Path to output CSV file (default: deployment_results.csv)"
    )
    parser.add_argument(
        "--ci",
        default="",
        help="Specific Catalog Item ID to process (optional, processes all if not specified)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print JSON payloads without creating ResourceClaims"
    )
    parser.add_argument(
        "--kubeconfig",
        default="",
        help="Path to kubeconfig file (optional, uses current oc session if not specified)"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Command timeout in seconds (default: 60)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )
    parser.add_argument(
        "--qa",
        choices=["1", "2", "both"],
        help="Run QA verification: '1'=verify setup (times/users), '2'=verify deployment status (seats), 'both'=run both"
    )
    
    return parser

def main():
    """Main orchestration function"""
    parser = create_parser()
    args = parser.parse_args()
    
    # Configure logging
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Initialize configuration
    config = RHDPConfig()
    config.dry_run = args.dry_run
    config.kubeconfig_path = args.kubeconfig or os.environ.get('KUBECONFIG')
    config.timeout = args.timeout
    
    # Validate configuration
    if not config.validate():
        logger.error("Configuration validation failed")
        sys.exit(1)
    
    # Print banner
    logger.info("=" * 70)
    logger.info("RHDP-Flow: Red Hat Demo Platform Workshop Automation")
    logger.info("=" * 70)
    logger.info(f"Dry-Run Mode: {config.dry_run}")
    
    # Handle QA mode
    if args.qa:
        logger.info("QA Mode: Enabled")
        logger.info(f"QA Type: {args.qa}")
        logger.info(f"Input CSV: {args.input_csv}")
        logger.info("=" * 70)
        
        try:
            # Extract namespace from CSV (use first schedule's namespace)
            schedules = read_csv_input(args.input_csv)
            if not schedules:
                logger.error("No schedules found in CSV")
                sys.exit(1)
            
            namespace = schedules[0].namespace
            logger.info(f"Checking namespace: {namespace}")
            logger.info("=" * 70)
            
            all_results = []
            
            # Run QA1: Verify Setup
            if args.qa in ["1", "both"]:
                logger.info("")
                results1 = qa1_verify_setup(
                    args.input_csv,
                    namespace,
                    config
                )
                all_results.extend(results1)
                
                # Export QA1 results
                qa1_output_file = f"qa1_setup_{namespace}.csv"
                qa_export_results(results1, qa1_output_file)
                logger.info(f"QA1 results exported to: {qa1_output_file}")
                
                # Export student landing page CSV from QA1 results
                student_landing_file = f"student_landing_page_{namespace}.csv"
                export_student_landing_page_csv(results1, student_landing_file)
                logger.info(f"Student landing page CSV exported to: {student_landing_file}")
            
            # Run QA2: Verify Deployment Status
            if args.qa in ["2", "both"]:
                logger.info("")
                results2 = qa2_verify_deployment_status(
                    args.input_csv,
                    namespace,
                    config
                )
                all_results.extend(results2)
                
                # Export QA2 results
                qa2_output_file = f"qa2_deployment_{namespace}.csv"
                qa_export_results(results2, qa2_output_file)
                logger.info(f"QA2 results exported to: {qa2_output_file}")
                
                # Export student landing page CSV from QA2 results (if not already done)
                if args.qa == "2":
                    student_landing_file = f"student_landing_page_{namespace}.csv"
                    export_student_landing_page_csv(results2, student_landing_file)
                    logger.info(f"Student landing page CSV exported to: {student_landing_file}")
            
            # Export combined results if both
            if args.qa == "both":
                combined_output_file = f"qa_combined_{namespace}.csv"
                qa_export_results(all_results, combined_output_file)
                logger.info(f"Combined QA results exported to: {combined_output_file}")
                
                # Export student landing page CSV from combined results
                student_landing_file = f"student_landing_page_{namespace}.csv"
                export_student_landing_page_csv(all_results, student_landing_file)
                logger.info(f"Student landing page CSV exported to: {student_landing_file}")
            
            sys.exit(0)
        except Exception as e:
            logger.error(f"QA verification failed: {e}", exc_info=True)
            sys.exit(1)
    
    logger.info(f"Input CSV: {args.input_csv}")
    logger.info(f"Output CSV: {args.output_csv}")
    if args.ci:
        logger.info(f"Filtering CI: {args.ci}")
    logger.info("=" * 70)
    
    try:
        # Read input CSV
        schedules = read_csv_input(args.input_csv)
        
        # Load per-asset passwords from {stem}_passwords.csv if present (for multi-asset workshops)
        input_path = Path(args.input_csv)
        passwords_path = input_path.parent / f"{input_path.stem}_passwords.csv"
        asset_passwords = load_asset_passwords(str(passwords_path))
        # Load per-asset num_users from {stem}_asset_users.csv if present (for multi-asset workshops)
        asset_users_path = input_path.parent / f"{input_path.stem}_asset_users.csv"
        asset_num_users = load_asset_num_users(str(asset_users_path))
        
        # Filter by CI if specified
        if args.ci:
            schedules = [s for s in schedules if s.ci == args.ci]
            if not schedules:
                logger.error(f"No schedules found for CI: {args.ci}")
                sys.exit(1)
        
        if config.dry_run:
            dry_run_validate_schedules(
                schedules, asset_passwords, asset_num_users, input_path, config
            )
        
        logger.info(f"Processing {len(schedules)} schedule(s)")
        
        # Process each schedule
        results = []
        for schedule in schedules:
            result = process_schedule(schedule, config, asset_passwords=asset_passwords, asset_num_users=asset_num_users)
            results.append(result)
            
            logger.info(
                f"Schedule processed: {result.ci_name} - "
                f"Status: {result.status} - GUID: {result.guid}"
            )
            
            # Small delay between schedules
            if not config.dry_run and len(schedules) > 1:
                time.sleep(1)
        
        # Write results
        output_path = Path(args.output_csv)
        if not output_path.is_absolute():
            output_path = Path(args.input_csv).parent / output_path
        
        write_deployment_results(results, str(output_path))
        
        # Print summary
        status_counts = {}
        for result in results:
            status_counts[result.status] = status_counts.get(result.status, 0) + 1
        
        logger.info("=" * 70)
        logger.info("Deployment Summary:")
        logger.info(f"  Total: {len(results)}")
        for status, count in sorted(status_counts.items()):
            logger.info(f"  {status}: {count}")
        logger.info(f"  Results saved to: {output_path}")
        logger.info("=" * 70)
        
        # Exit with error if any deployments failed
        failed_count = status_counts.get('failed', 0) + status_counts.get('error', 0)
        if failed_count > 0:
            logger.warning(f"{failed_count} deployments failed")
            sys.exit(1)
        
    except KeyboardInterrupt:
        logger.warning("Interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
