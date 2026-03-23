"""Pydantic request/response schemas for the RHDP-Flow API."""

from __future__ import annotations

from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Mirror of rhdp_flow dataclasses
# ---------------------------------------------------------------------------

class WorkshopScheduleResponse(BaseModel):
    """Mirrors rhdp_flow.WorkshopSchedule."""

    ci_name: str
    ci: str
    namespace: str
    enable_workshop_interface: bool
    password: str
    activity: str
    purpose: str
    workshop_name: str
    provisioning_date: str
    auto_stop: str
    auto_destroy: str
    is_multi_asset: bool = False
    asset_cis: str = ""
    multi_workshop_name: str = ""
    users: Optional[int] = None
    instances: Optional[int] = None
    concurrency: Optional[int] = None
    salesforce_ids: str = ""
    redirect: bool = True
    showroom_repo: str = ""
    showroom_ref: str = ""
    showroom_novnc: bool = False
    showroom_zerotouch: bool = False


class DeploymentResultResponse(BaseModel):
    """Mirrors rhdp_flow.DeploymentResult."""

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
    showroom_url: str = ""
    showroom_status: str = ""
    password: str = ""


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class DeployRequest(BaseModel):
    """Body for POST /api/deploy and /api/deploy/dry-run."""

    ci_filter: Optional[str] = Field(
        None, description="Optional Catalog Item ID to filter (process only this CI)"
    )
    dry_run: bool = Field(False, description="Override global dry-run toggle")
    resource_lock: bool = Field(True, description="Apply lock-enabled label")
    enable_resource_pools: bool = Field(False, description="Enable Poolboy resource pools")
    white_glove: bool = Field(True, description="White-glove mode")
    redirect: bool = Field(True, description="Enable workshop UI redirect (labUserInterface.redirect)")
    showroom_novnc: bool = Field(False, description="Enable noVNC remote desktop in Showroom")
    showroom_zerotouch: bool = Field(False, description="Use zerotouch Showroom chart with setup/runtime automation")
    export_yaml_dir: Optional[str] = Field(
        None,
        description="If set on dry-run deploy, write ResourceClaim / Workshop / WorkshopProvision YAMLs to this directory on the API host",
    )


class LockRequest(BaseModel):
    """Body for POST /api/operations/lock."""

    ci_filter: Optional[str] = None


class ExtendRequest(BaseModel):
    """Body for POST /api/operations/extend-stop and extend-destroy."""

    days: int = Field(0, ge=0, le=30)
    hours: int = Field(0, ge=0, le=720)
    ci_filter: Optional[str] = None


class DisableAutostopRequest(BaseModel):
    """Body for POST /api/operations/disable-autostop."""

    ci_filter: Optional[str] = None


class ShowroomCleanupRequest(BaseModel):
    """Body for POST /api/operations/showroom-cleanup."""

    ci_filter: Optional[str] = None


class ShowroomHealthRequest(BaseModel):
    """Body for POST /api/operations/showroom-health."""

    ci_filter: Optional[str] = None


class ShowroomAppSetRequest(BaseModel):
    """Body for POST /api/operations/showroom-applicationset."""

    ci_filter: Optional[str] = None
    seat_count: Optional[int] = Field(None, ge=1, le=500)


class ScaleRequest(BaseModel):
    """Body for POST /api/operations/scale."""

    target_count: int = Field(..., ge=0, le=1000)
    ci_filter: Optional[str] = None


class RetryRequest(BaseModel):
    """Body for POST /api/deploy/retry — re-deploy specific CI names."""

    ci_names: List[str] = Field(..., min_length=1, description="List of CI names to retry")
    dry_run: bool = Field(False, description="Run in dry-run mode")
    resource_lock: bool = Field(True, description="Apply lock-enabled label")
    enable_resource_pools: bool = Field(False, description="Enable Poolboy resource pools")
    white_glove: bool = Field(True, description="White-glove mode")
    redirect: bool = Field(True, description="Enable workshop UI redirect")


