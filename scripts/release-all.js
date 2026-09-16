#!/usr/bin/env node
// Full cross-platform release: mac, Linux, Windows — one command instead of a manual dance.
//
// yt-dlp, deno, and (since 2026-09-16) ffmpeg are all fetched by scripts/postinstall.js
// directly into bin/, per target platform/arch — it also removes any *other* platform's
// binary first (see removeForeignPlatformBinaries() there). That guard matters because
// electron-builder's asarUnpack has no per-platform filter (unlike extraResources): a
// stale binary from the wrong platform left sitting in bin/ gets bundled into every
// subsequent build regardless of target OS. ffmpeg used to be the one exception (it came
// from the separate `ffmpeg-static` npm package, which had this exact bug — no
// cross-platform cleanup at all) until it was folded into the same bin/ + postinstall.js
// mechanism as yt-dlp/deno, which is what fixed it for good instead of needing the
// fetch → clean → build → restore dance below to compensate.
//
// `sharp` (added for Background Remover, 1.4.0) has a similar problem, one level worse: it
// ships its native addon as per-platform npm optionalDependencies
// (@img/sharp-<platform>-<arch>), and npm only ever installs the ones matching the
// machine you ran `npm install` on. Building all three targets from one Mac means Linux
// and Windows builds silently got the macOS-only native binary (or none at all) baked in
// via asarUnpack — sharp then throws "Could not load the sharp module using <target>
// runtime" the moment the packaged app calls it, which is exactly what surfaced in 1.4.0's
// Windows build (Background Remover was never actually exercised on Windows before
// shipping). This script swaps in the right platform's @img/sharp-* packages before each
// non-native build to compensate for that one still lacking postinstall.js's guard.
//
// Requires: `gh` CLI authenticated (`gh auth status`). Bump the version and commit/push
// separately before running this — that's a judgment call, not a mechanical step.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'node_modules', '@img');
const KOROMIX_DIR = path.join(ROOT, 'node_modules', '@koromix');

// Sparkle (macOS auto-update) release toolchain — see the "Auto-update app" section of
// TODO.md for how this was validated end to end (1.4.1 -> 1.4.2).
const REPO = 'CellPod/bweb';
const SPARKLE_ACCOUNT = 'ed25519'; // Keychain account holding the EdDSA private key; never exported to a file
const SPARKLE_BIN_DIR = path.join(ROOT, 'node_modules', 'electron-sparkle-updater', 'native', 'vendor', 'bin');
const SPARKLE_CLI = path.join(ROOT, 'node_modules', 'electron-sparkle-updater', 'bin', 'electron-sparkle-updater.js');
const APPCAST_ARCHIVE_DIR = path.join(ROOT, 'dist', 'appcast-release');
const DELTA_BASES = 2; // how many previous releases to fetch in as delta patch sources, bounded so this can't grow unbounded

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

