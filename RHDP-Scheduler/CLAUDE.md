# RHDP-Scheduler — Claude Code Project Instructions

## Project Overview

RHDP-Flow Workshop Automation tool. Automates OpenShift workshop deployment from CSV files.

- **Core CLI**: `rhdp_flow.py` (3,974 lines)
- **Backend**: FastAPI in `api/` — run with `uvicorn api.server:app --port 8000`
- **Frontend**: React + PatternFly 6 + TypeScript + Vite in `frontend/` — run with `cd frontend && npm run dev`
- **Tests**: 80 backend + 47 frontend = 127 total. All passing.
- **Git remote**: `git@github.com:rhpds/rhpds-utils.git` (rhpds org), branch `main`
- **Git user**: `rhjcd` / `jdisrael@redhat.com`

## CRITICAL RULES

- **NEVER mention Claude, AI, Co-Authored-By, or any AI attribution in git commits or pushes.**
- Always run `git status` and `git diff` after any code change.
- Never push without user confirmation.

## Frontend Architecture

React 18.2 + PatternFly 6 + Vite. Components in `frontend/src/components/`:

| Component | Tab | Key features |
|-----------|-----|--------------|
| `UploadTab.tsx` | Upload & Deploy | CSV upload, schedule table, deploy settings, diff view |
| `DeploymentsTab.tsx` | Deployments | Results table, status cards, search/filter, auto-refresh, retry, CSV export |
| `OperationsTab.tsx` | Operations | Lock, Extend Stop/Destroy, Scale — each with per-CI target filter |
| `QATab.tsx` | QA | QA1/QA2 type selector, run/refresh, results table, status filter, CSV export |
| `StudentsTab.tsx` | Students | Landing page URLs, copy-to-clipboard, CSV export |
| `SessionHistory.tsx` | (toolbar) | Prior session dropdown, view/back controls |
| `DiffView.tsx` | (in Upload) | Compare schedules — added/removed/changed |
| `HealthBadge.tsx` | (masthead) | Cluster connection status |

Shared: `constants.ts`, `utils/statusColors.ts`, `services/api.ts`, `types/index.ts`, `hooks/useTheme.ts`, `hooks/useKeyboardShortcuts.ts`, `hooks/useAutoRefresh.ts`

## PatternFly 6 Selector Gotchas (for Playwright)

These were discovered through extensive debugging. Follow them exactly:

### PF6 Switch (e.g., Lock UI, White Glove, Redirect)
- The `<input>` is **hidden** with `role="switch"` — `boundingBox()` works but **click fails** because `<span class="pf-v6-c-switch__toggle">` intercepts pointer events.
- **Solution**: Use `page.getByRole('switch', { name: 'Lock UI Admin Settings' })` with `.click({ force: true })`.
- IDs: `resource-lock-switch`, `resource-pools-switch`, `white-glove-switch`, `redirect-switch`

### PF6 Checkbox (e.g., Dry-Run Mode)
- Works with: `page.getByRole('checkbox', { name: 'Dry-Run Mode' })`
- ID: `globalDryRun`

### PF6 FileUpload
- `setInputFiles()` on the hidden `<input type="file">` does NOT reliably trigger PF6's `onFileInputChange` callback.
- **Working fallback**: Upload via API directly, then reload:
  ```js
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  await page.evaluate(async (csv) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', blob, 'full_featured.csv');
    await fetch('/api/schedules/upload', { method: 'POST', body: fd });
  }, csvContent);
  await page.reload({ waitUntil: 'networkidle' });
  ```
- **Alternative that sometimes works**: `setInputFiles` on first `input[type="file"]` then click the Upload button. Verify table appears; if not, use API fallback.

### PF6 FormSelect (e.g., QA type)
- Renders as native `<select>` — use `select[aria-label="QA type"]`

### PF6 Table row expansion
- Expand buttons: `button:has-text("Details")` or `.pf-v6-c-table__toggle button`

### highlight() function
- Must use Playwright locator `.evaluate()`, NOT `document.querySelector()`, because `:has-text()` is a Playwright pseudo-selector not valid CSS.

### Scrolling
- The scrollable container is `.pf-v6-c-page__main-section.pf-m-fill`
- For elements below the fold, use `element.scrollIntoView({ behavior: 'smooth', block: 'center' })` via locator.evaluate()

## Demo Video Recording

### Current State
- `videos/record-demo.mjs` — Playwright recording script with overlays
- `videos/rhdp-flow-demo.mp4` (4.4MB) + `.webm` (9.7MB) — 1:50 at 1920x1080
- `videos/README.md` — viewing guide

### NEXT TASK: Split Videos and Improve Overlays

The current single video has these problems:
1. **Too large for GitHub** — shows "Sorry, can't show files this big"
2. **Top of video is cut off** — PF6 Masthead clipped at viewport top
3. **Bottom banner text hard to read** — competes for attention with UI actions
4. **Not user-friendly** — new associates can't jump to specific features

**Implementation plan:**

Split into 6 short videos (~15-30s each, target <2MB MP4 each):

| # | File | Content | Sections |
|---|------|---------|----------|
| 1 | `01-upload-and-schedule.mp4` | CSV upload, schedule table, row expand, search | Landing → table review |
| 2 | `02-deploy-settings.mp4` | Toggle switches, dry-run deployment | Settings → deploy |
| 3 | `03-deployments-tab.mp4` | Results, status cards, search/filter, auto-refresh, export | Deployments |
| 4 | `04-operations-tab.mp4` | Lock, Extend Stop/Destroy, Scale, CI filter, history | Operations |
| 5 | `05-qa-and-students.mp4` | QA types, run QA, results, students, export | QA + Students |
| 6 | `06-extras.mp4` | Live mode warning, dark mode, keyboard shortcuts, diff view | Misc features |

**Overlay improvements:**
- Replace bottom banner with **inline callout boxes** positioned near the relevant element (use absolute positioning based on element boundingBox)
- Add **top padding** (increase viewport to 1920x1120 or add 40px padding to body) to fix masthead cutoff
- Keep animated cursor and red highlights
- Add a **title card** (2-3 seconds) at the start of each video with the feature name

**Technical approach:**
- Refactor `record-demo.mjs` into a shared `recording-helpers.mjs` with overlay/cursor functions
- Create 6 separate recording scripts OR one script with chapter markers that outputs separate files
- Each video: own browser context with `recordVideo` → own WebM → ffmpeg to MP4
- After uploading CSV (needed for most videos), reuse the API upload approach

**Commands to run:**
```bash
# Start servers
uvicorn api.server:app --port 8000 &
cd frontend && npm run dev &

# Record all videos
node videos/record-demo.mjs

# Convert all WebM to MP4
for f in videos/*.webm; do
  ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
done
```

## Sample Data for Demos

- `docs/examples/full_featured.csv` — 3 workshops: Virt Roadshow, Ansible Lab, OpenShift AI (with Salesforce multi-type)
- `docs/examples/basic_workshop.csv` — 2 simple workshops
- `sample-csvs/multi-asset-passwords.csv` — password CSV for multi-asset demos

## API Endpoints (for Playwright testing)

- `POST /api/schedules/upload` — upload CSV (FormData with `file` field)
- `GET /api/schedules` — current schedules
- `GET /api/health` — cluster health check
- `POST /api/deploy` — deploy workshops
- `POST /api/qa/run` — run QA checks
- `GET /api/results` — deployment results
- `GET /api/qa/results` — QA results
- `GET /api/sessions` — session history list
