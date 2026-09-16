# RHDP-Flow Demo Videos

9 short demo videos: **7 for the Web UI** and **2 for the CLI**.

All videos are 1920x1120, H.264 MP4. Use any local video player or download from GitHub.

---

## Web UI Demos (chapters 01–07)

Recorded from the React + PatternFly 6 frontend (`localhost:5173`).

| # | File | Content | Duration |
|---|------|---------|----------|
| 1 | `01-upload-and-schedule.mp4` | CSV upload, schedule table, row expansion | ~20s |
| 2 | `02-deploy-settings.mp4` | Lock UI, White Glove, Redirect toggles, dry-run deploy | ~28s |
| 3 | `03-deployments-tab.mp4` | Results table, status cards, search/filter, export | ~26s |
| 4 | `04-operations-tab.mp4` | Resource Lock, Extend Stop/Destroy, Scale, CI filter, history | ~32s |
| 5 | `05-qa-and-students.mp4` | QA1/QA2 types, run QA, results, student URLs, export | ~31s |
| 6 | `06-extras.mp4` | Live mode warning, dark mode, keyboard shortcuts, diff view | ~37s |
| 7 | `07-labagator-integration.mp4` | Labagator import/export workflow, session conversion | ~35s |

## CLI Demos (chapters 07–08)

Recorded from a simulated terminal showing `rhdp_flow.py` commands and output.

| # | File | Content | Duration |
|---|------|---------|----------|
| 7 | `07-cli-deploy-and-qa.mp4` | Help, dry-run, live deploy, CI filter, QA1 & QA2 verification | ~52s |
| 8 | `08-cli-ops-and-wizard.mp4` | Lock, extend stop/destroy, scale, import namespace, sync, update passwords, interactive wizard | ~71s |

---

## How to Watch

### Option 1 — Local player (recommended)

```bash
# macOS — play one video
open videos/01-upload-and-schedule.mp4

# macOS — play all Web UI demos
for f in videos/0{1..7}*.mp4; do open "$f"; done

# macOS — play all CLI demos
for f in videos/0{7..8}*.mp4; do open "$f"; done

# Linux
xdg-open videos/07-cli-deploy-and-qa.mp4
```

### Option 2 — Download from GitHub

1. Navigate to `RHDP-Scheduler/videos/` in the repo
2. Click a video file, then click **Download raw file** (down-arrow icon)
3. Open in any local video player

### Option 3 — Embed in markdown

```html
<video src="https://github.com/rhpds/rhpds-utils/raw/main/RHDP-Scheduler/videos/01-upload-and-schedule.mp4" controls width="100%"></video>
```

---

## What Each Video Covers

### Web UI

#### 01 — Upload & Schedule
- Landing page and masthead controls (dry-run, health, timezone, theme)
- CSV file upload with validation
- Parsed workshop schedule table
- Expandable row details (password, Salesforce IDs, concurrency)

#### 02 — Deploy Settings
- Lock UI Admin Settings toggle
- White Glove toggle
- Redirect toggle
- Dry-run deployment (JSON payload generation)

#### 03 — Deployments
- Deployment results table with GUIDs, status, URLs
- Status summary cards (Total, Verified, Unverified, Failed)
- Search and filter toolbar
- Auto-refresh and CSV export

#### 04 — Operations
- Resource Lock card
- Extend Stop Time controls
- Extend Destroy Time and Scale controls
- Per-CI target filtering dropdown
- Operations History log table

#### 05 — QA & Students
- QA guidance (QA1 vs QA2 timing)
- QA type selector (QA1, QA2, Both)
- QA1 & QA2 explanations
- Students tab with landing page URLs
- Copy-to-clipboard and CSV export

#### 06 — Extras
- Live mode: disable dry-run and danger banner warning
- Dark mode theme toggle
- Keyboard shortcuts modal (? key)
- Compare Schedules diff view

#### 07 — Labagator Integration
- Toggle to Labagator Sessions import mode
- Labagator CSV format explanation (session code, title, dates, room)
- Upload Labagator session export CSV
- Auto-conversion to Flow workshop format
- View transformed schedules
- Export back to Labagator format for session updates

### CLI

#### 07 — Deploy & QA
- `--help` — full flag and option reference
- `--dry-run` — safe preview of JSON payloads without provisioning
- Live deployment — ResourceClaim, Workshop, and WorkshopProvision creation
- `--ci` — filter to a specific catalog item
- `--qa both` — QA1 (verify setup) and QA2 (verify deployment health and URLs)

#### 08 — Operations & Wizard
- `--lock` — set `demo.redhat.com/lock-enabled` label
- `--extend-stop --hours 4` — push back auto-stop time
- `--extend-destroy --days 2` — push back cleanup deadline
- `--scale 40` — adjust seat count
- `--import-namespace` — discover workshops on cluster and export to CSV
- `--sync` — compare master vs local CSV and write merged output
- `--update-passwords` — detect changed passwords and patch on cluster
- `--wizard` — interactive step-by-step CSV builder

---

## Recording

### Prerequisites

- **Node.js** with Playwright: `npm install playwright`
- **ffmpeg**: for WebM → MP4 conversion

### Record Web UI videos (requires servers running)

```bash
# Start servers first
uvicorn api.server:app --port 8000 &
cd frontend && npm run dev &

# Record 7 Web UI chapters
node videos/record-demo.mjs
```

### Record CLI videos (no servers needed)

```bash
# Record 2 CLI chapters (uses local HTML terminal simulator)
node videos/record-cli-demo.mjs
```

### Convert all to MP4

```bash
for f in videos/0*.webm; do
  ffmpeg -i "$f" -c:v libx264 -preset slow -crf 22 \
    -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
done
```

### Record a single chapter

Edit the `CHAPTERS` array in `record-demo.mjs` or `record-cli-demo.mjs` to include only the desired chapter.

---

## Architecture

| File | Purpose |
|------|---------|
| `record-demo.mjs` | Web UI recording — 6 chapters, navigates frontend at `localhost:5173` |
| `record-cli-demo.mjs` | CLI recording — 2 chapters, renders `cli-terminal.html` in browser |
| `recording-helpers.mjs` | Shared utilities: cursor, callouts, highlights, title cards, terminal API |
| `cli-terminal.html` | Browser-rendered terminal simulator (macOS-style, Catppuccin colors) |

### Overlay system (shared by both Web UI and CLI videos)

- **Title cards** — full-screen intro at the start of each video (2-3 seconds)
- **Inline callout boxes** — numbered step annotations positioned near relevant content
- **Animated cursor** — SVG arrow with click animation (Web UI videos)
- **Red highlight glow** — outline + box-shadow on focused elements (Web UI videos)
- **Section badges** — red pill in the top-right corner showing current section name

### Viewport

1920x1120 (40px taller than standard 1080p) to prevent PatternFly 6 masthead clipping in Web UI videos.
