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
