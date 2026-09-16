// Dependency Binary Updater
//
// yt-dlp, ffmpeg, and deno all move on their own release schedules, faster than bWeb itself
// ships — waiting for a full signed bWeb release every time one of them cuts a fix leaves
// the app broken for weeks (this is what caused the 403 errors investigated 2026-09-15:
// yt-dlp bundled in 1.4.0 was already 6 weeks stale by the time YouTube's protections moved
// again, and ffmpeg was frozen on 6.0/2023 until this file existed at all).
//
// This checks each dependency's upstream release on startup and, if newer, downloads the
// binary into userData/bin/ — never touching the signed app bundle under resourcesPath, so
// it works regardless of install-location write permissions (Program Files, /Applications,
// etc.) or code signing. ytdlp.js's getYtdlpPath()/getFfmpegPath()/getDenoPath() all check
// userData/bin/ first and prefer it over whatever shipped with the build.
//
// This intentionally shows no update UI at all — see TODO.md's "Auto-update app" section:
// the Sparkle modal is reserved for real bWeb releases (new features), these are meant to
// happen silently in the background and just work on next use, the way the user asked for
// after being caught out by a stale yt-dlp.

const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const yauzl = require('yauzl');
const { log, logError } = require('./utils');
const { isNewer } = require('./updater');

const DAY_MS = 24 * 60 * 60 * 1000; // none of these ship more than a few times a month — daily is plenty

function userBinDir() {
    const dir = path.join(app.getPath('userData'), 'bin');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
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

// Follows redirects with a 1-byte range request so we can read the *final* resolved URL
// (martin-riedl.de's /redirect/... endpoint embeds the actual version in it, e.g.
// ".../macos/arm64/1787073674_9.0.1/ffmpeg.zip") without downloading the whole archive just
// to check whether it's newer than what we already have.
//
// Electron's net module auto-follows redirects and does NOT expose the final URL on the
// eventual 'response' (verified directly: its headers.location is undefined there) — the
// only place the resolved URL shows up is the 'redirect' event fired for each hop, which
// must be explicitly told to proceed via request.followRedirect().
function resolveRedirect(url) {
    return new Promise((resolve, reject) => {
        let finalUrl = url;
        const request = net.request({ url, method: 'GET' });
        request.setHeader('User-Agent', 'bWeb-DepUpdater');
        request.setHeader('Range', 'bytes=0-0');
        request.on('redirect', (statusCode, method, redirectUrl) => {
            finalUrl = redirectUrl;
            request.followRedirect();
        });
        request.on('response', (res) => {
            res.on('data', () => {}); // drain so 'end' fires without buffering the body
            res.on('end', () => resolve(finalUrl));
        });
        request.on('error', reject);
        setTimeout(() => {
            request.abort();
            reject(new Error('Redirect resolution timed out'));
        }, 15000);
        request.end();
    });
}

function verifyBinary(binPath, versionArg) {
    return new Promise((resolve, reject) => {
        execFile(binPath, [versionArg], { timeout: 10000 }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout.trim());
        });
    });
}

const S_IFLNK = 0xa000; // symlink bit in a Unix file mode

