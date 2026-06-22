const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

exports.default = async function (context) {
    const platform = context.electronPlatformName;
    const resDir = path.join(context.appOutDir, platform === 'darwin' ? 'bWeb.app/Contents/Resources' : 'resources');

    if (platform === 'win32') {
        // ffmpeg.exe is pre-bundled as a real Windows binary — nothing to rename
        const ffmpegExe = path.join(resDir, 'ffmpeg-static', 'ffmpeg.exe');
        if (fs.existsSync(ffmpegExe)) {
            console.log('ffmpeg.exe (Windows) already present');
        } else {
            console.warn('Warning: ffmpeg.exe not found in bundle — Windows audio conversion will fail');
        }
    }

    if (platform === 'darwin') {
        const binaries = [
            path.join(resDir, 'bin', 'yt-dlp'),
            path.join(resDir, 'bin', 'deno'),
            path.join(resDir, 'ffmpeg-static', 'ffmpeg'),
        ];

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
};
