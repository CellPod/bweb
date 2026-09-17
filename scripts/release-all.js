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
// `@firecrawl/anydoc` and `minipdf` (added for Convert's Document sub-view, 2026-09-16) are
// the exact same class of problem, swapped the same way — see fetchNativePkgFor/
// removeNativePkgByPrefix below. Neither package's per-platform naming matches sharp/koffi's
// exactly (anydoc's Linux builds add a libc tag — "-gnu"/"-musl" — after the arch; minipdf
// ships every platform, including win32-x64, as a bare top-level package rather than under
// its own npm scope), which is why they get their own removal helper instead of reusing
// removeNativePkgFor as-is.
//
// Requires: `gh` CLI authenticated (`gh auth status`). Bump the version and commit/push
// separately before running this — that's a judgment call, not a mechanical step.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE_MODULES_DIR = path.join(ROOT, 'node_modules');
const IMG_DIR = path.join(ROOT, 'node_modules', '@img');
const KOROMIX_DIR = path.join(ROOT, 'node_modules', '@koromix');
const FIRECRAWL_DIR = path.join(ROOT, 'node_modules', '@firecrawl');
// minipdf's win32-x64 variant is a bare top-level package straight after `npm install`, but
// electron-builder's own native-module rebuild step has been observed placing it under this
// scope instead (verified via a real `--dir` build) — scanned defensively in addition to the
// node_modules root so a stale copy here can't survive into the next platform's build either.
const MINI_SOFTWARE_DIR = path.join(ROOT, 'node_modules', '@mini-software');

// Sparkle (macOS auto-update) release toolchain — see the "Auto-update app" section of
// TODO.md for how this was validated end to end (1.4.1 -> 1.4.2).
const REPO = 'CellPod/bweb';
const SPARKLE_ACCOUNT = 'ed25519'; // Keychain account holding the EdDSA private key; never exported to a file
const SPARKLE_BIN_DIR = path.join(ROOT, 'node_modules', 'electron-sparkle-updater', 'native', 'vendor', 'bin');
const SPARKLE_CLI = path.join(ROOT, 'node_modules', 'electron-sparkle-updater', 'bin', 'electron-sparkle-updater.js');
const APPCAST_ARCHIVE_DIR = path.join(ROOT, 'dist', 'appcast-release');
const DELTA_BASES = 2; // how many previous releases to fetch in as delta patch sources, bounded so this can't grow unbounded
const WINDOWS_APPCAST_WORK_DIR = path.join(ROOT, 'dist', 'appcast-windows-release');
const WINDOWS_APPCAST_MAX_ITEMS = 10; // oldest entries just get dropped, bounded so the feed can't grow unbounded

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

