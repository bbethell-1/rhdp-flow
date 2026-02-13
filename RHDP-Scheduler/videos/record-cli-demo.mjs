/**
 * RHDP-Flow CLI Demo Video Recorder — 2 chapter videos.
 *
 * Records a browser-rendered terminal (cli-terminal.html) with the same
 * overlay system used by the web UI demo videos: title cards, inline
 * callout boxes, and section badges.
 *
 * Run:  node videos/record-cli-demo.mjs
 * No servers required — uses a local HTML file.
 *
 * After recording, convert to MP4:
 *   for f in videos/07*.webm videos/08*.webm; do
 *     ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 \
 *       -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
 *   done
 */

import { chromium } from 'playwright';
import {
  VIDEOS_DIR, VIEWPORT, wait,
  injectOverlays, showCallout, hideCallout, showSection, hideSection,
  showTitleCard, hideTitleCard,
  CLI_TERMINAL_PATH,
  termType, termEnter, termOutput, termOutputAnimated, termGap, termPrompt, termClear,
  renameLatestWebm, cleanupStrayWebm,
} from './recording-helpers.mjs';

// ─── Chapter runner ──────────────────────────────────────────────────────────

async function recordChapter(browser, chapterName, titleText, titleSub, chapterFn) {
  console.log(`\n▶ Recording: ${chapterName}`);

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEOS_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();
  let stepNum = 0;

  const step = (text, sub, nearSelector, opts) =>
    showCallout(page, ++stepNum, text, sub, nearSelector, opts);

  try {
    await page.goto(`file://${CLI_TERMINAL_PATH}`, { waitUntil: 'load' });
    await injectOverlays(page);
    await wait(400);

    // Title card
    await showTitleCard(page, titleText, titleSub);
    await hideTitleCard(page);
    await wait(400);

    await chapterFn(page, step);

    await hideCallout(page);
    await hideSection(page);
    await wait(800);
  } finally {
    await page.close();
    await context.close();
  }

  renameLatestWebm(chapterName);
}

// ─── Styled output fragments ────────────────────────────────────────────────
// Reusable HTML snippets matching rhdp_flow.py logger output patterns.

const DIM = (t) => `<span class="out-dim">${t}</span>`;
const INFO = (t) => `<span class="out-info">INFO    </span> <span class="out">${t}</span>`;
const SUCCESS = (t) => `<span class="out-info">INFO    </span> <span class="out-success">${t}</span>`;
const WARN = (t) => `<span class="out-warning">WARNING </span> <span class="out-warning">${t}</span>`;
const SECTION = (t) => `<span class="out-section">${t}</span>`;
const RULER = () => `<span class="out-ruler">${'═'.repeat(70)}</span>`;
const JSON_LINE = (k, v) =>
  `  <span class="out-json-key">"${k}"</span>: <span class="out-json-val">"${v}"</span>,`;

// ─── Chapter 07 — Deploy & QA ───────────────────────────────────────────────

