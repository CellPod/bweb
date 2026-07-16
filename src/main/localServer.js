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

        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
}

module.exports = { startLocalServer };
