#!/usr/bin/env node
// Re-embeds a version's current GitHub release notes into the published macOS appcast.xml,
// without rebuilding or re-uploading the app itself.
//
// Why this exists: release-all.js's generateAndPublishAppcast() only embeds whatever notes
// are already on the GitHub release at the moment IT runs, mid-build. Writing the changelog
// afterwards is a natural order (you often want to see the actual diff before describing
// it), and it does edit the release page, but the appcast.xml already published doesn't
// retroactively pick that up. It's a separate file, generated once and never touched again
// unless a new release runs. Sparkle's own in-app update dialog reads that file, not the
// GitHub release body, so users see "No release notes available" even though the release
// page itself looks fine. Hit for real on v1.7.0 (2026-09-18).
//
// Usage: node scripts/refresh-mac-appcast-notes.js [version]
// Defaults to package.json's current version. Requires the release to already be published
// (assets uploaded, not a draft) and to already have a non-empty body. This only re-signs
// and re-uploads appcast.xml, it can't invent notes that were never written.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = 'CellPod/bweb';
const SPARKLE_ACCOUNT = 'ed25519';
const SPARKLE_BIN_DIR = path.join(ROOT, 'node_modules', 'electron-sparkle-updater', 'native', 'vendor', 'bin');
const SPARKLE_CLI = path.join(ROOT, 'node_modules', 'electron-sparkle-updater', 'bin', 'electron-sparkle-updater.js');
const WORK_DIR = path.join(ROOT, 'dist', 'appcast-notes-refresh');
const DELTA_BASES = 2; // matches release-all.js, keep in sync if that ever changes

function run(cmd) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function main() {
    const version = process.argv[2] || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const tag = `v${version}`;

    const notes = execSync(`gh release view ${tag} --repo ${REPO} --json body --jq .body`).toString();
    if (!notes.trim()) {
        console.error(`${tag} has no release notes yet. Write those first (gh release edit ${tag} --notes-file ...), nothing to embed.`);
        process.exit(1);
    }

    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    fs.mkdirSync(WORK_DIR, { recursive: true });

    const zipName = `bWeb-${version}-arm64-mac.zip`;
    run(`gh release download ${tag} --repo ${REPO} --pattern "${zipName}" --dir "${WORK_DIR}" --clobber`);
    fs.writeFileSync(path.join(WORK_DIR, `bWeb-${version}-arm64-mac.md`), notes);

    const appcastPath = path.join(WORK_DIR, 'appcast.xml');
    run(`curl -sL -f -o "${appcastPath}" "https://github.com/${REPO}/releases/latest/download/appcast.xml"`);

    let previousTags = [];
    try {
        previousTags = execSync(`gh release list --repo ${REPO} --limit ${DELTA_BASES + 1} --json tagName --jq '.[].tagName'`)
            .toString()
            .trim()
            .split('\n')
            .filter((t) => t && t !== tag)
            .slice(0, DELTA_BASES);
    } catch (err) {
        console.warn(`Could not list previous releases for delta bases: ${err.message}`);
    }
    for (const baseTag of previousTags) {
        try {
            run(`gh release download ${baseTag} --repo ${REPO} --pattern "*-arm64-mac.zip" --dir "${WORK_DIR}" --clobber`);
        } catch (err) {
            console.warn(`Could not fetch ${baseTag} as a delta base: ${err.message}`);
        }
    }

    run(
        `"${path.join(SPARKLE_BIN_DIR, 'generate_appcast')}" "${WORK_DIR}" --account ${SPARKLE_ACCOUNT} ` +
            `--download-url-prefix "https://github.com/${REPO}/releases/download/${tag}/" --embed-release-notes`,
    );
    run(`node "${SPARKLE_CLI}" fix-appcast "${appcastPath}" --repo ${REPO} --tag-prefix v`);

    const assets = fs
        .readdirSync(WORK_DIR)
        .filter((f) => f === 'appcast.xml' || f.endsWith('.delta'))
        .map((f) => path.join(WORK_DIR, f));
    run(`gh release upload ${tag} ${assets.map((a) => `"${a}"`).join(' ')} --repo ${REPO} --clobber`);

    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    console.log(`\n✓ ${tag}'s appcast.xml now carries its release notes.`);
}

main();