async function chapter07_deployAndQA(page, step) {
  await showSection(page, 'CLI — Deploy & QA');

  // ── 1. Show help ──
  await step(
    'Built-in help',
    'rhdp_flow.py --help shows all flags, options, and examples',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 60 },
  );
  await termType(page, 'python3 rhdp_flow.py --help');
  await termEnter(page);
  await termGap(page);

  const helpLines = [
    `<span class="out-bold">usage:</span> rhdp_flow.py [-h] [--input-csv INPUT_CSV] [--output-csv OUTPUT_CSV]`,
    `                    [--ci CI] [--dry-run] [--kubeconfig KUBECONFIG]`,
    `                    [--timeout TIMEOUT] [--debug] [--qa {1,2,both}] [--lock]`,
    `                    [--extend-stop] [--extend-destroy] [--days DAYS]`,
    `                    [--hours HOURS] [--scale SCALE] [--update-passwords]`,
    `                    [--import-namespace IMPORT_NAMESPACE] [--sync SYNC]`,
    `                    [--wizard]`,
    ``,
    `<span class="out-bold">RHDP-Flow: Red Hat Demo Platform Workshop Automation Tool</span>`,
    ``,
    `<span class="out-section">options:</span>`,
    `  <span class="out-info">--input-csv</span>       Path to input CSV file with workshop schedules`,
    `  <span class="out-info">--dry-run</span>         Print JSON payloads without creating ResourceClaims`,
    `  <span class="out-info">--qa {1,2,both}</span>   Run QA verification (1=setup, 2=deploy, both)`,
    `  <span class="out-info">--lock</span>            Lock all workshops matching the CSV`,
    `  <span class="out-info">--extend-stop</span>     Extend auto-stop time (use with --days / --hours)`,
    `  <span class="out-info">--extend-destroy</span>  Extend auto-destroy time`,
    `  <span class="out-info">--scale N</span>         Scale workshop seat count to target value`,
    `  <span class="out-info">--wizard</span>          Launch interactive CSV wizard`,
    `  <span class="out-info">--import-namespace</span> Import workshops from a namespace into CSV`,
    `  <span class="out-info">--sync</span>            Compare master vs local CSV, write merged output`,
    `  <span class="out-dim">  ... and more (--ci, --update-passwords, --debug, --timeout)</span>`,
  ];
  await termOutputAnimated(page, helpLines, 50);
  await wait(2000);
  await hideCallout(page);

  // ── 2. Dry-run ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Dry-run mode (safe preview)',
    '--dry-run prints JSON payloads without provisioning real resources',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 120 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv docs/examples/full_featured.csv --dry-run');
  await termEnter(page);
  await termGap(page);

  const dryRunLines = [
    INFO('Successfully read <span class="out-bold">3</span> schedules from docs/examples/full_featured.csv'),
    ``,
    INFO('[DRY-RUN] Validation and num_users check'),
    RULER(),
    INFO('  Multi-asset: Virt Roadshow + Ansible Lab (2 assets)'),
    INFO('    &bull; openshift-cnv.ocp-virt-roadshow-multi-user.prod: num_users=<span class="out-bold">20</span>, password=<span class="out-success">set</span>'),
    INFO('    &bull; zt-ansiblebu.ansible-network-automation-basics-lab-2.event: num_users=<span class="out-bold">20</span>, password=<span class="out-success">set</span>'),
    ``,
    INFO('  OpenShift AI: num_users=<span class="out-bold">15</span>, salesforce=<span class="out-highlight">opportunity:71456169;campaign:701Pe</span>'),
    RULER(),
    ``,
    INFO('Processing <span class="out-bold">3</span> schedule(s)'),
    ``,
    INFO('Processing schedule: <span class="out-bold">Virt Roadshow</span> (openshift-cnv.ocp-virt-roadshow-multi-user.prod)'),
    INFO('[DRY-RUN] Would create ResourceClaim in namespace <span class="out-info">user-jdoe-redhat-com</span>:'),
    `  {`,
    JSON_LINE('apiVersion', 'poolboy.gpte.redhat.com/v1'),
    JSON_LINE('kind', 'ResourceClaim'),
    JSON_LINE('namespace', 'user-jdoe-redhat-com'),
    `    <span class="out-dim">...</span>`,
    `  }`,
    INFO('[DRY-RUN] Would create Workshop for openshift-cnv... (num_users: <span class="out-bold">True</span>)'),
    INFO('[DRY-RUN] Would create WorkshopProvision: virt-roadshow-2026 (count=1, concurrency=1)'),
    ``,
    INFO('Processing schedule: <span class="out-bold">Ansible Lab</span> (zt-ansiblebu...basics-lab-2.event)'),
    INFO('[DRY-RUN] Would create ResourceClaim in namespace <span class="out-info">user-jdoe-redhat-com</span>'),
    INFO('[DRY-RUN] Would create Workshop + WorkshopProvision'),
    ``,
    INFO('Processing schedule: <span class="out-bold">OpenShift AI</span> (rosa.ocp-virt-roadshow-multi-user.prod)'),
    INFO('[DRY-RUN] Would create ResourceClaim in namespace <span class="out-info">user-jdoe-redhat-com</span>'),
    INFO('[DRY-RUN] Would create Workshop + WorkshopProvision'),
    ``,
    SUCCESS('Deployment results written to deployment_results.csv (3 records)'),
  ];
  await termOutputAnimated(page, dryRunLines, 55);
  await wait(2500);
  await hideCallout(page);

  // ── 3. Live deploy (simulated) ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Live deployment',
    'Without --dry-run, resources are created on the cluster via oc',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 180 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv workshop_schedule.csv');
  await termEnter(page);
  await termGap(page);

  const liveDeployLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from workshop_schedule.csv'),
    INFO('Processing <span class="out-bold">2</span> schedule(s)'),
    ``,
    INFO('Processing schedule: <span class="out-bold">Virt Roadshow</span>'),
    INFO('  Creating ResourceClaim in namespace <span class="out-info">user-jdoe-redhat-com</span>...'),
    SUCCESS('  &check; Successfully created ResourceClaim: <span class="out-bold">bfc2-xk9d</span>'),
    INFO('  Waiting for Workshop from ResourceClaim...'),
    SUCCESS('  &check; Successfully created Workshop: <span class="out-bold">virt-roadshow-2026-bfc2</span> with UI enabled'),
    SUCCESS('  &check; Successfully created WorkshopProvision: <span class="out-bold">virt-roadshow-2026-bfc2</span>'),
    ``,
    INFO('Processing schedule: <span class="out-bold">Ansible Lab</span>'),
    INFO('  Creating ResourceClaim in namespace <span class="out-info">user-jdoe-redhat-com</span>...'),
    SUCCESS('  &check; Successfully created ResourceClaim: <span class="out-bold">a1e7-mn3p</span>'),
    SUCCESS('  &check; Successfully created Workshop + WorkshopProvision'),
    ``,
    SUCCESS('Deployment results written to deployment_results.csv (2 records)'),
  ];
  await termOutputAnimated(page, liveDeployLines, 70);
  await wait(2500);
  await hideCallout(page);

  // ── 4. CI filter ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Filter to one catalog item',
    '--ci targets a specific CI so other workshops in the CSV are skipped',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 240 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --ci openshift-cnv.ocp-virt-roadshow-multi-user.prod');
  await termEnter(page);
  await termGap(page);

  const ciFilterLines = [
    INFO('Successfully read <span class="out-bold">3</span> schedules from schedule.csv'),
    INFO('Filtered to CI: <span class="out-bold">openshift-cnv.ocp-virt-roadshow-multi-user.prod</span>'),
    INFO('Processing <span class="out-bold">1</span> schedule(s)'),
    ``,
    INFO('Processing schedule: <span class="out-bold">Virt Roadshow</span>'),
    SUCCESS('  &check; Successfully created ResourceClaim: <span class="out-bold">cf91-ab2q</span>'),
    SUCCESS('  &check; Successfully created Workshop + WorkshopProvision'),
  ];
  await termOutputAnimated(page, ciFilterLines, 70);
  await wait(2000);
  await hideCallout(page);

  // ── 5. QA verification ──
  await termGap(page);
  await termPrompt(page);

  await hideSection(page);
  await showSection(page, 'CLI — QA Verification');

  await step(
    'QA verification',
    '--qa 1 checks setup (times, users); --qa 2 checks deployment health; --qa both runs both',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 100 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --qa both');
  await termEnter(page);
  await termGap(page);

  const qaLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from schedule.csv'),
    ``,
    SECTION('━━━ QA1: Verify Setup ━━━'),
    ``,
    INFO('Checking: <span class="out-bold">Virt Roadshow</span> in user-jdoe-redhat-com'),
    SUCCESS('  &check; Workshop found: virt-roadshow-2026-bfc2'),
    SUCCESS('  &check; num_users matches CSV: 20'),
    SUCCESS('  &check; Auto-stop:    19/03/2026 18:00 UTC'),
    SUCCESS('  &check; Auto-destroy: 21/03/2026 10:00 UTC'),
    SUCCESS('  &check; Lock-enabled: true'),
    ``,
    INFO('Checking: <span class="out-bold">Ansible Lab</span> in user-jdoe-redhat-com'),
    SUCCESS('  &check; Workshop found: ansible-lab-2026-a1e7'),
    SUCCESS('  &check; num_users matches CSV: 20'),
    SUCCESS('  &check; Auto-stop / Auto-destroy: OK'),
    ``,
    SECTION('━━━ QA2: Verify Deployment Status ━━━'),
    ``,
    INFO('Checking: <span class="out-bold">Virt Roadshow</span>'),
    SUCCESS('  &check; Status: <span class="out-bold">deployed</span>'),
    SUCCESS('  &check; Healthy seats: <span class="out-bold">20/20</span>'),
    SUCCESS('  &check; Landing page: <span class="out-highlight">https://prod.demo.redhat.com/workshops/virt-roadshow-2026-bfc2</span>'),
    ``,
    INFO('Checking: <span class="out-bold">Ansible Lab</span>'),
    SUCCESS('  &check; Status: <span class="out-bold">deployed</span>'),
    SUCCESS('  &check; Healthy seats: <span class="out-bold">20/20</span>'),
    SUCCESS('  &check; Landing page: <span class="out-highlight">https://prod.demo.redhat.com/workshops/ansible-lab-2026-a1e7</span>'),
    ``,
    SUCCESS('QA results written to qa_results.csv (2 records)'),
  ];
  await termOutputAnimated(page, qaLines, 55);
  await wait(3000);
  await hideCallout(page);
  await wait(500);
}

