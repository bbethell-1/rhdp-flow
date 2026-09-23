import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { clearApiCache } from '../services/api';
import { mockSchedule } from './mocks/api';

// Mock the fetch API for health check
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    status: 'ok',
    oc_installed: true,
    oc_connected: false,
    cluster_url: '',
    user: '',
    message: '',
    base_domain: '',
    rhdp_api_reachable: false,
  }),
  text: () => Promise.resolve(''),
}) as unknown as typeof fetch;

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByText('RHDP')).toBeInTheDocument();
  });

  it('shows the Upload & Deploy tab by default', () => {
    render(<App />);
    expect(screen.getByText('Upload & Deploy')).toBeInTheDocument();
  });

  it('shows dry-run checkbox', () => {
    render(<App />);
    expect(screen.getByLabelText('Dry-Run Mode')).toBeInTheDocument();
  });
});

describe('App session hydration', () => {
  const okJson = (body: unknown) => ({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  });

  // App mounts several sibling widgets (session history, health, examples).
  // Give each the shape it expects so a crash there can't mask what we're testing.
  const routeFetch = (schedules: unknown[]) => (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/schedules')) return Promise.resolve(okJson(schedules));
    if (url.endsWith('/api/qa/results')) return Promise.resolve(okJson({ results: [] }));
    if (url.endsWith('/api/labagator/events')) return Promise.resolve(okJson({ events: [] }));
    if (url.includes('/api/health')) return Promise.resolve(okJson({ status: 'ok' }));
    return Promise.resolve(okJson([]));
  };

  // api.ts memoises GETs for 5s, so the earlier block's responses would otherwise
  // still be served here.
  beforeEach(() => clearApiCache());

  afterEach(() => {
    clearApiCache();
    vi.restoreAllMocks();
  });

  it('loads the current server-side session on mount', async () => {
    // The backend keeps the last-uploaded schedules, so a refresh — or an upload
    // made via the API rather than the file picker — must repopulate the table.
    globalThis.fetch = vi.fn(routeFetch([mockSchedule])) as unknown as typeof fetch;

    render(<App />);

    // UploadTab is lazy-loaded, so allow for the dynamic import as well as the fetch.
    await waitFor(
      () => expect(screen.getByDisplayValue('Test Workshop')).toBeInTheDocument(),
      { timeout: 5000 }
    );
  });

  it('stays empty when the server has no schedules', async () => {
    globalThis.fetch = vi.fn(routeFetch([])) as unknown as typeof fetch;

    render(<App />);

    await waitFor(
      () => expect(screen.getByText('No schedules loaded')).toBeInTheDocument(),
      { timeout: 5000 }
    );
  });
});
