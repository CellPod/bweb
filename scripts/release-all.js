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
// `sharp` (added for Background Remover, 1.4.0) has the exact same problem, one level
// worse: it ships its native addon as per-platform npm optionalDependencies
// (@img/sharp-<platform>-<arch>), and npm only ever installs the ones matching the
// machine you ran `npm install` on. Building all three targets from one Mac means Linux
// and Windows builds silently got the macOS-only native binary (or none at all) baked in
// via asarUnpack — sharp then throws "Could not load the sharp module using <target>
// runtime" the moment the packaged app calls it, which is exactly what surfaced in 1.4.0's
// Windows build (Background Remover was never actually exercised on Windows before
// shipping). This script now swaps in the right platform's @img/sharp-* packages before
// each non-native build, the same way it already does for ffmpeg/yt-dlp.
//
// Before this pass, the Linux leg also never re-fetched yt-dlp/ffmpeg for Linux at all —
// it built straight after the macOS release using whatever was still sitting in bin/ and
// node_modules/ffmpeg-static/ from the previous (macOS) step, i.e. the wrong binaries.
// That's fixed below too.
//
// Requires: `gh` CLI authenticated (`gh auth status`). Bump the version and commit/push
// separately before running this — that's a judgment call, not a mechanical step.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FFMPEG_DIR = path.join(ROOT, 'node_modules', 'ffmpeg-static');
const IMG_DIR = path.join(ROOT, 'node_modules', '@img');
const KOROMIX_DIR = path.join(ROOT, 'node_modules', '@koromix');

const MAC_FFMPEG_FILES = ['ffmpeg', 'ffmpeg.LICENSE', 'ffmpeg.README'];
const WIN_FFMPEG_FILES = ['ffmpeg.exe', 'ffmpeg.exe.LICENSE', 'ffmpeg.exe.README'];

// The dev machine this script runs on — restored at the very end regardless of what it is.
const DEV_PLATFORM = process.platform;
const DEV_ARCH = process.arch;

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

// sharp resolves its native addon from node_modules/@img/sharp-<platform>-<arch> (plus a
// separate sharp-libvips-<platform>-<arch> on darwin/linux), and koffi the same way from
// node_modules/@koromix/koffi-<platform>-<arch> — both at require time. `npm install
// --os=X --cpu=Y <pkg>` is the documented way to fetch another platform's
// optionalDependencies without reinstalling everything (same fix suggested in the "Could
// not load the sharp module" error dialog itself); this generalizes that for any package
// using the same per-platform-optionalDependency pattern.
function fetchNativePkgFor(pkgName, platform, arch) {
    run(`npm install --no-save --os=${platform} --cpu=${arch} ${pkgName}`);
}

// Matches by directory name suffix (e.g. "sharp-darwin-arm64", "sharp-libvips-darwin-arm64"
// both end with "darwin-arm64") so this doesn't need to hardcode every per-platform package
// name — works the same for @img (sharp) and @koromix (koffi).
function removeNativePkgFor(scopeDir, platform, arch) {
    if (!fs.existsSync(scopeDir)) return;
    const suffix = `${platform}-${arch}`;
    for (const name of fs.readdirSync(scopeDir)) {
        if (name.endsWith(suffix)) fs.rmSync(path.join(scopeDir, name), { recursive: true, force: true });
    }
}

function main() {
    const ghToken = execSync('gh auth token').toString().trim();
    const env = { GH_TOKEN: ghToken };

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const version = pkg.version;
    console.log(`Releasing v${version} for mac, Linux, and Windows.`);

    step('macOS');
    run('npm run release:mac', env);

    step('Linux — fetching linux binaries');
    fetchBinariesFor('linux', 'x64'); // yt-dlp/deno + ffmpeg for linux (overwrites the mac ffmpeg file in place — same filename)
    fetchNativePkgFor('sharp', 'linux', 'x64');
    removeNativePkgFor(IMG_DIR, DEV_PLATFORM, DEV_ARCH); // don't let the mac sharp addon leak into the Linux asarUnpack
    // koffi's native addon isn't used on Linux (winSparkleUpdater.js is win32-only) — just
    // strip the mac one so it doesn't leak in; no Linux variant needs fetching.
    removeNativePkgFor(KOROMIX_DIR, DEV_PLATFORM, DEV_ARCH);

    step('Linux — build + publish');
    run('npm run release:linux', env);

    step('Windows — fetching win32 binaries');
    fetchBinariesFor('win32', 'x64'); // also fetches bin/WinSparkle.dll, see postinstall.js
    removeFfmpegFiles(MAC_FFMPEG_FILES); // prevent the linux/mac-named ffmpeg binary leaking into the win package via asarUnpack
    fetchNativePkgFor('sharp', 'win32', 'x64');
    removeNativePkgFor(IMG_DIR, 'linux', 'x64');
    fetchNativePkgFor('koffi', 'win32', 'x64');

    step('Windows — build + publish');
    run('npm run release:win', env);

    step('Restoring dev binaries for local dev');
    fetchBinariesFor(DEV_PLATFORM, DEV_ARCH);
    removeFfmpegFiles(WIN_FFMPEG_FILES);
    fetchNativePkgFor('sharp', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgFor(IMG_DIR, 'win32', 'x64');
    fetchNativePkgFor('koffi', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgFor(KOROMIX_DIR, 'win32', 'x64');
    run('rm -rf dist');

    step('Publishing release (undraft)');
    run(`gh release edit v${version} --draft=false`);

    console.log(`\n✓ v${version} released for mac, Linux, and Windows. Local dev environment restored.`);
}

main();
