/**
 * RHDP-Flow Demo Video Recorder (Enhanced)
 *
 * Records a comprehensive walkthrough of the RHDP-Flow web UI with:
 * - Visible animated cursor
 * - Text overlay banners describing each action
 * - Element highlighting (glow effect) before interactions
 * - Full feature coverage across all tabs
 *
 * Run:  node videos/record-demo.mjs
 * Prereqs: servers on localhost:5173 (frontend) and :8000 (API)
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEOS_DIR = __dirname;
const CSV_PATH = path.resolve(__dirname, '..', 'docs', 'examples', 'full_featured.csv');
const BASIC_CSV_PATH = path.resolve(__dirname, '..', 'docs', 'examples', 'basic_workshop.csv');
const BASE_URL = 'http://localhost:5173';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Overlay injection CSS & helpers ────────────────────────────────────────
const OVERLAY_CSS = `
  #demo-cursor {
    position: fixed;
    width: 24px;
    height: 24px;
    z-index: 999999;
    pointer-events: none;
    transition: left 0.5s cubic-bezier(.25,.1,.25,1), top 0.5s cubic-bezier(.25,.1,.25,1);
    /* SVG cursor arrow */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M5 3l14 8-6.5 1.5L11 19z' fill='%23111' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
  }
  #demo-cursor.clicking {
    transform: scale(0.85);
    transition: transform 0.1s;
  }
  #demo-banner {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 999998;
    background: linear-gradient(135deg, rgba(0,0,0,0.88) 0%, rgba(30,30,50,0.92) 100%);
    color: #fff;
    padding: 16px 32px;
    font-family: 'Red Hat Display', 'Segoe UI', system-ui, sans-serif;
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 0.3px;
    line-height: 1.4;
    backdrop-filter: blur(6px);
    border-top: 3px solid #EE0000;
    display: flex;
    align-items: center;
    gap: 16px;
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.4s, transform 0.4s;
  }
  #demo-banner.visible {
    opacity: 1;
    transform: translateY(0);
  }
  #demo-banner .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #EE0000;
    color: #fff;
    font-weight: 700;
    font-size: 15px;
    flex-shrink: 0;
  }
  #demo-banner .step-text {
    flex: 1;
  }
  #demo-banner .step-sub {
    font-size: 14px;
    opacity: 0.7;
    margin-top: 2px;
  }
  .demo-highlight {
    outline: 3px solid #EE0000 !important;
    outline-offset: 4px !important;
    box-shadow: 0 0 20px rgba(238,0,0,0.35) !important;
    border-radius: 4px !important;
    transition: outline 0.3s, box-shadow 0.3s !important;
  }
  #demo-section-title {
    position: fixed;
    top: 60px;
    right: 24px;
    z-index: 999997;
    background: rgba(238,0,0,0.9);
    color: #fff;
    padding: 8px 20px;
    border-radius: 6px;
    font-family: 'Red Hat Display', 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
  }
  #demo-section-title.visible {
    opacity: 1;
  }
