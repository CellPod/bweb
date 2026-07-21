// Main Process
// Electron entry point. Window, IPC, app lifecycle.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol } = require('electron');
const converter = require('./converter');
const path = require('path');
const Store = require('electron-store');
const ytdlp = require('./ytdlp');
const cookies = require('./cookies');
const { queue } = require('./queue');
const updater = require('./updater');
const { autoUpdater } = require('electron-updater');
const scraper = require('./scraper');
const { DEV_MODE, log, logError, getLogFilePath } = require('./utils');
const fs = require('fs');
const { Readable } = require('stream');
const { startLocalServer } = require('./localServer');

const MEDIA_MIME_TYPES = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.mts': 'video/mp2t',
    '.vob': 'video/dvd', '.3gp': 'video/3gpp', '.dav': 'video/mp2t',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.opus': 'audio/opus', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma',
};

function mimeTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MEDIA_MIME_TYPES[ext] || 'application/octet-stream';
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

// Silent background auto-update runs on all platforms. macOS builds are ad-hoc signed
// (see scripts/adhoc-sign-mac.js) — free, no Apple Developer account — which is enough
// for Squirrel.Mac (electron-updater's mac mechanism) to accept and install updates.
// It doesn't remove Gatekeeper's "unidentified developer" warning on first launch though;
// only a paid Developer ID cert + notarization would avoid that one-time prompt.
const SILENT_AUTOUPDATE = !DEV_MODE;

if (SILENT_AUTOUPDATE) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // electron-updater's own internal logging (signature checks, download/install steps)
    // is otherwise silent — this is the only way to see WHY quitAndInstall did nothing,
    // which console.log alone never surfaces in a packaged app.
    autoUpdater.logger = {
        info: (...a) => log('[updater]', ...a),
        warn: (...a) => log('[updater:warn]', ...a),
        error: (...a) => logError('[updater]', ...a),
        debug: (...a) => log('[updater:debug]', ...a),
    };

    autoUpdater.on('update-available', (info) => {
        log('Auto-updater: update available', info.version);
        autoUpdater.downloadUpdate();
    });

    autoUpdater.on('download-progress', (progress) => {
        send('update-download-progress', { percent: progress.percent });
    });

    autoUpdater.on('update-downloaded', (info) => {
        log('Auto-updater: update downloaded', info.version);
        send('update-ready-to-install', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
        logError('Auto-updater error:', err.message);
    });
}

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