// Extracts exactly one entry matching `matchFileName(entry.fileName)` from a zip to
// `destPath`. Written by hand instead of pulling in `extract-zip` (which has an open,
// unpatched symlink/path-traversal advisory as of 2026-09 — GHSA-jmr9-qjv8-65gv) — since we
// only ever need one specific, known-in-advance file out of these archives, there's no
// generic multi-entry extraction to secure in the first place: yauzl itself already
// rejects unsafe file names (see its own validateFileName()), and this additionally refuses
// to extract anything whose own Unix mode bits mark it as a symlink.
function extractZipEntry(zipPath, matchFileName, destPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            let found = false;
            zipfile.on('error', reject);
            zipfile.on('entry', (entry) => {
                if (found || !matchFileName(entry.fileName)) {
                    zipfile.readEntry();
                    return;
                }
                found = true;
                const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
                if (unixMode !== 0 && (unixMode & 0xf000) === S_IFLNK) {
                    zipfile.close();
                    reject(new Error(`refusing to extract symlink entry: ${entry.fileName}`));
                    return;
                }
                zipfile.openReadStream(entry, (streamErr, readStream) => {
                    if (streamErr) {
                        zipfile.close();
                        return reject(streamErr);
                    }
                    const out = fs.createWriteStream(destPath);
                    readStream.on('error', (e) => {
                        zipfile.close();
                        reject(e);
                    });
                    out.on('error', (e) => {
                        zipfile.close();
                        reject(e);
                    });
                    out.on('finish', () => {
                        zipfile.close();
                        resolve();
                    });
                    readStream.pipe(out);
                });
            });
            zipfile.on('end', () => {
                if (!found) reject(new Error('no matching entry found in zip'));
            });
            zipfile.readEntry();
        });
    });
}

function execFilePromise(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
    });
}

function cleanupTmp(dir, prefix) {
    try {
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(prefix)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
        }
    } catch {
        //
    }
}

// ---------------------------------------------------------------------------------------
// yt-dlp — plain per-platform executable asset, no archive to unpack.
// ---------------------------------------------------------------------------------------

const YTDLP_API_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

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

        const verified = await verifyBinary(tmpPath, '--version');
        if (!verified.includes(latest)) {
            throw new Error(`downloaded binary reports "${verified}", expected ${latest}`);
        }

        fs.renameSync(tmpPath, finalPath); // same filesystem (userData/bin) — atomic
        log(`yt-dlp auto-updated to ${latest}:`, finalPath);
        return { previous: currentVersion, latest, path: finalPath };
    } catch (err) {
        logError('yt-dlp auto-update failed, keeping current binary:', err.message);
        cleanupTmp(userBinDir(), '.yt-dlp-');
        return null;
    }
}

// ---------------------------------------------------------------------------------------
// ffmpeg — no single maintained source covers all three platforms with the same license.
// See TODO.md's FFmpeg section for the full research: BtbN/FFmpeg-Builds has a real
// LGPL-only variant but only builds Windows/Linux; macOS has no trustworthy LGPL-only
// arm64 source, so ffmpeg.martin-riedl.de (GPL, but actively maintained, code-signed and
// notarized, native arm64, linked from ffmpeg.org's own download page) is used there
// instead — no worse than the ffmpeg-static binary this replaces (also GPL), just current.
// ---------------------------------------------------------------------------------------

const BTBN_API_URL = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';
const FFMPEG_MAC_REDIRECT_URL = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip';

async function checkAndUpdateFfmpegMac(currentVersion) {
    try {
        const finalUrl = await resolveRedirect(FFMPEG_MAC_REDIRECT_URL);
        const match = finalUrl.match(/_(\d+(?:\.\d+)*)\/ffmpeg\.zip$/);
        const latest = match && match[1];
        if (!latest) {
            logError('ffmpeg auto-update: could not read version from', finalUrl);
            return null;
        }
        if (!isNewer(latest, currentVersion || '0')) {
            log(`ffmpeg up to date (${currentVersion})`);
            return null;
        }

        log(`ffmpeg update available: ${currentVersion} -> ${latest}, downloading...`);
        const dir = userBinDir();
        const zipPath = path.join(dir, `.ffmpeg-${latest}.zip.tmp`);
        const finalPath = path.join(dir, 'ffmpeg');

        await downloadTo(finalUrl, zipPath);
        await extractZipEntry(zipPath, (name) => name === 'ffmpeg', finalPath + '.tmp');
        fs.chmodSync(finalPath + '.tmp', 0o755);

        const verified = await verifyBinary(finalPath + '.tmp', '-version');
        if (!verified.includes(latest)) {
            throw new Error(`downloaded binary reports "${verified}", expected ${latest}`);
        }

        fs.renameSync(finalPath + '.tmp', finalPath);
        fs.rmSync(zipPath, { force: true });
        log(`ffmpeg auto-updated to ${latest}:`, finalPath);
        return { previous: currentVersion, latest, path: finalPath };
    } catch (err) {
        logError('ffmpeg auto-update failed, keeping current binary:', err.message);
        cleanupTmp(userBinDir(), '.ffmpeg-');
        return null;
    }
}

