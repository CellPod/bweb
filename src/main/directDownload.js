// Direct HTTPS Download
// Used for Vimeo library imports, bypassing yt-dlp entirely. yt-dlp's Vimeo extractor
// is currently blocked by Vimeo's bot-detection (HTTP 403 on its browser-impersonation
// fingerprint) even for plain public videos; the official API's authenticated download
// links are a normal HTTPS redirect chain with no such gate.

const https = require('https');
const fs = require('fs');

const MAX_REDIRECTS = 5;

function downloadDirect({ url, outputPath }, callbacks) {
    const { onProgress, onLog } = callbacks;

    return new Promise((resolve, reject) => {
        let settled = false;
        let currentReq = null;

        function finish(fn, arg) {
            if (settled) return;
            settled = true;
            fn(arg);
        }

        function get(target, redirectsLeft) {
            currentReq = https.get(target, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    res.resume();
                    if (redirectsLeft <= 0) return finish(reject, new Error('Too many redirects'));
                    return get(res.headers.location, redirectsLeft - 1);
                }

                if (res.statusCode !== 200) {
                    res.resume();
                    return finish(reject, new Error(`HTTP ${res.statusCode}`));
                }

                const total = parseInt(res.headers['content-length'] || '0', 10);
                let downloaded = 0;
                const startedAt = Date.now();
                const file = fs.createWriteStream(outputPath);

                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (onProgress && total) {
                        const elapsed = (Date.now() - startedAt) / 1000;
                        const speedMBs = elapsed > 0 ? downloaded / elapsed / (1024 * 1024) : 0;
                        onProgress({
                            percent: ((downloaded / total) * 100).toFixed(1) + '%',
                            speed: speedMBs ? `${speedMBs.toFixed(2)}MiB/s` : '',
                            eta: '',
                        });
                    }
                });

                res.pipe(file);
                file.on('finish', () => file.close(() => finish(resolve)));
                file.on('error', (err) => finish(reject, err));
                res.on('error', (err) => finish(reject, err));
            });

            currentReq.on('error', (err) => finish(reject, err));
        }

        if (onLog) onLog('Downloading via Vimeo API (direct)...');

        // Exposed so queue.js's existing cancel/pause logic (which calls `_proc.kill()`
        // on whatever this object is) works the same for direct downloads as it does
        // for yt-dlp child processes, with no changes needed on the queue side.
        callbacks._proc = {
            kill: () => {
                if (currentReq) currentReq.destroy();
                finish(reject, new Error('Cancelled'));
            },
        };

        get(url, MAX_REDIRECTS);
    });
}

module.exports = { downloadDirect };