async function createWindow() {
    const isMac = process.platform === 'darwin';

    mainWindow = new BrowserWindow({
        width: 900,
        height: 640,
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

        // Check for updates after a 3 sec
        setTimeout(async () => {
            try {
                const result = await updater.checkForUpdates(app.getVersion());
                if (result.hasUpdate) {
                    log('Update available:', result.latest);

                    if (store.get('autoUpdateEnabled') === true) {
                        // Already opted in — the silent flow below will download and
                        // notify once it's ready, no need for the plain banner too.
                    } else if (SILENT_AUTOUPDATE && store.get('autoUpdateConsentAskedForVersion') !== result.latest) {
                        // Never force this on someone: ask once per new version instead of
                        // silently enabling it, and don't nag again if they already answered.
                        store.set('autoUpdateConsentAskedForVersion', result.latest);
                        send('update-consent-needed', result);
                    } else {
                        send('update-available', result);
                    }
                }
            } catch (err) {
                logError('Startup update check failed:', err.message);
            }

            if (SILENT_AUTOUPDATE && store.get('autoUpdateEnabled') === true) {
                try {
                    await autoUpdater.checkForUpdates();
                } catch (err) {
                    logError('Silent update check failed:', err.message);
                }
            }
        }, 3000);
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
        const range = request.headers.get('range');
        if (range) {
            const match = /bytes=(\d+)-(\d+)?/.exec(range);
            const start = match ? parseInt(match[1], 10) : 0;
            const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const stream = fs.createReadStream(filePath, { start, end });
            return new Response(Readable.toWeb(stream), {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(end - start + 1),
                    'Content-Type': contentType,
                },
            });
        }

        const stream = fs.createReadStream(filePath);
        return new Response(Readable.toWeb(stream), {
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
            history: [],
            // Undecided until the user explicitly answers the consent prompt (or flips the
            // Settings toggle) — never silently opt them into automatic downloads.
            autoUpdateEnabled: false,
            autoUpdateConsentAskedForVersion: null,
        },
    });

    createWindow();

    // Fetch dependency versions in the background
    ytdlp
        .getVersions()
        .then((v) => {
            cachedVersions = v;
            log('Versions cached:', JSON.stringify(v));
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

ipcMain.handle('settings:openFolder', () => {
    shell.openPath(store.get('downloadPath'));
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
    const result = await updater.checkForUpdates(app.getVersion());
    if (result.hasUpdate) {
        if (SILENT_AUTOUPDATE && store.get('autoUpdateEnabled') === true) {
            // Already opted in — kick off the real in-app download instead of pointing
            // at GitHub. autoUpdater's own events drive the "ready to install" banner.
            autoUpdater.checkForUpdates().catch((err) => logError('Manual update check (autoUpdater) failed:', err.message));
        } else {
            send('update-available', result);
        }
    }
    return result;
});

ipcMain.handle('update:install', () => {
    log('update:install requested, SILENT_AUTOUPDATE:', SILENT_AUTOUPDATE);
    if (SILENT_AUTOUPDATE) {
        try {
            autoUpdater.quitAndInstall();
        } catch (err) {
            logError('quitAndInstall threw:', err.message);
        }
    }
});

ipcMain.handle('settings:getAutoUpdateEnabled', () => store.get('autoUpdateEnabled') === true);

ipcMain.handle('settings:setAutoUpdateEnabled', (_e, enabled) => {
    store.set('autoUpdateEnabled', !!enabled);
    log('Auto-update enabled set to:', !!enabled);
    if (enabled && SILENT_AUTOUPDATE) {
        autoUpdater.checkForUpdates().catch((err) => logError('Update check after opt-in failed:', err.message));
    }
    return !!enabled;
});

// Auth

ipcMain.handle('auth:check', () => cookies.hasCookies());

ipcMain.handle('auth:login', async () => {
    log('Opening YouTube login window');
    send('log', 'Opening YouTube sign-in...');
    const success = await cookies.openLoginWindow(mainWindow);
    if (success) {
        send('log', 'Signed in to YouTube ✓');
        log('YouTube login successful');
    } else {
        send('log', 'Sign-in cancelled');
        log('YouTube login cancelled');
    }
    return success;
});

ipcMain.handle('auth:logout', async () => {
    await cookies.clearCookies();
    send('log', 'Signed out of YouTube');
    log('YouTube logout');
    return true;
});

// Instagram Auth

ipcMain.handle('insta:check', () => cookies.hasInstaCookies());

ipcMain.handle('insta:login', async () => {
    log('Opening Instagram login window');
    send('log', 'Opening Instagram sign-in...');
    const success = await cookies.openInstaLoginWindow(mainWindow);
    if (success) {
        send('log', 'Signed in to Instagram ✓');
        log('Instagram login successful');
    } else {
        send('log', 'Instagram sign-in cancelled');
        log('Instagram login cancelled');
    }
    return success;
});

ipcMain.handle('insta:logout', async () => {
    await cookies.clearInstaCookies();
    send('log', 'Signed out of Instagram');
    log('Instagram logout');
    return true;
});

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
    const capped = (Array.isArray(urls) ? urls : []).slice(0, 50);
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

ipcMain.handle('queue:getAll', () => {
    return queue.getAll();
});

ipcMain.handle('queue:getCounts', () => {
    return queue.counts;
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
    const outputPath = converter.getOutputPath(inputPath, format, startTime, endTime);
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
