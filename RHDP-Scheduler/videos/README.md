# RHDP-Flow Demo Videos

## Videos

| # | File | Content | Duration |
|---|------|---------|----------|
| 1 | `01-upload-and-schedule.mp4` | CSV upload, schedule table, row expansion | ~15-25s |
| 2 | `02-deploy-settings.mp4` | Lock UI, White Glove, Redirect toggles, dry-run deploy | ~15-25s |
| 3 | `03-deployments-tab.mp4` | Results table, status cards, search/filter, export | ~15-25s |
| 4 | `04-operations-tab.mp4` | Resource Lock, Extend Stop/Destroy, Scale, CI filter, history | ~15-25s |
| 5 | `05-qa-and-students.mp4` | QA1/QA2 types, run QA, results, student URLs, export | ~15-25s |
| 6 | `06-extras.mp4` | Live mode warning, dark mode, keyboard shortcuts, diff view | ~20-30s |

All videos are 1920x1120 (extra 40px height to prevent masthead clipping). Use **MP4** for widest compatibility.

## How to Watch

### Option 1 — Local player (recommended)

```bash
# macOS
open videos/01-upload-and-schedule.mp4

# Linux
xdg-open videos/01-upload-and-schedule.mp4

# All chapters
for f in videos/0*.mp4; do open "$f"; done
```

### Option 2 — Download from GitHub

1. Navigate to `RHDP-Scheduler/videos/` in the repo
2. Click a video file, then click **Download raw file** (down-arrow icon)
3. Open in any local video player

### Option 3 — Embed in markdown

```html
<video src="https://github.com/rhpds/rhpds-utils/raw/main/RHDP-Scheduler/videos/01-upload-and-schedule.mp4" controls width="100%"></video>
```

## What Each Video Covers

### 01 — Upload & Schedule
- Landing page and masthead controls (dry-run, health, timezone, theme)
- CSV file upload with validation
- Parsed workshop schedule table
- Expandable row details (password, Salesforce IDs, concurrency)

### 02 — Deploy Settings
- Lock UI Admin Settings toggle
- White Glove toggle
- Redirect toggle
- Dry-run deployment (JSON payload generation)

### 03 — Deployments
- Deployment results table with GUIDs, status, URLs
- Status summary cards (Total, Verified, Unverified, Failed)
- Search and filter toolbar
- Auto-refresh and CSV export

### 04 — Operations
- Resource Lock card
- Extend Stop Time controls
- Extend Destroy Time and Scale controls
- Per-CI target filtering dropdown
- Operations History log table

### 05 — QA & Students
- QA guidance (QA1 vs QA2 timing)
- QA type selector (QA1, QA2, Both)
- QA1 & QA2 explanations
- Students tab with landing page URLs
- Copy-to-clipboard and CSV export

### 06 — Extras
- Live mode: disable dry-run and danger banner warning
- Dark mode theme toggle
- Keyboard shortcuts modal (? key)
- Compare Schedules diff view

## Recording

### Prerequisites

- **Node.js** with Playwright: `npm install playwright`
- **ffmpeg**: for WebM → MP4 conversion
- **Servers running**:
  - Backend: `uvicorn api.server:app --port 8000`
  - Frontend: `cd frontend && npm run dev`

### Record all 6 chapters

```bash
node videos/record-demo.mjs
```

This outputs 6 WebM files (`01-upload-and-schedule.webm` through `06-extras.webm`).

### Convert to MP4

```bash
for f in videos/0*.webm; do
  ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 \
    -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
done
```

### Record a single chapter

To re-record one video, edit the `CHAPTERS` array in `record-demo.mjs` to include only the desired chapter, or comment out others.

## Architecture

| File | Purpose |
|------|---------|
| `record-demo.mjs` | Main recording script — 6 chapters, each with own browser context |
| `recording-helpers.mjs` | Shared utilities: cursor, callouts, highlights, title cards, scrolling |

### Overlay system

- **Inline callout boxes** — positioned near the relevant UI element (replaces the old bottom banner)
- **Title cards** — full-screen intro at the start of each video (2-3 seconds)
- **Animated cursor** — SVG arrow with click animation
- **Red highlight glow** — outline + box-shadow on focused elements
- **Section badges** — red pill in the top-right corner showing current tab name

### Viewport

1920x1120 (40px taller than standard 1080p) to prevent the PatternFly 6 masthead from being clipped at the top of the recording.
