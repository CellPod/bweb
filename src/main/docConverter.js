// Document Converter — Office/PDF/OpenDocument/etc. → Markdown (via @firecrawl/anydoc) or
// Office → PDF (via minipdf, a native Rust addon). anydoc's conversion is async and safe to
// call directly here (runs on libuv's thread pool per its own docs, never blocks the event
// loop). minipdf's conversion functions are SYNCHRONOUS and would freeze the whole main
// process for the duration of a conversion — run in a worker_thread instead, the same
// "isolate the risky/blocking dependency" principle already used for ghostscript, just with
// a worker thread rather than a whole utilityProcess since the actual problem here is
// blocking, not crash-safety.

const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { toMarkdown } = require('@firecrawl/anydoc');
const { log, getUniqueOutputPath } = require('./utils');

// The only formats minipdf can produce a PDF from — see minipdf-node's own README, it does
// not (yet) handle legacy .doc/.ppt/.xls or OpenDocument formats, only modern OOXML.
const OFFICE_TO_PDF_EXTS = new Set(['.docx', '.pptx', '.xlsx']);

function getDocOutputPath(inputPath, format, destDir) {
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const ext = format === 'pdf' ? '.pdf' : '.md';
    return getUniqueOutputPath(dir, base, '_converted', ext);
}

function canConvertToPdf(inputPath) {
    return OFFICE_TO_PDF_EXTS.has(path.extname(inputPath).toLowerCase());
}

function convertOfficeToPdfInWorker(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'officeToPdfWorker.js'), {
            workerData: { inputPath, outputPath },
        });
        worker.once('message', (msg) => {
            worker.terminate();
            if (msg.ok) resolve();
            else reject(new Error(msg.error));
        });
        worker.once('error', (err) => {
            reject(err);
        });
    });
}

// anydoc throws an Error tagged with a `.code` (see its README) rather than a bare message —
// translate the ones a user can actually act on into plain language instead of surfacing the
// raw error code.
function describeAnydocError(err) {
    switch (err.code) {
        case 'needsOcr': return 'This PDF has scanned/image-only pages — text extraction needs OCR, not supported here.';
        case 'encrypted': return 'This file is encrypted or password-protected.';
        case 'malformed': return 'This file could not be read — it may be corrupted.';
        case 'unsupported': return 'This file format is not supported.';
        default: return err.message;
    }
}

async function convertDocument(inputPath, format, outputPath) {
    if (format === 'pdf') {
        if (!canConvertToPdf(inputPath)) {
            throw new Error('PDF output only supports .docx/.pptx/.xlsx input');
        }
        log('Converting office document to PDF (worker thread):', inputPath, '->', outputPath);
        await convertOfficeToPdfInWorker(inputPath, outputPath);
        return { ok: true, outputPath };
    }

    log('Converting document to Markdown:', inputPath, '->', outputPath);
    let markdown;
    try {
        markdown = await toMarkdown(inputPath);
    } catch (err) {
        throw new Error(describeAnydocError(err));
    }
    fs.writeFileSync(outputPath, markdown, 'utf8');
    return { ok: true, outputPath };
}

module.exports = { convertDocument, getDocOutputPath, canConvertToPdf };
