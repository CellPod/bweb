// Shared client for talking to the isolated Ghostscript utility process (ghostscriptWorker.js).
//
// Extracted out of watermark.js so watermark.js/redact.js (rasterize) and compressor.js
// (compress) all call the exact same isolation path instead of drifting apart — see
// ghostscriptWorker.js for why this runs in its own utilityProcess rather than in-process
// (@jspawn/ghostscript-wasm's own uncaughtException handler re-throws, which would
// otherwise crash all of bWeb on a bad PDF).
const path = require('path');

const RASTERIZE_TIMEOUT_MS = 120_000;
const COMPRESS_TIMEOUT_MS = 60_000; // no incident behind the shorter timeout here — compress is just the lighter operation

function runGhostscriptWorker(payload, timeoutMs, resultKey) {
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

        const timer = setTimeout(() => finish(reject, new Error('Ghostscript timed out')), timeoutMs);

        child.once('message', (msg) => {
            if (msg.ok) finish(resolve, msg[resultKey]);
            else finish(reject, new Error(msg.error || 'Ghostscript failed'));
        });

        child.once('exit', (code) => {
            finish(reject, new Error(`Ghostscript process crashed (exit code ${code}) — this PDF may be corrupted, encrypted, or use an unsupported feature`));
        });

        child.postMessage(payload);
    });
}

function rasterizePdf(inputPath, dpi) {
    return runGhostscriptWorker({ mode: 'rasterize', inputPath, dpi }, RASTERIZE_TIMEOUT_MS, 'buffers').then((buffers) =>
        buffers.map((b) => Buffer.from(b)),
    );
}

function compressPdf(inputPath, gsSetting) {
    return runGhostscriptWorker({ mode: 'compress', inputPath, gsSetting }, COMPRESS_TIMEOUT_MS, 'buffer').then((buffer) =>
        Buffer.from(buffer),
    );
}

// Reassembles rasterized page buffers (as returned by rasterizePdf) into a new PDF, running
// transformPage(buffer, pageIndex) on each page first and re-embedding the result as a JPEG.
// Shared by watermark.js and redact.js, which otherwise hand-duplicated this exact
// rasterize -> per-page transform -> re-embed -> pdf-lib reassembly loop.
async function buildPdfFromRasterPages(pageBuffers, transformPage, { dpi, jpegQuality }) {
    const { PDFDocument } = require('pdf-lib');
    const sharp = require('sharp');
    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < pageBuffers.length; i++) {
        const transformed = await transformPage(pageBuffers[i], i);
        const jpegBuffer = await sharp(transformed).jpeg({ quality: jpegQuality }).toBuffer();
        const meta = await sharp(jpegBuffer).metadata();
        const jpegImage = await pdfDoc.embedJpg(jpegBuffer);
        // Convert pixel dimensions at `dpi` back to PDF points (72 per inch) so the output
        // page is the same physical size as the original, not DPI-scaled huge.
        const pageWidth = (meta.width / dpi) * 72;
        const pageHeight = (meta.height / dpi) * 72;
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(jpegImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }

    return pdfDoc.save();
}

module.exports = { rasterizePdf, compressPdf, buildPdfFromRasterPages };
