/**
 * Shared recording helpers for RHDP-Flow demo videos.
 *
 * Provides: cursor animation, inline callout boxes, element highlights,
 * section badges, title cards, scrolling, and CSV upload via API.
 *
 * Used by record-demo.mjs to produce 6 short chapter videos.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Constants ──────────────────────────────────────────────────────────────

export const VIDEOS_DIR = __dirname;
export const CSV_PATH = path.resolve(__dirname, '..', 'docs', 'examples', 'full_featured.csv');
export const BASIC_CSV_PATH = path.resolve(__dirname, '..', 'docs', 'examples', 'basic_workshop.csv');
export const BASE_URL = 'http://localhost:5173';

// Viewport enlarged: extra 40px height fixes PF6 masthead clipping
export const VIEWPORT = { width: 1920, height: 1120 };

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Overlay CSS ────────────────────────────────────────────────────────────

const OVERLAY_CSS = `
  /* ── Animated cursor ── */
  #demo-cursor {
    position: fixed;
    width: 24px;
    height: 24px;
    z-index: 999999;
    pointer-events: none;
    transition: left 0.5s cubic-bezier(.25,.1,.25,1),
                top 0.5s cubic-bezier(.25,.1,.25,1);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M5 3l14 8-6.5 1.5L11 19z' fill='%23111' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
  }
  #demo-cursor.clicking {
    transform: scale(0.85);
    transition: transform 0.1s;
  }

  /* ── Inline callout box (replaces old bottom banner) ── */
  #demo-callout {
    position: fixed;
    z-index: 999998;
    background: rgba(0, 0, 0, 0.90);
    color: #fff;
    padding: 12px 20px;
    border-radius: 8px;
    border-left: 4px solid #EE0000;
    font-family: 'Red Hat Display', 'Segoe UI', system-ui, sans-serif;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.4;
    max-width: 420px;
    backdrop-filter: blur(8px);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  }
  #demo-callout.visible { opacity: 1; }

  #demo-callout .callout-step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #EE0000;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    margin-right: 10px;
    flex-shrink: 0;
  }
  #demo-callout .callout-header {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
  }
  #demo-callout .callout-title {
    font-weight: 600;
    font-size: 16px;
  }
  #demo-callout .callout-sub {
    font-size: 13px;
    opacity: 0.75;
    margin-left: 36px;
  }

  /* ── Element highlight glow ── */
  .demo-highlight {
    outline: 3px solid #EE0000 !important;
    outline-offset: 4px !important;
    box-shadow: 0 0 20px rgba(238, 0, 0, 0.35) !important;
    border-radius: 4px !important;
    transition: outline 0.3s, box-shadow 0.3s !important;
  }

  /* ── Section title badge (top-right corner) ── */
  #demo-section-title {
    position: fixed;
    top: 60px;
    right: 24px;
    z-index: 999997;
    background: rgba(238, 0, 0, 0.9);
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
  #demo-section-title.visible { opacity: 1; }

  /* ── Title card (full-screen overlay) ── */
  #demo-title-card {
    position: fixed;
    inset: 0;
    z-index: 1000000;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-family: 'Red Hat Display', 'Segoe UI', system-ui, sans-serif;
    opacity: 1;
    transition: opacity 0.5s ease;
    pointer-events: none;
  }
  #demo-title-card.hidden { opacity: 0; }
  #demo-title-card .title-main {
    font-size: 48px;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 16px;
    text-align: center;
    padding: 0 40px;
  }
  #demo-title-card .title-sub {
    font-size: 22px;
    font-weight: 400;
    opacity: 0.7;
    text-align: center;
    padding: 0 40px;
  }
  #demo-title-card .title-accent {
    width: 80px;
    height: 4px;
    background: #EE0000;
    border-radius: 2px;
    margin-bottom: 24px;
  }
