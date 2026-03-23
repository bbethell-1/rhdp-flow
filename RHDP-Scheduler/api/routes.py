"""API endpoints — thin wrappers around rhdp_flow functions."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import re
import shutil
import subprocess
import tempfile
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from api.auth import verify_api_key

import sys, os

# Ensure parent directory is on sys.path so we can import rhdp_flow
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rhdp_flow import (
    RHDPConfig,
    WorkshopSchedule,
    DeploymentResult,
    read_csv_input,
    load_asset_passwords,
    process_schedule,
    create_multi_workshop,
    create_multi_workshop_from_group,
    qa1_verify_setup,
    qa2_verify_deployment_status,
    qa_destroy_check,
    export_student_landing_page_csv,
    lock_workshops,
    unlock_workshops,
    extend_stop_time,
    extend_destroy_time,
    disable_autostop,
    scale_workshops,
    deploy_showroom,
    teardown_showroom,
    check_showroom_health,
    generate_showroom_applicationset,
    update_passwords,
    import_namespace_to_csv,
    derive_base_domain,
    utc_timestamp_str,
    get_catalog_item_num_users_limit,
    list_catalog_items,
    users_column_ignored_by_catalog_advisory,
)

from api.models import (
    CatalogItemEntry,
    CatalogItemParameter,
    DeploymentResultResponse,
    DeployRequest,
    DestroyCheckResponse,
    DiffEntry,
    DiffResponse,
    DisableAutostopRequest,
    ExtendRequest,
    HealthResponse,
    JobResponse,
    LockRequest,
    NumUsersValidationResponse,
    NumUsersViolation,
    UsersNotInCatalogAdvisory,
    OperationResponse,
    QARequest,
    QAResultItem,
    RetryRequest,
    ScaleRequest,
    SessionSummary,
    ShowroomAppSetRequest,
    ShowroomCleanupRequest,
    ShowroomHealthRequest,
    UploadResponse,
    WorkshopScheduleResponse,
)
from api import jobs
from api.log_capture import start_log_capture, stop_log_capture, get_log_dir
from api.limiter import limiter as _route_limiter

logger = logging.getLogger("rhdp_flow.api")

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
_schedules: List[WorkshopSchedule] = []
_deployment_results: List[DeploymentResult] = []
_qa_results: List[QAResultItem] = []
_csv_filepath: Optional[str] = None  # stashed for QA functions that need a path
_current_filename: str = ""
_asset_passwords: Optional[Dict[str, str]] = None
_deploy_log_path: Optional[str] = None
_qa_log_path: Optional[str] = None
_destroy_check_results: List[dict] = []

# Session history — each completed upload+deploy cycle gets archived here
_sessions: List[dict] = []
_session_counter: int = 0
MAX_SESSIONS = 50
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

# Built-in schedule examples (files under docs/examples/)
_SCHEDULE_EXAMPLES: Dict[str, tuple[str, str]] = {
    "basic": ("basic_workshop.csv", "Basic workshop"),
    "full": ("full_featured.csv", "Full featured"),
    "minimal": ("minimal_workshop.csv", "Minimal"),
}


def _schedule_examples_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "docs" / "examples"


# Cached base domain derived from the connected cluster
_cached_base_domain: Optional[str] = None

# Thread-safe lock for global state mutations (sync endpoints run in threadpool)
_state_lock = threading.Lock()


def _rate_limit(limit_string: str):
    """Apply per-route rate limit if slowapi is available, otherwise no-op."""
    if _route_limiter:
        return _route_limiter.limit(limit_string)
    return lambda f: f


_NAMESPACE_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


def _validate_namespace(ns: str) -> str:
    """Validate a Kubernetes namespace name. Raises HTTPException on invalid input."""
    if not ns or len(ns) > 63 or not _NAMESPACE_RE.match(ns):
        raise HTTPException(400, f"Invalid namespace: must match [a-z0-9-], 1-63 chars")
    return ns


def _detect_and_cache_base_domain() -> str:
    """Run `oc whoami --show-server`, derive base domain, and cache it."""
    global _cached_base_domain
    with _state_lock:
        if _cached_base_domain is not None:
            return _cached_base_domain
    try:
        env = os.environ.copy()
        kc = os.environ.get("KUBECONFIG")
        if kc:
            env["KUBECONFIG"] = kc
        r = subprocess.run(
            ["oc", "whoami", "--show-server"],
            capture_output=True, text=True, timeout=10, env=env,
        )
        with _state_lock:
            if r.returncode == 0:
                _cached_base_domain = derive_base_domain(r.stdout.strip())
            else:
                _cached_base_domain = "integration.demo.redhat.com"
    except Exception as exc:
        logger.warning("Base domain detection failed, using fallback: %s", exc)
        with _state_lock:
            _cached_base_domain = "integration.demo.redhat.com"
    return _cached_base_domain


def _get_config(
    dry_run: bool = False,
    resource_lock: bool = True,
    enable_resource_pools: bool = False,
    white_glove: bool = True,
    redirect: bool = True,
) -> RHDPConfig:
    config = RHDPConfig()
    config.dry_run = dry_run
    config.kubeconfig_path = os.environ.get("KUBECONFIG")
    config.resource_lock = resource_lock
    config.enable_resource_pools = enable_resource_pools
    config.white_glove = white_glove
    config.redirect = redirect
    config.base_domain = _detect_and_cache_base_domain()
    return config


def _schedule_to_response(s: WorkshopSchedule) -> WorkshopScheduleResponse:
    return WorkshopScheduleResponse(
        ci_name=s.ci_name, ci=s.ci, namespace=s.namespace, users=s.users,
        enable_workshop_interface=s.enable_workshop_interface,
        password=s.password, activity=s.activity, purpose=s.purpose,
        workshop_name=s.workshop_name, provisioning_date=s.provisioning_date,
        auto_stop=s.auto_stop, auto_destroy=s.auto_destroy,
        is_multi_asset=s.is_multi_asset, asset_cis=s.asset_cis,
        multi_workshop_name=s.multi_workshop_name,
        concurrency=s.concurrency, instances=s.instances,
        salesforce_ids=s.salesforce_ids,
        salesforce_type=s.salesforce_type,
        aws_regions=s.aws_regions,
        count=s.count,
        white_glove=s.white_glove,
        redirect=s.redirect,
        showroom_repo=s.showroom_repo,
        showroom_ref=s.showroom_ref,
        showroom_novnc=s.showroom_novnc,
        showroom_zerotouch=s.showroom_zerotouch,
    )


def _result_to_response(r: DeploymentResult) -> DeploymentResultResponse:
    return DeploymentResultResponse(**asdict(r))


def _ingest_schedule_csv_text(text: str, filename: str) -> UploadResponse:
    """Parse CSV text, replace in-memory schedules, return upload response."""
    global _schedules, _csv_filepath, _current_filename
    if len(text.encode("utf-8")) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(413, "File exceeds 10 MB size limit")
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8"
    )
    tmp.write(text)
    tmp.close()
    reader = csv.reader(io.StringIO(text))
    all_rows = [row for row in reader if any(cell.strip() for cell in row)]
    total_rows = max(0, len(all_rows) - 1)
    try:
        schedules = read_csv_input(tmp.name)
    except ValueError as e:
        os.unlink(tmp.name)
        raise HTTPException(400, str(e))
    with _state_lock:
        _schedules = schedules
        _current_filename = filename
        _csv_filepath = tmp.name
    skipped = total_rows - len(schedules)
    return UploadResponse(
        count=len(schedules),
        total_rows=total_rows,
        skipped_rows=max(0, skipped),
        schedules=[_schedule_to_response(s) for s in schedules],
    )


def _filter_schedules(ci_filter: Optional[str]) -> List[WorkshopSchedule]:
    if ci_filter:
        filtered = [s for s in _schedules if s.ci == ci_filter]
        if not filtered:
            raise HTTPException(404, f"No schedules found for CI: {ci_filter}")
        return filtered
    return list(_schedules)


def _archive_current_session():
    """Save the current state as a session if there's anything to save."""
    global _session_counter
    if not _schedules and not _deployment_results:
        return
    _session_counter += 1
    session = {
        "session_id": str(_session_counter),
        "filename": _current_filename,
        "schedules": list(_schedules),
        "deployment_results": list(_deployment_results),
        "qa_results": list(_qa_results),
        "destroy_check_results": list(_destroy_check_results),
        "csv_filepath": _csv_filepath,
        "schedule_count": len(_schedules),
        "result_count": len(_deployment_results),
        "timestamp": utc_timestamp_str(),
        "deploy_log_file": os.path.basename(_deploy_log_path) if _deploy_log_path else None,
        "qa_log_file": os.path.basename(_qa_log_path) if _qa_log_path else None,
    }
    _sessions.append(session)
    if len(_sessions) > MAX_SESSIONS:
        _sessions[:] = _sessions[-MAX_SESSIONS:]


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.post("/sessions/clear")
def clear_session():
    """Archive current session and reset state for a new upload."""
    global _schedules, _deployment_results, _qa_results, _csv_filepath, _current_filename, _asset_passwords, _deploy_log_path, _qa_log_path, _destroy_check_results
    with _state_lock:
        _archive_current_session()
        _schedules = []
        _deployment_results = []
        _qa_results = []
        _destroy_check_results = []
        _csv_filepath = None
        _current_filename = ""
        _asset_passwords = None
        _deploy_log_path = None
        _qa_log_path = None
        return {"message": "Session cleared", "session_count": len(_sessions)}