// ─── Chapter 08 — Operations & Wizard ────────────────────────────────────────

async function chapter08_opsAndWizard(page, step) {
  await showSection(page, 'CLI — Operations');

  // ── 1. Lock ──
  await step(
    'Lock workshops',
    '--lock sets demo.redhat.com/lock-enabled label to prevent student access',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 60 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --lock');
  await termEnter(page);
  await termGap(page);

  const lockLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from schedule.csv'),
    INFO('Processing lock for all workshops...'),
    ``,
    SUCCESS('  &check; Locked: virt-roadshow-2026-bfc2 in user-jdoe-redhat-com'),
    SUCCESS('  &check; Locked: ansible-lab-2026-a1e7 in user-jdoe-redhat-com'),
    ``,
    SUCCESS('Locked <span class="out-bold">2</span> workshops'),
  ];
  await termOutputAnimated(page, lockLines, 70);
  await wait(2000);
  await hideCallout(page);

  // ── 2. Extend stop ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Extend auto-stop',
    '--extend-stop --hours 4 pushes back the stop time for all matching workshops',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 120 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --extend-stop --hours 4');
  await termEnter(page);
  await termGap(page);

  const extendStopLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from schedule.csv'),
    INFO('Extending auto-stop by <span class="out-bold">0 days, 4 hours</span>...'),
    ``,
    SUCCESS('  &check; Extended stop: virt-roadshow-2026-bfc2 &rarr; 19/03/2026 <span class="out-bold">22:00</span> UTC'),
    SUCCESS('  &check; Extended stop: ansible-lab-2026-a1e7 &rarr; 19/03/2026 <span class="out-bold">22:00</span> UTC'),
  ];
  await termOutputAnimated(page, extendStopLines, 70);
  await wait(2000);
  await hideCallout(page);

  // ── 3. Extend destroy ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Extend auto-destroy',
    '--extend-destroy --days 2 pushes back the cleanup deadline',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 180 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --extend-destroy --days 2');
  await termEnter(page);
  await termGap(page);

  const extendDestroyLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from schedule.csv'),
    INFO('Extending auto-destroy by <span class="out-bold">2 days, 0 hours</span>...'),
    ``,
    SUCCESS('  &check; Extended destroy: virt-roadshow-2026-bfc2 &rarr; <span class="out-bold">23/03/2026</span> 10:00 UTC'),
    SUCCESS('  &check; Extended destroy: ansible-lab-2026-a1e7 &rarr; <span class="out-bold">23/03/2026</span> 10:00 UTC'),
  ];
  await termOutputAnimated(page, extendDestroyLines, 70);
  await wait(2000);
  await hideCallout(page);

  // ── 4. Scale ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Scale seat count',
    '--scale 40 adjusts WorkshopProvision count to the target value',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 240 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --scale 40');
  await termEnter(page);
  await termGap(page);

  const scaleLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from schedule.csv'),
    INFO('Scaling workshops to <span class="out-bold">40</span> seats...'),
    ``,
    SUCCESS('  &check; Scaled: virt-roadshow-2026-bfc2 &rarr; <span class="out-bold">40</span> seats'),
    SUCCESS('  &check; Scaled: ansible-lab-2026-a1e7 &rarr; <span class="out-bold">40</span> seats'),
  ];
  await termOutputAnimated(page, scaleLines, 70);
  await wait(2000);
  await hideCallout(page);

  // ── 5. Import namespace ──
  await termClear(page);
  await hideSection(page);
  await showSection(page, 'CLI — Data Management');

  await step(
    'Import from namespace',
    '--import-namespace discovers workshops on the cluster and generates a CSV',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 80 },
  );
  await termType(page, 'python3 rhdp_flow.py --import-namespace user-jdoe-redhat-com');
  await termEnter(page);
  await termGap(page);

  const importLines = [
    INFO('Importing workshops from namespace: <span class="out-info">user-jdoe-redhat-com</span>'),
    INFO('  Found <span class="out-bold">3</span> workshops via oc get workshop -n user-jdoe-redhat-com'),
    ``,
    SUCCESS('  &check; virt-roadshow-2026-bfc2 &rarr; CI: openshift-cnv.ocp-virt-roadshow-multi-user.prod'),
    SUCCESS('  &check; ansible-lab-2026-a1e7 &rarr; CI: zt-ansiblebu.ansible-network-automation-basics-lab-2.event'),
    SUCCESS('  &check; ocp-ai-demo-9f21 &rarr; CI: rosa.ocp-virt-roadshow-multi-user.prod'),
    ``,
    SUCCESS('Exported 3 workshops to <span class="out-bold">imported_user-jdoe-redhat-com.csv</span>'),
  ];
  await termOutputAnimated(page, importLines, 70);
  await wait(2500);
  await hideCallout(page);

  // ── 6. Sync ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Sync master vs local CSV',
    '--sync compares by (CI, Namespace) key and writes a merged output file',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 160 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv local.csv --sync master.csv');
  await termEnter(page);
  await termGap(page);

  const syncLines = [
    INFO('Comparing master.csv against local.csv...'),
    ``,
    `  <span class="out-success">ADDED</span>      2 rows in master not in local`,
    `  <span class="out-warning">CHANGED</span>    1 row with different values (Users: 20&rarr;30)`,
    `  <span class="out-dim">UNCHANGED</span>  3 rows identical`,
    ``,
    SUCCESS('Merged output written to <span class="out-bold">merged_schedule.csv</span> (6 rows)'),
  ];
  await termOutputAnimated(page, syncLines, 80);
  await wait(2500);
  await hideCallout(page);

  // ── 7. Update passwords ──
  await termGap(page);
  await termPrompt(page);

  await step(
    'Update passwords',
    '--update-passwords detects CSV changes and patches workshops on the cluster',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 220 },
  );
  await termType(page, 'python3 rhdp_flow.py --input-csv schedule.csv --update-passwords');
  await termEnter(page);
  await termGap(page);

  const updatePwLines = [
    INFO('Successfully read <span class="out-bold">2</span> schedules from schedule.csv'),
    INFO('Checking passwords against cluster...'),
    ``,
    INFO('  virt-roadshow-2026-bfc2: cluster=<span class="out-dim">OldPass1</span> csv=<span class="out-bold">NewPass1</span>'),
    SUCCESS('  &check; Patched password for virt-roadshow-2026-bfc2'),
    INFO('  ansible-lab-2026-a1e7: <span class="out-dim">unchanged</span>'),
    ``,
    SUCCESS('Updated <span class="out-bold">1</span> password(s), <span class="out-dim">1 unchanged</span>'),
  ];
  await termOutputAnimated(page, updatePwLines, 70);
  await wait(2500);
  await hideCallout(page);

  // ── 8. Interactive wizard ──
  await termClear(page);
  await hideSection(page);
  await showSection(page, 'CLI — CSV Wizard');

  await step(
    'Interactive CSV wizard',
    '--wizard walks you through building a schedule CSV step by step',
    '#terminal-window',
    { position: 'right', offsetX: -200, offsetY: 60 },
  );
  await termType(page, 'python3 rhdp_flow.py --wizard');
  await termEnter(page);
  await termGap(page);

  const wizardLines = [
    `<span class="out-section">╭─────────────────────────────────────────────────────╮</span>`,
    `<span class="out-section">│       RHDP-Flow Interactive CSV Wizard (v2.0)       │</span>`,
    `<span class="out-section">╰─────────────────────────────────────────────────────╯</span>`,
    ``,
    `<span class="out-bold">Step 1/8:</span> Workshop name`,
    `  <span class="out-info">?</span> Enter a display name: <span class="out-bold">Summit Virt Demo</span>`,
    ``,
    `<span class="out-bold">Step 2/8:</span> Catalog Item (CI)`,
    `  <span class="out-info">?</span> Enter CI (vendor.item.env): <span class="out-bold">openshift-cnv.ocp-virt-roadshow-multi-user.prod</span>`,
    ``,
    `<span class="out-bold">Step 3/8:</span> Namespace`,
    `  <span class="out-info">?</span> Enter namespace: <span class="out-bold">user-jdoe-redhat-com</span>`,
    ``,
    `<span class="out-bold">Step 4/8:</span> Users &amp; password`,
    `  <span class="out-info">?</span> Number of users: <span class="out-bold">25</span>`,
    `  <span class="out-info">?</span> Password: <span class="out-bold">summit2026</span>`,
    ``,
    `<span class="out-bold">Step 5/8:</span> Enable workshop UI? <span class="out-success">Yes</span>`,
    ``,
    `<span class="out-bold">Step 6/8:</span> Scheduling`,
    `  <span class="out-info">?</span> Provisioning date (DD/MM/YYYY HH:MM): <span class="out-bold">19/03/2026 08:00</span>`,
    `  <span class="out-info">?</span> Auto-stop:    <span class="out-bold">19/03/2026 18:00</span>`,
    `  <span class="out-info">?</span> Auto-destroy: <span class="out-bold">21/03/2026 10:00</span>`,
    ``,
    `<span class="out-bold">Step 7/8:</span> Optional features`,
    `  <span class="out-info">?</span> Count (instances): <span class="out-bold">1</span>`,
    `  <span class="out-info">?</span> Concurrency: <span class="out-bold">1</span>`,
    `  <span class="out-info">?</span> Multi-workshop name: <span class="out-dim">(empty — single workshop)</span>`,
    `  <span class="out-info">?</span> AWS regions: <span class="out-dim">(empty — default region)</span>`,
    ``,
    `<span class="out-bold">Step 8/8:</span> Salesforce`,
    `  <span class="out-info">?</span> Salesforce IDs: <span class="out-bold">71456169</span>`,
    `  <span class="out-info">?</span> Salesforce type: <span class="out-bold">opportunity</span>`,
    ``,
    RULER(),
    SUCCESS('CSV saved to: <span class="out-bold">summit_virt_demo.csv</span>'),
    ``,
    `<span class="out-dim">Tip: Review the file, then deploy with:</span>`,
    `<span class="out">  python3 rhdp_flow.py --input-csv summit_virt_demo.csv --dry-run</span>`,
  ];
  await termOutputAnimated(page, wizardLines, 50);
  await wait(3000);
  await hideCallout(page);

  // ── Closing ──
  await hideSection(page);
  await showCallout(page, '', 'RHDP-Flow CLI', 'Full power from the command line — deploy, verify, operate, and manage');
  await wait(3000);
  await hideCallout(page);
  await wait(500);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const CHAPTERS = [
  {
    file: '07-cli-deploy-and-qa.webm',
    title: 'CLI: Deploy & QA',
    sub: 'Dry-run, live deployment, CI filter, and QA verification',
    fn: chapter07_deployAndQA,
  },
  {
    file: '08-cli-ops-and-wizard.webm',
    title: 'CLI: Operations & Wizard',
    sub: 'Lock, extend, scale, import, sync, passwords, and interactive wizard',
    fn: chapter08_opsAndWizard,
  },
];

(async () => {
  console.log('RHDP-Flow CLI Demo Recorder — 2-chapter split');
  console.log(`Terminal page: ${CLI_TERMINAL_PATH}`);
  console.log(`Viewport: ${VIEWPORT.width}×${VIEWPORT.height}\n`);

  const browser = await chromium.launch({ headless: true });

  for (const ch of CHAPTERS) {
    await recordChapter(browser, ch.file, ch.title, ch.sub, ch.fn);
  }

  await browser.close();

  cleanupStrayWebm(['01-', '02-', '03-', '04-', '05-', '06-', '07-', '08-', 'rhdp-flow-demo']);

  console.log('\n✓ CLI chapters recorded.');
  console.log('\nConvert to MP4:');
  console.log('  for f in videos/07*.webm videos/08*.webm; do');
  console.log('    ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 \\');
  console.log('      -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"');
  console.log('  done');
})();
