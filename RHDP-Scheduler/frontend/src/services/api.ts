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
  ShowroomAppSetRequest,
  QARequest,
  QAResponse,
  RetryRequest,
  NumUsersValidationResponse,
  SessionSummary,
  SessionDetail,
} from '../types';

const API = '/api';

function getApiKey(): string | null {
  // Use sessionStorage — cleared on tab close, not vulnerable to persistent XSS
  return sessionStorage.getItem('rhdp-api-key');
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
  const apiKey = getApiKey();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
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

  // Schedules
  uploadCSV: async (file: File): Promise<UploadResponse> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/schedules/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  uploadPasswordsCSV: async (file: File): Promise<{count: number; message: string}> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/schedules/upload-passwords`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  getSchedules: () => cachedRequest<WorkshopSchedule[]>('/schedules'),
  validateNamespaces: () =>
    request<{ namespaces: Record<string, boolean>; missing: string[] }>('/schedules/validate-namespaces', { method: 'POST', body: '{}' }),
  validateNumUsers: () =>
    request<NumUsersValidationResponse>('/schedules/validate-num-users', { method: 'POST', body: '{}' }),
  diffSchedules: async (file: File): Promise<import('../types').DiffResponse> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/schedules/diff`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // Deploy
  deploy: (body: DeployRequest) =>
    request<JobResponse>('/deploy', { method: 'POST', body: JSON.stringify(body) }),
  dryRun: (body: DeployRequest) =>
    request<DeploymentResult[]>('/deploy/dry-run', { method: 'POST', body: JSON.stringify(body) }),
  deployStatus: (jobId: string) => request<JobResponse>(`/deploy/status/${jobId}`),
  deployResults: () => cachedRequest<DeploymentResult[]>('/deploy/results'),
  deployStream: (jobId: string) => new EventSource(`${API}/deploy/stream/${jobId}`),
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
  showroomAppSet: (body: ShowroomAppSetRequest) =>
    request<OperationResponse>('/operations/showroom-applicationset', { method: 'POST', body: JSON.stringify(body) }),

  // QA
  runQA: (body: QARequest) =>
    request<QAResponse>('/qa/run', { method: 'POST', body: JSON.stringify(body) }),
  qaResults: () => cachedRequest<QAResponse>('/qa/results'),
  destroyCheck: () =>
    request<import('../types').DestroyCheckResponse>('/qa/destroy-check', { method: 'POST', body: '{}' }),
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
};
