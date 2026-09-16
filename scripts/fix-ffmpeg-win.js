const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { adHocSignAfterPack } = require('electron-sparkle-updater/builder');

exports.default = async function (context) {
    const platform = context.electronPlatformName;
    const resDir = path.join(context.appOutDir, platform === 'darwin' ? 'bWeb.app/Contents/Resources' : 'resources');

    if (platform === 'win32') {
        const ffmpegExe = path.join(resDir, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(ffmpegExe)) {
            console.log('ffmpeg.exe (Windows) already present');
        } else {
            console.warn('Warning: ffmpeg.exe not found in bundle — Windows audio conversion will fail');
        }
    }

    if (platform === 'darwin') {
        const binaries = [path.join(resDir, 'bin', 'yt-dlp'), path.join(resDir, 'bin', 'deno'), path.join(resDir, 'bin', 'ffmpeg')];

        for (const bin of binaries) {
            if (fs.existsSync(bin)) {
                try {
                    execSync(`xattr -cr "${bin}"`);
                    execSync(`chmod +x "${bin}"`);
                    console.log(`Fixed permissions: ${path.basename(bin)}`);
                } catch (err) {
                    console.warn(`Warning: could not fix ${path.basename(bin)}: ${err.message}`);
                }
            }
        }
    }

    // Must run last: this deep-signs the whole bundle ad-hoc (free, no Developer ID —
    // already proven sufficient for Squirrel.Mac's own signature check, see the removed
    // scripts/adhoc-sign-mac.js) and then verifies it with `codesign --verify --deep
    // --strict`, which Sparkle's own `generate_appcast` tool refuses to process an archive
    // without passing. Doing the sign here (afterPack, once staging is done) rather than
    // afterSign avoids a second, redundant signing pass.
    await adHocSignAfterPack(context);
};