@router.get("/sessions", response_model=List[SessionSummary])
def list_sessions():
    """List all prior sessions."""
    return [
        SessionSummary(
            session_id=s["session_id"],
            filename=s["filename"],
            schedule_count=s["schedule_count"],
            result_count=s["result_count"],
            timestamp=s["timestamp"],
            has_results=s["result_count"] > 0,
            deploy_log_file=s.get("deploy_log_file"),
            qa_log_file=s.get("qa_log_file"),
        )
        for s in _sessions
    ]


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    """Restore a prior session's data for viewing."""
    for s in _sessions:
        if s["session_id"] == session_id:
            return {
                "session_id": s["session_id"],
                "filename": s["filename"],
                "timestamp": s["timestamp"],
                "schedules": [_schedule_to_response(sc) for sc in s["schedules"]],
                "results": [_result_to_response(r) for r in s["deployment_results"]],
                "qa_results": s["qa_results"],
                "destroy_check_results": s.get("destroy_check_results", []),
            }
    raise HTTPException(404, "Session not found")


# ---------------------------------------------------------------------------
# Schedule Management
# ---------------------------------------------------------------------------

@router.put("/schedules")
def update_schedules(schedules_data: List[dict], _key=Depends(verify_api_key)):
    """Update the entire schedules list."""
    global _schedules
    try:
        new_schedules = [WorkshopSchedule(**data) for data in schedules_data]
        with _state_lock:
            _schedules = new_schedules
        return {"message": f"Updated {len(new_schedules)} schedules"}
    except Exception as e:
        raise HTTPException(400, f"Failed to update schedules: {e}")


@router.delete("/schedules/{index}")
def delete_schedule(index: int, _key=Depends(verify_api_key)):
    """Delete a schedule by its index."""
    global _schedules
    with _state_lock:
        if index < 0 or index >= len(_schedules):
            raise HTTPException(404, f"Schedule index {index} not found")
        deleted_schedule = _schedules.pop(index)
        return {"message": f"Deleted schedule: {deleted_schedule.ci_name}"}


