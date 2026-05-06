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
  SessionSummary,
  SessionDetail,
  ScheduleExampleMeta,
  CatalogItemEntry,
  DeployPreviewResponse,
} from '../types';

const API = '/api';

function getApiKey(): string | null {
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
};