`;

async function injectOverlays(page) {
  await page.evaluate((css) => {
    // CSS
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    // Cursor
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.style.left = '-50px';
    cursor.style.top = '-50px';
    document.body.appendChild(cursor);
    // Banner
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.innerHTML = '<span class="step-number"></span><div class="step-text"><div class="step-main"></div><div class="step-sub"></div></div>';
    document.body.appendChild(banner);
    // Section title
    const section = document.createElement('div');
    section.id = 'demo-section-title';
    document.body.appendChild(section);
  }, OVERLAY_CSS);
}

async function moveCursorTo(page, selector, options = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('demo-cursor');
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  }, { x, y });
  await wait(options.moveDuration || 600);
}

async function moveCursorToCoords(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('demo-cursor');
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  }, { x, y });
  await wait(500);
}

async function clickWithCursor(page, selector, options = {}) {
  await moveCursorTo(page, selector, options);
  // Click animation
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) c.classList.add('clicking');
  });
  await wait(150);
  await page.locator(selector).first().click();
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) c.classList.remove('clicking');
  });
  await wait(options.afterClick || 400);
}

async function highlight(page, selector, duration = 2000) {
  // Use Playwright locator to find the element, then add class via JS handle
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return;
  await loc.evaluate(el => el.classList.add('demo-highlight'));
  await wait(duration);
  await loc.evaluate(el => el.classList.remove('demo-highlight'));
}

async function showBanner(page, step, text, sub = '') {
  await page.evaluate(({ step, text, sub }) => {
    const b = document.getElementById('demo-banner');
    if (!b) return;
    b.querySelector('.step-number').textContent = step;
    b.querySelector('.step-main').textContent = text;
    b.querySelector('.step-sub').textContent = sub;
    b.classList.add('visible');
  }, { step: String(step), text, sub });
  await wait(300);
}

async function hideBanner(page) {
  await page.evaluate(() => {
    const b = document.getElementById('demo-banner');
    if (b) b.classList.remove('visible');
  });
  await wait(300);
}

async function showSection(page, text) {
  await page.evaluate((t) => {
    const s = document.getElementById('demo-section-title');
    if (s) { s.textContent = t; s.classList.add('visible'); }
  }, text);
}

async function hideSection(page) {
  await page.evaluate(() => {
    const s = document.getElementById('demo-section-title');
    if (s) s.classList.remove('visible');
  });
}

async function scrollSection(page, top) {
  await page.evaluate((t) => {
    const section = document.querySelector('.pf-v6-c-page__main-section.pf-m-fill');
    if (section) section.scrollTo({ top: t, behavior: 'smooth' });
  }, top);
  await wait(800);
}

// ─── Main recording ─────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: VIDEOS_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  let stepNum = 0;
  const step = (text, sub) => showBanner(page, ++stepNum, text, sub);

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 1: LANDING & OVERVIEW
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 1: Landing page');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await injectOverlays(page);
    await wait(1000);

    await showSection(page, 'Upload & Deploy');
    await step('RHDP-Flow — Workshop Automation', 'Red Hat Demo Platform scheduling, deployment, and QA in one web UI');
    await wait(3000);

    // Highlight key masthead elements
    await step('Masthead controls', 'Dry-run mode, health status, timezone indicator, theme toggle');
    await highlight(page, '.masthead-controls', 2500);
    await wait(500);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 2: CSV UPLOAD
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 2: CSV upload');
    await step('Upload a workshop schedule CSV', 'Supports basic, multi-asset, multi-region, and count expansion formats');

    // Highlight the file upload area
    await highlight(page, '#csv-file-upload', 1500);

    // Upload the file using the hidden input + clicking Upload
    await page.locator('input[type="file"]').first().setInputFiles(CSV_PATH);
    await wait(1500);

    await step('Click Upload to parse the CSV', 'Validates CI format, namespace, user counts, and duplicate rows');
    // Click the exact "Upload" button (first button with text "Upload")
    await page.locator('button').filter({ hasText: /^Upload$/ }).first().click();
    await wait(3000);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 3: SCHEDULE TABLE REVIEW
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 3: Schedule table review');
    await step('Workshop schedule table', '3 workshops parsed: Virt Roadshow, Ansible Lab, OpenShift AI');
    await highlight(page, '.pf-v6-c-table', 2500);

    // Expand a row to show details
    await step('Expand row to view details', 'Password, activity, salesforce IDs, concurrency, multi-asset info');
    // PF6 expand buttons have aria-label="Details"
    const expandSel = 'button:has-text("Details")';
    if (await page.locator(expandSel).first().count() > 0) {
      await clickWithCursor(page, expandSel, { afterClick: 2500 });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 4: DEPLOY SETTINGS
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 4: Deploy settings');

    // Scroll the Deploy Settings card into view
    const deployCard = page.locator('text=Deploy Settings').first();
    if (await deployCard.count() > 0) {
      await deployCard.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } else {
      await scrollSection(page, 9999);
    }
    await wait(1000);

    await step('Deploy settings', 'Configure Lock UI, Resource Pools, White Glove, and Redirect toggles');
    await wait(2000);

    // PF6 Switch: <label class="pf-v6-c-switch" for="id"> wraps the toggle
    // Use getByRole('switch') which Playwright resolves via role="switch" on the input
    const lockSwitch = page.getByRole('switch', { name: 'Lock UI Admin Settings' });
    const whiteGloveSwitch = page.getByRole('switch', { name: 'White Glove' });
    const redirectSwitch = page.getByRole('switch', { name: 'Redirect' });

    // PF6 Switch toggle intercepts pointer events — use { force: true } to click the input
    const lockBox = await lockSwitch.boundingBox();
    if (lockBox) {
      await moveCursorToCoords(page, lockBox.x + lockBox.width / 2, lockBox.y + lockBox.height / 2);
      await lockSwitch.click({ force: true });
      await step('Toggled "Lock UI Admin Settings" off', 'Controls demo.redhat.com/lock-enabled label on workshops');
      await wait(1500);
      await lockSwitch.click({ force: true });
      await wait(500);
    }

    const wgBox = await whiteGloveSwitch.boundingBox();
    if (wgBox) {
      await moveCursorToCoords(page, wgBox.x + wgBox.width / 2, wgBox.y + wgBox.height / 2);
      await whiteGloveSwitch.click({ force: true });
      await step('Toggled "White Glove" off', 'White Glove marks workshops as fully managed delivery');
      await wait(1500);
      await whiteGloveSwitch.click({ force: true });
      await wait(500);
    }

    const rdBox = await redirectSwitch.boundingBox();
    if (rdBox) {
      await moveCursorToCoords(page, rdBox.x + rdBox.width / 2, rdBox.y + rdBox.height / 2);
      await redirectSwitch.click({ force: true });
      await step('Toggled "Redirect" off', 'Students will not auto-redirect to the lab UI on login');
      await wait(1500);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 5: DRY-RUN DEPLOYMENT
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 5: Dry-run deployment');
    await step('Deploy workshops in dry-run mode', 'Generates JSON payloads without provisioning real resources');
    await clickWithCursor(page, 'button:has-text("Deploy (dry-run)")', { afterClick: 5000 });

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 6: DEPLOYMENTS TAB
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 6: Deployments tab');
    await hideSection(page);
    await step('Switch to Deployments tab', 'View deployment results, status, GUIDs, and URLs');
    await clickWithCursor(page, 'button[role="tab"]:has-text("Deployments")', { afterClick: 2000 });
    await showSection(page, 'Deployments');

    // Highlight summary cards
    await step('Status summary cards', 'Total, Verified, Unverified, and Failed counts at a glance');
    await wait(2500);

    // Highlight the search and filter toolbar
    await step('Search and filter deployments', 'Filter by status (All / Verified / Unverified / Failed), search by CI, GUID, namespace');
    await highlight(page, '.pf-v6-c-search-input', 1800);
    await wait(1000);

    // Show auto-refresh and download controls
    await step('Auto-refresh, CSV export, and row selection', 'Select rows to retry failed deployments; download results as CSV');
    await wait(2500);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 7: OPERATIONS TAB
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 7: Operations tab');
    await hideSection(page);
    await step('Switch to Operations tab', 'Lock, extend timelines, and scale workshops post-deployment');
    await clickWithCursor(page, 'button[role="tab"]:has-text("Operations")', { afterClick: 2000 });
    await showSection(page, 'Operations');

    // Resource Lock card
    await step('Resource Lock', 'Toggle demo.redhat.com/lock-enabled label on workshops');
    // Highlight the first operations card
    const opsCards = page.locator('.pf-v6-c-card');
    if (await opsCards.first().count() > 0) {
      await highlight(page, '.pf-v6-c-card:first-child', 2000);
    }
    await wait(500);

    // Extend Stop card
    await step('Extend Stop Time', 'Push back when workshops auto-stop — set days and hours');
    await wait(1500);

    // Extend Destroy card - scroll down
    await scrollSection(page, 300);
    await step('Extend Destroy Time', 'Push back permanent cleanup deadline for workshop resources');
    await wait(1500);

    // Scale card
    await step('Scale Workshops', 'Change the number of running seat instances per catalog item');
    await wait(1500);

    // CI filter dropdown
    await step('Per-CI target filtering', 'Each operation card has a Target dropdown to scope to a specific catalog item');
    await wait(2000);

    // Scroll down to Operations History
    await scrollSection(page, 800);
    await step('Operations History table', 'Structured log of all operations with time, target, values, and status');
    await wait(2500);
    await scrollSection(page, 0);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 8: QA TAB
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 8: QA tab');
    await hideSection(page);
    await step('Switch to QA tab', 'Verify workshop deployment health and collect student URLs');
    await clickWithCursor(page, 'button[role="tab"]:has-text("QA")', { afterClick: 2000 });
    await showSection(page, 'QA');

    // QA info alert
    await step('QA guidance', 'QA1 runs immediately after deploy; QA2 runs after provisioning (10-30 min)');
    await wait(2500);

    // QA type selector
    await step('QA type selector', 'Choose QA1 (Verify Setup), QA2 (Verify Deployment), or Both');
    // PF6 FormSelect renders as native <select>
    const qaSelect = 'select[aria-label="QA type"]';
    if (await page.locator(qaSelect).count() > 0) {
      await highlight(page, qaSelect, 1800);
    }
    await wait(1000);

    // QA explanation cards
    await step('QA1 & QA2 explained', 'QA1 checks config matches CSV; QA2 verifies health and collects landing page URLs');
    await wait(2500);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 9: STUDENTS TAB
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 9: Students tab');
    await hideSection(page);
    await step('Switch to Students tab', 'View and export student landing page URLs for distribution');
    await clickWithCursor(page, 'button[role="tab"]:has-text("Students")', { afterClick: 2000 });
    await showSection(page, 'Students');

    await step('Student Landing Pages', 'URLs with copy-to-clipboard and CSV download for easy sharing');
    await wait(2500);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 10: LIVE MODE WARNING
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 10: Live mode warning');
    await hideSection(page);
    await step('Disable dry-run for live deployments', 'A prominent danger banner warns when dry-run is off');
    const dryRunCheck = page.getByRole('checkbox', { name: 'Dry-Run Mode' });
    const drBox = await dryRunCheck.boundingBox();
    if (drBox) await moveCursorToCoords(page, drBox.x + drBox.width / 2, drBox.y + drBox.height / 2);
    await dryRunCheck.click();
    await wait(2000);

    // Try to highlight the danger alert
    const dangerAlert = page.locator('.pf-v6-c-alert.pf-m-danger');
    if (await dangerAlert.count() > 0) {
      await highlight(page, '.pf-v6-c-alert.pf-m-danger', 2500);
    } else {
      await wait(2000);
    }

    // Re-enable dry-run
    await step('Re-enable dry-run mode', 'Safety first — dry-run is the default to prevent accidental provisioning');
    await clickWithCursor(page, 'label:has-text("Dry-Run Mode")', { afterClick: 1500 });

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 11: DARK MODE & KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 11: Dark mode & shortcuts');
    await step('Dark mode', 'Toggle between light and dark themes');
    await clickWithCursor(page, 'button.theme-toggle', { afterClick: 2000 });

    await step('Keyboard shortcuts', 'Press ? to view shortcuts — 1-5 switch tabs instantly');
    await page.keyboard.press('Shift+/');
    await wait(3000);
    await page.keyboard.press('Escape');
    await wait(800);

    // Switch back to light mode
    await clickWithCursor(page, 'button.theme-toggle', { afterClick: 1000 });

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 12: DIFF VIEW (Back to Upload tab)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 12: Diff view');
    await hideSection(page);
    await step('Switch back to Upload tab', 'The Compare Schedules (Diff) feature lives below the deploy buttons');
    await clickWithCursor(page, 'button[role="tab"]:has-text("Upload")', { afterClick: 1500 });
    await showSection(page, 'Upload & Deploy');

    // Scroll down to the Diff section
    await scrollSection(page, 99999);
    await step('Compare Schedules (Diff View)', 'Upload a second CSV to see added, removed, and changed workshops');
    await highlight(page, '#diff-file-upload', 2500);

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 13: CLOSING
    // ═══════════════════════════════════════════════════════════════════════
    console.log('Section 13: Closing');
    await scrollSection(page, 0);
    await hideSection(page);
    await hideBanner(page);
    await wait(500);

    await showBanner(page, '', 'RHDP-Flow — Automate workshop scheduling, deployment, operations, and QA', 'Built with React, PatternFly 6, FastAPI, and OpenShift');
    // Remove step number for closing
    await page.evaluate(() => {
      const num = document.querySelector('#demo-banner .step-number');
      if (num) num.style.display = 'none';
    });
    await wait(4000);

    await hideBanner(page);
    await wait(1000);

    console.log('Recording complete.');
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Rename the generated video file
  const files = fs.readdirSync(VIDEOS_DIR).filter((f) => f.endsWith('.webm') && f !== 'rhdp-flow-demo.webm');
  if (files.length > 0) {
    files.sort((a, b) => {
      const sa = fs.statSync(path.join(VIDEOS_DIR, a)).mtimeMs;
      const sb = fs.statSync(path.join(VIDEOS_DIR, b)).mtimeMs;
      return sb - sa;
    });
    const src = path.join(VIDEOS_DIR, files[0]);
    const dest = path.join(VIDEOS_DIR, 'rhdp-flow-demo.webm');
    // Remove old webm if exists
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(src, dest);
    console.log(`WebM saved: ${dest}`);
  }

  // Clean up any extra .webm fragments
  const extras = fs.readdirSync(VIDEOS_DIR).filter(f => f.endsWith('.webm') && f !== 'rhdp-flow-demo.webm');
  extras.forEach(f => fs.unlinkSync(path.join(VIDEOS_DIR, f)));

  console.log('Done. Run ffmpeg to convert: ffmpeg -i videos/rhdp-flow-demo.webm -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart videos/rhdp-flow-demo.mp4');
})();
