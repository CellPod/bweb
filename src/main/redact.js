// Redact tool — physically destructive blur/pixelate/blackout of user-marked zones on an
// image or PDF page.
//
// Why not just draw an opaque box over the content: that is a well-documented real-world privacy
// failure (the "redacted" content stays extractable underneath — copy/paste the text layer, or
// undo/remove the covering layer in an editor). See CoverUP (github.com/digidigital/CoverUP) and
// pdf-redactor (github.com/JoshData/pdf-redactor), both of which exist specifically to document
// and fix that exact mistake. This module never composites an opaque layer on top of intact
// pixels/text — for images it destructively transforms the marked pixel region in place (crop →
// blur/pixelate/blacken → composite back), and for PDF it rasterizes the affected pages first
// (same isolated Ghostscript worker as watermark.js, via ghostscriptClient.js) so there is no
// underlying text layer left to extract, then redacts the page image the same way. Same
// trade-off already accepted for Watermark: a redacted PDF loses selectable text — that is the
// price of the content actually being gone rather than merely hidden.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { log, logError } = require('./utils');
const { rasterizePdf } = require('./ghostscriptClient');

const RASTERIZE_DPI = 200;

function getRedactedOutputPath(inputPath, destDir) {
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const ext = path.extname(inputPath);
    let outputPath = path.join(dir, `${base}_redacted${ext}`);
    let n = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${base}_redacted_${n}${ext}`);
        n++;
    }
    return outputPath;
}

// Parses "#rrggbb" (what a color <input> gives us) into {r,g,b}. Defaults to black on anything
// unexpected rather than throwing — a bad color should never block a redaction from completing.
function parseHexColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Same mapping as the renderer's live preview (renderer.js intensityToBlurPx/intensityToBlockCount)
// — kept in sync by hand since the two run in different processes, but the exact formulas must
// match or the live preview would lie about what the actual output looks like.
function intensityToSigma(intensity) {
    return 2 + ((intensity ?? 50) / 100) * 38; // 2-40
}

function intensityToBlockCount(intensity) {
    return Math.round(30 - ((intensity ?? 50) / 100) * 26); // 30 (fine) down to 4 (very blocky)
}

// zones: [{ xPct, yPct, wPct, hPct, method, color, intensity }] — xPct/etc. are fractions (0..1)
// of the image's own width/height, not absolute pixels, so the same zone coordinates recorded
// while editing at whatever zoom level the user picked still land correctly when re-applied to
// the RASTERIZE_DPI buffer used for the actual redaction (same page, same aspect ratio, only the
// pixel grid differs).
// Each zone carries its OWN method/color/intensity — captured client-side at the moment it was
// drawn — so a document can freely mix e.g. a red blackout zone with a heavily-pixelated zone
// elsewhere, and changing the sidebar's current settings never repaints zones already placed.
async function applyRedactionToBuffer(buffer, zones) {
    if (!zones || zones.length === 0) return buffer;

    const meta = await sharp(buffer).metadata();
    const W = meta.width;
    const H = meta.height;

    const composites = [];
    for (const zone of zones) {
        let x = Math.round(zone.xPct * W);
        let y = Math.round(zone.yPct * H);
        let w = Math.round(zone.wPct * W);
        let h = Math.round(zone.hPct * H);
        // Clamp to image bounds — a zone dragged slightly past the edge must not crash sharp's
        // extract() (it throws on out-of-bounds regions rather than clipping).
        x = Math.max(0, Math.min(x, W - 1));
        y = Math.max(0, Math.min(y, H - 1));
        w = Math.max(1, Math.min(w, W - x));
        h = Math.max(1, Math.min(h, H - y));
        if (w < 2 || h < 2) continue;

        const method = zone.method || 'blackout';

        if (method === 'blackout') {
            const rgb = parseHexColor(zone.color);
            const fillRect = await sharp({
                create: { width: w, height: h, channels: 4, background: { ...rgb, alpha: 1 } },
            }).png().toBuffer();
            composites.push({ input: fillRect, left: x, top: y });
            continue;
        }

        const region = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).toBuffer();
        let transformed;
        if (method === 'pixelate') {
            // Extreme downscale + nearest-neighbor upscale — genuinely destroys the original
            // pixel data (unlike a Gaussian blur, this is not reversible even approximately once
            // the block size is small enough) rather than just visually obscuring it. Block
            // count (how blocky) is user-controlled via intensity, not a fixed ratio — a fixed
            // ratio was either too subtle or so aggressive the zone read as pure noise depending
            // on the zone's size, with no way for the user to dial it back.
            const blocksAcross = intensityToBlockCount(zone.intensity);
            const blockSize = Math.max(1, Math.round(Math.min(w, h) / blocksAcross));
            const smallW = Math.max(1, Math.round(w / blockSize));
            const smallH = Math.max(1, Math.round(h / blockSize));
            // Two separate sharp() pipelines, not two chained .resize() calls on one instance —
            // sharp only keeps the last resize() options set on a given pipeline (the first call
            // never actually runs), so downscale must be materialized to a buffer before the
            // upscale-with-nearest-neighbor pass that creates the visible pixelation blocks.
            const tiny = await sharp(region).resize(smallW, smallH, { fit: 'fill' }).toBuffer();
            transformed = await sharp(tiny).resize(w, h, { fit: 'fill', kernel: 'nearest' }).toBuffer();
        } else {
            // 'blur' — sigma is user-controlled via intensity (was previously auto-scaled to
            // zone size only, with no way for the user to make it stronger or weaker).
            transformed = await sharp(region).blur(intensityToSigma(zone.intensity)).toBuffer();
        }
        composites.push({ input: transformed, left: x, top: y });
    }

    if (composites.length === 0) return buffer;
    return sharp(buffer).composite(composites).toBuffer();
}

async function redactImage(inputPath, zones, destDir) {
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getRedactedOutputPath(inputPath, destDir);
    log('Redacting image:', inputPath, '->', outputPath, `(${zones.length} zone(s))`);
    try {
        const inputBuffer = fs.readFileSync(inputPath);
        const outBuffer = await applyRedactionToBuffer(inputBuffer, zones);

        const ext = path.extname(inputPath).toLowerCase();
        let pipeline = sharp(outBuffer);
        if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
        else if (ext === '.webp') pipeline = pipeline.webp({ quality: 92 });
        else if (ext === '.avif') pipeline = pipeline.avif({ quality: 92 });
        else if (ext === '.tiff' || ext === '.tif') pipeline = pipeline.tiff({ quality: 92 });
        else pipeline = pipeline.png();

        await pipeline.toFile(outputPath);
        log('Redaction complete:', outputPath);
        return { ok: true, outputPath };
    } catch (err) {
        logError('Redact image failed:', err.message);
        throw err;
    }
}

// pageZones: [{ page, xPct, yPct, wPct, hPct }] (page is 1-indexed). Pages with no zones are
// still rasterized (consistency of the whole document + already-accepted text-loss trade-off),
// but obviously left visually untouched since there's nothing to composite.
async function redactPdf(inputPath, pageZones, destDir) {
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getRedactedOutputPath(inputPath, destDir);
    log('Redacting PDF (rasterize):', inputPath, '->', outputPath, `(${pageZones.length} zone(s))`);

    try {
        const pageBuffers = await rasterizePdf(inputPath, RASTERIZE_DPI);
        const pdfDoc = await PDFDocument.create();

        for (let i = 0; i < pageBuffers.length; i++) {
            const pageNum = i + 1;
            const zonesForPage = pageZones.filter((z) => z.page === pageNum);
            const redacted = await applyRedactionToBuffer(pageBuffers[i], zonesForPage);
            const jpegBuffer = await sharp(redacted).jpeg({ quality: 90 }).toBuffer();
            const meta = await sharp(jpegBuffer).metadata();
            const jpegImage = await pdfDoc.embedJpg(jpegBuffer);
            const pageWidth = (meta.width / RASTERIZE_DPI) * 72;
            const pageHeight = (meta.height / RASTERIZE_DPI) * 72;
            const page = pdfDoc.addPage([pageWidth, pageHeight]);
            page.drawImage(jpegImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
        }

        const finalBytes = await pdfDoc.save();
        fs.writeFileSync(outputPath, finalBytes);
        log('Redaction complete:', outputPath);
        return { ok: true, outputPath };
    } catch (err) {
        logError('PDF redact failed:', err.message);
        throw err;
    }
}

module.exports = {
    redactImage,
    redactPdf,
    getRedactedOutputPath,
};
