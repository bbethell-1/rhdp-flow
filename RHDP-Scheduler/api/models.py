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
    users: int | None = None
    instances: int | None = None
    concurrency: int | None = None
    salesforce_ids: str = ""
    salesforce_type: str = "opportunity"
    aws_regions: str = ""
    count: int | None = None
    white_glove: bool = True
    redirect: bool = True
    catalog_namespace: str = ""
    showroom_repo: str = ""
    showroom_ref: str = ""
    showroom_novnc: bool = False
    showroom_zerotouch: bool = False
    item_type: Optional[str] = None
    cluster_ci_override: Optional[str] = None
    is_cluster: bool = False
    is_tenant: bool = False
    detected_cluster_ci: Optional[str] = None
    detection_method: str = "none"
    cluster_ci_source: Optional[str] = None


class CatalogItemParameter(BaseModel):
    """Summary of a single parameter from a CatalogItem spec (openAPIV3Schema)."""

    name: str
    type: str | None = None
    default: object | None = None
    minimum: object | None = None
    maximum: object | None = None
    enum: list[object] | None = None
    description: str | None = None


class CatalogItemEntry(BaseModel):
    """One row from cluster CatalogItem list (prod + event namespaces)."""

    id: str = Field(description="Catalog Item ID, e.g. openshift-cnv.ocp-virt-roadshow-multi-user.prod")
    display_name: str = Field(description="babylon.gpte.redhat.com/catalogItemDisplayName or id")
    catalog_namespace: str = Field(description="Kubernetes namespace listing was read from")
    description: str = Field("", description="babylon.gpte.redhat.com/description annotation")
    category: str = Field("", description="babylon.gpte.redhat.com/category annotation")
    parameters: list[CatalogItemParameter] = Field(default_factory=list, description="Parameter definitions from spec")


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
    cluster_name: str = ""
    cluster_capacity: str = ""


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class DeployRequest(BaseModel):
    """Body for POST /api/deploy and /api/deploy/dry-run."""

    ci_filter: str | None = Field(
        None, description="Optional Catalog Item ID to filter (process only this CI)"
    )
    dry_run: bool = Field(False, description="Override global dry-run toggle")
    resource_lock: bool = Field(True, description="Apply lock-enabled label")
    enable_resource_pools: bool = Field(False, description="Enable Poolboy resource pools")
    white_glove: bool = Field(True, description="White-glove mode")
    redirect: bool = Field(True, description="Enable workshop UI redirect (labUserInterface.redirect)")
    showroom_novnc: bool = Field(False, description="Enable noVNC remote desktop in Showroom")
    showroom_zerotouch: bool = Field(False, description="Use zerotouch Showroom chart with setup/runtime automation")
    ignore_capacity_warnings: bool = Field(False, description="Skip tenant cluster capacity checks before deployment")
    export_yaml_dir: Optional[str] = Field(
        None,
        description="If set on dry-run deploy, write ResourceClaim / Workshop / WorkshopProvision YAMLs to this directory on the API host",
    )


class LockRequest(BaseModel):
    """Body for POST /api/operations/lock."""

    ci_filter: str | None = None


class ExtendRequest(BaseModel):
    """Body for POST /api/operations/extend-stop and extend-destroy."""

    days: int = Field(0, ge=0, le=30)
    hours: int = Field(0, ge=0, le=720)
    ci_filter: str | None = None


class DisableAutostopRequest(BaseModel):
    """Body for POST /api/operations/disable-autostop."""

    ci_filter: str | None = None


class ShowroomCleanupRequest(BaseModel):
    """Body for POST /api/operations/showroom-cleanup."""

    ci_filter: str | None = None


class ShowroomHealthRequest(BaseModel):
    """Body for POST /api/operations/showroom-health."""

    ci_filter: str | None = None


class ShowroomPreflightRequest(BaseModel):
    """Body for POST /api/operations/showroom-preflight (Demolition browser check)."""

    ci_filter: str | None = None


class ShowroomAppSetRequest(BaseModel):
    """Body for POST /api/operations/showroom-applicationset."""

    ci_filter: str | None = None
    seat_count: int | None = Field(None, ge=1, le=500)


class ScaleRequest(BaseModel):
    """Body for POST /api/operations/scale."""

    target_count: int = Field(..., ge=0, le=1000)
    ci_filter: str | None = None


class RetryRequest(BaseModel):
    """Body for POST /api/deploy/retry — re-deploy specific CI names."""

    ci_names: list[str] = Field(..., min_length=1, description="List of CI names to retry")
    dry_run: bool = Field(False, description="Run in dry-run mode")
    resource_lock: bool = Field(True, description="Apply lock-enabled label")
    enable_resource_pools: bool = Field(False, description="Enable Poolboy resource pools")
    white_glove: bool = Field(True, description="White-glove mode")
    redirect: bool = Field(True, description="Enable workshop UI redirect")


class QAType(str, Enum):
    qa1 = "1"
    qa2 = "2"
    qa3 = "3"
    both = "both"  # For backward compatibility (runs 1+2 only)
    all = "all"    # Runs all QA checks (1+2+3)


