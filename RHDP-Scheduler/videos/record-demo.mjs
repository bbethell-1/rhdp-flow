/**
 * RHDP-Flow Demo Video Recorder — Split into 7 chapter videos.
 *
 * Each chapter records to its own WebM file with:
 * - Enlarged viewport (1920×1120) to fix masthead clipping
 * - Inline callout boxes positioned near relevant elements
 * - Animated cursor + red highlight outlines
 * - 2-3 second title card at the start
 *
 * Run:  node videos/record-demo.mjs
 * Prereqs: servers on localhost:5173 (frontend) and :8000 (API)
 *
 * After recording, convert to MP4:
 *   for f in videos/0*.webm; do
 *     ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 \
 *       -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
 *   done
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import {
  VIDEOS_DIR, CSV_PATH, BASE_URL, VIEWPORT, wait,
  injectOverlays, moveCursorTo, moveCursorToCoords, clickWithCursor,
  highlight, showCallout, hideCallout, showSection, hideSection,
  showTitleCard, hideTitleCard, scrollSection, uploadCSV,
  renameLatestWebm, cleanupStrayWebm,
} from './recording-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Chapter runner ─────────────────────────────────────────────────────────

/**
 * Run a single chapter: create a browser context with video recording,
 * navigate to the app, inject overlays, show the title card, execute the
 * chapter function, then close and rename the output file.
 */
async function recordChapter(browser, chapterName, titleText, titleSub, chapterFn) {
  console.log(`\n▶ Recording: ${chapterName}`);

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEOS_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();
  let stepNum = 0;

  // Helper: show a callout near an element with auto-incrementing step number
  const step = (text, sub, nearSelector, opts) =>
    showCallout(page, ++stepNum, text, sub, nearSelector, opts);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await injectOverlays(page);
    await wait(300);

    // Title card
    await showTitleCard(page, titleText, titleSub);
    await hideTitleCard(page);
    await wait(400);

    // Execute chapter-specific actions
    await chapterFn(page, step, stepNum);

    // Fade out overlays
    await hideCallout(page);
    await hideSection(page);
    await wait(800);
  } finally {
    await page.close();
    await context.close();
  }

  // Rename the generated .webm to the chapter name
  renameLatestWebm(chapterName);
}

// ─── Chapter definitions ────────────────────────────────────────────────────

async function chapter01_uploadAndSchedule(page, step) {
  await showSection(page, 'Upload & Deploy');

  // 1. Landing overview
  await step(
    'RHDP-Flow — Workshop Automation',
    'Red Hat Demo Platform scheduling, deployment, and QA in one web UI',
    null
  );
  await wait(2500);
  await hideCallout(page);

  // 2. Highlight masthead controls
  await step(
    'Masthead controls',
    'Dry-run toggle, cluster health, timezone, theme',
    '.masthead-controls',
    { position: 'below' }
  );
  await highlight(page, '.masthead-controls', 2500);
  await hideCallout(page);

  // 3. Highlight file upload area
  await step(
    'Upload a workshop CSV',
    'Supports basic, multi-asset, multi-region, and count expansion formats',
    '#csv-file-upload',
    { position: 'right' }
  );
  await highlight(page, '#csv-file-upload', 1500);
  await hideCallout(page);

  // 4. Upload the file using the hidden input + clicking Upload
  await page.locator('input[type="file"]').first().setInputFiles(CSV_PATH);
  await wait(1000);

  await step(
    'Click Upload to parse CSV',
    'Validates CI format, namespace, user counts, and duplicates',
    'button:has-text("Upload")',
    { position: 'right' }
  );
  const uploadBtn = page.locator('button').filter({ hasText: /^Upload$/ }).first();
  await clickWithCursor(page, 'button:has-text("Upload")', { afterClick: 2500 });
  await hideCallout(page);

  // 5. Schedule table
  await step(
    'Workshop schedule table',
    '3 workshops parsed: Virt Roadshow, Ansible Lab, OpenShift AI',
    '.pf-v6-c-table',
    { position: 'above' }
  );
  await highlight(page, '.pf-v6-c-table', 2500);
  await hideCallout(page);

  // 6. Expand a row
  const expandSel = 'button:has-text("Details")';
  if (await page.locator(expandSel).first().count() > 0) {
    await step(
      'Expand row for details',
      'Password, activity, Salesforce IDs, concurrency, multi-asset info',
      expandSel,
      { position: 'right' }
    );
    await clickWithCursor(page, expandSel, { afterClick: 2500 });
  }
  await hideCallout(page);
  await wait(500);
}

