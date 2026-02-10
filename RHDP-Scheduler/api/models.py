"""Pydantic request/response schemas for the RHDP-Flow API."""

from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Mirror of rhdp_flow dataclasses
# ---------------------------------------------------------------------------

class WorkshopScheduleResponse(BaseModel):
    """Mirrors rhdp_flow.WorkshopSchedule."""

    ci_name: str
    ci: str
    namespace: str
    users: int
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
    concurrency: int = 1
    count: int = 1
    aws_regions: str = ""


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


class LockRequest(BaseModel):
    ci_filter: Optional[str] = None


class ExtendRequest(BaseModel):
    days: int = Field(0, ge=0)
    hours: int = Field(0, ge=0)
    ci_filter: Optional[str] = None


class ScaleRequest(BaseModel):
    target_count: int = Field(..., ge=0)
    ci_filter: Optional[str] = None


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


class UploadResponse(BaseModel):
    count: int
    schedules: List[WorkshopScheduleResponse]


class OperationResponse(BaseModel):
    success: bool
    message: str
    details: List[str] = Field(default_factory=list)


class SessionSummary(BaseModel):
    session_id: str
    filename: str
    schedule_count: int
    result_count: int
    timestamp: str
    has_results: bool
