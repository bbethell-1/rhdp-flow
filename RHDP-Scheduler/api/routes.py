"""API endpoints — thin wrappers around rhdp_flow functions."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import subprocess
import time
from dataclasses import asdict
from typing import Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

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
    export_student_landing_page_csv,
    lock_workshops,
    unlock_workshops,
    extend_stop_time,
    extend_destroy_time,
    scale_workshops,
    derive_base_domain,
)

from api.models import (
    DeploymentResultResponse,
    DeployRequest,
    ExtendRequest,
    HealthResponse,
    JobResponse,
    LockRequest,
    OperationResponse,
    QARequest,
    ScaleRequest,
    SessionSummary,
    UploadResponse,
    WorkshopScheduleResponse,
)
from api import jobs

logger = logging.getLogger("rhdp_flow.api")

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
_schedules: List[WorkshopSchedule] = []
_deployment_results: List[DeploymentResult] = []
_qa_results: List[dict] = []
_csv_filepath: Optional[str] = None  # stashed for QA functions that need a path
_current_filename: str = ""
_asset_passwords: Optional[Dict[str, str]] = None

# Session history — each completed upload+deploy cycle gets archived here
_sessions: List[dict] = []
_session_counter: int = 0

# Cached base domain derived from the connected cluster
_cached_base_domain: Optional[str] = None


def _detect_and_cache_base_domain() -> str:
    """Run `oc whoami --show-server`, derive base domain, and cache it."""
    global _cached_base_domain
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
        if r.returncode == 0:
            _cached_base_domain = derive_base_domain(r.stdout.strip())
        else:
            _cached_base_domain = "integration.demo.redhat.com"
    except Exception:
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
    )


def _result_to_response(r: DeploymentResult) -> DeploymentResultResponse:
    return DeploymentResultResponse(**asdict(r))


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
        "csv_filepath": _csv_filepath,
        "schedule_count": len(_schedules),
        "result_count": len(_deployment_results),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    _sessions.append(session)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.post("/sessions/clear")
def clear_session():
    """Archive current session and reset state for a new upload."""
    global _schedules, _deployment_results, _qa_results, _csv_filepath, _current_filename, _asset_passwords
    _archive_current_session()
    _schedules = []
    _deployment_results = []
    _qa_results = []
    _csv_filepath = None
    _current_filename = ""
    _asset_passwords = None
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
            }
    raise HTTPException(404, "Session not found")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
def health():
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

    # 2. Check actual cluster connectivity with oc whoami
    try:
        r_user = subprocess.run(
            [config.oc_command, "whoami"],
            capture_output=True, text=True, timeout=10, env=env,
        )
        r_server = subprocess.run(
            [config.oc_command, "whoami", "--show-server"],
            capture_output=True, text=True, timeout=10, env=env,
        )
        if r_user.returncode == 0 and r_server.returncode == 0:
            cluster_url = r_server.stdout.strip()
            # Cache and return the derived base domain
            global _cached_base_domain
            _cached_base_domain = derive_base_domain(cluster_url)
            return HealthResponse(
                status="ok",
                oc_installed=True,
                oc_connected=True,
                cluster_url=cluster_url,
                user=r_user.stdout.strip(),
                base_domain=_cached_base_domain,
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
# Schedules
# ---------------------------------------------------------------------------

@router.post("/schedules/upload", response_model=UploadResponse)
async def upload_csv(file: UploadFile = File(...)):
    global _schedules, _csv_filepath, _current_filename
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded CSV")

    # Write to temp file — read_csv_input requires a file path
    import tempfile
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8"
    )
    tmp.write(text)
    tmp.close()

    # Count total data rows (non-empty, excluding header)
    reader = csv.reader(io.StringIO(text))
    all_rows = [row for row in reader if any(cell.strip() for cell in row)]
    total_rows = max(0, len(all_rows) - 1)  # subtract header row

    try:
        schedules = read_csv_input(tmp.name)
    except ValueError as e:
        os.unlink(tmp.name)
        raise HTTPException(400, str(e))

    _schedules = schedules
    _current_filename = file.filename or "unknown.csv"
    _csv_filepath = tmp.name

    skipped = total_rows - len(schedules)

    return UploadResponse(
        count=len(schedules),
        total_rows=total_rows,
        skipped_rows=max(0, skipped),
        schedules=[_schedule_to_response(s) for s in schedules],
    )


@router.post("/schedules/upload-passwords")
async def upload_passwords(file: UploadFile = File(...)):
    """Upload a per-asset passwords CSV (columns: CI, Password)."""
    global _asset_passwords
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded CSV")

    import tempfile as _tf
    tmp = _tf.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    tmp.write(text)
    tmp.close()
    _asset_passwords = load_asset_passwords(tmp.name)
    os.unlink(tmp.name)

    return {"count": len(_asset_passwords), "message": f"Loaded {len(_asset_passwords)} asset password(s)"}


@router.get("/schedules", response_model=List[WorkshopScheduleResponse])
def get_schedules():
    return [_schedule_to_response(s) for s in _schedules]


# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

@router.post("/deploy", response_model=JobResponse)
async def deploy(body: DeployRequest = DeployRequest()):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded. Upload a CSV first.")

    schedules = _filter_schedules(body.ci_filter)
    job = jobs.create_job()

    async def _run():
        try:
            config = _get_config(
                dry_run=body.dry_run,
                resource_lock=body.resource_lock,
                enable_resource_pools=body.enable_resource_pools,
                white_glove=body.white_glove,
                redirect=body.redirect,
            )
            jobs.update_job(job.job_id, status=jobs.Status.running, message="Starting deployment")

            # Replicate main() deploy loop logic
            grouped_multi = {}
            regular_schedules = []
            for s in schedules:
                if s.multi_workshop_name and not s.is_multi_asset:
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
                        timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                    ))
                else:
                    results.append(DeploymentResult(
                        ci_name=group_name, ci=first.ci, namespace=first.namespace,
                        guid="failed", url="", status="failed",
                        provisioning_date=first.provisioning_date,
                        auto_stop=first.auto_stop, auto_destroy=first.auto_destroy,
                        timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                        error_message="Failed to create grouped MultiWorkshop",
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
            _deployment_results = results
            jobs.update_job(
                job.job_id,
                status=jobs.Status.completed,
                progress=100,
                message=f"Completed: {len(results)} deployment(s)",
                results=[asdict(r) for r in results],
            )
        except Exception as exc:
            jobs.update_job(
                job.job_id,
                status=jobs.Status.failed,
                error=str(exc),
                message=f"Deployment failed: {exc}",
            )

    asyncio.create_task(_run())
    return JobResponse(job_id=job.job_id, status=job.status)


@router.post("/deploy/dry-run", response_model=List[DeploymentResultResponse])
def deploy_dry_run(body: DeployRequest = DeployRequest()):
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

    # Replicate main() grouping logic for accurate preview
    grouped_multi = {}
    regular_schedules = []
    for s in schedules:
        if s.multi_workshop_name and not s.is_multi_asset:
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
                timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
            ))
        else:
            results.append(DeploymentResult(
                ci_name=group_name, ci=first.ci, namespace=first.namespace,
                guid="failed", url="", status="failed",
                provisioning_date=first.provisioning_date,
                auto_stop=first.auto_stop, auto_destroy=first.auto_destroy,
                timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                error_message="Failed to create grouped MultiWorkshop",
            ))

    for s in regular_schedules:
        result = process_schedule(s, config, asset_passwords=_asset_passwords)
        results.append(result)

    global _deployment_results
    _deployment_results = results
    return [_result_to_response(r) for r in results]


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
    )


@router.get("/deploy/stream/{job_id}")
async def deploy_stream(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return EventSourceResponse(jobs.event_generator(job_id))


@router.get("/deploy/results", response_model=List[DeploymentResultResponse])
def get_deploy_results():
    return [_result_to_response(r) for r in _deployment_results]


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

@router.post("/operations/lock", response_model=OperationResponse)
def op_lock(body: LockRequest = LockRequest()):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    lock_workshops(schedules, config)
    return OperationResponse(success=True, message=f"Locked {len(schedules)} schedule(s)")


@router.post("/operations/unlock", response_model=OperationResponse)
def op_unlock(body: LockRequest = LockRequest()):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    unlock_workshops(schedules, config)
    return OperationResponse(success=True, message=f"Unlocked {len(schedules)} schedule(s)")


@router.post("/operations/extend-stop", response_model=OperationResponse)
def op_extend_stop(body: ExtendRequest):
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
def op_extend_destroy(body: ExtendRequest):
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


@router.post("/operations/scale", response_model=OperationResponse)
def op_scale(body: ScaleRequest):
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    schedules = _filter_schedules(body.ci_filter)
    config = _get_config()
    scale_workshops(schedules, config, body.target_count)
    return OperationResponse(
        success=True,
        message=f"Scaled {len(schedules)} schedule(s) to count={body.target_count}",
    )


# ---------------------------------------------------------------------------
# QA
# ---------------------------------------------------------------------------

@router.post("/qa/run")
def qa_run(body: QARequest = QARequest()):
    global _qa_results
    if not _schedules:
        raise HTTPException(400, "No schedules loaded.")
    if not _csv_filepath:
        raise HTTPException(400, "No CSV file available. Upload a CSV first.")

    config = _get_config()
    namespace = _schedules[0].namespace
    all_results = []

    if body.type.value in ("1", "both"):
        r1 = qa1_verify_setup(_csv_filepath, namespace, config)
        all_results.extend(r1)
    if body.type.value in ("2", "both"):
        r2 = qa2_verify_deployment_status(_csv_filepath, namespace, config)
        all_results.extend(r2)

    _qa_results = all_results
    return {"count": len(all_results), "results": all_results}


@router.get("/qa/results")
def qa_get_results():
    return {"count": len(_qa_results), "results": _qa_results}


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
        "timestamp", "error_message", "log_url",
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
