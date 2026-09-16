#!/usr/bin/env node
// Checks how far behind real FFmpeg the `ffmpeg-static` npm package's bundled binary is.
//
// Why this exists: unlike yt-dlp/deno/WinSparkle (fetched "latest" fresh at every build —
// see scripts/postinstall.js), `ffmpeg-static` bundles a binary tied to its own release
// cadence, which turned out to lag real FFmpeg by 3 major versions (found 2026-09-16: the
// bundled binary reported "ffmpeg version 6.0" from 2023, while upstream FFmpeg was at
// v9.0.1) — and worse, that binary was compiled with --enable-gpl --enable-nonfree, which
// this project's own license-discipline rule (see CLAUDE.md) says to avoid. `npm outdated`
// never surfaces this because the *npm package* itself is at its own latest version; the
// staleness is in what it bundles, one level down.
//
// This compares ffmpeg-static's declared `binary-release-tag` (e.g. "b6.1.1" -> major 6)
// against FFmpeg's actual latest release tag (e.g. "n9.0.1" -> major 9) and exits non-zero
// with a clear message if the gap looks bad — cheap enough to run in CI on a schedule
// without needing to download and execute any binary.

const https = require('https');

function get(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'bweb-dep-check', Accept: 'application/vnd.github+json' } }, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                    return;
                }
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (err) {
                        reject(err);
                    }
                });
            })
            .on('error', reject);
    });
}

function majorOf(tag, prefix) {
    const m = new RegExp(`^${prefix}(\\d+)`).exec(tag);
    return m ? parseInt(m[1], 10) : null;
}

async function main() {
    const ffmpegStaticPkg = require('ffmpeg-static/package.json');
    const bundledTag = ffmpegStaticPkg['ffmpeg-static']?.['binary-release-tag'];
    const bundledMajor = bundledTag ? majorOf(bundledTag, 'b') : null;

    // FFmpeg doesn't have a clean GitHub "latest release" (they tag but don't always
    // publish GitHub Releases) — read the newest release-branch-style tag (n#.#[.#])
    // instead, which is what they actually cut stable releases from.
    const tags = await get('https://api.github.com/repos/FFmpeg/FFmpeg/tags?per_page=100');
    const releaseTags = tags.map((t) => t.name).filter((n) => /^n\d+\.\d+(\.\d+)?$/.test(n));
    const latestMajor = releaseTags
        .map((n) => majorOf(n, 'n'))
        .filter((n) => n !== null)
        .sort((a, b) => b - a)[0];

    console.log(`ffmpeg-static bundled tag: ${bundledTag} (major ${bundledMajor})`);
    console.log(`FFmpeg latest release major: ${latestMajor}`);

    if (bundledMajor === null || latestMajor === null) {
        console.error('Could not determine one of the version numbers — skipping gap check.');
        return;
    }

    const gap = latestMajor - bundledMajor;
    if (gap >= 2) {
        console.error(
            `\n⚠ ffmpeg-static is ${gap} major FFmpeg versions behind upstream (bundled: ${bundledMajor}, latest: ${latestMajor}).\n` +
                'See TODO.md "Dépendances binaires" for context — this also bundles a GPL/nonfree build, a separate license concern.'
        );
        process.exitCode = 1;
        return;
    }

    console.log('✓ ffmpeg-static is reasonably current.');
}

main().catch((err) => {
    console.error('Freshness check failed:', err.message);
    process.exitCode = 1;
});
