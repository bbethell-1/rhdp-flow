export interface HealthResponse {
  status: string;
  oc_installed: boolean;
  oc_connected: boolean;
  cluster_url: string;
  user: string;
  message: string;
  base_domain: string;
  rhdp_api_reachable: boolean;
}

export interface WorkshopSchedule {
  ci_name: string;
  ci: string;
  namespace: string;
  users: number | null;
  enable_workshop_interface: boolean;
  password: string;
  activity: string;
  purpose: string;
  workshop_name: string;
  provisioning_date: string;
  auto_stop: string;
  auto_destroy: string;
  is_multi_asset: boolean;
  asset_cis: string;
  multi_workshop_name: string;
  concurrency: number | null;
  instances: number | null;
  salesforce_ids: string;
  salesforce_type: string;
  aws_regions: string;
  count: number | null;
  white_glove: boolean;
  redirect: boolean;
  showroom_repo: string;
  showroom_ref: string;
  showroom_novnc: boolean;
  showroom_zerotouch: boolean;
}

export interface UploadResponse {
  count: number;
  total_rows: number;
  skipped_rows: number;
  schedules: WorkshopSchedule[];
}

/** Built-in example schedule (GET /api/schedules/examples). */
export interface ScheduleExampleMeta {
  slug: string;
  label: string;
}

/** Parameter summary from a CatalogItem spec (openAPIV3Schema). */
export interface CatalogItemParameter {
  name: string;
  type?: string;
  default?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  enum?: unknown[];
  description?: string;
}

/** Cluster CatalogItem row (GET /api/catalog/items). */
export interface CatalogItemEntry {
  id: string;
  display_name: string;
  catalog_namespace: string;
  description: string;
  category: string;
  parameters: CatalogItemParameter[];
}

export interface DeploymentResult {
  ci_name: string;
  ci: string;
  namespace: string;
  guid: string;
  url: string;
  status: string;
  provisioning_date: string;
  auto_stop: string;
  auto_destroy: string;
  timestamp: string;
  error_message: string;
  showroom_url: string;
  showroom_status: string;
  password: string;
}

export interface JobResponse {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: number;
  message: string;
  results: DeploymentResult[] | null;
  error: string | null;
  log_file: string | null;
}

export interface DeployRequest {
  ci_filter?: string | null;
  dry_run?: boolean;
  resource_lock?: boolean;
  enable_resource_pools?: boolean;
  white_glove?: boolean;
  redirect?: boolean;
  showroom_novnc?: boolean;
  showroom_zerotouch?: boolean;
}

export interface OperationResponse {
  success: boolean;
  message: string;
  details: string[];
}

export interface ExtendRequest {
  days: number;
  hours: number;
  ci_filter?: string | null;
}

export interface ScaleRequest {
  target_count: number;
  ci_filter?: string | null;
}

export interface LockRequest {
  ci_filter?: string | null;
}

export interface DisableAutostopRequest {
  ci_filter?: string | null;
}

export interface ShowroomCleanupRequest {
  ci_filter?: string | null;
}

export interface ShowroomHealthRequest {
  ci_filter?: string | null;
}

export interface QARequest {
  type: '1' | '2' | 'both';
  namespace?: string | null;
}

export interface RetryRequest {
  ci_names: string[];
  dry_run?: boolean;
  resource_lock?: boolean;
  enable_resource_pools?: boolean;
  white_glove?: boolean;
  redirect?: boolean;
}

export interface QAResponse {
  count: number;
  results: QAResult[];
}

export interface QAResult {
  ci_name: string;
  ci: string;
  namespace?: string;
  status: string;
  deployed: string;
  healthy?: boolean | string | null;
  expected_users?: number | string | null;
  actual_count?: number | string | null;
  lock_status?: boolean | null;
  actual_start?: string;
  actual_stop?: string;
  actual_destroy?: string;
  landing_page_url?: string;
  showroom_status?: string;
  showroom_url?: string;
  [key: string]: unknown;
}

export interface DiffEntry {
  ci_name: string;
  ci: string;
  namespace: string;
  change: 'added' | 'removed' | 'changed';
  details: string;
}

export interface DiffResponse {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  unchanged: number;
}

export interface NumUsersViolation {
  ci_name: string;
  ci: string;
  namespace: string;
  requested_users: number;
  maximum: number;
  minimum: number | null;
  default_value: number | null;
}

export interface UsersNotInCatalogAdvisory {
  ci_name: string;
  ci: string;
  namespace: string;
  users: number;
  enable_workshop_interface: boolean;
  instances: number | null;
  severity: 'high' | 'medium';
  message: string;
}

export interface NumUsersValidationResponse {
  violations: NumUsersViolation[];
  users_not_in_catalog: UsersNotInCatalogAdvisory[];
  checked: number;
  skipped: number;
  limits: Record<string, number>;
}

export interface ResourceStatus {
  exists: boolean;
  status: string;
  lifespan_end: string | null;
  count?: number | null;
  healthy?: boolean | null;
}

export interface DestroyCheckResult {
  ci_name: string;
  ci: string;
  namespace: string;
  scheduled_destroy: string;
  scheduled_stop: string;
  workshop: ResourceStatus;
  workshop_provision: ResourceStatus;
  resource_claim: ResourceStatus;
  overall_status: string;
  stop_status: string;
}

export interface DestroyCheckResponse {
  count: number;
  results: DestroyCheckResult[];
}

export interface SessionSummary {
  session_id: string;
  filename: string;
  schedule_count: number;
  result_count: number;
  timestamp: string;
  has_results: boolean;
  deploy_log_file: string | null;
  qa_log_file: string | null;
}

export interface SessionDetail {
  session_id: string;
  filename: string;
  timestamp: string;
  schedules: WorkshopSchedule[];
  results: DeploymentResult[];
  qa_results: QAResult[];
  deploy_log_file: string | null;
  qa_log_file: string | null;
}

export interface RegionPlan {
  region: string;
  users: number;
}

export interface DeployPreviewItem {
  ci_name: string;
  ci: string;
  namespace: string;
  users: number | null;
  instances: number | null;
  count: number | null;
  is_multi_asset: boolean;
  multi_region: boolean;
  regions: RegionPlan[];
}

export interface DeployPreviewResponse {
  schedules: DeployPreviewItem[];
}