function fetchBinariesFor(platform, arch) {
    const env = { npm_config_platform: platform, npm_config_arch: arch };
    run('node scripts/postinstall.js', env); // yt-dlp + deno + ffmpeg; removes the stale platform's binaries itself
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

// Publishes the signed appcast.xml (with delta patches when possible) for this release.
// Must run right after the macOS build/publish step, while dist/ still has this version's
// zip — the "Restoring dev binaries" step at the end of main() wipes dist/ entirely.
//
// Deltas are optional best-effort: generate_appcast only produces a patch for a base
// version whose zip we actually managed to fetch in below. A fetch failure (rate limit,
// a release missing its mac zip, ...) just means that one base falls back to a full
// download for its users — never a reason to fail the whole release.
function generateAndPublishAppcast(version) {
    step('macOS — signing appcast (with deltas where possible)');

    fs.rmSync(APPCAST_ARCHIVE_DIR, { recursive: true, force: true });
    fs.mkdirSync(APPCAST_ARCHIVE_DIR, { recursive: true });

    const zipName = `bWeb-${version}-arm64-mac.zip`;
    fs.copyFileSync(path.join(ROOT, 'dist', zipName), path.join(APPCAST_ARCHIVE_DIR, zipName));

    // Whatever notes are already on the GitHub release (e.g. from `gh release create
    // --notes` or `gh release edit`) become this version's in-app changelog too — same
    // sidecar-markdown mechanism generate_appcast already supports for any archive.
    // Nothing to embed if the release has no body yet; that's fine, not an error.
    try {
        const notes = execSync(`gh release view v${version} --repo ${REPO} --json body --jq .body`).toString();
        if (notes.trim()) {
            fs.writeFileSync(path.join(APPCAST_ARCHIVE_DIR, `bWeb-${version}-arm64-mac.md`), notes);
        }
    } catch (err) {
        console.warn(`Could not fetch release notes to embed: ${err.message}`);
    }

    // Existing published feed, so generate_appcast updates it instead of starting fresh.
    // Absent on the very first-ever appcast — that's fine, not an error.
    try {
        run(
            `curl -sL -f -o "${path.join(APPCAST_ARCHIVE_DIR, 'appcast.xml')}" ` +
                `"https://github.com/${REPO}/releases/latest/download/appcast.xml"`,
        );
    } catch {
        console.warn('No existing appcast.xml found (first release?) — starting a fresh one.');
    }

    // Previous releases' own mac zips, fetched in purely so generate_appcast can compute
    // binary deltas against them. Never re-uploaded themselves — only the new *.delta
    // files and the updated appcast.xml are.
    let previousTags = [];
    try {
        previousTags = execSync(`gh release list --repo ${REPO} --limit ${DELTA_BASES + 1} --json tagName --jq '.[].tagName'`)
            .toString()
            .trim()
            .split('\n')
            .filter((t) => t && t !== `v${version}`)
            .slice(0, DELTA_BASES);
    } catch (err) {
        console.warn(`Could not list previous releases for delta bases: ${err.message}`);
    }
    for (const tag of previousTags) {
        try {
            run(`gh release download ${tag} --repo ${REPO} --pattern "*-arm64-mac.zip" --dir "${APPCAST_ARCHIVE_DIR}" --clobber`);
        } catch (err) {
            console.warn(`Could not fetch ${tag} as a delta base (falling back to full download for it): ${err.message}`);
        }
    }

    run(
        `"${path.join(SPARKLE_BIN_DIR, 'generate_appcast')}" "${APPCAST_ARCHIVE_DIR}" --account ${SPARKLE_ACCOUNT} ` +
            `--download-url-prefix "https://github.com/${REPO}/releases/download/v${version}/" --embed-release-notes`,
    );

    // generate_appcast just stamped every archive it touched — including old zips that
    // were only fetched in as delta bases — with this run's download URL. Those old zips
    // were never uploaded under v${version}, so point their appcast entries back at the
    // tag they actually live under (their own signatures are untouched, only the URL).
    run(`node "${SPARKLE_CLI}" fix-appcast "${path.join(APPCAST_ARCHIVE_DIR, 'appcast.xml')}" --repo ${REPO} --tag-prefix v`);

    const assets = fs
        .readdirSync(APPCAST_ARCHIVE_DIR)
        .filter((f) => f === 'appcast.xml' || f.endsWith('.delta'))
        .map((f) => path.join(APPCAST_ARCHIVE_DIR, f));
    run(`gh release upload v${version} ${assets.map((a) => `"${a}"`).join(' ')} --repo ${REPO} --clobber`);

    fs.rmSync(APPCAST_ARCHIVE_DIR, { recursive: true, force: true });
}

function main() {
    const ghToken = execSync('gh auth token').toString().trim();
    const env = { GH_TOKEN: ghToken };

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const version = pkg.version;
    console.log(`Releasing v${version} for mac, Linux, and Windows.`);

    step('macOS');
    run('npm run release:mac', env);

    generateAndPublishAppcast(version);

    step('Linux — fetching linux binaries');
    fetchBinariesFor('linux', 'x64'); // yt-dlp/deno/ffmpeg for linux — postinstall.js removes the mac binaries first
    fetchNativePkgFor('sharp', 'linux', 'x64');
    removeNativePkgFor(IMG_DIR, DEV_PLATFORM, DEV_ARCH); // don't let the mac sharp addon leak into the Linux asarUnpack
    // koffi's native addon isn't used on Linux (winSparkleUpdater.js is win32-only) — just
    // strip the mac one so it doesn't leak in; no Linux variant needs fetching.
    removeNativePkgFor(KOROMIX_DIR, DEV_PLATFORM, DEV_ARCH);

    step('Linux — build + publish');
    run('npm run release:linux', env);

    step('Windows — fetching win32 binaries');
    fetchBinariesFor('win32', 'x64'); // also fetches bin/WinSparkle.dll, see postinstall.js
    fetchNativePkgFor('sharp', 'win32', 'x64');
    removeNativePkgFor(IMG_DIR, 'linux', 'x64');
    fetchNativePkgFor('koffi', 'win32', 'x64');

    step('Windows — build + publish');
    run('npm run release:win', env);

    step('Restoring dev binaries for local dev');
    fetchBinariesFor(DEV_PLATFORM, DEV_ARCH);
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
