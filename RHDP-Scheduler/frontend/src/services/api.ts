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
  QARequest,
  QAResponse,
  SessionSummary,
  SessionDetail,
} from '../types';

const API = '/api';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers as Record<string, string> },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => request<HealthResponse>('/health'),

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
  getSchedules: () => request<WorkshopSchedule[]>('/schedules'),
  validateNamespaces: () =>
    request<{ namespaces: Record<string, boolean>; missing: string[] }>('/schedules/validate-namespaces', { method: 'POST', body: '{}' }),

  // Deploy
  deploy: (body: DeployRequest) =>
    request<JobResponse>('/deploy', { method: 'POST', body: JSON.stringify(body) }),
  dryRun: (body: DeployRequest) =>
    request<DeploymentResult[]>('/deploy/dry-run', { method: 'POST', body: JSON.stringify(body) }),
  deployStatus: (jobId: string) => request<JobResponse>(`/deploy/status/${jobId}`),
  deployResults: () => request<DeploymentResult[]>('/deploy/results'),
  deployStream: (jobId: string) => new EventSource(`${API}/deploy/stream/${jobId}`),

  // Operations
  lock: (body: LockRequest) =>
    request<OperationResponse>('/operations/lock', { method: 'POST', body: JSON.stringify(body) }),
  unlock: (body: LockRequest) =>
    request<OperationResponse>('/operations/unlock', { method: 'POST', body: JSON.stringify(body) }),
  extendStop: (body: ExtendRequest) =>
    request<OperationResponse>('/operations/extend-stop', { method: 'POST', body: JSON.stringify(body) }),
  extendDestroy: (body: ExtendRequest) =>
    request<OperationResponse>('/operations/extend-destroy', { method: 'POST', body: JSON.stringify(body) }),
  scale: (body: ScaleRequest) =>
    request<OperationResponse>('/operations/scale', { method: 'POST', body: JSON.stringify(body) }),

  // QA
  runQA: (body: QARequest) =>
    request<QAResponse>('/qa/run', { method: 'POST', body: JSON.stringify(body) }),
  qaResults: () => request<QAResponse>('/qa/results'),

  // Export
  exportResultsURL: `${API}/export/results`,
  exportStudentsURL: `${API}/export/students`,

  // Sessions
  getSessions: () => request<SessionSummary[]>('/sessions'),
  getSession: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  clearSession: () =>
    request<{ message: string; session_count: number }>('/sessions/clear', { method: 'POST', body: '{}' }),
};