class QARequest(BaseModel):
    type: QAType = QAType.all
    namespace: str | None = Field(
        None,
        min_length=1,
        description="Optional namespace override for QA runs (can be comma-separated list); defaults to the loaded schedule namespace",
    )
    namespaces: list[str] | None = Field(
        None,
        description="Optional list of namespaces to scan for faster targeted QA",
    )

    @field_validator("namespace")
    @classmethod
    def _strip_namespace(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class DestroyCheckRequest(BaseModel):
    namespace: str | None = Field(
        None,
        min_length=1,
        description="Optional namespace override for destroy checks; defaults to the loaded schedule namespace",
    )

    @field_validator("namespace")
    @classmethod
    def _strip_namespace(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


# ---------------------------------------------------------------------------
# Job tracking
# ---------------------------------------------------------------------------

class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    paused = "paused"


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = Field(0, ge=0, le=100)
    message: str = ""
    results: list[DeploymentResultResponse] | None = None
    error: str | None = None
    log_file: str | None = None


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
    schedules: list[WorkshopScheduleResponse]


class OperationResponse(BaseModel):
    success: bool
    message: str
    details: list[str] = Field(default_factory=list)


class DiffEntry(BaseModel):
    ci_name: str
    ci: str
    namespace: str
    change: Literal["added", "removed", "changed"]
    details: str = ""


class DiffResponse(BaseModel):
    added: list[DiffEntry]
    removed: list[DiffEntry]
    changed: list[DiffEntry]
    unchanged: int


class NumUsersViolation(BaseModel):
    """A single num_users limit violation."""

    ci_name: str
    ci: str
    namespace: str
    requested_users: int
    maximum: int
    minimum: int | None = None
    default_value: int | None = None


class UsersNotInCatalogAdvisory(BaseModel):
    """Users > 0 but catalog item has no num_users (e.g. use Instances for WorkshopProvision count)."""

    ci_name: str
    ci: str
    namespace: str
    users: int
    enable_workshop_interface: bool
    instances: int | None = None
    severity: Literal["high", "medium"]
    message: str


class NumUsersValidationResponse(BaseModel):
    """Response for POST /schedules/validate-num-users."""

    violations: list[NumUsersViolation] = Field(default_factory=list)
    users_not_in_catalog: list[UsersNotInCatalogAdvisory] = Field(
        default_factory=list,
        description="Schedules with Users set where the catalog item does not define num_users",
    )
    checked: int = 0
    skipped: int = 0
    limits: dict = Field(default_factory=dict, description="Per-CI maximum map, e.g. {'ci-name': 40}")


class CatalogNamespaceMismatch(BaseModel):
    """A catalog item found in a different namespace than expected."""

    ci_name: str
    ci: str
    namespace: str
    expected_catalog_namespace: str
    found_catalog_namespace: str
    suggestion: str


class CatalogNamespaceValidationResponse(BaseModel):
    """Response for POST /schedules/validate-catalog-namespaces."""

    mismatches: list[CatalogNamespaceMismatch] = Field(default_factory=list)
    not_found: list[dict] = Field(default_factory=list, description="CIs not found in any catalog namespace")
    checked: int = 0
    skipped: int = 0


class ClusterTenantValidationError(BaseModel):
    """A cluster-tenant ordering validation error."""

    ci_name: str
    tenant_ci: str
    cluster_ci: str
    tenant_date: str
    cluster_date: str
    namespace: str
    message: str


class ClusterTenantValidationWarning(BaseModel):
    """A cluster-tenant validation warning."""

    ci_name: str
    tenant_ci: str
    namespace: str
    message: str


class ClusterTenantValidationResponse(BaseModel):
    """Response for POST /schedules/validate-cluster-tenant."""

    errors: List[ClusterTenantValidationError] = Field(default_factory=list)
    warnings: List[ClusterTenantValidationWarning] = Field(default_factory=list)
    tenants_checked: int = 0
    clusters_found: int = 0


class ResourceStatus(BaseModel):
    exists: bool
    status: str           # "not_found" | "active" | "overdue"
    lifespan_end: str | None = None
    count: int | None = None
    healthy: bool | None = None


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
    results: list[DestroyCheckResult]


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
    expected_users: int | None = None
    actual_count: int | None = None
    workshop_users_assigned: int | None = None
    total_seats: int | None = None
    provisioning_date: str = ""
    auto_stop: str = ""
    auto_destroy: str = ""
    resourceclaim_name: str = ""
    resourceclaims: list[str] = Field(default_factory=list)
    link_to_service: str = ""
    landing_page_url: str = ""
    healthy: bool | None = None
    ready: bool | None = None
    lock_status: bool | None = None
    actual_start: str = ""
    actual_stop: str = ""
    actual_destroy: str = ""
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
    deploy_log_file: str | None = None
    qa_log_file: str | None = None


# ---------------------------------------------------------------------------
# Pool Lookup Models
# ---------------------------------------------------------------------------

class PoolInfo(BaseModel):
    """ResourcePool information for a catalog item."""

    pool_name: str
    min_available: int
    max_available: int | None = None
    ready: int = 0
    available: int = 0
    claimed: int = 0
    provisioning: int = 0
    lifespan_default: str = "N/A"
    lifespan_unclaimed: str = "N/A"
    lifespan_maximum: str = "N/A"
    provider_name: str
    exists: bool = True


class PoolLookupResponse(BaseModel):
    """Response for pool lookup by catalog item."""

    catalog_item: str
    pool: PoolInfo | None = None
    has_pool: bool = False


class FillMissingDatesRequest(BaseModel):
    """Request to fill missing dates in schedules."""
    provisioning_date: str
    auto_stop: str
    auto_destroy: str
