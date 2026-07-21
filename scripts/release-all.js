#!/usr/bin/env node
// Full cross-platform release: mac, Linux, Windows — one command instead of a manual dance.
//
// Why this exists: ffmpeg-static's installer only ever fetches the binary for whatever
// platform/arch you tell it (via npm_config_platform/npm_config_arch), and — unlike
// scripts/postinstall.js for yt-dlp/deno — it never removes the OTHER platform's binary
// first. If both sit in node_modules/ffmpeg-static/ at once, electron-builder's
// asarUnpack bundles whichever one you're NOT building for right into the package too
// (asarUnpack has no per-platform filter, unlike extraResources). That's how a stray
// ~40-80MB binary from the wrong platform has repeatedly ended up shipped — this script
// makes the fetch → clean → build → restore sequence impossible to get out of order.
//
// Requires: `gh` CLI authenticated (`gh auth status`). Bump the version and commit/push
// separately before running this — that's a judgment call, not a mechanical step.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FFMPEG_DIR = path.join(ROOT, 'node_modules', 'ffmpeg-static');

const MAC_FFMPEG_FILES = ['ffmpeg', 'ffmpeg.LICENSE', 'ffmpeg.README'];
const WIN_FFMPEG_FILES = ['ffmpeg.exe', 'ffmpeg.exe.LICENSE', 'ffmpeg.exe.README'];

function step(title) {
    console.log(`\n\x1b[1m=== ${title} ===\x1b[0m`);
}

function run(cmd, extraEnv = {}) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

function removeFfmpegFiles(files) {
    for (const f of files) {
        const p = path.join(FFMPEG_DIR, f);
        if (fs.existsSync(p)) fs.rmSync(p);
    }
}

function fetchBinariesFor(platform, arch) {
    const env = { npm_config_platform: platform, npm_config_arch: arch };
    run('node scripts/postinstall.js', env); // yt-dlp + deno; removes the stale platform's binary itself
    run('node node_modules/ffmpeg-static/install.js', env); // ffmpeg; does NOT remove the stale one — we do that below
}

function main() {
    const ghToken = execSync('gh auth token').toString().trim();
    const env = { GH_TOKEN: ghToken };

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const version = pkg.version;
    console.log(`Releasing v${version} for mac, Linux, and Windows.`);

    step('macOS');
    run('npm run release:mac', env);

    step('Linux');
    run('npm run release:linux', env);

    step('Windows — fetching win32 binaries');
    fetchBinariesFor('win32', 'x64');
    removeFfmpegFiles(MAC_FFMPEG_FILES); // prevent the mac binary leaking into the win package via asarUnpack

    step('Windows — build + publish');
    run('npm run release:win', env);

    step('Restoring mac binaries for local dev');
    fetchBinariesFor('darwin', 'arm64');
    removeFfmpegFiles(WIN_FFMPEG_FILES);
    run('rm -rf dist');

    step('Publishing release (undraft)');
    run(`gh release edit v${version} --draft=false`);

    console.log(`\n✓ v${version} released for mac, Linux, and Windows. Local dev environment restored to mac binaries.`);
}

main();
