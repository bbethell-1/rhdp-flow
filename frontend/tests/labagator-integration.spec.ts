import { test, expect } from '@playwright/test';

const EVENTS_RESPONSE = {
  events: [
    { id: 1, name: 'Virt Roadshow', start_date: '2026-08-27', end_date: '2026-08-29', location: 'Room 1' },
  ],
  error: null,
};

const PREVIEW_RESPONSE = {
  event_name: 'Virt Roadshow',
  session_count: 2,
  csv_text:
    'Workshop Name,CI,Namespace,Users,Enable_workshop_interface,Provisioning Date (UTC),Auto_stop (UTC),Auto_destroy (UTC)\n' +
    'Virt Roadshow,babylon-catalog-prod.test-ci.prod,demo-ns,25,True,27/08/2026 09:00,27/08/2026 17:00,28/08/2026 09:00\n' +
    'Virt Roadshow,babylon-catalog-prod.test-ci.prod,demo-ns,25,True,27/08/2026 09:00,27/08/2026 17:00,28/08/2026 09:00\n',
};

const IMPORT_RESPONSE = {
  count: 2,
  total_rows: 2,
  skipped_rows: 0,
  schedules: [
    { ci_name: 'Virt Roadshow', ci: 'babylon-catalog-prod.test-ci.prod', namespace: 'demo-ns' },
    { ci_name: 'Virt Roadshow', ci: 'babylon-catalog-prod.test-ci.prod', namespace: 'demo-ns' },
  ],
};

test.describe('Direct Labagator import', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass the API-key gate: unattended local/CI runs have no key configured.
    await page.addInitScript(() => sessionStorage.setItem('rhdp-api-key', 'test-key'));
    await page.route('**/api/labagator/events', (route) =>
      route.fulfill({ json: EVENTS_RESPONSE }));
    await page.goto('/');
  });

  test('populates event dropdown and imports on confirm', async ({ page }) => {
    await page.route('**/api/schedules/labagator-preview*', (route) =>
      route.fulfill({ json: PREVIEW_RESPONSE }));
    await page.route('**/api/schedules/import-from-labagator', (route) =>
      route.fulfill({ json: IMPORT_RESPONSE }));

    await expect(page.getByRole('combobox', { name: 'Labagator event' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Labagator event' }).selectOption('1');
    await page.locator('#labagator-namespace').fill('demo-ns');
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByText('Confirm Labagator Import')).toBeVisible();
    await expect(page.getByText(/Import.*2.*session/)).toBeVisible();

    // Verify event name and namespace appear in modal body
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/Virt Roadshow/)).toBeVisible();
    await expect(modal.getByText(/demo-ns/)).toBeVisible();

    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText(/Imported 2 session/)).toBeVisible();
  });

  test('cancel leaves schedule table unchanged', async ({ page }) => {
    await page.route('**/api/schedules/labagator-preview*', (route) =>
      route.fulfill({ json: PREVIEW_RESPONSE }));

    await page.getByRole('combobox', { name: 'Labagator event' }).selectOption('1');
    await page.locator('#labagator-namespace').fill('demo-ns');
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByText('Confirm Labagator Import')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Confirm Labagator Import')).not.toBeVisible();
    await expect(page.getByText(/Imported/)).not.toBeVisible();
  });

  test('shows unavailable message when Labagator events call errors', async ({ page }) => {
    await page.route('**/api/labagator/events', (route) =>
      route.fulfill({ json: { events: [], error: 'labagator_unreachable' } }));
    await page.reload();

    await expect(page.getByText('Labagator is unavailable — use manual CSV export instead')).toBeVisible();
  });
});

test.describe('Manual CSV upload fallback', () => {
  test('still works independently of Labagator', async ({ page }) => {
    // Bypass the API-key gate: unattended local/CI runs have no key configured.
    await page.addInitScript(() => sessionStorage.setItem('rhdp-api-key', 'test-key'));
    await page.route('**/api/labagator/events', (route) =>
      route.fulfill({ json: { events: [], error: null } }));
    await page.goto('/');

    // Verify manual CSV upload card is always visible
    await expect(page.getByText('Upload Flow CSV')).toBeVisible();
    await expect(page.getByText('Import from Labagator')).toBeVisible();

    // Upload a CSV via API and verify it appears in the schedule table
    const csvContent =
      'CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)\n' +
      'Basic Workshop,babylon-catalog-prod.test-ci.prod,demo-ns,10,True,test123,Admin,QA,01/01/2027 10:00,01/01/2027 18:00,02/01/2027 10:00\n';
    const uploadResult = await page.evaluate(async (csv) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const fd = new FormData();
      fd.append('file', blob, 'basic.csv');
      const response = await fetch('/api/schedules/upload', { method: 'POST', body: fd });
      const data = await response.json();
      return { status: response.status, data };
    }, csvContent);

    // Verify upload succeeded
    expect(uploadResult.status).toBe(200);
    expect(uploadResult.data.count).toBe(1);

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByText('Basic Workshop')).toBeVisible();
  });
});
