import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, clearApiKey, setApiKey } from '../api';

function okJsonResponse(body: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('api multipart requests', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    clearApiKey();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends X-API-Key for CSV upload', async () => {
    setApiKey('secret-key');
    vi.mocked(fetch).mockResolvedValue(
      okJsonResponse({ count: 1, total_rows: 1, skipped_rows: 0, schedules: [] }),
    );

    await api.uploadCSV(new File(['a,b\n'], 'schedule.csv', { type: 'text/csv' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/schedules/upload',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      }),
    );
  });

  it('sends X-API-Key for password upload', async () => {
    setApiKey('secret-key');
    vi.mocked(fetch).mockResolvedValue(okJsonResponse({ count: 1, message: 'ok' }));

    await api.uploadPasswordsCSV(new File(['a,b\n'], 'passwords.csv', { type: 'text/csv' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/schedules/upload-passwords',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      }),
    );
  });

  it('sends X-API-Key for schedule diff upload', async () => {
    setApiKey('secret-key');
    vi.mocked(fetch).mockResolvedValue(
      okJsonResponse({ added: [], removed: [], changed: [], unchanged: 0 }),
    );

    await api.diffSchedules(new File(['a,b\n'], 'diff.csv', { type: 'text/csv' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/schedules/diff',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      }),
    );
  });
});

describe('API errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['validation', () => api.validateNamespaces()],
    ['dry-run', () => api.dryRun({ dry_run: true })],
    ['YAML download', () => api.downloadDryRunYaml({ dry_run: true })],
    ['CSV upload', () => api.uploadCSV(new File(['a,b'], 'test.csv'))],
  ])('explains backend unavailability for %s without exposing router HTML', async (_name, action) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<html><h1>Application is not available</h1></html>',
      { status: 503, headers: { 'Content-Type': 'text/html' } },
    )));
    await expect(action()).rejects.toThrow(
      'RHDP-Flow backend is unavailable (HTTP 503). Validation and dry-run both require the backend.',
    );
  });

  it('recognizes HTML even when the router omits its content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 502 })));
    await expect(api.validateNamespaces()).rejects.toThrow('backend is unavailable (HTTP 502)');
  });

  it('explains a successful HTML sign-in response instead of trying to parse JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Sign in</html>', {
      headers: { 'Content-Type': 'text/html' },
    })));
    await expect(api.validateNamespaces()).rejects.toThrow('Reload to check your sign-in session');
  });

  it('preserves the backend detail for a JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'Invalid or missing API key' }), { status: 403 },
    )));
    await expect(api.validateNamespaces()).rejects.toThrow('Invalid or missing API key');
  });
});