# ---------------------------------------------------------------------------
# Debug
# ---------------------------------------------------------------------------

@router.get("/debug/config")
def debug_config(_key=Depends(verify_api_key)):
    """Show current deployment configuration for debugging."""
    config = _get_config()
    return {
        "dry_run": config.dry_run,
        "resource_lock": config.resource_lock,
        "enable_resource_pools": config.enable_resource_pools,
        "white_glove": config.white_glove,
        "redirect": config.redirect,
        "base_domain": config.base_domain,
        "kubeconfig_path": config.kubeconfig_path,
        "schedules_count": len(_schedules),
        "results_count": len(_deployment_results),
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
async def health():
    config = _get_config()
    env = os.environ.copy()
    if config.kubeconfig_path:
        env["KUBECONFIG"] = config.kubeconfig_path

    # 1. Check oc binary exists
    oc_installed = config.validate()
    if not oc_installed:
        return HealthResponse(
            status="error",
            oc_installed=False,
            message="oc command not found or not working",
        )

    # 2. Check cluster connectivity — run blocking subprocess calls off the
    #    event loop so we don't starve other requests while waiting on oc.
    loop = asyncio.get_event_loop()

    def _run_oc(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [config.oc_command, *args],
            capture_output=True, text=True, timeout=10, env=env,
        )

    try:
        r_user, r_server = await asyncio.gather(
            loop.run_in_executor(None, _run_oc, "whoami"),
            loop.run_in_executor(None, _run_oc, "whoami", "--show-server"),
        )
        if r_user.returncode == 0 and r_server.returncode == 0:
            cluster_url = r_server.stdout.strip()
            global _cached_base_domain
            with _state_lock:
                _cached_base_domain = derive_base_domain(cluster_url)
            # RHDP API probe — also non-blocking
            rhdp_ok = False
            try:
                r_cat = await loop.run_in_executor(
                    None, _run_oc,
                    "get", "catalogitem", "-n", "babylon-catalog-prod",
                    "--no-headers", "-o", "name",
                )
                rhdp_ok = r_cat.returncode == 0
            except Exception as exc:
                logger.warning("RHDP catalog probe failed: %s", exc)
            return HealthResponse(
                status="ok",
                oc_installed=True,
                oc_connected=True,
                cluster_url=cluster_url,
                user=r_user.stdout.strip(),
                base_domain=_cached_base_domain,
                rhdp_api_reachable=rhdp_ok,
            )
        else:
            msg_parts = []
            if r_user.stderr.strip():
                msg_parts.append(r_user.stderr.strip())
            if r_server.stderr.strip():
                msg_parts.append(r_server.stderr.strip())
            return HealthResponse(
                status="error",
                oc_installed=True,
                oc_connected=False,
                message=" | ".join(msg_parts) or "oc installed but cluster unreachable",
            )
    except Exception as e:
        return HealthResponse(
            status="error",
            oc_installed=True,
            oc_connected=False,
            message=f"Cluster connectivity check failed: {e}",
        )


# ---------------------------------------------------------------------------
# Catalog (cluster)
# ---------------------------------------------------------------------------


@router.get("/catalog/items", response_model=List[CatalogItemEntry])
@_rate_limit("30/minute")
def get_catalog_items_list(request: Request):
    """List CatalogItem resources from babylon-catalog-prod and babylon-catalog-event."""
    config = _get_config()
    if not config.validate():
        raise HTTPException(503, "OpenShift client (oc) is not available on the API host")
    raw = list_catalog_items(config)
    out = []
    for x in raw:
        params = [CatalogItemParameter(**p) for p in (x.get("parameters") or [])]
        out.append(CatalogItemEntry(
            id=x["id"],
            display_name=x["display_name"],
            catalog_namespace=x["catalog_namespace"],
            description=x.get("description", ""),
            category=x.get("category", ""),
            parameters=params,
        ))
    return out


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------

@router.post("/schedules/upload", response_model=UploadResponse)
@_rate_limit("10/minute")
async def upload_csv(request: Request, file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(413, "File exceeds 10 MB size limit")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded CSV")
    return _ingest_schedule_csv_text(text, file.filename or "unknown.csv")


@router.get("/schedules/examples")
def list_schedule_examples():
    """Short labels for built-in schedule CSVs (see docs/examples/)."""
    return [{"slug": slug, "label": label} for slug, (_, label) in _SCHEDULE_EXAMPLES.items()]


@router.post("/schedules/load-example/{slug}", response_model=UploadResponse)
@_rate_limit("10/minute")
def load_schedule_example(request: Request, slug: str):
    """Load a whitelisted example CSV from docs/examples/ (same effect as upload)."""
    if slug not in _SCHEDULE_EXAMPLES:
        raise HTTPException(404, f"Unknown example: {slug}")
    filename, _label = _SCHEDULE_EXAMPLES[slug]
    path = _schedule_examples_dir() / filename
    if not path.is_file():
        logger.error("Example CSV missing: %s", path)
        raise HTTPException(500, "Example file not available")
    text = path.read_text(encoding="utf-8")
    return _ingest_schedule_csv_text(text, f"example-{slug}.csv")


@router.post("/schedules/upload-passwords")
async def upload_passwords(file: UploadFile = File(...)):
    """Upload a per-asset passwords CSV (columns: CI, Password)."""
    global _asset_passwords
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(413, "File exceeds 10 MB size limit")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded CSV")

    import tempfile as _tf
    tmp = _tf.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    tmp.write(text)
    tmp.close()
    passwords = load_asset_passwords(tmp.name)
    os.unlink(tmp.name)
    with _state_lock:
        _asset_passwords = passwords

    return {"count": len(passwords), "message": f"Loaded {len(passwords)} asset password(s)"}


@router.get("/schedules", response_model=List[WorkshopScheduleResponse])
def get_schedules():
    return [_schedule_to_response(s) for s in _schedules]


@router.post("/schedules/validate-namespaces")
def validate_namespaces():
    """Check whether the namespaces referenced by loaded schedules exist on the cluster."""
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    config = _get_config()
    env = os.environ.copy()
    if config.kubeconfig_path:
        env["KUBECONFIG"] = config.kubeconfig_path

    unique_ns = {s.namespace for s in _schedules}
    for ns in unique_ns:
        _validate_namespace(ns)
    results: Dict[str, bool] = {}
    for ns in unique_ns:
        try:
            r = subprocess.run(
                [config.oc_command, "get", "namespace", ns, "-o", "name"],
                capture_output=True, text=True, timeout=10, env=env,
            )
            results[ns] = r.returncode == 0
        except Exception as exc:
            logger.warning("Namespace validation failed for %s: %s", ns, exc)
            results[ns] = False
    missing = [ns for ns, ok in results.items() if not ok]
    return {"namespaces": results, "missing": missing}


@router.post("/schedules/validate-num-users", response_model=NumUsersValidationResponse)
def validate_num_users():
    """Check whether any loaded schedules exceed the catalog item's num_users maximum."""
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    config = _get_config()
    violations: List[NumUsersViolation] = []
    users_not_in_catalog: List[UsersNotInCatalogAdvisory] = []
    limits: Dict[str, int] = {}
    checked = 0
    skipped = 0
    ci_cache: Dict[str, Optional[Dict]] = {}
    advisory_seen: set = set()

    def _check_ci(ci: str, schedule: WorkshopSchedule):
        nonlocal checked, skipped
        requested_users = schedule.users
        if requested_users is None or requested_users <= 0:
            skipped += 1
            return
        if ci not in ci_cache:
            ci_cache[ci] = get_catalog_item_num_users_limit(ci, config)
        info = ci_cache[ci]
        if info is None:
            skipped += 1
            return
        checked += 1
        adv = users_column_ignored_by_catalog_advisory(schedule, ci, info)
        if adv:
            key = (schedule.ci_name, schedule.namespace, ci, adv["severity"], adv["message"])
            if key not in advisory_seen:
                advisory_seen.add(key)
                users_not_in_catalog.append(UsersNotInCatalogAdvisory(**adv))
        if info.get("has_num_users") and info.get("maximum") is not None:
            limits[ci] = info["maximum"]
            if requested_users > info["maximum"]:
                violations.append(NumUsersViolation(
                    ci_name=schedule.ci_name,
                    ci=ci,
                    namespace=schedule.namespace,
                    requested_users=requested_users,
                    maximum=info["maximum"],
                    minimum=info.get("minimum"),
                    default_value=info.get("default"),
                ))

    for s in _schedules:
        _check_ci(s.ci, s)
        # Also check individual asset CIs for multi-asset workshops
        if s.is_multi_asset and s.asset_cis:
            for asset_ci in (c.strip() for c in s.asset_cis.split(",") if c.strip()):
                _check_ci(asset_ci, s)

    return NumUsersValidationResponse(
        violations=violations,
        users_not_in_catalog=users_not_in_catalog,
        checked=checked,
        skipped=skipped,
        limits=limits,
    )


@router.post("/schedules/diff", response_model=DiffResponse)
async def diff_schedules(file: UploadFile = File(...)):
    """Compare a new CSV against the currently loaded schedules."""
    if not _schedules:
        raise HTTPException(400, "No schedules loaded to compare against.")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(413, "File exceeds 10 MB size limit")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded CSV")

    import tempfile
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    tmp.write(text)
    tmp.close()

    try:
        new_schedules = read_csv_input(tmp.name)
    except ValueError as e:
        os.unlink(tmp.name)
        raise HTTPException(400, str(e))
    os.unlink(tmp.name)

    # Build keyed maps: (ci, namespace) -> schedule
    old_map = {(s.ci, s.namespace): s for s in _schedules}
    new_map = {(s.ci, s.namespace): s for s in new_schedules}

    added = []
    removed = []
    changed = []
    unchanged = 0

    # Find added + changed
    for key, ns in new_map.items():
        if key not in old_map:
            added.append(DiffEntry(ci_name=ns.ci_name, ci=ns.ci, namespace=ns.namespace, change="added"))
        else:
            os_item = old_map[key]
            diffs = []
            for field in ("users", "provisioning_date", "auto_stop", "auto_destroy", "password", "workshop_name"):
                old_val = getattr(os_item, field)
                new_val = getattr(ns, field)
                if old_val != new_val:
                    diffs.append(f"{field}: {old_val} → {new_val}")
            if diffs:
                changed.append(DiffEntry(
                    ci_name=ns.ci_name, ci=ns.ci, namespace=ns.namespace,
                    change="changed", details="; ".join(diffs),
                ))
            else:
                unchanged += 1

    # Find removed
    for key, os_item in old_map.items():
        if key not in new_map:
            removed.append(DiffEntry(ci_name=os_item.ci_name, ci=os_item.ci, namespace=os_item.namespace, change="removed"))

    return DiffResponse(added=added, removed=removed, changed=changed, unchanged=unchanged)


# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

@router.post("/deploy", response_model=JobResponse)
@_rate_limit("10/minute")
async def deploy(request: Request, body: DeployRequest = DeployRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded. Upload a CSV first.")

    schedules = _filter_schedules(body.ci_filter)

    # Pre-deploy num_users limit check (live deploys only)
    if not body.dry_run:
        config_check = _get_config()
        ci_cache: Dict[str, Optional[Dict]] = {}
        limit_errors: List[str] = []
        for s in schedules:
            if s.users is not None and s.users > 0:
                if s.ci not in ci_cache:
                    ci_cache[s.ci] = get_catalog_item_num_users_limit(s.ci, config_check)
                info = ci_cache[s.ci]
                if info and info.get("maximum") is not None and s.users > info["maximum"]:
                    limit_errors.append(
                        f"{s.ci_name} ({s.ci}): {s.users} requested, max {info['maximum']}"
                    )
        if limit_errors:
            raise HTTPException(
                400,
                f"num_users limit exceeded: {'; '.join(limit_errors)}"
            )

    job = jobs.create_job()

    async def _run():
        global _deploy_log_path
        handler, log_path = start_log_capture("deploy", job.job_id)
        try:
            config = _get_config(
                dry_run=body.dry_run,
                resource_lock=body.resource_lock,
                enable_resource_pools=body.enable_resource_pools,
                white_glove=body.white_glove,
                redirect=body.redirect,
            )
            # U3: Propagate showroom deploy settings to schedules
            for s in schedules:
                if s.showroom_repo:
                    s.showroom_novnc = body.showroom_novnc
                    s.showroom_zerotouch = body.showroom_zerotouch
            jobs.update_job(job.job_id, status=jobs.Status.running, message="Starting deployment")

            # Replicate main() deploy loop logic
            grouped_multi = {}
            regular_schedules = []
            for s in schedules:
                if s.multi_workshop_name and s.is_multi_asset:
                    grouped_multi.setdefault(s.multi_workshop_name, []).append(s)
                else:
                    regular_schedules.append(s)

            results = []
            total = len(grouped_multi) + len(regular_schedules)
            done = 0

            # Grouped multi-asset
            for group_name, group_scheds in grouped_multi.items():
                mw_name = create_multi_workshop_from_group(group_scheds, config)
                first = group_scheds[0]
                if mw_name:
                    url = f"https://{config.base_domain}/multi-workshop/{first.namespace}/{mw_name}"
                    results.append(DeploymentResult(
                        ci_name=group_name, ci=first.ci, namespace=first.namespace,
                        guid=mw_name, url=url, status="deployed_unverified",
                        provisioning_date=first.provisioning_date,
                        auto_stop=first.auto_stop, auto_destroy=first.auto_destroy,
                        timestamp=utc_timestamp_str(),
                        password=first.password,
                    ))
                else:
                    results.append(DeploymentResult(
                        ci_name=group_name, ci=first.ci, namespace=first.namespace,
                        guid="failed", url="", status="failed",
                        provisioning_date=first.provisioning_date,
                        auto_stop=first.auto_stop, auto_destroy=first.auto_destroy,
                        timestamp=utc_timestamp_str(),
                        error_message="Failed to create grouped MultiWorkshop",
                        password=first.password,
                    ))
                done += 1
                pct = int(done / total * 100) if total else 100
                jobs.update_job(job.job_id, progress=pct, message=f"Processed group: {group_name}")

            for s in regular_schedules:
                result = process_schedule(s, config, asset_passwords=_asset_passwords)
                results.append(result)
                done += 1
                pct = int(done / total * 100) if total else 100
                jobs.update_job(
                    job.job_id, progress=pct,
                    message=f"Deployed {result.ci_name}: {result.status}",
                )
                if not config.dry_run and len(regular_schedules) > 1:
                    await asyncio.sleep(1)

            global _deployment_results
            with _state_lock:
                _deployment_results = results
                _deploy_log_path = log_path
            jobs.update_job(
                job.job_id,
                status=jobs.Status.completed,
                progress=100,
                message=f"Completed: {len(results)} deployment(s)",
                results=[asdict(r) for r in results],
                log_path=log_path,
            )
        except Exception as exc:
            with _state_lock:
                _deploy_log_path = log_path
            jobs.update_job(
                job.job_id,
                status=jobs.Status.failed,
                error=str(exc),
                message=f"Deployment failed: {exc}",
                log_path=log_path,
            )
        finally:
            stop_log_capture(handler)

    asyncio.create_task(_run())
    return JobResponse(job_id=job.job_id, status=job.status)


@router.post("/deploy/dry-run", response_model=List[DeploymentResultResponse])
@_rate_limit("10/minute")
def deploy_dry_run(request: Request, body: DeployRequest = DeployRequest(), _key=Depends(verify_api_key)):
    global _deploy_log_path
    if not _schedules:
        raise HTTPException(400, "No schedules loaded. Upload a CSV first.")

    schedules = _filter_schedules(body.ci_filter)
    config = _get_config(
        dry_run=True,
        resource_lock=body.resource_lock,
        enable_resource_pools=body.enable_resource_pools,
        white_glove=body.white_glove,
        redirect=body.redirect,
    )
    if body.export_yaml_dir:
        config.dry_run_export_yaml_dir = body.export_yaml_dir
        config.dry_run_yaml_export_seq = 0
    # U3: Propagate showroom deploy settings to schedules
    for s in schedules:
        if s.showroom_repo:
            s.showroom_novnc = body.showroom_novnc
            s.showroom_zerotouch = body.showroom_zerotouch

    handler, log_path = start_log_capture("deploy-dryrun")
    try:
        # Replicate main() grouping logic for accurate preview
        grouped_multi = {}
        regular_schedules = []
        for s in schedules:
            if s.multi_workshop_name and s.is_multi_asset:
                grouped_multi.setdefault(s.multi_workshop_name, []).append(s)
            else:
                regular_schedules.append(s)

        results = []
        for group_name, group_scheds in grouped_multi.items():
            mw_name = create_multi_workshop_from_group(group_scheds, config)
            first = group_scheds[0]
            if mw_name:
                url = f"https://{config.base_domain}/multi-workshop/{first.namespace}/{mw_name}"
                results.append(DeploymentResult(
                    ci_name=group_name, ci=first.ci, namespace=first.namespace,
                    guid=mw_name, url=url, status="deployed_unverified",
                    provisioning_date=first.provisioning_date,
                    auto_stop=first.auto_stop, auto_destroy=first.auto_destroy,
                    timestamp=utc_timestamp_str(),
                    password=first.password,
                ))
            else:
                results.append(DeploymentResult(
                    ci_name=group_name, ci=first.ci, namespace=first.namespace,
                    guid="failed", url="", status="failed",
                    provisioning_date=first.provisioning_date,
                    auto_stop=first.auto_stop, auto_destroy=first.auto_destroy,
                    timestamp=utc_timestamp_str(),
                    error_message="Failed to create grouped MultiWorkshop",
                    password=first.password,
                ))

        for s in regular_schedules:
            result = process_schedule(s, config, asset_passwords=_asset_passwords)
            results.append(result)

        global _deployment_results
        with _state_lock:
            _deployment_results = results
            _deploy_log_path = log_path
        return [_result_to_response(r) for r in results]
    finally:
        stop_log_capture(handler)


@router.post("/deploy/dry-run-yaml")
@_rate_limit("10/minute")
def deploy_dry_run_yaml(request: Request, body: DeployRequest = DeployRequest(), _key=Depends(verify_api_key)):
    """Run the same dry-run deploy path and return concatenated manifest YAML (download).

    Writes ResourceClaim / Workshop / WorkshopProvision YAMLs to a temp directory during
    dry-run, then returns them as one file separated by ``---``. Requires schedules loaded.
    """
    if not _schedules:
        raise HTTPException(400, "No schedules loaded. Upload a CSV first.")

    schedules = _filter_schedules(body.ci_filter)
    tmpdir = tempfile.mkdtemp(prefix="rhdp-dryrun-yaml-")
    try:
        config = _get_config(
            dry_run=True,
            resource_lock=body.resource_lock,
            enable_resource_pools=body.enable_resource_pools,
            white_glove=body.white_glove,
            redirect=body.redirect,
        )
        config.dry_run_export_yaml_dir = tmpdir
        config.dry_run_yaml_export_seq = 0
        for s in schedules:
            if s.showroom_repo:
                s.showroom_novnc = body.showroom_novnc
                s.showroom_zerotouch = body.showroom_zerotouch

        grouped_multi: Dict[str, List[WorkshopSchedule]] = {}
        regular_schedules: List[WorkshopSchedule] = []
        for s in schedules:
            if s.multi_workshop_name and s.is_multi_asset:
                grouped_multi.setdefault(s.multi_workshop_name, []).append(s)
            else:
                regular_schedules.append(s)

        for _group_name, group_scheds in grouped_multi.items():
            create_multi_workshop_from_group(group_scheds, config)

        for s in regular_schedules:
            process_schedule(s, config, asset_passwords=_asset_passwords)

        yaml_paths = sorted(Path(tmpdir).glob("*.yaml"))
        if not yaml_paths:
            raise HTTPException(
                400,
                "No manifest YAML was generated. YAML export applies to dry-run paths that "
                "emit ResourceClaim, Workshop, or WorkshopProvision (e.g. standard single-workshop flows).",
            )
        parts = [p.read_text(encoding="utf-8").strip() for p in yaml_paths]
        combined = "\n---\n".join(parts)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    return Response(
        content=combined,
        media_type="text/yaml; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="rhdp-dry-run-manifests.yaml"',
        },
    )


@router.get("/deploy/status/{job_id}", response_model=JobResponse)
def deploy_status(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return JobResponse(
        job_id=job.job_id,
        status=job.status,
        progress=job.progress,
        message=job.message,
        error=job.error,
        results=[DeploymentResultResponse(**r) for r in (job.results or [])],
        log_file=os.path.basename(job.log_path) if job.log_path else None,
    )


@router.get("/deploy/stream/{job_id}")
async def deploy_stream(job_id: str, _key=Depends(verify_api_key)):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return EventSourceResponse(jobs.event_generator(job_id))


@router.get("/deploy/results", response_model=List[DeploymentResultResponse])
def get_deploy_results():
    return [_result_to_response(r) for r in _deployment_results]


@router.post("/deploy/retry", response_model=JobResponse)
@_rate_limit("10/minute")
async def deploy_retry(request: Request, body: RetryRequest, _key=Depends(verify_api_key)):
    """Re-deploy specific workshops by CI name (typically failed ones)."""
    if not _schedules:
        raise HTTPException(400, "No schedules loaded. Upload a CSV first.")

    ci_name_set = set(body.ci_names)
    matching = [s for s in _schedules if s.ci_name in ci_name_set]
    if not matching:
        raise HTTPException(404, f"No schedules match the provided CI names: {body.ci_names}")

    job = jobs.create_job()

    async def _run():
        global _deploy_log_path
        handler, log_path = start_log_capture("deploy-retry", job.job_id)
        try:
            config = _get_config(
                dry_run=body.dry_run,
                resource_lock=body.resource_lock,
                enable_resource_pools=body.enable_resource_pools,
                white_glove=body.white_glove,
                redirect=body.redirect,
            )
            jobs.update_job(job.job_id, status=jobs.Status.running, message=f"Retrying {len(matching)} deployment(s)")

            results = []
            for i, s in enumerate(matching):
                result = process_schedule(s, config, asset_passwords=_asset_passwords)
                results.append(result)
                pct = int((i + 1) / len(matching) * 100)
                jobs.update_job(
                    job.job_id, progress=pct,
                    message=f"Retried {result.ci_name}: {result.status}",
                )
                if not config.dry_run and len(matching) > 1:
                    await asyncio.sleep(1)

            # Update global results: replace matching entries, keep the rest
            global _deployment_results
            result_map = {r.ci_name: r for r in results}
            with _state_lock:
                _deployment_results = [
                    result_map.get(r.ci_name, r) for r in _deployment_results
                ] + [r for r in results if r.ci_name not in {dr.ci_name for dr in _deployment_results}]
                _deploy_log_path = log_path
            jobs.update_job(
                job.job_id,
                status=jobs.Status.completed,
                progress=100,
                message=f"Retry completed: {len(results)} deployment(s)",
                results=[asdict(r) for r in results],
                log_path=log_path,
            )
        except Exception as exc:
            with _state_lock:
                _deploy_log_path = log_path
            jobs.update_job(
                job.job_id,
                status=jobs.Status.failed,
                error=str(exc),
                message=f"Retry failed: {exc}",
                log_path=log_path,
            )
        finally:
            stop_log_capture(handler)

    asyncio.create_task(_run())
    return JobResponse(job_id=job.job_id, status=job.status)


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

@router.post("/operations/lock", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_lock(request: Request, body: LockRequest = LockRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    lock_workshops(schedules, config)
    return OperationResponse(success=True, message=f"Locked {len(schedules)} schedule(s)")


@router.post("/operations/unlock", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_unlock(request: Request, body: LockRequest = LockRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    unlock_workshops(schedules, config)
    return OperationResponse(success=True, message=f"Unlocked {len(schedules)} schedule(s)")


@router.post("/operations/extend-stop", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_extend_stop(request: Request, body: ExtendRequest, _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    if body.days == 0 and body.hours == 0:
        raise HTTPException(400, "Must specify days and/or hours > 0")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    extend_stop_time(schedules, config, body.days, body.hours)
    return OperationResponse(
        success=True,
        message=f"Extended stop time by {body.days}d {body.hours}h for {len(schedules)} schedule(s)",
    )


@router.post("/operations/extend-destroy", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_extend_destroy(request: Request, body: ExtendRequest, _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    if body.days == 0 and body.hours == 0:
        raise HTTPException(400, "Must specify days and/or hours > 0")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    extend_destroy_time(schedules, config, body.days, body.hours)
    return OperationResponse(
        success=True,
        message=f"Extended destroy time by {body.days}d {body.hours}h for {len(schedules)} schedule(s)",
    )


@router.post("/operations/disable-autostop", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_disable_autostop(request: Request, body: DisableAutostopRequest = DisableAutostopRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    patched = disable_autostop(schedules, config)
    return OperationResponse(
        success=patched > 0 or config.dry_run,
        message=f"Disabled auto-stop: {patched} resource(s) patched across {len(schedules)} schedule(s)",
    )


@router.post("/operations/scale", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_scale(request: Request, body: ScaleRequest, _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    scale_workshops(schedules, config, body.target_count)
    return OperationResponse(
        success=True,
        message=f"Scaled {len(schedules)} schedule(s) to count={body.target_count}",
    )


@router.post("/operations/showroom-cleanup", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_showroom_cleanup(request: Request, body: ShowroomCleanupRequest = ShowroomCleanupRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    cleaned, failed, failed_details = teardown_showroom(schedules, config)
    success = failed == 0 or config.dry_run
    details = failed_details if failed_details else []
    return OperationResponse(
        success=success,
        message=f"Showroom cleanup: {cleaned} removed, {failed} failed across {len(schedules)} schedule(s)",
        details=details,
    )


@router.post("/operations/showroom-health", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_showroom_health(request: Request, body: ShowroomHealthRequest = ShowroomHealthRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    results = []
    for s in schedules:
        health = check_showroom_health(s, config)
        results.append(f"{s.ci_name}: {health['status']} ({health['url'] or 'no route'})")
    healthy_count = sum(1 for r in results if "healthy" in r)
    return OperationResponse(
        success=True,
        message=f"Showroom health: {healthy_count}/{len(schedules)} healthy",
        details=results,
    )


@router.post("/operations/showroom-applicationset")
@_rate_limit("10/minute")
def op_showroom_applicationset(request: Request, body: ShowroomAppSetRequest = ShowroomAppSetRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    yamls = []
    for s in schedules:
        if s.showroom_repo:
            appset = generate_showroom_applicationset(s, config, seat_count=body.seat_count)
            if appset:
                yamls.append(appset)
    if not yamls:
        return OperationResponse(success=False, message="No schedules have Showroom repos configured.")
    combined = "\n---\n".join(yamls)
    return OperationResponse(
        success=True,
        message=f"Generated {len(yamls)} ApplicationSet(s)",
        details=[combined],
    )


@router.post("/operations/update-passwords", response_model=OperationResponse)
@_rate_limit("10/minute")
def op_update_passwords(request: Request, body: LockRequest = LockRequest(), _key=Depends(verify_api_key)):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    updated = update_passwords(schedules, config)
    return OperationResponse(
        success=True,
        message=f"Updated passwords for {updated} workshop(s)",
    )


@router.post("/operations/import-namespace")
@_rate_limit("10/minute")
def op_import_namespace(request: Request, namespace: str, _key=Depends(verify_api_key)):
    _validate_namespace(namespace)
    config = _get_config()
    import tempfile
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    tmp.close()
    rows = import_namespace_to_csv(namespace, tmp.name, config)
    if not rows:
        os.unlink(tmp.name)
        raise HTTPException(404, f"No workshops found in namespace {namespace}")

    def _iter():
        with open(tmp.name, "r") as f:
            yield f.read()
        os.unlink(tmp.name)

    return StreamingResponse(
        _iter(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=imported_{namespace}.csv"},
    )


# ---------------------------------------------------------------------------
# QA
# ---------------------------------------------------------------------------

@router.post("/qa/run")
@_rate_limit("10/minute")
def qa_run(request: Request, body: QARequest = QARequest()):
    global _qa_results, _qa_log_path
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    if not _csv_filepath:
        raise HTTPException(400, "No CSV file available. Upload a CSV first.")

    config = _get_config()
    namespace = _schedules[0].namespace
    all_raw: List[dict] = []

    handler, log_path = start_log_capture("qa")
    try:
        if body.type.value in ("1", "both"):
            r1 = qa1_verify_setup(_csv_filepath, namespace, config)
            all_raw.extend(r1)
        if body.type.value in ("2", "both"):
            r2 = qa2_verify_deployment_status(_csv_filepath, namespace, config)
            all_raw.extend(r2)

        all_results = [QAResultItem(**r) for r in all_raw]
        with _state_lock:
            _qa_results = all_results
            _qa_log_path = log_path
        return {
            "count": len(all_results),
            "results": all_results,
            "log_file": os.path.basename(log_path),
        }
    finally:
        stop_log_capture(handler)


@router.get("/qa/results")
def qa_get_results():
    return {"count": len(_qa_results), "results": _qa_results}


@router.post("/qa/destroy-check", response_model=DestroyCheckResponse)
@_rate_limit("10/minute")
def qa_destroy_check_endpoint(request: Request):
    """Read-only check whether deployments have been properly destroyed/stopped."""
    global _destroy_check_results
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    if not _csv_filepath:
        raise HTTPException(400, "No CSV file available. Upload a CSV first.")

    config = _get_config()
    all_results: List[dict] = []

    handler, log_path = start_log_capture("destroy-check")
    try:
        namespaces_seen: set = set()
        for s in _schedules:
            if s.namespace not in namespaces_seen:
                namespaces_seen.add(s.namespace)
                r = qa_destroy_check(_csv_filepath, s.namespace, config)
                all_results.extend(r)

        with _state_lock:
            _destroy_check_results = all_results
        return DestroyCheckResponse(count=len(all_results), results=all_results)
    finally:
        stop_log_capture(handler)


@router.get("/qa/destroy-check/results")
def qa_destroy_check_results():
    """Return stored destroy-check results."""
    return {"count": len(_destroy_check_results), "results": _destroy_check_results}


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

@router.get("/logs")
def list_logs():
    """List available log files, newest first."""
    log_dir = get_log_dir()
    try:
        files = [f for f in os.listdir(log_dir) if f.endswith(".log")]
    except FileNotFoundError:
        files = []
    files.sort(reverse=True)
    return {"files": files}


_LOG_FILENAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-\.]*\.log$")


@router.get("/logs/{filename}")
def download_log(filename: str):
    """Download a specific log file."""
    if not _LOG_FILENAME_RE.match(filename):
        raise HTTPException(400, "Invalid filename: must be alphanumeric with .log extension")
    log_dir = get_log_dir()
    filepath = os.path.join(log_dir, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(404, "Log file not found")
    return StreamingResponse(
        open(filepath, "r", encoding="utf-8"),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@router.get("/export/results")
def export_results():
    if not _deployment_results:
        raise HTTPException(404, "No deployment results available.")

    output = io.StringIO()
    fieldnames = [
        "ci_name", "ci", "namespace", "guid", "url", "status",
        "provisioning_date", "auto_stop", "auto_destroy",
        "timestamp", "error_message", "showroom_url", "showroom_status",
        "password",
        "log_url",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for r in _deployment_results:
        writer.writerow(asdict(r))

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=deployment_results.csv"},
    )


@router.get("/templates/schedule")
def download_template():
    """Download a CSV template with headers and an example row.

    Headers match ``read_csv_input`` in rhdp_flow.py (case-insensitive).
    """
    output = io.StringIO()
    fieldnames = [
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
        "Multi_Asset",
        "Asset_CIs",
        "Multi_Workshop_Name",
        "Concurrency",
        "Instances",
        "Salesforce IDs",
        "Salesforce_Type",
        "Count",
        "AWS_Region",
        "Redirect",
        "Showroom_Repo",
        "Showroom_Ref",
        "Showroom_NoVNC",
        "Showroom_Zerotouch",
        "White_Glove",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerow({
        "CI Name": "Example Workshop",
        "CI": "vendor.workshop.prod",
        "Namespace": "user-ns",
        "Users": "30",
        "Enable_workshop_interface": "True",
        "Password": "changeme",
        "Activity": "Training",
        "Purpose": "Demo",
        "Workshop Name": "my-workshop",
        "Provisioning Date (UTC)": "15/03/2025 09:00",
        "Auto-stop (UTC)": "15/03/2025 17:00",
        "Auto-destroy (UTC)": "16/03/2025 09:00",
        "Multi_Asset": "",
        "Asset_CIs": "",
        "Multi_Workshop_Name": "",
        "Concurrency": "",
        "Instances": "",
        "Salesforce IDs": "",
        "Salesforce_Type": "",
        "Count": "",
        "AWS_Region": "",
        "Redirect": "",
        "Showroom_Repo": "",
        "Showroom_Ref": "",
        "Showroom_NoVNC": "",
        "Showroom_Zerotouch": "",
        "White_Glove": "True",
    })
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=schedule_template.csv"},
    )


@router.get("/export/students")
def export_students():
    if not _qa_results:
        raise HTTPException(404, "No QA results available. Run QA first.")

    import tempfile
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8"
    )
    tmp.close()
    export_student_landing_page_csv(_qa_results, tmp.name)

    def _iter():
        with open(tmp.name, "r") as f:
            yield f.read()
        os.unlink(tmp.name)

    return StreamingResponse(
        _iter(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=student_landing_page.csv"},
    )