class QAType(str, Enum):
    qa1 = "1"
    qa2 = "2"
    both = "both"


class QARequest(BaseModel):
    type: QAType = QAType.both


# ---------------------------------------------------------------------------
# Job tracking
# ---------------------------------------------------------------------------

class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = Field(0, ge=0, le=100)
    message: str = ""
    results: Optional[List[DeploymentResultResponse]] = None
    error: Optional[str] = None
    log_file: Optional[str] = None


# ---------------------------------------------------------------------------
# Generic
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    detail: str
    status_code: int = 500


class HealthResponse(BaseModel):
    status: str
    oc_installed: bool = False
    oc_connected: bool = False
    cluster_url: str = ""
    user: str = ""
    message: str = ""
    base_domain: str = ""
    rhdp_api_reachable: bool = False


class UploadResponse(BaseModel):
    count: int
    total_rows: int = 0
    skipped_rows: int = 0
    schedules: List[WorkshopScheduleResponse]


class OperationResponse(BaseModel):
    success: bool
    message: str
    details: List[str] = Field(default_factory=list)


class DiffEntry(BaseModel):
    ci_name: str
    ci: str
    namespace: str
    change: Literal["added", "removed", "changed"]
    details: str = ""


class DiffResponse(BaseModel):
    added: List[DiffEntry]
    removed: List[DiffEntry]
    changed: List[DiffEntry]
    unchanged: int


class NumUsersViolation(BaseModel):
    """A single num_users limit violation."""

    ci_name: str
    ci: str
    namespace: str
    requested_users: int
    maximum: int
    minimum: Optional[int] = None
    default_value: Optional[int] = None


class NumUsersValidationResponse(BaseModel):
    """Response for POST /schedules/validate-num-users."""

    violations: List[NumUsersViolation] = Field(default_factory=list)
    checked: int = 0
    skipped: int = 0
    limits: dict = Field(default_factory=dict, description="Per-CI maximum map, e.g. {'ci-name': 40}")


class ResourceStatus(BaseModel):
    exists: bool
    status: str           # "not_found" | "active" | "overdue"
    lifespan_end: Optional[str] = None
    count: Optional[int] = None
    healthy: Optional[bool] = None


class DestroyCheckResult(BaseModel):
    ci_name: str
    ci: str
    namespace: str
    scheduled_destroy: str
    scheduled_stop: str
    workshop: ResourceStatus
    workshop_provision: ResourceStatus
    resource_claim: ResourceStatus
    overall_status: str   # "destroyed" | "active" | "overdue" | "not_deployed"
    stop_status: str      # "stopped" | "pending" | "stop_overdue" | "n/a"


class DestroyCheckResponse(BaseModel):
    count: int
    results: List[DestroyCheckResult]


class QAResultItem(BaseModel):
    """Typed representation of a QA check result."""

    ci_name: str
    ci: str
    namespace: str
    scheduled: str = ""
    deployed: str = ""
    status: str = ""
    matches_schedule: str = ""
    issues: str = ""
    expected_users: Optional[int] = None
    actual_count: Optional[int] = None
    workshop_users_assigned: Optional[int] = None
    total_seats: Optional[int] = None
    provisioning_date: str = ""
    auto_stop: str = ""
    auto_destroy: str = ""
    resourceclaim_name: str = ""
    resourceclaims: List[str] = Field(default_factory=list)
    link_to_service: str = ""
    landing_page_url: str = ""
    healthy: Optional[bool] = None
    ready: Optional[bool] = None
    showroom_status: str = ""
    showroom_url: str = ""

    model_config = {"extra": "allow"}


class SessionSummary(BaseModel):
    session_id: str
    filename: str
    schedule_count: int
    result_count: int
    timestamp: str
    has_results: bool
    deploy_log_file: Optional[str] = None
    qa_log_file: Optional[str] = None
