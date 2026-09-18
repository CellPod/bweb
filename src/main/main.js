// Main Process
// Electron entry point. Window, IPC, app lifecycle.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol } = require('electron');
const converter = require('./converter');
const imageConverter = require('./imageConverter');
const docConverter = require('./docConverter');
const compressor = require('./compressor');
const watermark = require('./watermark');
const redact = require('./redact');
const qrGenerator = require('./qrGenerator');
const bgRemover = require('./bgRemover');
const path = require('path');
// v11+ is ESM-only; require(esm) (stable since Node 23, bundled by Electron 43) resolves it,
// but the interop wraps the export in { default }.
const Store = require('electron-store').default;
const ytdlp = require('./ytdlp');
const cookies = require('./cookies');
const { queue } = require('./queue');
const updater = require('./updater');
const depUpdater = require('./depUpdater');
const sparkleUpdater = require('./sparkleUpdater');
const winSparkleUpdater = require('./winSparkleUpdater');
const scraper = require('./scraper');
const vimeoApi = require('./vimeoApi');
const { DEV_MODE, log, logError, getLogFilePath } = require('./utils');
const fs = require('fs');
const { startLocalServer, MEDIA_MIME_TYPES } = require('./localServer');

function mimeTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MEDIA_MIME_TYPES[ext] || 'application/octet-stream';
}

// Shared by Compress/Watermark/Redact's file pickers, which all accept the same image+PDF
// inputs. macOS/Windows dialogs restrict selection to whichever filter is active, and
// default to the first one — with Images/PDF as separate groups, PDFs looked disabled/
// unselectable until the user manually switched the filter dropdown. One combined group
// first fixes that.
const IMAGE_AND_PDF_FILTERS = [
    { name: 'Images & PDF', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif', 'pdf'] },
    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif'] },
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'All files', extensions: ['*'] },
];

// Every input format anydoc can turn into Markdown (see docConverter.js) — Convert's
// Document sub-view file picker.
const DOCUMENT_FILTERS = [
    {
        name: 'Documents',
        extensions: ['doc', 'docx', 'docm', 'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm', 'xls', 'xlsx', 'xlsm', 'xlsb', 'odt', 'ods', 'odp', 'rtf', 'epub', 'csv', 'pdf'],
    },
    { name: 'All files', extensions: ['*'] },
];

function readFileRange(filePath, start, end) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

const APP_NAME = 'bWeb';

