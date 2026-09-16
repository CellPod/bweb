#!/usr/bin/env node

// Download yt-dlp + Deno binaries
//
// Runs automatically after `npm install`.
// Downloads the correct binaries for the current platform/arch into bin/.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');

const YTDLP_LATEST_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function getYtdlpBinaryName() {
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;

    if (platform === 'win32') return 'yt-dlp.exe';
    if (platform === 'darwin') return 'yt-dlp_macos';
    if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (platform === 'linux') return 'yt-dlp_linux';
    return 'yt-dlp';
}

function getYtdlpOutputName() {
    const platform = process.env.npm_config_platform || process.platform;
    return platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

const DENO_LATEST_URL = 'https://api.github.com/repos/denoland/deno/releases/latest';

function getDenoBinaryInfo() {
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;

    if (platform === 'darwin' && arch === 'arm64') return { zip: 'deno-aarch64-apple-darwin.zip', exe: 'deno' };
    if (platform === 'darwin') return { zip: 'deno-x86_64-apple-darwin.zip', exe: 'deno' };
    if (platform === 'win32') return { zip: 'deno-x86_64-pc-windows-msvc.zip', exe: 'deno.exe' };
    if (platform === 'linux' && arch === 'arm64') return { zip: 'deno-aarch64-unknown-linux-gnu.zip', exe: 'deno' };
    if (platform === 'linux') return { zip: 'deno-x86_64-unknown-linux-gnu.zip', exe: 'deno' };

    return null;
}

function get(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client
            .get(url, { headers: { 'User-Agent': 'ArcDLP' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return get(new URL(res.headers.location, url).toString()).then(resolve, reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                resolve(res);
            })
            .on('error', reject);
    });
}

function downloadFile(url, dest, label) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await get(url);
            const total = parseInt(res.headers['content-length'], 10) || 0;
            let downloaded = 0;

            const file = fs.createWriteStream(dest);
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0) {
                    const pct = Math.round((downloaded / total) * 100);
                    process.stdout.write(`\r  Downloading ${label}... ${pct}%  (${(downloaded / 1e6).toFixed(1)} MB)`);
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                process.stdout.write('\n');
                resolve();
            });
            file.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
}

async function getLatestRelease(apiUrl) {
    const res = await get(apiUrl);
    let body = '';
    for await (const chunk of res) body += chunk;
    return JSON.parse(body);
}

async function getLatestTag(apiUrl) {
    const release = await getLatestRelease(apiUrl);
    return release.tag_name;
}

// Follows redirects with a 1-byte range request so we get the *final* resolved URL without
// downloading the whole file — martin-riedl.de's /redirect/... endpoint embeds ffmpeg's
// actual version in the final URL (e.g. ".../macos/arm64/1787073674_9.0.1/ffmpeg.zip").
function resolveRedirectUrl(url, hopsLeft = 5) {
    return new Promise((resolve, reject) => {
        if (hopsLeft < 0) return reject(new Error('Too many redirects'));
        const client = url.startsWith('https') ? https : http;
        const req = client
            .get(url, { headers: { 'User-Agent': 'ArcDLP', Range: 'bytes=0-0' } }, (res) => {
                res.resume();
                const loc = res.headers.location;
                if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
                    resolveRedirectUrl(new URL(loc, url).toString(), hopsLeft - 1).then(resolve, reject);
                } else {
                    resolve(url);
                }
            })
            .on('error', reject);
    });
}

