"""Pydantic request/response schemas for the RHDP-Flow API."""

from __future__ import annotations

from enum import Enum
from typing import List, Optional

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


class LockRequest(BaseModel):
    """Body for POST /api/operations/lock."""

    ci_filter: Optional[str] = None


class ExtendRequest(BaseModel):
    """Body for POST /api/operations/extend-stop and extend-destroy."""

    days: int = Field(0, ge=0, le=30)
    hours: int = Field(0, ge=0, le=720)
    ci_filter: Optional[str] = None


class ScaleRequest(BaseModel):
    """Body for POST /api/operations/scale."""

    target_count: int = Field(..., ge=0)
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
    change: str  # 'added', 'removed', 'changed'
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


class SessionSummary(BaseModel):
    session_id: str
    filename: str
    schedule_count: int
    result_count: int
    timestamp: str
    has_results: bool
