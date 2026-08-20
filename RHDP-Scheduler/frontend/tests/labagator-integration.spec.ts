import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Labagator Integration', () => {
  const LABAGATOR_CSV = path.join(__dirname, '../../docs/examples/labagator_sample.csv');

  test('import Labagator CSV and verify transformation', async ({ page }) => {
    await page.goto('http://localhost:6500');
    await page.waitForLoadState('networkidle');

    // Step 1: Switch to Labagator import mode
    await page.getByRole('button', { name: 'Labagator Sessions' }).click();
    await expect(page.getByText('Labagator import mode')).toBeVisible();

    // Step 2: Upload Labagator CSV via API
    const csvContent = fs.readFileSync(LABAGATOR_CSV, 'utf8');
    const uploadResponse = await page.evaluate(async (csv) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const fd = new FormData();
      fd.append('file', blob, 'labagator_sample.csv');
      const response = await fetch('/api/schedules/import-labagator', { method: 'POST', body: fd });
      const data = await response.json();
      return { status: response.status, data };
    }, csvContent);

    // Step 3: Verify upload succeeded and transformation is correct
    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.data.count).toBe(2);
    expect(uploadResponse.data.total_rows).toBe(2);
    expect(uploadResponse.data.skipped_rows).toBe(0);

    // Verify schedules are correctly transformed
    const schedules = uploadResponse.data.schedules;
    expect(schedules).toHaveLength(2);

    // Check first schedule (LAB-001)
    const lab001 = schedules.find((s: any) => s.ci_name === 'LAB-001 - Getting Started with OpenShift');
    expect(lab001).toBeDefined();
    expect(lab001.namespace).toContain('labagator-lab-001');
    expect(lab001.users).toBe(25); // Default from transformation
    expect(lab001.enable_workshop_interface).toBe(true);

    // Check second schedule (LAB-002)
    const lab002 = schedules.find((s: any) => s.ci_name === 'LAB-002 - Advanced Ansible Automation');
    expect(lab002).toBeDefined();
    expect(lab002.namespace).toContain('labagator-lab-002');

    // Step 4: Verify backend state persistence
    const backendSchedules = await page.evaluate(async () => {
      const res = await fetch('/api/schedules');
      return res.json();
    });
    expect(backendSchedules).toHaveLength(2);

    // Step 5: Test export endpoint
    const exportResponse = await page.evaluate(async () => {
      const res = await fetch('/api/schedules/export-for-labagator');
      const text = await res.text();
      return { status: res.status, csv: text };
    });

    if (exportResponse.status !== 200) {
      console.log('Export error:', exportResponse.csv);
    }
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.csv).toContain('session_code,title,room');
    expect(exportResponse.csv).toContain('LAB-001');
    expect(exportResponse.csv).toContain('LAB-002');
    expect(exportResponse.csv).toContain('Getting Started with OpenShift');
    expect(exportResponse.csv).toContain('Advanced Ansible Automation');
  });
});
