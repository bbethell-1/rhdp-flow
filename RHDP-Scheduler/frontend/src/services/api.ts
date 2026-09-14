import type {
  HealthResponse,
  UploadResponse,
  WorkshopSchedule,
  DeploymentResult,
  JobResponse,
  DeployRequest,
  OperationResponse,
  ExtendRequest,
  ScaleRequest,
  LockRequest,
  DisableAutostopRequest,
  ShowroomCleanupRequest,
  ShowroomHealthRequest,

  QARequest,
  QAResponse,
  RetryRequest,
  NumUsersValidationResponse,
  PoolCapacityValidationResponse,
  SessionSummary,
  SessionDetail,
  ScheduleExampleMeta,
  CatalogItemEntry,
  DeployPreviewResponse,
  PoolInfo,
  PoolLookupResponse,
  LabagatorEventsResponse,
  LabagatorPreviewResponse,
} from '../types';

export interface TenantClusterRef {
  ci: string;
  namespace: string;
  cluster_ref: string;
  cluster_ci_from_csv: string;
  workshop_name: string;
  pool_exists: boolean;
  has_cluster_row: boolean;
}

const API = '/api';

export function getApiKey(): string | null {
  // Use sessionStorage — cleared on tab close, not vulnerable to persistent XSS
  return sessionStorage.getItem('rhdp-api-key');
}

function getApiKeyHeader(): Record<string, string> {
  const apiKey = getApiKey();
  return apiKey ? { 'X-API-Key': apiKey } : {};
}

export function setApiKey(key: string): void {
  sessionStorage.setItem('rhdp-api-key', key);
}

export function clearApiKey(): void {
  sessionStorage.removeItem('rhdp-api-key');
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers as Record<string, string>,
  };
  Object.assign(headers, getApiKeyHeader());
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json();
}

// ── Response cache (5s TTL) for GET endpoints ──
const _cache = new Map<string, { data: unknown; expiry: number }>();

async function cachedRequest<T>(path: string, ttlMs = 5000): Promise<T> {
  const entry = _cache.get(path);
  if (entry && Date.now() < entry.expiry) return entry.data as T;
  const data = await request<T>(path);
  _cache.set(path, { data, expiry: Date.now() + ttlMs });
  return data;
}

export function clearApiCache() {
  _cache.clear();
}

