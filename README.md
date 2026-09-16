<div align="center">

<img src="build/icon.png" width="128" alt="bWeb icon" />

# bWeb

Download videos and audio from anywhere — YouTube, Vimeo, Twitter/X, Instagram,
and [1000+ other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) —
plus a growing set of everyday creator tools: compress, watermark, redact,
remove backgrounds, generate QR codes. Everything runs locally on your machine.
No cloud, no subscriptions, no tracking, no uploads.

**[Download the latest release](https://github.com/CellPod/bweb/releases/latest)**

</div>

<br/>

<p align="center">
  <img src="screenshots/screenshot-download.png" width="80%" alt="bWeb — download a video" />
</p>

---

## Download & Install

**[→ Download the latest release](https://github.com/CellPod/bweb/releases/latest)**

Go to the Releases page, scroll down to **Assets**, and pick the file for your system:

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `bWeb-x.x.x.dmg` |
| Windows | `bWeb-Setup-x.x.x.exe` |
| Linux | `bWeb-x.x.x.AppImage` |

> Only Apple Silicon Macs are built at the moment — no Intel (`x64`) mac build is published yet.

No dependencies to install. yt-dlp and ffmpeg are bundled inside the app.

### macOS

1. Download the `.dmg` file
2. Open it and drag bWeb to your Applications folder
3. Open bWeb

bWeb is not code-signed with an Apple certificate, so macOS will block it on first launch. On macOS Sequoia and Sonoma it shows **"bWeb is damaged and can't be opened"** — the app is fine, macOS is just enforcing its quarantine policy.

**To fix it, open Terminal and run:**

```bash
xattr -cr /Applications/bWeb.app
```

Then double-click bWeb again — it opens normally from that point on.

> If you haven't moved it to Applications yet, run `xattr -cr` on the `.dmg` file first:
> ```bash
> xattr -cr ~/Downloads/bWeb-*.dmg
> ```

You only need to do this once.

### Windows

1. Download and run the `.exe` installer
2. If SmartScreen appears, click **More info → Run anyway**
3. bWeb installs automatically and creates a shortcut

Installs per-user — no admin required. Uninstall from **Settings → Apps**.

### Linux

1. Download the `.AppImage` file
2. Make it executable: right-click → Properties → Permissions → **Allow executing as program**
3. Double-click to run

---

## Features

### Download
- **Single video** — Paste a URL, preview the metadata and thumbnail, pick a quality (4K / 2K / 1080p / 720p / 480p or lower), download as MP4 or extract audio as MP3, M4A, OPUS, FLAC, or WAV
- **Playlist** — Paste a playlist URL, select which items to download, pick a format for the whole batch
- **Batch mode** — Paste up to 50 URLs at once, pick a quality preset, add them all to the queue
- **Trim before download** — Scrub a real preview player (or drag the range slider — both stay in sync) to pick start/end points before adding to queue, or use "Mark start/end" while it plays. Supports multiple segments. Works on **live streams** too: since the total duration isn't known yet, marking is based on elapsed time since the broadcast actually started, and the download uses yt-dlp's `--live-from-start` to grab just that part

### Queue
- Sequential processing with real-time progress per item
- Pause, retry failed, clear done, or cancel all — one failure never stops the rest
- Active download strip always visible at the bottom
- In-progress downloads survive an app quit or crash — they resume as pending on next launch
- A download that stalls for 5 minutes with no progress is auto-cancelled instead of blocking the rest of the queue

### Convert
- Drop any local video or audio file to convert or trim it
- Supports MP4, MKV, MOV, AVI, WebM, MP3, WAV, FLAC, M4A, and more
- Trim with a visual timeline before converting
- Cancel mid-conversion — no partial output file left behind

### Compress
- Drop an image (JPG/PNG/WebP/AVIF/TIFF) or PDF, batch multiple files at once
- Three no-jargon presets — Maximum quality / Balanced / Smallest — ranked by actual measured output size, not a fixed setting
- Target-size mode for images: enter a size in MB and bWeb finds the closest match
- Never overwrites the original — always writes a new `_compressed` file

### Privacy (Watermark & Redact)
- **Watermark** — Tile a text or logo watermark diagonally across images or PDFs, batch mode. PDF watermarking rasterizes each page so the mark can't be stripped in a couple of clicks in Acrobat/Illustrator
- **Redact** — Draw zones over an image or PDF page to permanently black out, blur, or pixelate sensitive content. Redaction is real pixel destruction (rasterized), not a shape drawn on top that can be removed to reveal the original underneath
- **Redact PDF editor** — Real zoom (25%–400%, mouse wheel/trackpad or +/− buttons) and pan (drag or Space+drag) over the actual PDF, rendered client-side so landscape/portrait pages and fine detail (maps, technical drawings) stay sharp at any zoom level — not a fixed-resolution snapshot

### QR Code
- Generate a QR code from any link or text, live preview as you type
- Optional logo in the center (error correction is bumped automatically — nothing to configure)
- Shape: square, rounded, or circle frame — baked into the exported file, not just the preview
- Export as PNG (512/1024/2048px) or SVG

### Background Remover
- Drop, browse, or **paste an image from your clipboard** — get a transparent PNG back, runs a local AI model, nothing uploaded
- Before/after preview on a checkerboard so you can see the real transparency
- If a photo has no distinct subject to cut out (a full scene/landscape rather than a product-on-background shot), bWeb automatically falls back to trimming solid-color borders instead of handing back a blank image

### Account sign-in
- **YouTube** — Sign in to access age-restricted, private, and members-only videos. Your credentials go directly to Google through their standard login page
- **Instagram** — Sign in to download from your saved collections. The app opens Instagram's login page directly — your password is never stored
- **Vimeo** — Sign in for Pro/private videos, or import your entire Vimeo library via a personal access token (title, description, upload date, direct download — bypasses yt-dlp's Vimeo bot detection entirely)

### Instagram saved collections
yt-dlp doesn't support saved collections natively. bWeb bridges the gap with a built-in scraper:
1. Sign in via **Settings → Instagram Account**
2. Paste a saved collection URL
3. The app opens the page in a hidden browser, scrolls through it, and collects all post links
4. Results appear in a playlist-style picker — select what you want and queue

### Interface
- **French / English** — Full bilingual UI, toggle in Settings
- **Light and dark mode** — Follows your system preference, or force one in Settings
- **Download history** — Quick access to all previously fetched videos with cached metadata

### Settings
- **Download location** — Change where files are saved (defaults to `~/Downloads/bWeb`)
- **Language, theme** — see Interface above
- **Updates** — bWeb checks GitHub for a newer version on launch (and on demand from the About tab) and shows a notification with a link to the release — nothing is ever silently downloaded or installed

---

## Usage

1. Paste a video or playlist URL and click **Fetch**
2. Pick a quality or audio format
3. Click **Add to Queue**
4. Go to **Queue** and click **Start Queue**

Files are saved to `~/Downloads/bWeb` by default. Change the location in **Settings → Storage**.

You can paste and fetch multiple URLs back-to-back — each result lands in a side panel so you can review and queue them one by one.

---

## Build from Source

```bash
git clone https://github.com/CellPod/bweb.git
cd bweb
npm install
npm run dev
```

`npm install` downloads yt-dlp and ffmpeg automatically for your platform, plus the
Background Remover's ONNX model (~433MB, one-time — skipped if already present).

### Builds

```bash
npm run build:mac      # macOS — .dmg + .zip
npm run build:win      # Windows — NSIS installer
npm run build:linux    # Linux — AppImage
```

For Apple Silicon:

```bash
npm run build:mac -- --arm64
```

### Cross-platform builds

If you're building for a different architecture, set environment variables before `npm install`:

**Windows (x64) from macOS:**
```bash
export npm_config_platform=win32
export npm_config_arch=x64
rm -rf node_modules bin
npm install
npm run build:win
```

**Linux (x64):**
```bash
export npm_config_platform=linux
export npm_config_arch=x64
rm -rf node_modules bin
npm install
npm run build:linux
```

---

## Project Structure

```
bweb/
├── src/
│   ├── main/
│   │   ├── main.js              # Electron main process — window, IPC, history
│   │   ├── preload.js           # Context bridge (window.api)
│   │   ├── ytdlp.js             # yt-dlp integration — spawn, parse, download
│   │   ├── queue.js             # Sequential download queue with per-item state
│   │   ├── cookies.js           # YouTube + Instagram cookie auth
│   │   ├── scraper.js           # Instagram collection scraper (BrowserWindow)
│   │   ├── vimeoApi.js          # Vimeo API-based library import
│   │   ├── directDownload.js    # Plain-HTTPS downloader (Vimeo library items)
│   │   ├── converter.js         # Local file conversion via ffmpeg
│   │   ├── compressor.js        # Image/PDF compression (sharp + Ghostscript)
│   │   ├── ghostscriptClient.js # Talks to the Ghostscript worker subprocess
│   │   ├── ghostscriptWorker.js # Isolated subprocess running Ghostscript WASM
│   │   ├── watermark.js         # Tiled watermark, images + PDF
│   │   ├── redact.js            # Zone-based black out / blur / pixelate
│   │   ├── bgRemover.js         # Background removal (local ONNX model)
│   │   ├── qrGenerator.js       # QR export file-write helper (rendering is client-side)
│   │   ├── updater.js           # Update checker via GitHub Releases API
│   │   ├── localServer.js       # Loopback-only HTTP server the renderer loads from (not
│   │   │                        # file://, so the YouTube trim preview embed can load)
│   │   └── utils.js             # Dev mode flag, logging helpers
│   └── renderer/
│       ├── index.html      # UI structure
│       ├── renderer.js     # UI logic, state, rendering
│       ├── i18n.js         # EN/FR translations and language toggle
│       ├── index.css       # All styles
│       ├── fonts/          # Bundled Inter woff2 weights
│       └── vendor/         # Vendored client-side libs (qr-code-styling, PDF.js)
├── scripts/
│   ├── postinstall.js      # Downloads yt-dlp, ffmpeg, Deno, and the Background Remover
│   │                       # model on npm install
│   ├── release-all.js      # Automates the mac/Linux/Windows release sequence
│   └── fix-ffmpeg-win.js   # Post-pack binary permission fixes + ad-hoc code signing
├── bin/                    # yt-dlp + ffmpeg + Deno binaries (auto-populated by postinstall)
├── resources/models/       # Background Remover's ONNX model (gitignored — fetched by
│                           # postinstall, too large for a normal git push)
├── licenses/               # Third-party license texts required for bundled models
├── build/                  # App icons (icon.icns, icon.ico, icon.png)
├── package.json
├── LICENSE
└── README.md
```

---

## Credits

- [ArcDLP](https://github.com/archisvaze/arcdlp) by Archis — the foundation this project is built on (MIT)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — the engine that does all the downloading
- [Electron](https://www.electronjs.org/) — desktop app framework
- [ffmpeg](https://ffmpeg.org/) — audio/video processing (bundled per platform: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) LGPL builds on Windows/Linux, [martin-riedl.de](https://ffmpeg.martin-riedl.de/) on macOS)
- [sharp](https://github.com/lovell/sharp) — image compression and processing
- [Ghostscript](https://www.ghostscript.com/) (via [@jspawn/ghostscript-wasm](https://github.com/jsscheller/ghostscript-wasm)) — PDF compression/rasterization
- [qr-code-styling](https://github.com/kozakdenys/qr-code-styling) — QR code rendering
- [withoutBG](https://github.com/withoutbg/withoutbg-python) — Background Remover model (built with [DINOv3](https://ai.meta.com/resources/models-and-libraries/dinov3-license/))
- [Iconoir](https://iconoir.com) — icon set (MIT)
- [PDF.js](https://mozilla.github.io/pdf.js/) — client-side PDF rendering for the Redact editor (Apache-2.0)

---

## License

[MIT](LICENSE) — see the license file for details.