function btbnTarget() {
    if (process.platform === 'win32') return { arch: 'win64', ext: 'zip', binName: 'ffmpeg.exe' };
    if (process.platform === 'linux' && process.arch === 'x64') return { arch: 'linux64', ext: 'tar.xz', binName: 'ffmpeg' };
    return null; // linux/arm64 isn't a target this project builds/ships today
}

async function checkAndUpdateFfmpegBtbn(currentVersion) {
    try {
        const target = btbnTarget();
        if (!target) return null;

        const release = await fetchJSON(BTBN_API_URL);
        const extRe = target.ext.replace('.', '\\.');
        const nameRe = new RegExp(`^ffmpeg-n([\\d.]+)-latest-${target.arch}-lgpl-[\\d.]+\\.${extRe}$`);
        // BtbN keeps assets from more than one ffmpeg release branch (e.g. both n8.1 and
        // n9.0) under the same rolling "latest" release — the newest match isn't
        // necessarily first in the array, so every match must be compared.
        let latest = null;
        let asset = null;
        for (const a of release.assets || []) {
            const m = a.name.match(nameRe);
            if (m && (!latest || isNewer(m[1], latest))) {
                latest = m[1];
                asset = a;
            }
        }
        if (!asset) {
            logError('ffmpeg auto-update: no matching BtbN asset found for', target.arch);
            return null;
        }
        if (!isNewer(latest, currentVersion || '0')) {
            log(`ffmpeg up to date (${currentVersion})`);
            return null;
        }

        log(`ffmpeg update available: ${currentVersion} -> ${latest}, downloading...`);
        const dir = userBinDir();
        const archivePath = path.join(dir, `.ffmpeg-${latest}.${target.ext}.tmp`);
        const finalPath = path.join(dir, target.binName);

        await downloadTo(asset.browser_download_url, archivePath);

        if (target.ext === 'zip') {
            await extractZipEntry(archivePath, (name) => name.endsWith(`/bin/${target.binName}`), finalPath + '.tmp');
        } else {
            // No pure-JS xz/tar decoder worth adding for this one case — every desktop
            // Linux distro ships `tar` (it's coreutils, not an optional package), unlike
            // `unzip` which sometimes isn't preinstalled. Extract just the one file.
            const extractDir = path.join(dir, `.ffmpeg-${latest}-extract`);
            fs.mkdirSync(extractDir, { recursive: true });
            await execFilePromise('tar', ['-xJf', archivePath, '-C', extractDir]);
            const topFolder = fs.readdirSync(extractDir)[0];
            fs.renameSync(path.join(extractDir, topFolder, 'bin', target.binName), finalPath + '.tmp');
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
        if (process.platform !== 'win32') fs.chmodSync(finalPath + '.tmp', 0o755);

        const verified = await verifyBinary(finalPath + '.tmp', '-version');
        if (!verified.includes(latest)) {
            throw new Error(`downloaded binary reports "${verified}", expected ${latest}`);
        }

        fs.renameSync(finalPath + '.tmp', finalPath);
        fs.rmSync(archivePath, { force: true });
        log(`ffmpeg auto-updated to ${latest}:`, finalPath);
        return { previous: currentVersion, latest, path: finalPath };
    } catch (err) {
        logError('ffmpeg auto-update failed, keeping current binary:', err.message);
        cleanupTmp(userBinDir(), '.ffmpeg-');
        return null;
    }
}

async function checkAndUpdateFfmpeg(currentVersion) {
    if (process.platform === 'darwin') return checkAndUpdateFfmpegMac(currentVersion);
    if (process.platform === 'win32' || process.platform === 'linux') return checkAndUpdateFfmpegBtbn(currentVersion);
    return null;
}

// ---------------------------------------------------------------------------------------
// deno — official denoland/deno releases, always a flat zip with a single "deno"/"deno.exe"
// entry at the root, same on every platform.
// ---------------------------------------------------------------------------------------

const DENO_API_URL = 'https://api.github.com/repos/denoland/deno/releases/latest';

function denoAssetName() {
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'deno-aarch64-apple-darwin.zip';
    if (process.platform === 'darwin') return 'deno-x86_64-apple-darwin.zip';
    if (process.platform === 'win32') return 'deno-x86_64-pc-windows-msvc.zip';
    if (process.platform === 'linux' && process.arch === 'arm64') return 'deno-aarch64-unknown-linux-gnu.zip';
    if (process.platform === 'linux') return 'deno-x86_64-unknown-linux-gnu.zip';
    return null;
}

function denoOutputName() {
    return process.platform === 'win32' ? 'deno.exe' : 'deno';
}

async function checkAndUpdateDeno(currentVersion) {
    try {
        const assetName = denoAssetName();
        if (!assetName) return null;

        const release = await fetchJSON(DENO_API_URL);
        const latest = (release.tag_name || '').replace(/^v/, '');
        if (!latest || !isNewer(latest, currentVersion || '0')) {
            log(`deno up to date (${currentVersion})`);
            return null;
        }

        const asset = (release.assets || []).find((a) => a.name === assetName);
        if (!asset) {
            logError('deno auto-update: no release asset named', assetName);
            return null;
        }

        log(`deno update available: ${currentVersion} -> ${latest}, downloading...`);
        const dir = userBinDir();
        const zipPath = path.join(dir, `.deno-${latest}.zip.tmp`);
        const outputName = denoOutputName();
        const finalPath = path.join(dir, outputName);

        await downloadTo(asset.browser_download_url, zipPath);
        await extractZipEntry(zipPath, (name) => name === outputName, finalPath + '.tmp');
        if (process.platform !== 'win32') fs.chmodSync(finalPath + '.tmp', 0o755);

        const verified = await verifyBinary(finalPath + '.tmp', '--version');
        if (!verified.includes(latest)) {
            throw new Error(`downloaded binary reports "${verified}", expected ${latest}`);
        }

        fs.renameSync(finalPath + '.tmp', finalPath);
        fs.rmSync(zipPath, { force: true });
        log(`deno auto-updated to ${latest}:`, finalPath);
        return { previous: currentVersion, latest, path: finalPath };
    } catch (err) {
        logError('deno auto-update failed, keeping current binary:', err.message);
        cleanupTmp(userBinDir(), '.deno-');
        return null;
    }
}

// ---------------------------------------------------------------------------------------

let lastYtdlpCheck = 0;
async function maybeUpdateYtdlp(currentVersion, force = false) {
    if (!force && Date.now() - lastYtdlpCheck < DAY_MS) return null;
    lastYtdlpCheck = Date.now();
    return checkAndUpdateYtdlp(currentVersion);
}

let lastFfmpegCheck = 0;
async function maybeUpdateFfmpeg(currentVersion, force = false) {
    if (!force && Date.now() - lastFfmpegCheck < DAY_MS) return null;
    lastFfmpegCheck = Date.now();
    return checkAndUpdateFfmpeg(currentVersion);
}

let lastDenoCheck = 0;
async function maybeUpdateDeno(currentVersion, force = false) {
    if (!force && Date.now() - lastDenoCheck < DAY_MS) return null;
    lastDenoCheck = Date.now();
    return checkAndUpdateDeno(currentVersion);
}

module.exports = { maybeUpdateYtdlp, maybeUpdateFfmpeg, maybeUpdateDeno, userBinDir };