export const api = {
  health: () => cachedRequest<HealthResponse>('/health'),

  /** Cluster catalog items (prod + event namespaces). */
  listCatalogItems: () => request<CatalogItemEntry[]>('/catalog/items'),

  /** Lookup ResourcePool for a catalog item. */
  lookupPool: (catalogItem: string) =>
    request<PoolLookupResponse>(`/pools/lookup?catalog_item=${encodeURIComponent(catalogItem)}`),

  /** List all ResourcePools in the cluster. */
  listAllPools: () => request<{ pools: PoolInfo[] }>('/pools/all'),

  // Schedules
  uploadCSV: async (file: File): Promise<UploadResponse> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/schedules/upload`, {
      method: 'POST',
      body: form,
      headers: getApiKeyHeader(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  listLabagatorEvents: () => cachedRequest<LabagatorEventsResponse>('/labagator/events'),

  previewLabagatorImport: (params: {
    event_id: number;
    namespace: string;
    event_name: string;
    enable_workshop_interface: boolean;
    concurrency: number;
    white_glove: boolean;
    auto_stop_days: number;
    auto_destroy_days: number;
  }): Promise<LabagatorPreviewResponse> => {
    const qs = new URLSearchParams({
      event_id: String(params.event_id),
      namespace: params.namespace,
      event_name: params.event_name,
      enable_workshop_interface: String(params.enable_workshop_interface),
      concurrency: String(params.concurrency),
      white_glove: String(params.white_glove),
      auto_stop_days: String(params.auto_stop_days),
      auto_destroy_days: String(params.auto_destroy_days),
    });
    return request<LabagatorPreviewResponse>(`/schedules/labagator-preview?${qs.toString()}`);
  },

  /** Legacy manual-upload path: POST a Labagator session-export CSV, transformed server-side. */
  importLabagatorCSV: async (
    file: File,
    options?: {
      default_ci?: string;
      default_users?: number;
      default_redirect?: boolean;
      default_white_glove?: boolean;
      buffer_hours?: number;
    }
  ): Promise<UploadResponse> => {
    const form = new FormData();
    form.append('file', file);

    // Build query params from options
    const params = new URLSearchParams();
    if (options?.default_ci) params.append('default_ci', options.default_ci);
    if (options?.default_users !== undefined) params.append('default_users', options.default_users.toString());
    if (options?.default_redirect !== undefined) params.append('default_redirect', options.default_redirect.toString());
    if (options?.default_white_glove !== undefined) params.append('default_white_glove', options.default_white_glove.toString());
    if (options?.buffer_hours !== undefined) params.append('buffer_hours', options.buffer_hours.toString());

    const url = params.toString() ? `${API}/schedules/import-labagator?${params}` : `${API}/schedules/import-labagator`;
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      headers: getApiKeyHeader(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  importFromLabagator: (csvText: string, filename: string): Promise<UploadResponse> =>
    request<UploadResponse>('/schedules/import-from-labagator', {
      method: 'POST',
      body: JSON.stringify({ csv_text: csvText, filename }),
    }),
  uploadPasswordsCSV: async (file: File): Promise<{count: number; message: string}> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/schedules/upload-passwords`, {
      method: 'POST',
      body: form,
      headers: getApiKeyHeader(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  listScheduleExamples: () => cachedRequest<ScheduleExampleMeta[]>('/schedules/examples'),
  loadScheduleExample: (slug: string) =>
    request<UploadResponse>(
      `/schedules/load-example/${encodeURIComponent(slug)}`,
      { method: 'POST', body: '{}' },
    ),
  getSchedules: () => cachedRequest<WorkshopSchedule[]>('/schedules'),
  validateNamespaces: () =>
    request<{ namespaces: Record<string, boolean>; missing: string[] }>('/schedules/validate-namespaces', { method: 'POST', body: '{}' }),
  validateNumUsers: () =>
    request<NumUsersValidationResponse>('/schedules/validate-num-users', { method: 'POST', body: '{}' }),
  validateCatalogNamespaces: () =>
    request<import('../types').CatalogNamespaceValidationResponse>('/schedules/validate-catalog-namespaces', { method: 'POST', body: '{}' }),
  validateClusterTenant: () =>
    request<any>('/schedules/validate-cluster-tenant', { method: 'POST', body: '{}' }),

  getClusterNeeds: () =>
    request<{
      needs: Array<{
        cluster_ci: string;
        tenant_ci_example: string;
        tenant_count: number;
        capacity_per_cluster: number;
        clusters_needed: number;
        clusters_in_csv: number;
        deficit: number;
        pool_available: number | null;
      }>;
      total_tenant_count: number;
      total_deficit: number;
    }>('/schedules/cluster-needs'),
  checkTenantClusterRefs: () =>
    request<{
      missing_refs: TenantClusterRef[];
      ref_no_pool: TenantClusterRef[];
      ready: TenantClusterRef[];
      total_tenant_count: number;
      checked: boolean;
    }>('/schedules/tenant-cluster-refs'),
  autoProvisionClusters: (bufferHours = 4.0) =>
    request<{
      added: Array<{ tenant_ci: string; cluster_ci: string; workshop_name: string }>;
      count: number;
      needs_agv_prs: Array<{ tenant_ci: string; cluster_ci: string; workshop_name: string }>;
      schedules: WorkshopSchedule[];
    }>(`/schedules/auto-provision-clusters?buffer_hours=${bufferHours}`, { method: 'POST' }),
  removeAutoProvisioned: () =>
    request<{ removed_count: number; schedules: WorkshopSchedule[] }>(
      '/schedules/remove-auto-provisioned', { method: 'POST' }),
  createTenantClusterPools: (body: {
    cluster_cis: string[];
    enabled?: boolean;
    min_clusters?: number;
    max_clusters?: number;
    max_placements?: number;
    environment_level?: string;
    cloud?: string;
    apply_to_cluster?: boolean;
  }) =>
    request<{
      yaml: string;
      applied: boolean;
      results: Array<{ name: string; success: boolean; output: string; error: string }>;
      count: number;
    }>('/schedules/create-tenant-cluster-pools', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  autoFixClusterTenantTiming: (bufferHours = 4.0) =>
    request<{
      fixed_count: number;
      skipped_count: number;
      fixed_items: any[];
      skipped_items: any[];
      warnings: string[];
      message: string
    }>(`/schedules/auto-fix-cluster-tenant?buffer_hours=${bufferHours}`, { method: 'POST' }),
  validatePoolCapacity: () =>
    request<PoolCapacityValidationResponse>('/schedules/validate-pool-capacity', { method: 'POST', body: '{}' }),
  diffSchedules: async (file: File): Promise<import('../types').DiffResponse> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/schedules/diff`, {
      method: 'POST',
      body: form,
      headers: getApiKeyHeader(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // Deploy
  deploy: (body: DeployRequest) =>
    request<JobResponse>('/deploy', { method: 'POST', body: JSON.stringify(body) }),
  dryRun: (body: DeployRequest) =>
    request<DeploymentResult[]>('/deploy/dry-run', { method: 'POST', body: JSON.stringify(body) }),

  /** POST dry-run with YAML export; triggers browser download of combined manifests. */
  downloadDryRunYaml: async (body: DeployRequest): Promise<void> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...getApiKeyHeader(),
    };
    const res = await fetch(`${API}/deploy/dry-run-yaml`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    const m = cd?.match(/filename="([^"]+)"/);
    const filename = m?.[1] ?? 'rhdp-dry-run-manifests.yaml';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  deployStatus: (jobId: string) => request<JobResponse>(`/deploy/status/${jobId}`),
  deployResults: () => cachedRequest<DeploymentResult[]>('/deploy/results'),
  deployStream: (jobId: string) => new EventSource(`${API}/deploy/stream/${jobId}`),
  deployWebSocket: (jobId: string) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(`${proto}//${location.host}${API}/deploy/ws/${jobId}`);
  },
  deployCancel: (jobId: string) =>
    request<{ message: string }>(`/deploy/cancel/${jobId}`, { method: 'POST', body: '{}' }),
  deployPause: (jobId: string) =>
    request<{ message: string }>(`/deploy/pause/${jobId}`, { method: 'POST', body: '{}' }),
  deployResume: (jobId: string) =>
    request<{ message: string }>(`/deploy/resume/${jobId}`, { method: 'POST', body: '{}' }),
  deployPreview: (body: DeployRequest) =>
    request<DeployPreviewResponse>('/deploy/preview', { method: 'POST', body: JSON.stringify(body) }),
  retry: (body: RetryRequest) =>
    request<JobResponse>('/deploy/retry', { method: 'POST', body: JSON.stringify(body) }),
  deleteResults: (items: Array<{ ci: string; namespace: string }>) =>
    request<{ deleted: number; remaining: number }>('/deploy/results/delete', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  // Operations
  lock: (body: LockRequest) =>
    request<OperationResponse>('/operations/lock', { method: 'POST', body: JSON.stringify(body) }),
  unlock: (body: LockRequest) =>
    request<OperationResponse>('/operations/unlock', { method: 'POST', body: JSON.stringify(body) }),
  extendStop: (body: ExtendRequest) =>
    request<OperationResponse>('/operations/extend-stop', { method: 'POST', body: JSON.stringify(body) }),
  extendDestroy: (body: ExtendRequest) =>
    request<OperationResponse>('/operations/extend-destroy', { method: 'POST', body: JSON.stringify(body) }),
  disableAutostop: (body: DisableAutostopRequest) =>
    request<OperationResponse>('/operations/disable-autostop', { method: 'POST', body: JSON.stringify(body) }),
  scale: (body: ScaleRequest) =>
    request<OperationResponse>('/operations/scale', { method: 'POST', body: JSON.stringify(body) }),
  showroomCleanup: (body: ShowroomCleanupRequest) =>
    request<OperationResponse>('/operations/showroom-cleanup', { method: 'POST', body: JSON.stringify(body) }),
  showroomHealth: (body: ShowroomHealthRequest) =>
    request<OperationResponse>('/operations/showroom-health', { method: 'POST', body: JSON.stringify(body) }),
  showroomPreflight: (body: { ci_filter?: string }) =>
    request<OperationResponse>('/operations/showroom-preflight', { method: 'POST', body: JSON.stringify(body) }),
  // QA
  qaNamespaces: () => cachedRequest<string[]>('/qa/namespaces'),
  runQA: (body: QARequest) =>
    request<QAResponse>('/qa/run', { method: 'POST', body: JSON.stringify(body) }),
  qaResults: () => cachedRequest<QAResponse>('/qa/results'),
  destroyCheck: (namespace?: string) =>
    request<import('../types').DestroyCheckResponse>('/qa/destroy-check', {
      method: 'POST',
      body: JSON.stringify({ namespace: namespace || undefined }),
    }),
  destroyCheckResults: () =>
    cachedRequest<{ count: number; results: import('../types').DestroyCheckResult[] }>('/qa/destroy-check/results'),

  // Templates
  templateURL: `${API}/templates/schedule`,

  // Export
  exportResultsURL: `${API}/export/results`,
  exportStudentsURL: `${API}/export/students`,

  // Logs
  logURL: (filename: string) => `${API}/logs/${filename}`,

  // Sessions
  getSessions: () => cachedRequest<SessionSummary[]>('/sessions'),
  getSession: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  clearSession: () =>
    request<{ message: string; session_count: number }>('/sessions/clear', { method: 'POST', body: '{}' }),

  // Schedule Management
  updateSchedules: (schedules: WorkshopSchedule[]) =>
    request<{ message: string }>('/schedules', { method: 'PUT', body: JSON.stringify(schedules) }),
  deleteSchedule: (index: number) =>
    request<{ message: string }>(`/schedules/${index}`, { method: 'DELETE' }),
  fillMissingDates: (dates: { provisioning_date: string; auto_stop: string; auto_destroy: string }) =>
    request<{ message: string; updated_count: number }>('/schedules/fill-missing-dates', { method: 'PATCH', body: JSON.stringify(dates) }),
};
