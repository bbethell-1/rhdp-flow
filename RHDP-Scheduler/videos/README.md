# RHDP-Flow Demo Videos

## Files

| File | Format | Size | Duration |
|------|--------|------|----------|
| `rhdp-flow-demo.mp4` | H.264/MP4 | ~4.4 MB | ~1:50 |
| `rhdp-flow-demo.webm` | VP8/WebM | ~9.7 MB | ~1:50 |
| `record-demo.mjs` | Script | — | — |

Both videos are 1920x1080 and cover the same content. Use **MP4** for widest
compatibility.

## How to Watch

### Option 1 — Local player (recommended)

```bash
# macOS (QuickTime)
open videos/rhdp-flow-demo.mp4

# Linux
xdg-open videos/rhdp-flow-demo.mp4

# Windows
start videos\rhdp-flow-demo.mp4
```

Any video player works: QuickTime, VLC, Windows Media Player, mpv, etc.

### Option 2 — Download from GitHub

1. Navigate to `RHDP-Scheduler/videos/rhdp-flow-demo.mp4` in the repo
2. Click the **Download raw file** button (down-arrow icon, top-right of the file view)
3. Open the downloaded file in any local video player

> GitHub does **not** play video files inline on the file view page. You must
> download the raw file first.

### Option 3 — Browser playback via raw URL

Copy the raw file URL from GitHub and paste it directly into your browser
address bar:

```
https://github.com/rhpds/rhpds-utils/raw/main/RHDP-Scheduler/videos/rhdp-flow-demo.mp4
```

Most browsers (Chrome, Firefox, Edge, Safari) will play MP4 files natively
when opened as a direct URL.

### Option 4 — Embed in markdown

To embed the video in a GitHub README, issue, or PR description:

```html
<video src="https://github.com/rhpds/rhpds-utils/raw/main/RHDP-Scheduler/videos/rhdp-flow-demo.mp4" controls width="100%"></video>
```

> Note: `<video>` tags work in GitHub markdown (READMEs, issues, PR
> descriptions) but not in all markdown renderers.

## What the Demo Covers

The video walks through every major feature of the RHDP-Flow web UI:

1. **Landing page** — empty state, masthead controls (dry-run, health, timezone, theme)
2. **CSV upload** — schedule file upload and validation
3. **Schedule table** — parsed workshops with expandable row details
4. **Deploy settings** — Lock UI, Resource Pools, White Glove, Redirect toggles
5. **Dry-run deployment** — JSON payload preview without provisioning
6. **Deployments tab** — results table, status cards, search/filter, auto-refresh, CSV export
7. **Operations tab** — Resource Lock, Extend Stop, Extend Destroy, Scale with per-CI filtering
8. **QA tab** — QA1/QA2 types, run controls, results table, status filters
9. **Students tab** — landing page URLs, copy-to-clipboard, CSV export
10. **Live mode** — dry-run toggle with danger banner warning
11. **Dark mode & keyboard shortcuts** — theme toggle, shortcut modal
12. **Diff view** — compare schedules for added/removed/changed workshops

## Re-recording

To record a new version of the demo:

```bash
# 1. Start the servers
uvicorn api.server:app --port 8000 &
cd frontend && npm run dev &

# 2. Record (requires Playwright: npm i -g playwright)
node videos/record-demo.mjs

# 3. Convert to MP4 (requires ffmpeg)
ffmpeg -i videos/rhdp-flow-demo.webm \
  -c:v libx264 -preset slow -crf 20 \
  -pix_fmt yuv420p -movflags +faststart \
  videos/rhdp-flow-demo.mp4
```

The recording script (`record-demo.mjs`) includes:
- Animated cursor that moves to each interactive element
- Step-by-step text banners describing every action
- Red highlight outlines on key elements
- Section title badges in the corner
