// Shared client for talking to the isolated Ghostscript utility process (ghostscriptWorker.js).
//
// Extracted out of watermark.js so both watermark.js and redact.js call the exact same
// isolation path instead of two copies drifting apart — see ghostscriptWorker.js for why this
// runs in its own utilityProcess rather than in-process (@jspawn/ghostscript-wasm's own
// uncaughtException handler re-throws, which would otherwise crash all of bWeb on a bad PDF).
const path = require('path');

function rasterizePdf(inputPath, dpi) {
    const { utilityProcess } = require('electron');

    return new Promise((resolve, reject) => {
        const workerPath = path.join(__dirname, 'ghostscriptWorker.js');
        const child = utilityProcess.fork(workerPath, [], { stdio: 'pipe' });
        let settled = false;

        const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { child.kill(); } catch { /**/ }
            fn(arg);
        };

        const timer = setTimeout(() => finish(reject, new Error('Ghostscript timed out')), 120_000);

        child.once('message', (msg) => {
            if (msg.ok) finish(resolve, msg.buffers.map((b) => Buffer.from(b)));
            else finish(reject, new Error(msg.error || 'Ghostscript failed'));
        });

        child.once('exit', (code) => {
            finish(reject, new Error(`Ghostscript process crashed (exit code ${code}) — this PDF may be corrupted, encrypted, or use an unsupported feature`));
        });

        child.postMessage({ mode: 'rasterize', inputPath, dpi });
    });
}

module.exports = { rasterizePdf };
