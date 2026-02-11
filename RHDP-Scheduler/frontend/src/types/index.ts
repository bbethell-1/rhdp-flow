export interface HealthResponse {
  status: string;
  oc_installed: boolean;
  oc_connected: boolean;
  cluster_url: string;
  user: string;
  message: string;
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
}

export interface UploadResponse {
  count: number;
  total_rows: number;
  skipped_rows: number;
  schedules: WorkshopSchedule[];
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
}

export interface JobResponse {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  results: DeploymentResult[] | null;
  error: string | null;
}

export interface DeployRequest {
  ci_filter?: string | null;
  dry_run?: boolean;
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

export interface QARequest {
  type: '1' | '2' | 'both';
}

export interface QAResponse {
  count: number;
  results: QAResult[];
}

export interface QAResult {
  ci_name: string;
  ci: string;
  status: string;
  deployed: string;
  healthy: boolean | string;
  expected_seats: number;
  actual_seats: number;
  landing_page_url: string;
  [key: string]: unknown;
}

export interface SessionSummary {
  session_id: string;
  filename: string;
  schedule_count: number;
  result_count: number;
  timestamp: string;
  has_results: boolean;
}

export interface SessionDetail {
  session_id: string;
  filename: string;
  timestamp: string;
  schedules: WorkshopSchedule[];
  results: DeploymentResult[];
  qa_results: QAResult[];
}
