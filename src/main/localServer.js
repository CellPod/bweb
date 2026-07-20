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

function startLocalServer(rootDir) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
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

module.exports = { startLocalServer };
