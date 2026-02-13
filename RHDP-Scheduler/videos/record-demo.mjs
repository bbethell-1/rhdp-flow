/**
 * RHDP-Flow Demo Video Recorder
 *
 * Records a walkthrough of the full RHDP-Flow web UI using Playwright's
 * built-in video recording.  Run with:
 *   node videos/record-demo.mjs
 *
 * Prerequisites: servers running on localhost:5173 (frontend) and :8000 (API).
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEOS_DIR = __dirname;
const CSV_PATH = path.resolve(__dirname, '..', 'docs', 'examples', 'full_featured.csv');
const BASE_URL = 'http://localhost:5173';

// Timing helpers
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: VIDEOS_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  try {
    // ── 1. Landing page (Upload & Deploy tab, empty state) ──────────
    console.log('1/9  Opening RHDP-Flow…');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await wait(2500);

    // ── 2. Upload a CSV file ────────────────────────────────────────
    console.log('2/9  Uploading CSV…');
    // Target the CSV file upload input specifically (first one on page, id=csv-file-upload)
    const fileInput = page.locator('#csv-file-upload input[type="file"]').first();
    if (await fileInput.count() === 0) {
      // Fallback: PF6 FileUpload puts a hidden input inside
      await page.locator('input[type="file"]').first().setInputFiles(CSV_PATH);
    } else {
      await fileInput.setInputFiles(CSV_PATH);
    }
    await wait(1500);

    // Click the Upload button
    console.log('   Clicking Upload…');
    await page.locator('button:has-text("Upload")').first().click();
    await wait(3000);

    // ── 3. Scroll through schedule table ────────────────────────────
    console.log('3/9  Reviewing schedule table & deploy settings…');
    // Scroll down to see deploy settings cards
    await page.evaluate(() => {
      const section = document.querySelector('.pf-v6-c-page__main-section.pf-m-fill');
      if (section) section.scrollTop = section.scrollHeight;
    });
    await wait(3000);
    // Scroll back up
    await page.evaluate(() => {
      const section = document.querySelector('.pf-v6-c-page__main-section.pf-m-fill');
      if (section) section.scrollTop = 0;
    });
    await wait(1500);

    // ── 4. Deploy (dry-run) ─────────────────────────────────────────
    console.log('4/9  Running dry-run deployment…');
    const deployBtn = page.locator('button:has-text("Deploy (dry-run)")');
    if (await deployBtn.isVisible()) {
      await deployBtn.click();
      await wait(5000);
    }

    // ── 5. Deployments tab ──────────────────────────────────────────
    console.log('5/9  Switching to Deployments tab…');
    await page.locator('button[role="tab"]:has-text("Deployments")').click();
    await wait(3000);

    // ── 6. Operations tab ───────────────────────────────────────────
    console.log('6/9  Switching to Operations tab…');
    await page.locator('button[role="tab"]:has-text("Operations")').click();
    await wait(3000);
    // Scroll operations to show the full layout
    await page.evaluate(() => {
      const section = document.querySelector('.pf-v6-c-page__main-section.pf-m-fill');
      if (section) section.scrollTop = 400;
    });
    await wait(2000);
    await page.evaluate(() => {
      const section = document.querySelector('.pf-v6-c-page__main-section.pf-m-fill');
      if (section) section.scrollTop = 0;
    });
    await wait(1000);

    // ── 7. QA tab ───────────────────────────────────────────────────
    console.log('7/9  Switching to QA tab…');
    await page.locator('button[role="tab"]:has-text("QA")').click();
    await wait(3000);

    // ── 8. Students tab ─────────────────────────────────────────────
    console.log('8/9  Switching to Students tab…');
    await page.locator('button[role="tab"]:has-text("Students")').click();
    await wait(3000);

    // ── 9. Toggle dark mode and show keyboard shortcuts ─────────────
    console.log('9/9  Dark mode & keyboard shortcuts…');
    const darkBtn = page.locator('button.theme-toggle');
    if (await darkBtn.isVisible()) {
      await darkBtn.click();
      await wait(2000);
    }

    // Open keyboard shortcuts modal with "?"
    await page.keyboard.press('Shift+/');
    await wait(2500);

    // Close modal
    await page.keyboard.press('Escape');
    await wait(1000);

    // Toggle back to light mode
    if (await darkBtn.isVisible()) {
      await darkBtn.click();
      await wait(1500);
    }

    // Return to Upload tab for a clean ending
    await page.locator('button[role="tab"]:has-text("Upload")').click();
    await wait(2000);

    console.log('Recording complete.');
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Rename the generated video file
  const files = fs.readdirSync(VIDEOS_DIR).filter((f) => f.endsWith('.webm'));
  if (files.length > 0) {
    // Use the most recent .webm file
    files.sort((a, b) => {
      const sa = fs.statSync(path.join(VIDEOS_DIR, a)).mtimeMs;
      const sb = fs.statSync(path.join(VIDEOS_DIR, b)).mtimeMs;
      return sb - sa;
    });
    const src = path.join(VIDEOS_DIR, files[0]);
    const dest = path.join(VIDEOS_DIR, 'rhdp-flow-demo.webm');
    fs.renameSync(src, dest);
    console.log(`Video saved: ${dest}`);
  } else {
    console.log('No .webm files found — check VIDEOS_DIR for output.');
  }
})();