`;

// ─── Overlay injection ──────────────────────────────────────────────────────

export async function injectOverlays(page) {
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

    // Callout box
    const callout = document.createElement('div');
    callout.id = 'demo-callout';
    callout.innerHTML = `
      <div class="callout-header">
        <span class="callout-step"></span>
        <span class="callout-title"></span>
      </div>
      <div class="callout-sub"></div>
    `;
    document.body.appendChild(callout);

    // Section title badge
    const section = document.createElement('div');
    section.id = 'demo-section-title';
    document.body.appendChild(section);
  }, OVERLAY_CSS);
}

// ─── Cursor helpers ─────────────────────────────────────────────────────────

export async function moveCursorTo(page, selector, options = {}) {
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

export async function moveCursorToCoords(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('demo-cursor');
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  }, { x, y });
  await wait(500);
}

export async function clickWithCursor(page, selector, options = {}) {
  await moveCursorTo(page, selector, options);
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

// ─── Highlight ──────────────────────────────────────────────────────────────

export async function highlight(page, selector, duration = 2000) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return;
  await loc.evaluate(el => el.classList.add('demo-highlight'));
  await wait(duration);
  await loc.evaluate(el => el.classList.remove('demo-highlight'));
}

// ─── Inline callout (positioned near an element) ────────────────────────────

/**
 * Show an inline callout box near a target element.
 *
 * @param {import('playwright').Page} page
 * @param {number|string} step   Step number (or '' to hide the badge)
 * @param {string}        text   Main callout title
 * @param {string}        sub    Subtitle / description
 * @param {string|null}   nearSelector  CSS selector of element to position near (null = center of viewport)
 * @param {object}        opts   { position: 'above'|'below'|'right'|'left', offsetX, offsetY }
 */
export async function showCallout(page, step, text, sub = '', nearSelector = null, opts = {}) {
  const viewportSize = page.viewportSize();
  let pos = { x: viewportSize.width / 2 - 200, y: viewportSize.height / 2 - 50 };

  if (nearSelector) {
    const loc = page.locator(nearSelector).first();
    if ((await loc.count()) > 0) {
      const box = await loc.boundingBox();
      if (box) {
        const placement = opts.position || 'above';
        const ox = opts.offsetX || 0;
        const oy = opts.offsetY || 0;

        switch (placement) {
          case 'above':
            pos = { x: box.x + ox, y: box.y - 80 + oy };
            break;
          case 'below':
            pos = { x: box.x + ox, y: box.y + box.height + 12 + oy };
            break;
          case 'right':
            pos = { x: box.x + box.width + 16 + ox, y: box.y + oy };
            break;
          case 'left':
            pos = { x: box.x - 440 + ox, y: box.y + oy };
            break;
        }

        // Clamp to viewport
        pos.x = Math.max(16, Math.min(pos.x, viewportSize.width - 440));
        pos.y = Math.max(16, Math.min(pos.y, viewportSize.height - 100));
      }
    }
  }

  await page.evaluate(({ step, text, sub, x, y }) => {
    const c = document.getElementById('demo-callout');
    if (!c) return;
    c.querySelector('.callout-step').textContent = step;
    c.querySelector('.callout-step').style.display = step ? '' : 'none';
    c.querySelector('.callout-title').textContent = text;
    c.querySelector('.callout-sub').textContent = sub;
    c.querySelector('.callout-sub').style.display = sub ? '' : 'none';
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    c.classList.add('visible');
  }, { step: String(step), text, sub, x: pos.x, y: pos.y });
  await wait(300);
}

export async function hideCallout(page) {
  await page.evaluate(() => {
    const c = document.getElementById('demo-callout');
    if (c) c.classList.remove('visible');
  });
  await wait(300);
}

// ─── Section title badge ────────────────────────────────────────────────────

export async function showSection(page, text) {
  await page.evaluate((t) => {
    const s = document.getElementById('demo-section-title');
    if (s) { s.textContent = t; s.classList.add('visible'); }
  }, text);
}

export async function hideSection(page) {
  await page.evaluate(() => {
    const s = document.getElementById('demo-section-title');
    if (s) s.classList.remove('visible');
  });
}

// ─── Title card (full-screen intro) ─────────────────────────────────────────

export async function showTitleCard(page, title, subtitle = '') {
  await page.evaluate(({ title, subtitle }) => {
    let card = document.getElementById('demo-title-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'demo-title-card';
      card.innerHTML = `
        <div class="title-accent"></div>
        <div class="title-main"></div>
        <div class="title-sub"></div>
      `;
      document.body.appendChild(card);
    }
    card.querySelector('.title-main').textContent = title;
    card.querySelector('.title-sub').textContent = subtitle;
    card.querySelector('.title-sub').style.display = subtitle ? '' : 'none';
    card.classList.remove('hidden');
  }, { title, subtitle });
  await wait(2500);
}

export async function hideTitleCard(page) {
  await page.evaluate(() => {
    const card = document.getElementById('demo-title-card');
    if (card) card.classList.add('hidden');
  });
  await wait(600);
}

// ─── Scrolling ──────────────────────────────────────────────────────────────

export async function scrollSection(page, top) {
  await page.evaluate((t) => {
    const section = document.querySelector('.pf-v6-c-page__main-section.pf-m-fill');
    if (section) section.scrollTo({ top: t, behavior: 'smooth' });
  }, top);
  await wait(800);
}

// ─── CSV upload via API (reliable for PF6 FileUpload) ───────────────────────

export async function uploadCSVviaAPI(page, csvPath = CSV_PATH) {
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const csvName = path.basename(csvPath);
  await page.evaluate(async ({ csv, name }) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', blob, name);
    await fetch('/api/schedules/upload', { method: 'POST', body: fd });
  }, { csv: csvContent, name: csvName });
  await page.reload({ waitUntil: 'networkidle' });
}

// ─── Video file management ──────────────────────────────────────────────────

/**
 * After closing a recording context, find the newest .webm in VIDEOS_DIR
 * and rename it to the target filename.
 */
export function renameLatestWebm(targetName) {
  const files = fs.readdirSync(VIDEOS_DIR).filter(
    (f) => f.endsWith('.webm') && !f.startsWith('rhdp-flow-demo') && !f.match(/^\d{2}-/)
  );
  if (files.length === 0) return null;

  files.sort((a, b) => {
    const sa = fs.statSync(path.join(VIDEOS_DIR, a)).mtimeMs;
    const sb = fs.statSync(path.join(VIDEOS_DIR, b)).mtimeMs;
    return sb - sa;
  });

  const src = path.join(VIDEOS_DIR, files[0]);
  const dest = path.join(VIDEOS_DIR, targetName);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(src, dest);
  console.log(`  → saved: ${dest}`);
  return dest;
}

/** Remove stray .webm files that aren't chapter outputs or the legacy single video. */
export function cleanupStrayWebm(keepPrefixes = []) {
  const files = fs.readdirSync(VIDEOS_DIR).filter((f) => f.endsWith('.webm'));
  for (const f of files) {
    if (keepPrefixes.some((p) => f.startsWith(p))) continue;
    if (f === 'rhdp-flow-demo.webm') continue;
    try { fs.unlinkSync(path.join(VIDEOS_DIR, f)); } catch { /* ignore */ }
  }
}