async function downloadYtdlp() {
    const outputName = getYtdlpOutputName();
    const outputPath = path.join(BIN_DIR, outputName);

    if (fs.existsSync(outputPath)) {
        console.log(`  ✓ yt-dlp already exists at bin/${outputName}`);
        return;
    }

    console.log('  🎬 Downloading yt-dlp...');
    const binaryName = getYtdlpBinaryName();

    try {
        const tag = await getLatestTag(YTDLP_LATEST_URL);
        const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${binaryName}`;
        console.log(`  Version: ${tag}`);
        console.log(`  Binary: ${binaryName}`);

        await downloadFile(downloadUrl, outputPath, 'yt-dlp');

        if (process.platform !== 'win32') {
            fs.chmodSync(outputPath, 0o755);
        }

        console.log(`  ✓ yt-dlp installed to bin/${outputName}`);
    } catch (err) {
        console.error(`  ✗ Failed to download yt-dlp: ${err.message}`);
        console.error('    You can manually download it from: https://github.com/yt-dlp/yt-dlp/releases');
    }
}

async function downloadDeno() {
    const info = getDenoBinaryInfo();
    if (!info) {
        console.log('  ⚠ Unsupported platform for Deno, skipping');
        return;
    }

    const outputPath = path.join(BIN_DIR, info.exe);

    if (fs.existsSync(outputPath)) {
        console.log(`  ✓ Deno already exists at bin/${info.exe}`);
        return;
    }

    console.log('  Downloading Deno...');

    try {
        const tag = await getLatestTag(DENO_LATEST_URL);
        const downloadUrl = `https://github.com/denoland/deno/releases/download/${tag}/${info.zip}`;
        console.log(`  Version: ${tag}`);
        console.log(`  Binary: ${info.zip}`);

        const zipPath = path.join(BIN_DIR, info.zip);
        await downloadFile(downloadUrl, zipPath, 'deno');

        console.log('  Extracting...');
        if (process.platform === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`, {
                stdio: 'ignore',
            });
        } else {
            execSync(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, { stdio: 'ignore' });
        }

        fs.unlinkSync(zipPath);

        // Ensure executable
        if (process.platform !== 'win32') {
            fs.chmodSync(outputPath, 0o755);
        }

        console.log(`  ✓ Deno installed to bin/${info.exe}`);
    } catch (err) {
        console.error(`  ✗ Failed to download Deno: ${err.message}`);
        console.error('    You can manually download it from: https://github.com/denoland/deno/releases');
        console.error('    Place the binary in the bin/ folder.');
    }
}

// No single maintained source covers all three platforms with the same license — see
// TODO.md's FFmpeg section for the full research. BtbN/FFmpeg-Builds has a real LGPL-only
// variant but only builds Windows/Linux; macOS has no trustworthy LGPL-only arm64 source,
// so ffmpeg.martin-riedl.de (GPL, but actively maintained, code-signed/notarized, native
// arm64, linked from ffmpeg.org's own download page) is used there instead — no worse than
// the ffmpeg-static package this replaces (also GPL), just not frozen on 2023's v6.0.
const FFMPEG_MAC_REDIRECT_URL = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip';
const BTBN_LATEST_URL = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';

function getFfmpegOutputName() {
    const platform = process.env.npm_config_platform || process.platform;
    return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function compareVersions(a, b) {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// BtbN keeps assets from more than one ffmpeg release branch (e.g. both n8.1 and n9.0) under
// the same rolling "latest" release — the newest matching asset isn't necessarily first in
// the array, so every match must be compared, not just the first one found.
function findLatestBtbnAsset(assets, re) {
    let best = null;
    let bestVersion = null;
    for (const a of assets || []) {
        const m = a.name.match(re);
        if (!m) continue;
        if (!best || compareVersions(m[1], bestVersion) > 0) {
            best = a;
            bestVersion = m[1];
        }
    }
    return best;
}

async function downloadFfmpeg() {
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;
    const outputName = getFfmpegOutputName();
    const outputPath = path.join(BIN_DIR, outputName);

    if (fs.existsSync(outputPath)) {
        console.log(`  ✓ ffmpeg already exists at bin/${outputName}`);
        return;
    }

    console.log('  Downloading ffmpeg...');

    try {
        if (platform === 'darwin') {
            if (arch !== 'arm64') {
                console.log('  ⚠ No maintained ffmpeg source wired up for macOS Intel yet, skipping');
                return;
            }
            const finalUrl = await resolveRedirectUrl(FFMPEG_MAC_REDIRECT_URL);
            console.log(`  Source: martin-riedl.de (${finalUrl})`);

            const zipPath = path.join(BIN_DIR, 'ffmpeg-mac.zip');
            await downloadFile(finalUrl, zipPath, 'ffmpeg');
            execSync(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, { stdio: 'ignore' });
            fs.unlinkSync(zipPath);
        } else {
            const btbnArch = platform === 'win32' ? 'win64' : 'linux64';
            const ext = platform === 'win32' ? 'zip' : 'tar.xz';
            const release = await getLatestRelease(BTBN_LATEST_URL);
            const re = new RegExp(`^ffmpeg-n([\\d.]+)-latest-${btbnArch}-lgpl-[\\d.]+\\.${ext.replace('.', '\\.')}$`);
            const asset = findLatestBtbnAsset(release.assets, re);
            if (!asset) throw new Error(`no matching BtbN LGPL asset found for ${btbnArch}`);
            console.log(`  Source: BtbN/FFmpeg-Builds (${asset.name})`);

            const archivePath = path.join(BIN_DIR, asset.name);
            await downloadFile(asset.browser_download_url, archivePath, 'ffmpeg');

            const extractDir = path.join(BIN_DIR, '_ffmpeg_extract');
            fs.mkdirSync(extractDir, { recursive: true });
            if (ext === 'zip') {
                execSync(`unzip -o "${archivePath}" -d "${extractDir}"`, { stdio: 'ignore' });
            } else {
                execSync(`tar -xJf "${archivePath}" -C "${extractDir}"`, { stdio: 'ignore' });
            }
            const topFolder = fs.readdirSync(extractDir)[0];
            fs.copyFileSync(path.join(extractDir, topFolder, 'bin', outputName), outputPath);
            fs.rmSync(extractDir, { recursive: true, force: true });
            fs.unlinkSync(archivePath);
        }

        if (platform !== 'win32') fs.chmodSync(outputPath, 0o755);
        console.log(`  ✓ ffmpeg installed to bin/${outputName}`);
    } catch (err) {
        console.error(`  ✗ Failed to download ffmpeg: ${err.message}`);
        console.error('    macOS: https://ffmpeg.martin-riedl.de/');
        console.error('    Windows/Linux: https://github.com/BtbN/FFmpeg-Builds/releases (lgpl variant)');
        console.error(`    Place the binary at bin/${outputName}`);
    }
}

// Background Remover's model weights (~433MB) are too large for a normal git push
// (GitHub hard-blocks anything over 100MB) so they're gitignored and fetched here
// instead, the same way yt-dlp/deno are — see src/main/bgRemover.js for how the app
// resolves this path at runtime.
const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models');
const WITHOUTBG_MODEL_URL = 'https://huggingface.co/withoutbg/withoutbg-openweights-onnx/resolve/main/withoutbg-open-weights.onnx';

async function downloadWithoutbgModel() {
    const outputPath = path.join(MODELS_DIR, 'withoutbg-open-weights.onnx');

    if (fs.existsSync(outputPath)) {
        console.log('  ✓ withoutbg model already exists at resources/models/withoutbg-open-weights.onnx');
        return;
    }

    if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    console.log('  Downloading Background Remover model (~433MB, one-time)...');

    try {
        await downloadFile(WITHOUTBG_MODEL_URL, outputPath, 'withoutbg model');
        console.log('  ✓ withoutbg model installed to resources/models/withoutbg-open-weights.onnx');
    } catch (err) {
        console.error(`  ✗ Failed to download withoutbg model: ${err.message}`);
        console.error(`    You can manually download it from: https://huggingface.co/withoutbg/withoutbg-openweights-onnx`);
        console.error('    Place it at resources/models/withoutbg-open-weights.onnx');
    }
}

const WINSPARKLE_LATEST_URL = 'https://api.github.com/repos/vslavik/winsparkle/releases/latest';

// WinSparkle is the Windows port of Sparkle (same maintainer format: appcast + EdDSA
// signatures) — used by src/main/winSparkleUpdater.js. Only needed for the win32 target;
// unlike yt-dlp/deno this doesn't vary by CPU arch since bWeb only ships win32-x64.
async function downloadWinSparkle() {
    const platform = process.env.npm_config_platform || process.platform;
    if (platform !== 'win32') return;

    const outputPath = path.join(BIN_DIR, 'WinSparkle.dll');
    if (fs.existsSync(outputPath)) {
        console.log('  ✓ WinSparkle.dll already exists at bin/WinSparkle.dll');
        return;
    }

    console.log('  Downloading WinSparkle...');

    try {
        const tag = await getLatestTag(WINSPARKLE_LATEST_URL);
        const version = tag.replace(/^v/, '');
        const downloadUrl = `https://github.com/vslavik/winsparkle/releases/download/${tag}/WinSparkle-${version}.zip`;
        console.log(`  Version: ${tag}`);

        const zipPath = path.join(BIN_DIR, 'winsparkle.zip');
        await downloadFile(downloadUrl, zipPath, 'WinSparkle');

        console.log('  Extracting...');
        const extractDir = path.join(BIN_DIR, '_winsparkle_extract');
        if (process.platform === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, {
                stdio: 'ignore',
            });
        } else {
            execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'ignore' });
        }

        const dllSrc = path.join(extractDir, `WinSparkle-${version}`, 'x64', 'Release', 'WinSparkle.dll');
        fs.copyFileSync(dllSrc, outputPath);
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);

        console.log('  ✓ WinSparkle.dll installed to bin/WinSparkle.dll');
    } catch (err) {
        console.error(`  ✗ Failed to download WinSparkle: ${err.message}`);
        console.error('    You can manually download it from: https://github.com/vslavik/winsparkle/releases');
        console.error('    Extract x64/Release/WinSparkle.dll to bin/WinSparkle.dll');
    }
}