async function chapter02_deploySettings(page, step) {
  // Pre-load CSV via API so the table is populated
  await uploadCSV(page, CSV_PATH);
  await showSection(page, 'Deploy Settings');

  // Scroll deploy settings into view
  const deployCard = page.locator('text=Deploy Settings').first();
  if (await deployCard.count() > 0) {
    await deployCard.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else {
    await scrollSection(page, 9999);
  }
  await wait(1000);

  // 1. Overview
  await step(
    'Deploy settings',
    'Configure Lock UI, Resource Pools, White Glove, and Redirect toggles',
    'text=Deploy Settings',
    { position: 'right' }
  );
  await wait(2000);
  await hideCallout(page);

  // 2. Toggle Lock UI
  const lockSwitch = page.getByRole('switch', { name: 'Lock UI Admin Settings' });
  const lockBox = await lockSwitch.boundingBox();
  if (lockBox) {
    await moveCursorToCoords(page, lockBox.x + lockBox.width / 2, lockBox.y + lockBox.height / 2);
    await lockSwitch.click({ force: true });
    await step(
      'Lock UI Admin Settings',
      'Controls demo.redhat.com/lock-enabled label on workshops',
      'label:has-text("Lock UI")',
      { position: 'right' }
    );
    await wait(1500);
    await lockSwitch.click({ force: true });
    await hideCallout(page);
    await wait(500);
  }

  // 3. Toggle White Glove
  const whiteGloveSwitch = page.getByRole('switch', { name: 'White Glove' });
  const wgBox = await whiteGloveSwitch.boundingBox();
  if (wgBox) {
    await moveCursorToCoords(page, wgBox.x + wgBox.width / 2, wgBox.y + wgBox.height / 2);
    await whiteGloveSwitch.click({ force: true });
    await step(
      'White Glove toggle',
      'Marks workshops as fully managed delivery',
      'label:has-text("White Glove")',
      { position: 'right' }
    );
    await wait(1500);
    await whiteGloveSwitch.click({ force: true });
    await hideCallout(page);
    await wait(500);
  }

  // 4. Toggle Redirect
  const redirectSwitch = page.getByRole('switch', { name: 'Redirect' });
  const rdBox = await redirectSwitch.boundingBox();
  if (rdBox) {
    await moveCursorToCoords(page, rdBox.x + rdBox.width / 2, rdBox.y + rdBox.height / 2);
    await redirectSwitch.click({ force: true });
    await step(
      'Redirect toggle',
      'Students auto-redirect to lab UI on login',
      'label:has-text("Redirect")',
      { position: 'right' }
    );
    await wait(1500);
    await hideCallout(page);
  }

  // 5. Dry-run deployment
  await step(
    'Deploy in dry-run mode',
    'Generates JSON payloads without provisioning real resources',
    'button:has-text("Deploy (dry-run)")',
    { position: 'above' }
  );
  await clickWithCursor(page, 'button:has-text("Deploy (dry-run)")', { afterClick: 3000 });
  await hideCallout(page);
  await wait(500);
}

async function chapter03_deploymentsTab(page, step) {
  // Pre-load CSV and trigger dry-run deploy so there are results
  await uploadCSV(page, CSV_PATH);
  // Deploy dry-run via button
  const deployBtn = page.locator('button:has-text("Deploy (dry-run)")');
  if (await deployBtn.count() > 0) {
    await deployBtn.first().click();
    await wait(3000);
  }

  // Switch to Deployments tab
  await clickWithCursor(page, 'button[role="tab"]:has-text("Deployments")', { afterClick: 2000 });
  await showSection(page, 'Deployments');

  // 1. Results overview
  await step(
    'Deployment results',
    'View GUIDs, status, URLs, and timestamps for every provisioned workshop',
    '.pf-v6-c-table',
    { position: 'above' }
  );
  await wait(2500);
  await hideCallout(page);

  // 2. Status summary cards
  await step(
    'Status summary cards',
    'Total, Verified, Unverified, and Failed counts at a glance',
    '.pf-v6-c-card',
    { position: 'below' }
  );
  await wait(2500);
  await hideCallout(page);

  // 3. Search and filter
  await step(
    'Search and filter',
    'Filter by status, search by CI, GUID, or namespace',
    '.pf-v6-c-search-input',
    { position: 'below' }
  );
  await highlight(page, '.pf-v6-c-search-input', 1800);
  await hideCallout(page);

  // 4. Auto-refresh and export
  await step(
    'Auto-refresh & CSV export',
    'Select rows to retry failures; download results as CSV',
    null
  );
  await wait(2500);
  await hideCallout(page);
  await wait(500);
}

async function chapter04_operationsTab(page, step) {
  // Pre-load CSV and deploy so ops tab has targets
  await uploadCSV(page, CSV_PATH);
  const deployBtn = page.locator('button:has-text("Deploy (dry-run)")');
  if (await deployBtn.count() > 0) {
    await deployBtn.first().click();
    await wait(3000);
  }

  // Switch to Operations tab
  await clickWithCursor(page, 'button[role="tab"]:has-text("Operations")', { afterClick: 2000 });
  await showSection(page, 'Operations');

  // 1. Resource Lock
  await step(
    'Resource Lock',
    'Toggle demo.redhat.com/lock-enabled label on workshops',
    '.pf-v6-c-card',
    { position: 'right' }
  );
  const opsCards = page.locator('.pf-v6-c-card');
  if (await opsCards.first().count() > 0) {
    await highlight(page, '.pf-v6-c-card:first-child', 2000);
  }
  await hideCallout(page);

  // 2. Extend Stop
  await step(
    'Extend Stop Time',
    'Push back when workshops auto-stop — set days and hours',
    null
  );
  await wait(1500);
  await hideCallout(page);

  // 3. Extend Destroy & Scale
  await scrollSection(page, 300);
  await step(
    'Extend Destroy & Scale',
    'Push back cleanup deadline; change seat instance counts',
    null
  );
  await wait(2000);
  await hideCallout(page);

  // 4. Per-CI target filter
  await step(
    'Per-CI target filtering',
    'Each card has a Target dropdown to scope to a specific catalog item',
    null
  );
  await wait(2000);
  await hideCallout(page);

  // 5. Operations History
  await scrollSection(page, 800);
  await step(
    'Operations History',
    'Structured log of all operations with time, target, values, and status',
    null
  );
  await wait(2500);
  await hideCallout(page);
  await scrollSection(page, 0);
  await wait(500);
}

async function chapter05_qaAndStudents(page, step) {
  // Pre-load CSV and deploy
  await uploadCSV(page, CSV_PATH);
  const deployBtn = page.locator('button:has-text("Deploy (dry-run)")');
  if (await deployBtn.count() > 0) {
    await deployBtn.first().click();
    await wait(3000);
  }

  // === QA Tab ===
  await clickWithCursor(page, 'button[role="tab"]:has-text("QA")', { afterClick: 2000 });
  await showSection(page, 'QA');

  // 1. QA guidance
  await step(
    'QA guidance',
    'QA1 runs immediately after deploy; QA2 runs after provisioning (10-30 min)',
    null
  );
  await wait(2500);
  await hideCallout(page);

  // 2. QA type selector
  const qaSelect = 'select[aria-label="QA type"]';
  if (await page.locator(qaSelect).count() > 0) {
    await step(
      'QA type selector',
      'Choose QA1 (Verify Setup), QA2 (Verify Deployment), or Both',
      qaSelect,
      { position: 'right' }
    );
    await highlight(page, qaSelect, 1800);
    await hideCallout(page);
  }

  // 3. QA1 & QA2 explained
  await step(
    'QA1 & QA2 explained',
    'QA1 checks config matches CSV; QA2 verifies health and collects URLs',
    null
  );
  await wait(2500);
  await hideCallout(page);

  // === Students Tab ===
  await hideSection(page);
  await clickWithCursor(page, 'button[role="tab"]:has-text("Students")', { afterClick: 2000 });
  await showSection(page, 'Students');

  // 4. Student landing pages
  await step(
    'Student Landing Pages',
    'URLs with copy-to-clipboard and CSV download for easy sharing',
    null
  );
  await wait(2500);
  await hideCallout(page);
  await wait(500);
}

async function chapter06_extras(page, step) {
  // Pre-load CSV so Upload tab has content
  await uploadCSV(page, CSV_PATH);

  // === Live mode warning ===
  await showSection(page, 'Extras');

  // 1. Disable dry-run
  await step(
    'Disable dry-run for live mode',
    'A prominent danger banner warns when dry-run is off',
    'label:has-text("Dry-Run Mode")',
    { position: 'below' }
  );
  const dryRunCheck = page.getByRole('checkbox', { name: 'Dry-Run Mode' });
  const drBox = await dryRunCheck.boundingBox();
  if (drBox) await moveCursorToCoords(page, drBox.x + drBox.width / 2, drBox.y + drBox.height / 2);
  await dryRunCheck.click();
  await wait(2000);
  await hideCallout(page);

  // Highlight danger alert
  const dangerAlert = page.locator('.pf-v6-c-alert.pf-m-danger');
  if (await dangerAlert.count() > 0) {
    await highlight(page, '.pf-v6-c-alert.pf-m-danger', 2500);
  } else {
    await wait(2000);
  }

  // 2. Re-enable dry-run
  await step(
    'Re-enable dry-run',
    'Safety first — dry-run prevents accidental provisioning',
    'label:has-text("Dry-Run Mode")',
    { position: 'below' }
  );
  await clickWithCursor(page, 'label:has-text("Dry-Run Mode")', { afterClick: 1500 });
  await hideCallout(page);

  // === Dark mode ===
  await step(
    'Dark mode',
    'Toggle between light and dark themes',
    'button.theme-toggle',
    { position: 'below' }
  );
  await clickWithCursor(page, 'button.theme-toggle', { afterClick: 2000 });
  await hideCallout(page);

  // === Keyboard shortcuts ===
  await step(
    'Keyboard shortcuts',
    'Press ? to view shortcuts — 1-5 switch tabs instantly',
    null
  );
  await page.keyboard.press('Shift+/');
  await wait(3000);
  await page.keyboard.press('Escape');
  await wait(800);
  await hideCallout(page);

  // Switch back to light mode
  await clickWithCursor(page, 'button.theme-toggle', { afterClick: 1000 });

  // === Diff view ===
  await hideSection(page);
  await clickWithCursor(page, 'button[role="tab"]:has-text("Upload")', { afterClick: 1500 });
  await showSection(page, 'Compare Schedules');

  await scrollSection(page, 99999);
  await step(
    'Compare Schedules (Diff View)',
    'Upload a second CSV to see added, removed, and changed workshops',
    '#diff-file-upload',
    { position: 'above' }
  );
  await highlight(page, '#diff-file-upload', 2500);
  await hideCallout(page);

  // Closing
  await scrollSection(page, 0);
  await hideSection(page);
  await wait(500);

  await showCallout(page, '', 'RHDP-Flow', 'Automate workshop scheduling, deployment, operations, and QA');
  await wait(3000);
  await hideCallout(page);
  await wait(500);
}

async function chapter07_labagatorIntegration(page, step) {
  // Start on Upload tab (fresh state)
  await showSection(page, 'Labagator');

  // 1. Landing overview
  await step(
    'Labagator Integration',
    'Import event sessions from Labagator planner, deploy as Flow workshops',
    null
  );
  await wait(2500);
  await hideCallout(page);

  // 2. Toggle to Labagator mode
  const labagatorBtn = page.locator('button:has-text("Labagator Sessions")');
  if (await labagatorBtn.count() > 0) {
    await step(
      'Switch to Labagator mode',
      'Import sessions from Labagator event CSV format',
      'button:has-text("Labagator Sessions")',
      { position: 'below' }
    );
    await clickWithCursor(page, 'button:has-text("Labagator Sessions")', { afterClick: 1200 });
    await hideCallout(page);
  }

  // 3. Info alert explaining format
  const infoAlert = page.locator('.pf-v6-c-alert.pf-m-info');
  if (await infoAlert.count() > 0) {
    await step(
      'Labagator CSV format',
      'Session code, title, room, dates — auto-converts to Flow format',
      '.pf-v6-c-alert.pf-m-info',
      { position: 'below' }
    );
    await highlight(page, '.pf-v6-c-alert.pf-m-info', 2000);
    await hideCallout(page);
  }

  // 4. Upload Labagator CSV
  const labagatorCsvPath = path.resolve(__dirname, '..', 'docs', 'examples', 'labagator_sample.csv');
  await step(
    'Upload Labagator session export',
    'CSV with session_code, title, dates, room columns',
    '#csv-file-upload',
    { position: 'right' }
  );
  await uploadCSV(page, labagatorCsvPath);
  await hideCallout(page);

  // 5. Show transformed schedule
  const table = page.locator('.pf-v6-c-table');
  if (await table.count() > 0) {
    await step(
      'Sessions converted to workshops',
      'CI names, namespaces, and date ranges auto-generated from Labagator data',
      '.pf-v6-c-table',
      { position: 'above' }
    );
    await highlight(page, '.pf-v6-c-table tbody tr:first-child', 2500);
    await hideCallout(page);
  }

  // 6. Switch to Deployments tab
  await hideSection(page);
  await clickWithCursor(page, 'button[role="tab"]:has-text("Deployments")', { afterClick: 2000 });
  await showSection(page, 'Export');

  // 7. Export back to Labagator
  const exportBtn = page.locator('button:has-text("Export for Labagator")');
  if (await exportBtn.count() > 0) {
    await step(
      'Export for Labagator',
      'Round-trip: Flow → Labagator CSV for session updates',
      'button:has-text("Export for Labagator")',
      { position: 'above' }
    );
    await clickWithCursor(page, 'button:has-text("Export for Labagator")', { afterClick: 2000 });
    await hideCallout(page);
  }

  // 8. Success confirmation
  const successAlert = page.locator('.pf-v6-c-alert--success');
  if (await successAlert.count() > 0) {
    await step(
      'Round-trip complete',
      'Labagator sessions deployed and exported back for event tracking',
      '.pf-v6-c-alert--success',
      { position: 'below' }
    );
    await wait(2500);
    await hideCallout(page);
  }

  await hideSection(page);
  await wait(500);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const CHAPTERS = [
  {
    file: '01-upload-and-schedule.webm',
    title: 'Upload & Schedule',
    sub: 'CSV upload, schedule table, and row details',
    fn: chapter01_uploadAndSchedule,
  },
  {
    file: '02-deploy-settings.webm',
    title: 'Deploy Settings',
    sub: 'Toggle switches and dry-run deployment',
    fn: chapter02_deploySettings,
  },
  {
    file: '03-deployments-tab.webm',
    title: 'Deployments',
    sub: 'Results, status cards, search, filter, and export',
    fn: chapter03_deploymentsTab,
  },
  {
    file: '04-operations-tab.webm',
    title: 'Operations',
    sub: 'Lock, Extend, Scale, CI filter, and history',
    fn: chapter04_operationsTab,
  },
  {
    file: '05-qa-and-students.webm',
    title: 'QA & Students',
    sub: 'QA checks, type selector, student URLs, and export',
    fn: chapter05_qaAndStudents,
  },
  {
    file: '06-extras.webm',
    title: 'Extras',
    sub: 'Live mode, dark mode, keyboard shortcuts, and diff view',
    fn: chapter06_extras,
  },
  {
    file: '07-labagator-integration.webm',
    title: 'Labagator Integration',
    sub: 'Import event sessions, deploy, and export back',
    fn: chapter07_labagatorIntegration,
  },
];

(async () => {
  console.log('RHDP-Flow Demo Recorder — 7-chapter split');
  console.log(`Frontend: ${BASE_URL}`);
  console.log(`Viewport: ${VIEWPORT.width}×${VIEWPORT.height}`);
  console.log(`CSV: ${CSV_PATH}\n`);

  const browser = await chromium.launch({ headless: true });

  for (const ch of CHAPTERS) {
    await recordChapter(browser, ch.file, ch.title, ch.sub, ch.fn);
  }

  await browser.close();

  // Clean up stray .webm files (keep chapter outputs)
  cleanupStrayWebm(['01-', '02-', '03-', '04-', '05-', '06-', '07-', 'rhdp-flow-demo']);

  console.log('\n✓ All chapters recorded.');
  console.log('\nConvert to MP4:');
  console.log('  for f in videos/0*.webm; do');
  console.log('    ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 \\');
  console.log('      -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"');
  console.log('  done');
})();