// The renderer now loads over http://127.0.0.1 (see localServer.js), not file://, so
// Electron's own URL safety check blocks a plain file:// <video src> from that origin
// ("Media load rejected by URL safety check"). This custom scheme is the sanctioned way
// to hand the renderer a local file it can actually play — it just proxies to a real
// file:// read from the trusted main process, for the Convert tab's local-file preview.
protocol.registerSchemesAsPrivileged([
    { scheme: 'bweb-file', privileges: { stream: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Updates are check-and-redirect only: we point people at the GitHub release page
// instead of silently downloading + installing in place. electron-updater's silent
// install (Squirrel.Mac / NSIS) was tried and turned out unreliable on an ad-hoc-signed
// (unpaid) mac build — quitAndInstall() failed with no visible error and no trace
// anywhere, leaving a user stuck on an old version with no way to tell what went wrong.
// A manual download+reinstall always works, so that's the only path now.
let mainWindow = null;

process.on('uncaughtException', (err) => {
    logError('Uncaught exception:', err.message);
    send('log', `Error: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
    logError('Unhandled rejection:', err?.message || err);
    send('log', `Error: ${err?.message || 'Unknown error'}`);
});

let store = null;
let cachedVersions = { ytdlp: null, ffmpeg: null, deno: null };

function send(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// Forwards Sparkle's update lifecycle straight to the renderer, which owns the actual
// banner UI (see showSparkleBanner() in renderer.js) — Sparkle's own native dialogs are
// suppressed by the bridge specifically so bWeb can show something consistent with the
// rest of the app instead.
function handleSparkleEvent(event) {
    send('sparkle:event', event);
}

async function createWindow() {
    const isMac = process.platform === 'darwin';

    mainWindow = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 700,
        minHeight: 500,
        backgroundColor: isMac ? '#00000000' : '#f5f5f7',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : {}),
        ...(isMac ? { vibrancy: 'under-window' } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: DEV_MODE,
        },
        show: false,
    });

    const { port } = await startLocalServer(path.join(__dirname, '..', 'renderer'));
    mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (DEV_MODE) mainWindow.webContents.openDevTools({ mode: 'detach' });
        log('Window ready');

        // Check for updates as soon as the window is ready — no artificial delay tacked on
        // top (this used to wait a flat extra 3s here, which is what made the update prompt
        // feel like it showed up 5-10s after launch instead of right away). Safe to fire
        // immediately at this exact point specifically: renderer.js is a plain synchronous,
        // non-deferred <script> at the end of index.html's body, so Chromium cannot paint
        // anything — meaning 'ready-to-show' cannot fire — until it has already finished
        // running, which is what registers the onSparkleEvent/onUpdateAvailable listeners
        // this depends on. Moving this any earlier (e.g. right at app.whenReady(), before
        // the window/renderer exist at all) would race that registration and could silently
        // drop the event for the macOS custom-banner and Linux-fallback paths.
        //
        // On macOS this hands off entirely to Sparkle (sparkleUpdater.js) — its own events
        // drive the renderer banner instead, see handleSparkleEvent below. On Windows it
        // hands off to WinSparkle (winSparkleUpdater.js), which shows its own native
        // dialogs — nothing further for main.js to wire up there, and no renderer
        // dependency either, so it doesn't need this timing guarantee at all. Falls back to
        // the manual GitHub-release check (updater.js) on Linux, or on macOS/Windows if the
        // native bridge failed to load (both bridges must never block startup on failure —
        // see their own init()).
        (async () => {
            const sparkleReady = await sparkleUpdater.init(handleSparkleEvent);
            if (sparkleReady) {
                sparkleUpdater.checkForUpdates();
                return;
            }

            if (winSparkleUpdater.init()) {
                return; // WinSparkle checks automatically on its own timer once initialized
            }

            try {
                const result = await updater.checkForUpdates(app.getVersion());
                if (result.hasUpdate) {
                    log('Update available:', result.latest);
                    send('update-available', result);
                }
            } catch (err) {
                logError('Startup update check failed:', err.message);
            }
        })();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    log('App starting, DEV_MODE:', DEV_MODE);
    log('Platform:', process.platform, process.arch);

    protocol.handle('bweb-file', async (request) => {
        const encodedPath = request.url.slice('bweb-file://'.length).replace(/^\/+/, '');
        const filePath = decodeURIComponent(encodedPath);

        let stat;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            return new Response('Not found', { status: 404 });
        }

        const contentType = mimeTypeFor(filePath);
        const fileSize = stat.size;

        // <video>/<audio> needs real byte-range support to determine duration and to seek —
        // without it (e.g. the old plain net.fetch(file://...) passthrough), some containers
        // like WAV never resolve a finite duration and scrubbing silently does nothing.
        //
        // Two things matter here, both found by testing real playback (not just checking that
        // the HTTP response looked correct):
        // 1. An open-ended range ("bytes=0-") must NOT be answered with the entire rest of the
        //    file in one response. Chromium's media pipeline sends that request as a metadata
        //    probe expecting a small reply, then issues further Range requests as it actually
        //    needs more — handing back e.g. a 20MB single response instead silently produced a
        //    video element stuck at readyState 4 with correct duration/dimensions but every
        //    decoded frame black and playback time frozen at 0, no error ever surfaced.
        // 2. The body must be a real, fully-read Buffer, not `Readable.toWeb(fs.createReadStream)`
        //    — that combination measured as returning a near-empty body (a couple bytes) despite
        //    Content-Length claiming the full range, even though the network log reported 206
        //    success. Buffering the (now capped, so small) range directly avoids that.
        const RANGE_CHUNK_CAP = 2 * 1024 * 1024; // 2MB — plenty for a probe or a seek buffer-ahead
        const range = request.headers.get('range');
        if (range) {
            const match = /bytes=(\d+)-(\d+)?/.exec(range);
            const start = match ? parseInt(match[1], 10) : 0;
            const end = match && match[2]
                ? Math.min(parseInt(match[2], 10), fileSize - 1)
                : fileSize - 1;
            const buffer = await readFileRange(filePath, start, end);
            return new Response(buffer, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(buffer.length),
                    'Content-Type': contentType,
                },
            });
        }

        const buffer = await fs.promises.readFile(filePath);
        return new Response(buffer, {
            status: 200,
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(fileSize),
                'Content-Type': contentType,
            },
        });
    });

    store = new Store({
        name: 'app-config',
        defaults: {
            downloadPath: path.join(app.getPath('downloads'), APP_NAME),
            convertDestPath: path.join(app.getPath('downloads'), APP_NAME),
            compressDestPath: path.join(app.getPath('downloads'), APP_NAME),
            compressAutoOpen: false,
            watermarkDestPath: path.join(app.getPath('downloads'), APP_NAME),
            redactDestPath: path.join(app.getPath('downloads'), APP_NAME),
            qrDestPath: path.join(app.getPath('downloads'), APP_NAME),
            bgRemoveDestPath: path.join(app.getPath('downloads'), APP_NAME),
            history: [],
            vimeoApiToken: '',
            onboardingCompleted: false,
            legalAcknowledged: false,
        },
    });

    createWindow();

    // Fetch dependency versions in the background, then check whether yt-dlp/ffmpeg/deno
    // themselves are stale — each moves on its own release schedule, faster than bWeb
    // itself ships, so this is what actually keeps the app working between bWeb updates
    // (see depUpdater.js). Deliberately silent/background-only — no update UI for these,
    // unlike a real bWeb release (see the Sparkle modal in renderer.js).
    ytdlp
        .getVersions()
        .then(async (v) => {
            cachedVersions = v;
            log('Versions cached:', JSON.stringify(v));

            const [ytdlpUpdate, ffmpegUpdate, denoUpdate] = await Promise.all([
                depUpdater.maybeUpdateYtdlp(v.ytdlp),
                depUpdater.maybeUpdateFfmpeg(v.ffmpeg),
                depUpdater.maybeUpdateDeno(v.deno),
            ]);

            if (ytdlpUpdate) send('log', `yt-dlp mis à jour automatiquement : ${ytdlpUpdate.previous} → ${ytdlpUpdate.latest}`);
            if (ffmpegUpdate) send('log', `ffmpeg mis à jour automatiquement : ${ffmpegUpdate.previous} → ${ffmpegUpdate.latest}`);
            if (denoUpdate) send('log', `deno mis à jour automatiquement : ${denoUpdate.previous} → ${denoUpdate.latest}`);

            if (ytdlpUpdate || ffmpegUpdate || denoUpdate) {
                ytdlp
                    .getVersions()
                    .then((v2) => {
                        cachedVersions = v2;
                    })
                    .catch(() => {
                        //
                    });
            }
        })
        .catch((err) => {
            logError('Version fetch failed:', err.message);
        });

    // Wire queue callbacks to renderer
    queue.setCallbacks({
        onLog: (msg) => send('log', msg),
        onItemUpdate: (item) => send('queue:itemUpdate', item),
        onQueueUpdate: (data) => send('queue:update', data),
        onItemComplete: (item) => {
            // Add completed downloads to history, skip if already there
            const history = store.get('history') || [];
            const alreadyExists = history.some((h) => h.info.webpage_url === item.url);
            if (!alreadyExists) {
                addToHistory(
                    {
                        id: item.url,
                        title: item.title,
                        thumbnail: item.thumbnail,
                        extractor_key: 'download',
                        webpage_url: item.url,
                    },
                    [],
                );
            }
        },
    });
    queue.setStore(store);
    queue.setDownloadPath(store.get('downloadPath'));

    // Restore pending items from previous session
    const pendingItems = store.get('queue.pending') || [];
    if (pendingItems.length) {
        queue.loadPersisted(pendingItems);
        store.set('queue.pending', []);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Kill any running yt-dlp process to prevent orphans
    queue.cancelCurrent();
    winSparkleUpdater.cleanup();
});

// Max 50 history entries, deduped by video id + extractor
const MAX_HISTORY = 50;

function addToHistory(info, presets) {
    const history = store.get('history') || [];
    const key = `${info.extractor_key}:${info.id}`;

    // Remove existing entry for same video
    const filtered = history.filter((h) => `${h.info.extractor_key}:${h.info.id}` !== key);

    filtered.unshift({
        info,
        presets,
        fetchedAt: Date.now(),
    });

    store.set('history', filtered.slice(0, MAX_HISTORY));
    log('History updated, total:', Math.min(filtered.length, MAX_HISTORY));
}

ipcMain.handle('history:get', () => {
    return store.get('history') || [];
});

ipcMain.handle('history:remove', (_e, videoId, extractorKey) => {
    const history = store.get('history') || [];
    const filtered = history.filter((h) => !(h.info.id === videoId && h.info.extractor_key === extractorKey));
    store.set('history', filtered);
    log('History entry removed:', extractorKey, videoId);
    return filtered;
});

ipcMain.handle('history:clear', () => {
    store.set('history', []);
    log('History cleared');
    return [];
});

ipcMain.handle('deps:check', () => {
    log('Checking dependencies...');
    return ytdlp.checkDeps();
});

ipcMain.handle('deps:versions', () => {
    return cachedVersions;
});

ipcMain.handle('video:fetch', async (_e, url) => {
    log('Fetch requested:', url);
    send('log', 'Fetching video info...');

    try {
        const { info, raw } = await ytdlp.fetchInfo(url, {
            onLog: (msg) => send('log', msg),
        });
        const presets = ytdlp.buildPresets(info.formats, info.duration);
        send('log', `Found: ${info.title}`);
        log('Presets:', presets.map((p) => p.label).join(', '));

        addToHistory(info, presets);

        return { info, presets, raw };
    } catch (err) {
        send('log', `Error: ${err.message}`);
        throw err;
    }
});

ipcMain.handle('clipboard:read', () => clipboard.readText());

ipcMain.handle('settings:getDownloadPath', () => store.get('downloadPath'));

ipcMain.handle('settings:chooseDownloadPath', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return store.get('downloadPath');
    }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose download folder',
    });
    if (!result.canceled && result.filePaths[0]) {
        store.set('downloadPath', result.filePaths[0]);
        queue.setDownloadPath(result.filePaths[0]);
        log('Download path changed:', result.filePaths[0]);
        return result.filePaths[0];
    }
    return store.get('downloadPath');
});

ipcMain.handle('settings:openFolder', (_e, folderPath) => {
    shell.openPath(folderPath || store.get('downloadPath'));
});

ipcMain.handle('settings:openLogs', () => {
    const file = getLogFilePath();
    if (file) shell.showItemInFolder(file);
});

ipcMain.handle('settings:openExternal', (_e, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    devMode: DEV_MODE,
    platform: process.platform,
    arch: process.arch,
}));

ipcMain.handle('app:checkForUpdates', async () => {
    if (sparkleUpdater.isAvailable()) {
        sparkleUpdater.checkForUpdates(); // answer arrives async via 'sparkle:event'
        return { sparkle: true, hasUpdate: false };
    }
    if (winSparkleUpdater.isAvailable()) {
        winSparkleUpdater.checkForUpdates(); // shows WinSparkle's own native dialog
        return { sparkle: true, hasUpdate: false };
    }
    const result = await updater.checkForUpdates(app.getVersion());
    if (result.hasUpdate) send('update-available', result);
    return result;
});

ipcMain.handle('sparkle:installUpdateNow', () => {
    sparkleUpdater.installUpdateNow();
});

ipcMain.handle('sparkle:installUpdateOnQuit', () => {
    sparkleUpdater.installUpdateOnQuit();
});

// "Skip this version" / "automatically install" preferences for the update modal — plain
// persisted values, no Sparkle-side equivalent (its permission-request API only covers the
// one-time "may Sparkle check automatically at all" question, already answered in
// sparkleUpdater.js's init()).
ipcMain.handle('sparkle:getSkippedVersion', () => store.get('updateSkippedVersion') || null);
ipcMain.handle('sparkle:setSkippedVersion', (_e, version) => {
    store.set('updateSkippedVersion', version || null);
});
ipcMain.handle('sparkle:getAutoInstall', () => !!store.get('updateAutoInstall'));
ipcMain.handle('sparkle:setAutoInstall', (_e, enabled) => {
    store.set('updateAutoInstall', !!enabled);
});

// First-run onboarding wizard, plus a one-time responsible-use acknowledgment. Two
// separate flags on purpose: legal is gated on onboarding being done first, so it
// never adds friction to the initial setup screen.
ipcMain.handle('onboarding:isCompleted', () => !!store.get('onboardingCompleted'));
ipcMain.handle('onboarding:complete', () => {
    store.set('onboardingCompleted', true);
});
ipcMain.handle('legal:isAcknowledged', () => !!store.get('legalAcknowledged'));
ipcMain.handle('legal:acknowledge', () => {
    store.set('legalAcknowledged', true);
});

// Auth — YouTube/Instagram/Vimeo all share the same cookie-based check/login/logout shape,
// differing only in which cookies.js methods back them and the label shown in log/toast text.
function registerAuthHandlers(prefix, label, cancelMessage, api) {
    ipcMain.handle(`${prefix}:check`, () => api.hasCookies());

    ipcMain.handle(`${prefix}:login`, async () => {
        log(`Opening ${label} login window`);
        send('log', `Opening ${label} sign-in...`);
        const success = await api.openLoginWindow(mainWindow);
        if (success) {
            send('log', `Signed in to ${label} ✓`);
            log(`${label} login successful`);
        } else {
            send('log', cancelMessage);
            log(`${label} login cancelled`);
        }
        return success;
    });

    ipcMain.handle(`${prefix}:logout`, async () => {
        await api.clearCookies();
        send('log', `Signed out of ${label}`);
        log(`${label} logout`);
        return true;
    });
}

registerAuthHandlers('auth', 'YouTube', 'Sign-in cancelled', {
    hasCookies: cookies.hasCookies,
    openLoginWindow: cookies.openLoginWindow,
    clearCookies: cookies.clearCookies,
});

registerAuthHandlers('insta', 'Instagram', 'Instagram sign-in cancelled', {
    hasCookies: cookies.hasInstaCookies,
    openLoginWindow: cookies.openInstaLoginWindow,
    clearCookies: cookies.clearInstaCookies,
});

registerAuthHandlers('vimeo', 'Vimeo', 'Vimeo sign-in cancelled', {
    hasCookies: cookies.hasVimeoCookies,
    openLoginWindow: cookies.openVimeoLoginWindow,
    clearCookies: cookies.clearVimeoCookies,
});

// Vimeo API (Personal Access Token) — lists the account's library (personal + team)
// via the official REST API. Used instead of scraping vimeo.com/library, which is
// blocked by Vimeo's bot protection and doesn't expose description/real content date anyway.

ipcMain.handle('vimeo:getToken', () => store.get('vimeoApiToken') || '');

ipcMain.handle('vimeo:saveToken', (_e, token) => {
    store.set('vimeoApiToken', token || '');
    return true;
});

ipcMain.handle('vimeo:fetchLibrary', async () => {
    const token = store.get('vimeoApiToken');
    log('Vimeo library fetch requested');
    send('log', 'Fetching Vimeo library...');

    try {
        const { items, total } = await vimeoApi.fetchLibrary(token, {
            onLog: (msg) => send('log', msg),
        });

        const downloadPath = store.get('downloadPath');
        const manifestPath = writeVimeoManifest(items, downloadPath);

        send('log', `Vimeo library: ${items.length}/${total} videos found`);
        log('Vimeo library fetched:', items.length, 'items, manifest:', manifestPath);
        return { items, total, manifestPath };
    } catch (err) {
        send('log', `Vimeo library error: ${err.message}`);
        throw err;
    }
});

ipcMain.handle('vimeo:getVideoFile', async (_e, videoId) => {
    const token = store.get('vimeoApiToken');
    try {
        return await vimeoApi.getVideoFile(token, videoId);
    } catch (err) {
        log('Vimeo getVideoFile error:', err.message);
        throw err;
    }
});

function writeVimeoManifest(items, downloadPath) {
    try {
        fs.mkdirSync(downloadPath, { recursive: true });
    } catch {
        //
    }

    const jsonPath = path.join(downloadPath, 'vimeo-library.json');
    fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), 'utf8');

    const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['id', 'name', 'description', 'link', 'duration', 'createdTime', 'detectedYear', 'displayTitle'];
    const rows = items.map((it) => header.map((k) => csvEscape(it[k])).join(','));
    const csvPath = path.join(downloadPath, 'vimeo-library.csv');
    fs.writeFileSync(csvPath, [header.join(','), ...rows].join('\n'), 'utf8');

    return jsonPath;
}

// Instagram Collection Scraper

ipcMain.handle('scraper:collection', async (_e, url) => {
    if (!url || !url.startsWith('https://www.instagram.com/')) {
        throw new Error('Invalid Instagram URL');
    }
    log('Scraper: collection requested:', url);
    send('log', 'Scraping Instagram collection...');

    try {
        const result = await scraper.scrapeCollection(url, mainWindow, {
            onLog: (msg) => send('log', msg),
            onItem: (item, count) => send('scraper:item', { item, count }),
        });

        send('log', `Found ${result.items.length} posts in collection`);
        log('Scraper: found', result.items.length, 'items');
        return result;
    } catch (err) {
        send('log', `Scraper error: ${err.message}`);
        throw err;
    }
});

// Playlist

ipcMain.handle('playlist:fetch', async (_e, url) => {
    log('Playlist fetch requested:', url);
    send('log', 'Fetching playlist...');

    try {
        const result = await ytdlp.fetchPlaylist(url, {
            onLog: (msg) => send('log', msg),
            onItem: (item, count) => send('playlist:item', { item, count }),
        });

        send('log', `Playlist: ${result.items.length} items found`);
        log('Playlist items:', result.items.length);
        return result;
    } catch (err) {
        send('log', `Error: ${err.message}`);
        throw err;
    }
});

ipcMain.handle('playlist:detect', (_e, url) => {
    return ytdlp.looksLikePlaylist(url);
});

ipcMain.handle('video:batchMeta', async (_e, urls) => {
    const capped = (Array.isArray(urls) ? urls : []).slice(0, 500);
    const results = await Promise.allSettled(capped.map((url) => ytdlp.fetchMeta(url)));
    return results.map((r, i) => ({
        url: capped[i],
        title: r.status === 'fulfilled' ? r.value.title : capped[i],
        thumbnail: r.status === 'fulfilled' ? r.value.thumbnail : null,
    }));
});

// Queue

ipcMain.handle('queue:add', (_e, items) => {
    log('Queue: adding', items.length, 'items');
    return queue.add(items);
});

ipcMain.handle('queue:cancelCurrent', () => {
    queue.cancelCurrent();
    return { ok: true };
});

ipcMain.handle('queue:cancelAll', () => {
    queue.cancelAll();
    return { ok: true };
});

ipcMain.handle('queue:retry', (_e, itemId) => {
    queue.retry(itemId);
    return { ok: true };
});

ipcMain.handle('queue:retryFailed', () => {
    queue.retryFailed();
    return { ok: true };
});

ipcMain.handle('queue:clearCompleted', () => {
    queue.clearCompleted();
    return { ok: true };
});

ipcMain.handle('queue:remove', (_e, itemId) => {
    queue.remove(itemId);
    return { ok: true };
});

ipcMain.handle('queue:start', () => {
    queue.start();
    return { ok: true };
});

ipcMain.handle('queue:pause', () => {
    queue.pause();
    return { ok: true };
});

// Converter

ipcMain.handle('convert:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select media file(s)',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Media files', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'opus', 'ogg'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled) return [];
    return result.filePaths;
});

let currentConvertHandle = null;

ipcMain.handle('convert:file', async (_e, { inputPath, format, startTime, endTime }) => {
    log('Convert requested:', inputPath, '->', format, startTime ? `[${startTime} - ${endTime || 'end'}]` : '');
    const ffmpegBin = ytdlp.getFfmpegPath();
    const destDir = store.get('convertDestPath');
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = converter.getOutputPath(inputPath, format, startTime, endTime, destDir);
    if (!outputPath) throw new Error(`Unknown format: ${format}`);

    const handle = {};
    currentConvertHandle = handle;

    try {
        const result = await converter.convertFile(
            ffmpegBin,
            inputPath,
            outputPath,
            format,
            (p) => send('convert:progress', p),
            (msg) => send('log', msg),
            startTime || null,
            endTime || null,
            handle,
        );
        send('log', `Conversion complete ✓ → ${outputPath}`);
        return result;
    } catch (err) {
        if (err.message === 'Cancelled') {
            // Delete the partial/corrupt output ffmpeg was killed mid-write to.
            try {
                fs.unlinkSync(outputPath);
            } catch { /**/ }
            send('log', 'Conversion cancelled');
        } else {
            send('log', `Conversion failed: ${err.message}`);
        }
        throw err;
    } finally {
        currentConvertHandle = null;
    }
});

ipcMain.handle('convert:cancel', () => {
    if (currentConvertHandle && currentConvertHandle.cancel) {
        currentConvertHandle.cancel();
        return true;
    }
    return false;
});

// Image conversion — a sub-view of Convert, not a separate tool: shares the same "Saving
// to" destination/auto-open (registerDestPathHandlers('convert', ...) below) as the video
// side, since it's one output folder per Convert session either way.
ipcMain.handle('imgconvert:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select image file(s)',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif', 'gif', 'heic', 'heif'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled) return [];
    return result.filePaths;
});

ipcMain.handle('imgconvert:file', async (_e, { inputPath, format }) => {
    log('Image convert requested:', inputPath, '->', format);
    const ffmpegBin = ytdlp.getFfmpegPath();
    const destDir = store.get('convertDestPath');
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = imageConverter.getImageOutputPath(inputPath, format, destDir);
    if (!outputPath) throw new Error(`Unknown image format: ${format}`);

    try {
        const result = await imageConverter.convertImage(ffmpegBin, inputPath, outputPath, format);
        send('log', `Image conversion complete ✓ → ${outputPath}`);
        return result;
    } catch (err) {
        send('log', `Image conversion failed: ${err.message}`);
        throw err;
    }
});

// Document conversion — the third Convert sub-view, same shared destination as Video/Image.
ipcMain.handle('docconvert:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select document file(s)',
        properties: ['openFile', 'multiSelections'],
        filters: DOCUMENT_FILTERS,
    });
    if (result.canceled) return [];
    return result.filePaths;
});

ipcMain.handle('docconvert:file', async (_e, { inputPath, format }) => {
    log('Document convert requested:', inputPath, '->', format);
    const destDir = store.get('convertDestPath');
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = docConverter.getDocOutputPath(inputPath, format, destDir);

    try {
        const result = await docConverter.convertDocument(inputPath, format, outputPath);
        send('log', `Document conversion complete ✓ → ${outputPath}`);
        return result;
    } catch (err) {
        send('log', `Document conversion failed: ${err.message}`);
        throw err;
    }
});

registerDestPathHandlers('convert', 'convertDestPath', 'converted files');

// Registers the getDestPath/chooseDestPath/getAutoOpen/setAutoOpen/openDestFolder quintet
// that every processing tool (Compress, Watermark, Redact, QR, Background Remover, Convert)
// needs identically — a "Saving to: … [Change]" destination plus an "Open folder after X"
// toggle. Was previously copy-pasted per tool with Convert and the auto-open toggle missing
// from most of them; this is the single place that behavior now lives.
function registerDestPathHandlers(prefix, storeKey, folderLabel) {
    ipcMain.handle(`${prefix}:getDestPath`, () => store.get(storeKey));

    ipcMain.handle(`${prefix}:chooseDestPath`, async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return store.get(storeKey);
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: `Choose destination folder for ${folderLabel}`,
        });
        if (!result.canceled && result.filePaths[0]) {
            store.set(storeKey, result.filePaths[0]);
            log(`${prefix} destination path changed:`, result.filePaths[0]);
            return result.filePaths[0];
        }
        return store.get(storeKey);
    });

    ipcMain.handle(`${prefix}:getAutoOpen`, () => store.get(`${prefix}AutoOpen`));

    ipcMain.handle(`${prefix}:setAutoOpen`, (_e, value) => {
        store.set(`${prefix}AutoOpen`, !!value);
        return store.get(`${prefix}AutoOpen`);
    });

    ipcMain.handle(`${prefix}:openDestFolder`, () => {
        // shell.openPath asks the OS to reveal the folder — on macOS/Windows this focuses an
        // already-open Finder/Explorer window for that same path instead of opening a new
        // one, so no extra window-dedup logic is needed on our end.
        shell.openPath(store.get(storeKey));
    });
}

// Compress

ipcMain.handle('compress:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select file(s) to compress',
        properties: ['openFile', 'multiSelections'],
        filters: IMAGE_AND_PDF_FILTERS,
    });
    if (result.canceled) return [];
    return result.filePaths;
});

ipcMain.handle('compress:detectType', (_e, filePath) => {
    return compressor.detectFileType(filePath);
});

ipcMain.handle('compress:estimate', async (_e, filePath) => {
    const type = compressor.detectFileType(filePath);
    if (type === 'image') return compressor.estimateImageCompression(filePath);
    if (type === 'pdf') return compressor.estimatePdfCompression(filePath);
    throw new Error(`Estimation not supported for type: ${type}`);
});

ipcMain.handle('compress:run', async (_e, { filePath, preset }) => {
    const type = compressor.detectFileType(filePath);
    const destDir = store.get('compressDestPath');
    let result;
    if (type === 'image') result = await compressor.compressImage(filePath, preset, destDir);
    else if (type === 'pdf') result = await compressor.compressPdf(filePath, preset, destDir);
    else throw new Error(`Compression not supported for type: ${type}`);
    send('log', `Compression complete ✓ → ${result.outputPath}`);
    return result;
});

ipcMain.handle('compress:runTarget', async (_e, { filePath, targetBytes }) => {
    const type = compressor.detectFileType(filePath);
    if (type !== 'image') throw new Error(`Compression not yet supported for type: ${type}`);
    const destDir = store.get('compressDestPath');
    const result = await compressor.compressImageToTarget(filePath, targetBytes, destDir);
    send('log', `Compression complete ✓ → ${result.outputPath}`);
    return result;
});

registerDestPathHandlers('compress', 'compressDestPath', 'compressed files');

// Watermark

ipcMain.handle('watermark:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select file(s) to watermark',
        properties: ['openFile', 'multiSelections'],
        filters: IMAGE_AND_PDF_FILTERS,
    });
    if (result.canceled) return [];
    return result.filePaths;
});

ipcMain.handle('watermark:chooseLogo', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select a logo image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
});

ipcMain.handle('watermark:detectType', (_e, filePath) => compressor.detectFileType(filePath));

ipcMain.handle('watermark:run', async (_e, { filePath, options }) => {
    const type = compressor.detectFileType(filePath);
    const destDir = store.get('watermarkDestPath');
    let result;
    if (type === 'image') result = await watermark.watermarkImage(filePath, options, destDir);
    else if (type === 'pdf') result = await watermark.watermarkPdf(filePath, options, destDir);
    else throw new Error(`Watermark not supported for type: ${type}`);
    send('log', `Watermark complete ✓ → ${result.outputPath}`);
    return result;
});

registerDestPathHandlers('watermark', 'watermarkDestPath', 'watermarked files');

// Redact

ipcMain.handle('redact:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select a file to redact',
        properties: ['openFile'],
        filters: IMAGE_AND_PDF_FILTERS,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
});

ipcMain.handle('redact:detectType', (_e, filePath) => compressor.detectFileType(filePath));

ipcMain.handle('redact:run', async (_e, { filePath, zones }) => {
    const type = compressor.detectFileType(filePath);
    const destDir = store.get('redactDestPath');
    let result;
    if (type === 'image') result = await redact.redactImage(filePath, zones, destDir);
    else if (type === 'pdf') result = await redact.redactPdf(filePath, zones, destDir);
    else throw new Error(`Redact not supported for type: ${type}`);
    send('log', `Redaction complete ✓ → ${result.outputPath}`);
    return result;
});

registerDestPathHandlers('redact', 'redactDestPath', 'redacted files');

// QR Generator

ipcMain.handle('qr:export', async (_e, { bytes, format }) => {
    const destDir = store.get('qrDestPath');
    const result = qrGenerator.saveQrFile(bytes, destDir, format);
    send('log', `QR code exported ✓ → ${result.outputPath}`);
    return result;
});

registerDestPathHandlers('qr', 'qrDestPath', 'QR codes');

// Clipboard paste — lets a tab accept Cmd/Ctrl+V of an image copied from elsewhere (another app,
// a browser) instead of requiring "choose file"/drag-and-drop every time. Generic (not scoped to
// one tab) since the renderer decides which tab's `paste` listener is active; this just turns
// whatever image bytes the renderer already read from `clipboardData` into a real file on disk,
// since every processing pipeline in this app works off file paths, not in-memory buffers.
ipcMain.handle('clipboard:saveImage', async (_e, bytes, ext) => {
    const tempDir = path.join(app.getPath('temp'), 'bWeb-clipboard');
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `pasted-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(bytes));
    return filePath;
});

// Background Remover

ipcMain.handle('bgremove:chooseFile', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select an image',
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
});

ipcMain.handle('bgremove:preview', async (_e, filePath) => bgRemover.previewBackground(filePath));

ipcMain.handle('bgremove:run', async (_e, filePath) => {
    const destDir = store.get('bgRemoveDestPath');
    const result = await bgRemover.removeBackground(filePath, destDir);
    send('log', `Background removed ✓ → ${result.outputPath}`);
    return result;
});

registerDestPathHandlers('bgremove', 'bgRemoveDestPath', 'background-removed images');

ipcMain.handle('app:reset', async () => {
    try {
        const userDataPath = app.getPath('userData');
        log('Reset requested. userData:', userDataPath);

        // Relaunch AFTER cleanup
        setTimeout(() => {
            try {
                fs.rmSync(userDataPath, { recursive: true, force: true });
                log('User data deleted');
            } catch (err) {
                logError('Failed deleting userData:', err.message);
            }

            app.relaunch();
            app.exit(0);
        }, 100);

        return { ok: true };
    } catch (err) {
        logError('Reset failed:', err.message);
        return { ok: false, error: err.message };
    }
});