// Same idea as removeNativePkgFor, but for @firecrawl/anydoc and minipdf (added 2026-09-16
// for Convert's Document sub-view): their Linux builds append a libc tag after the arch
// (e.g. "anydoc-linux-x64-gnu"/"-musl", "minipdf-linux-x64-gnu"/"-musl"), so a plain suffix
// match would miss them entirely — this matches by prefix + substring instead. minipdf
// additionally ships every platform (including win32-x64) as a bare top-level package, not
// under its own npm scope like sharp/koffi/anydoc, despite what its own optionalDependencies
// list's win32-x64 entry name would suggest — verified empirically via a clean `npm ci` +
// `npm install --os=X --cpu=Y minipdf`, not assumed from the package.json alone. `scopeDir`
// is NODE_MODULES_DIR itself for minipdf, @firecrawl for anydoc.
function removeNativePkgByPrefix(scopeDir, pkgPrefix, platform, arch) {
    if (!fs.existsSync(scopeDir)) return;
    const marker = `${platform}-${arch}`;
    for (const name of fs.readdirSync(scopeDir)) {
        if (name.startsWith(pkgPrefix) && name.includes(marker)) {
            fs.rmSync(path.join(scopeDir, name), { recursive: true, force: true });
        }
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

// Windows — hand-builds and signs a separate appcast-windows.xml (the URL winSparkleUpdater.js
// already points at). Can't reuse generate_appcast the way the macOS step above does: verified
// empirically against a real published .exe — it only knows how to inspect a macOS app bundle
// inside a .zip/.dmg (LSMinimumSystemVersion, architecture slices) and refuses anything else
// ("No usable archives found"). sign_update, the other vendored Sparkle CLI, has no such
// restriction — it signs arbitrary bytes with the exact same EdDSA keypair already used for
// macOS, which is enough to hand-write a valid WinSparkle <item> ourselves.
//
// Kept as its own file rather than merged into the macOS appcast.xml: Sparkle/WinSparkle do
// technically support mixing platforms in one feed (a `sparkle:os` attribute on the enclosure),
// but the Sparkle project's own docs still recommend separate feeds regardless, and
// generate_appcast rewrites/prunes appcast.xml on every macOS release — an item it can't parse
// (this one) risks being silently dropped by that pruning logic. A second small file is a
// strictly lower-risk trade than that, and GitHub Releases has no folder concept for assets
// anyway (verified — it's a flat list), so there was never a way to tuck it out of sight.
//
// No delta patches — WinSparkle doesn't support Sparkle's binary delta format, so every update
// is a full installer download; this matches how much simpler the whole WinSparkle bridge
// already is (see winSparkleUpdater.js).
//
// Must run right after the Windows build/publish step, while dist/ still has this version's
// .exe — the "Restoring dev binaries" step at the end of main() wipes dist/ entirely.
function generateAndPublishWindowsAppcast(version) {
    step('Windows — signing appcast');

    fs.rmSync(WINDOWS_APPCAST_WORK_DIR, { recursive: true, force: true });
    fs.mkdirSync(WINDOWS_APPCAST_WORK_DIR, { recursive: true });

    const exeName = `bWeb-Setup-${version}.exe`;
    const exePath = path.join(ROOT, 'dist', exeName);
    const size = fs.statSync(exePath).size;
    const signature = execSync(
        `"${path.join(SPARKLE_BIN_DIR, 'sign_update')}" --account ${SPARKLE_ACCOUNT} -p "${exePath}"`,
    ).toString().trim();

    // Existing published feed, so this version's item gets prepended to real history instead
    // of starting fresh each time. Absent on the very first Windows release — that's fine.
    const appcastPath = path.join(WINDOWS_APPCAST_WORK_DIR, 'appcast-windows.xml');
    try {
        run(`curl -sL -f -o "${appcastPath}" "https://github.com/${REPO}/releases/latest/download/appcast-windows.xml"`);
    } catch {
        console.warn('No existing appcast-windows.xml found (first Windows release?) — starting a fresh one.');
    }

    const existingItems = fs.existsSync(appcastPath)
        ? [...fs.readFileSync(appcastPath, 'utf8').matchAll(/ {8}<item>[\s\S]*?<\/item>/g)].map((m) => m[0])
        : [];

    const pubDate = new Date().toUTCString().replace('GMT', '+0000'); // RFC-822, as Sparkle/WinSparkle expect
    const newItem = `        <item>
            <title>${version}</title>
            <pubDate>${pubDate}</pubDate>
            <sparkle:version>${version}</sparkle:version>
            <enclosure url="https://github.com/${REPO}/releases/download/v${version}/${exeName}" length="${size}" type="application/octet-stream" sparkle:edSignature="${signature}"/>
        </item>`;

    // Drop any stale entry for this same version (a re-run of this release) before prepending
    // the fresh one, then cap total history so the feed can't grow unbounded release over release.
    const items = [newItem, ...existingItems.filter((it) => !it.includes(`<sparkle:version>${version}</sparkle:version>`))]
        .slice(0, WINDOWS_APPCAST_MAX_ITEMS);

    fs.writeFileSync(
        appcastPath,
        '<?xml version="1.0" standalone="yes"?>\n' +
            '<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">\n' +
            `    <channel>\n        <title>bWeb</title>\n${items.join('\n')}\n    </channel>\n</rss>\n`,
    );

    run(`gh release upload v${version} "${appcastPath}" --repo ${REPO} --clobber`);
    fs.rmSync(WINDOWS_APPCAST_WORK_DIR, { recursive: true, force: true });
}

// electron-builder always generates latest.yml/latest-mac.yml/latest-linux.yml plus a
// .blockmap next to every zip/nsis artifact whenever --publish is used — but those all
// feed electron-builder's own electron-updater/Squirrel.Mac auto-update mechanism, which
// this project doesn't use (mac/Windows go through the custom Sparkle/WinSparkle bridges
// instead, fed by appcast.xml). They're inert here, just clutter on the release page.
function removeUnwantedPublishArtifacts(version) {
    step('Removing unused electron-updater artifacts (latest*.yml, *.blockmap)');
    const unwanted = [
        'latest.yml',
        'latest-mac.yml',
        'latest-linux.yml',
        `bWeb-${version}-arm64-mac.zip.blockmap`,
        `bWeb-Setup-${version}.exe.blockmap`,
    ];
    for (const name of unwanted) {
        try {
            run(`gh release delete-asset v${version} "${name}" --yes`);
        } catch (err) {
            console.warn(`Could not delete asset ${name} (may not exist): ${err.message}`);
        }
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

    generateAndPublishAppcast(version);

    step('Linux — fetching linux binaries');
    fetchBinariesFor('linux', 'x64'); // yt-dlp/deno/ffmpeg for linux — postinstall.js removes the mac binaries first
    fetchNativePkgFor('sharp', 'linux', 'x64');
    removeNativePkgFor(IMG_DIR, DEV_PLATFORM, DEV_ARCH); // don't let the mac sharp addon leak into the Linux asarUnpack
    // koffi's native addon isn't used on Linux (winSparkleUpdater.js is win32-only) — just
    // strip the mac one so it doesn't leak in; no Linux variant needs fetching.
    removeNativePkgFor(KOROMIX_DIR, DEV_PLATFORM, DEV_ARCH);
    fetchNativePkgFor('@firecrawl/anydoc', 'linux', 'x64');
    removeNativePkgByPrefix(FIRECRAWL_DIR, 'anydoc-', DEV_PLATFORM, DEV_ARCH);
    fetchNativePkgFor('minipdf', 'linux', 'x64');
    removeNativePkgByPrefix(NODE_MODULES_DIR, 'minipdf-', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgByPrefix(MINI_SOFTWARE_DIR, 'minipdf-', DEV_PLATFORM, DEV_ARCH);

    step('Linux — build + publish');
    run('npm run release:linux', env);

    step('Windows — fetching win32 binaries');
    fetchBinariesFor('win32', 'x64'); // also fetches bin/WinSparkle.dll, see postinstall.js
    fetchNativePkgFor('sharp', 'win32', 'x64');
    removeNativePkgFor(IMG_DIR, 'linux', 'x64');
    fetchNativePkgFor('koffi', 'win32', 'x64');
    fetchNativePkgFor('@firecrawl/anydoc', 'win32', 'x64');
    removeNativePkgByPrefix(FIRECRAWL_DIR, 'anydoc-', 'linux', 'x64');
    fetchNativePkgFor('minipdf', 'win32', 'x64');
    removeNativePkgByPrefix(NODE_MODULES_DIR, 'minipdf-', 'linux', 'x64');
    removeNativePkgByPrefix(MINI_SOFTWARE_DIR, 'minipdf-', 'linux', 'x64');

    step('Windows — build + publish');
    run('npm run release:win', env);

    generateAndPublishWindowsAppcast(version);

    removeUnwantedPublishArtifacts(version);

    step('Restoring dev binaries for local dev');
    fetchBinariesFor(DEV_PLATFORM, DEV_ARCH);
    fetchNativePkgFor('sharp', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgFor(IMG_DIR, 'win32', 'x64');
    fetchNativePkgFor('koffi', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgFor(KOROMIX_DIR, 'win32', 'x64');
    fetchNativePkgFor('@firecrawl/anydoc', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgByPrefix(FIRECRAWL_DIR, 'anydoc-', 'win32', 'x64');
    fetchNativePkgFor('minipdf', DEV_PLATFORM, DEV_ARCH);
    removeNativePkgByPrefix(NODE_MODULES_DIR, 'minipdf-', 'win32', 'x64');
    removeNativePkgByPrefix(MINI_SOFTWARE_DIR, 'minipdf-', 'win32', 'x64');
    run('rm -rf dist');

    step('Publishing release (undraft)');
    run(`gh release edit v${version} --draft=false`);

    console.log(`\n✓ v${version} released for mac, Linux, and Windows. Local dev environment restored.`);
}

main();
