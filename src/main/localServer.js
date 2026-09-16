// Local static server for the renderer.
//
// Electron's file:// origin makes the YouTube iframe embed (used for live-stream trim)
// fail with "Error 153 — Video player configuration error". Serving the same files over
// http://127.0.0.1 instead gives the page a real origin, which YouTube accepts, while
// staying loopback-only so nothing is reachable from outside this machine.

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

// localStorage (theme, accent color, language) is scoped to the page's origin, which
// includes the port — so this MUST be a fixed port, not a random one, or every launch
// looks like a brand new origin with empty storage and settings silently reset. Falls
// back to a random port only if this one is somehow already taken, so the app can still
// start (at the cost of that single launch not seeing previously saved settings).
const PREFERRED_PORT = 47318;

const MEDIA_MIME_TYPES = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.mts': 'video/mp2t',
    '.vob': 'video/dvd', '.3gp': 'video/3gpp', '.dav': 'video/mp2t',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.opus': 'audio/opus', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma',
    '.pdf': 'application/pdf',
};

// Serves an arbitrary local file (any absolute path the renderer already knows about — e.g. a
// file the user picked via the native dialog or drag-and-drop) with real byte-range support, for
// Convert's video/audio trim preview. This exists as a SEPARATE code path from the static
// `rootDir` handler above (which stays traversal-guarded to the app's own bundled files) — media
// preview intentionally reads outside rootDir, reachable only from this same 127.0.0.1-only
// server that already only accepts connections from the renderer's own process.
//
// This replaced the `bweb-file://` custom protocol for video specifically: found by testing real
// playback (not just checking HTTP responses looked correct) that Electron's `protocol.handle`
// mechanism silently fails to actually decode/advance certain H.264+AAC files served through it —
// readyState/duration/dimensions all resolve correctly, but every frame decodes black and
// currentTime never advances past 0, with no error ever surfaced. The exact same file, byte-range
// logic, and file bytes play back perfectly through a plain http:// origin instead — confirmed by
// serving one of the stuck files through a disposable standalone Node http server. `bweb-file://`
// is left in place for still-image previews (Watermark logo, Background Remover), which aren't
// affected — they don't use incremental range-based streaming the way video playback does.
function serveMediaFile(req, res, filePath) {
    fs.stat(filePath, (statErr, stat) => {
        if (statErr) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MEDIA_MIME_TYPES[ext] || 'application/octet-stream';
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const match = /bytes=(\d+)-(\d+)?/.exec(range);
            const start = match ? parseInt(match[1], 10) : 0;
            const end = match && match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': String(end - start + 1),
                'Content-Type': contentType,
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
        }

        res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(fileSize),
            'Content-Type': contentType,
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

const MEDIA_PREFIX = '/__media/';

function startLocalServer(rootDir) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);

            if (urlPath.startsWith(MEDIA_PREFIX)) {
                serveMediaFile(req, res, urlPath.slice(MEDIA_PREFIX.length));
                return;
            }

            const resolved = path.normalize(path.join(rootDir, urlPath));

            // Path traversal guard: resolved path must stay inside rootDir.
            if (!resolved.startsWith(rootDir)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            fs.readFile(resolved, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(resolved).toLowerCase();
                res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
                res.end(data);
            });
        });

        server.once('error', (err) => {
            if (err.code !== 'EADDRINUSE') return reject(err);
            server.removeAllListeners('error');
            server.once('error', reject);
            server.listen(0, '127.0.0.1');
        });
        server.once('listening', () => {
            resolve({ server, port: server.address().port });
        });
        server.listen(PREFERRED_PORT, '127.0.0.1');
    });
}

module.exports = { startLocalServer, MEDIA_MIME_TYPES };
