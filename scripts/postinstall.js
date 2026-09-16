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
                    return get(res.headers.location).then(resolve, reject);
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

async function getLatestTag(apiUrl) {
    const res = await get(apiUrl);
    let body = '';
    for await (const chunk of res) body += chunk;
    const release = JSON.parse(body);
    return release.tag_name;
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
    const keep = new Set([outputName, denoInfo?.exe].filter(Boolean));
    if (platform === 'win32') keep.add('WinSparkle.dll');
    const ALL_KNOWN_BINARIES = ['yt-dlp', 'yt-dlp.exe', 'deno', 'deno.exe', 'WinSparkle.dll'];

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
    await downloadWinSparkle();
    await downloadWithoutbgModel();
}

main();
