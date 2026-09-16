// Dependency Binary Updater
//
// yt-dlp has to track YouTube's (and other sites') anti-bot changes far more often than
// bWeb itself ships — yt-dlp frequently cuts a new release within days of something
// breaking. Waiting for a full signed bWeb release every time leaves downloads broken for
// weeks (this is what caused the 403 errors investigated 2026-09-15: the binary bundled in
// 1.4.0 was already 6 weeks stale by the time YouTube's protections moved again).
//
// This checks yt-dlp's GitHub releases on startup and, if newer, downloads the binary into
// userData/bin/ — never touching the signed app bundle under resourcesPath, so it works
// regardless of install-location write permissions (Program Files, /Applications, etc.) or
// code signing. ytdlp.js's getYtdlpPath() checks userData/bin/ first and prefers it.
//
// Deno is NOT auto-updated here: it ships as a platform zip (no plain binary asset), and
// unzipping it would mean adding a new dependency (e.g. `extract-zip`) — a deliberate call
// left for the user per this project's license-discipline rule, not something to slip in
// silently. Deno also changes far less urgently than yt-dlp for this app's use (embedded
// browser sign-in / scraping, not the YouTube-facing extractor logic).

const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { log, logError } = require('./utils');
const { isNewer } = require('./updater');

const YTDLP_API_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // yt-dlp doesn't ship hourly — once a day is plenty

function userBinDir() {
    const dir = path.join(app.getPath('userData'), 'bin');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function ytdlpAssetName() {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    if (process.platform === 'linux' && process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (process.platform === 'linux') return 'yt-dlp_linux';
    return null;
}

function ytdlpOutputName() {
    return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const request = net.request({ url, method: 'GET' });
        request.setHeader('User-Agent', 'bWeb-DepUpdater');
        request.setHeader('Accept', 'application/vnd.github.v3+json');
        let body = '';
        request.on('response', (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
            res.on('error', reject);
        });
        request.on('error', reject);
        setTimeout(() => {
            request.abort();
            reject(new Error('GitHub API request timed out'));
        }, 15000);
        request.end();
    });
}

function downloadTo(url, destPath) {
    return new Promise((resolve, reject) => {
        const request = net.request({ url, method: 'GET' });
        request.setHeader('User-Agent', 'bWeb-DepUpdater');
        request.on('response', (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(destPath);
            res.on('data', (chunk) => file.write(chunk));
            res.on('end', () => file.end((err) => (err ? reject(err) : resolve())));
            res.on('error', reject);
        });
        request.on('error', reject);
        request.end();
    });
}

function verifyBinary(binPath) {
    return new Promise((resolve, reject) => {
        execFile(binPath, ['--version'], { timeout: 10000 }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout.trim());
        });
    });
}

// Never throws — a failed check/download/verify must fall back to whatever binary already
// works (bundled or previously auto-updated), not break startup or downloads.
async function checkAndUpdateYtdlp(currentVersion) {
    try {
        const assetName = ytdlpAssetName();
        if (!assetName) return null; // unsupported platform/arch combo — leave bundled binary alone

        const release = await fetchJSON(YTDLP_API_URL);
        const latest = release.tag_name;
        if (!latest || !isNewer(latest, currentVersion || '0')) {
            log(`yt-dlp up to date (${currentVersion})`);
            return null;
        }

        const asset = (release.assets || []).find((a) => a.name === assetName);
        if (!asset) {
            logError('yt-dlp auto-update: no release asset named', assetName);
            return null;
        }

        log(`yt-dlp update available: ${currentVersion} -> ${latest}, downloading...`);
        const dir = userBinDir();
        const tmpPath = path.join(dir, `.yt-dlp-${latest}.tmp`);
        const finalPath = path.join(dir, ytdlpOutputName());

        await downloadTo(asset.browser_download_url, tmpPath);
        if (process.platform !== 'win32') fs.chmodSync(tmpPath, 0o755);

        const verified = await verifyBinary(tmpPath);
        if (!verified.includes(latest)) {
            throw new Error(`downloaded binary reports "${verified}", expected ${latest}`);
        }

        fs.renameSync(tmpPath, finalPath); // same filesystem (userData/bin) — atomic
        log(`yt-dlp auto-updated to ${latest}:`, finalPath);
        return { previous: currentVersion, latest, path: finalPath };
    } catch (err) {
        logError('yt-dlp auto-update failed, keeping current binary:', err.message);
        try {
            const dir = userBinDir();
            for (const f of fs.readdirSync(dir)) {
                if (f.endsWith('.tmp')) fs.rmSync(path.join(dir, f), { force: true });
            }
        } catch {
            //
        }
        return null;
    }
}

let lastCheck = 0;
async function maybeUpdateYtdlp(currentVersion, force = false) {
    if (!force && Date.now() - lastCheck < CHECK_INTERVAL_MS) return null;
    lastCheck = Date.now();
    return checkAndUpdateYtdlp(currentVersion);
}

module.exports = { maybeUpdateYtdlp, userBinDir };