// Cross-platform builds (see README) reuse this same bin/ folder across platform
// switches. Without this, a leftover binary from a previous platform's install just
// sits there — and since electron-builder's per-platform extraResources filter only
// looks at what's physically in bin/, a stale foreign binary would get bundled into
// every subsequent build regardless of target OS.
function removeForeignPlatformBinaries() {
    const platform = process.env.npm_config_platform || process.platform;
    const outputName = getYtdlpOutputName();
    const denoInfo = getDenoBinaryInfo();
    const keep = new Set([outputName, denoInfo?.exe, getFfmpegOutputName()].filter(Boolean));
    if (platform === 'win32') keep.add('WinSparkle.dll');
    const ALL_KNOWN_BINARIES = ['yt-dlp', 'yt-dlp.exe', 'deno', 'deno.exe', 'ffmpeg', 'ffmpeg.exe', 'WinSparkle.dll'];

    for (const name of ALL_KNOWN_BINARIES) {
        if (keep.has(name)) continue;
        const p = path.join(BIN_DIR, name);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`  Removed stale binary from another platform: bin/${name}`);
        }
    }
}

async function main() {
    if (!fs.existsSync(BIN_DIR)) {
        fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    removeForeignPlatformBinaries();
    await downloadYtdlp();
    await downloadDeno();
    await downloadFfmpeg();
    await downloadWinSparkle();
    await downloadWithoutbgModel();
}

main();
