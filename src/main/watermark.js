// Watermark tool — tiled/diagonal filigrane on images (sharp) and PDF (rasterize + sharp + pdf-lib).
//
// "Tiled" rather than a single corner stamp because the point is to be hard to crop/clone out —
// a single corner mark is trivial to crop away; a repeating diagonal pattern covering the whole
// page survives cropping and partial edits. For PDF specifically, the watermark is burned into
// rasterized page images (not added as a removable PDF object) so it can't be deleted with
// Acrobat/Illustrator in a couple of clicks — see rasterizePdf. That trade-off (losing selectable
// PDF text) was confirmed with the user before building this.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { log, logError } = require('./utils');
const { rasterizePdf } = require('./ghostscriptClient');

const DEFAULT_OPACITY = 0.16;
const DEFAULT_ANGLE = -30;
const RASTERIZE_DPI = 200;

// Tile size presets — the tile is both the spacing between repeats AND (via fontSize/logoBox)
// the size of the mark itself, so "size" controls both at once rather than needing two knobs.
const SIZE_PRESETS = {
    small:  { width: 180, height: 100, fontSize: 15 },
    medium: { width: 280, height: 160, fontSize: 22 },
    large:  { width: 440, height: 250, fontSize: 34 },
};

function getSizeConfig(size) {
    return SIZE_PRESETS[size] || SIZE_PRESETS.medium;
}

function escapeXml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Rough average glyph width for a bold Helvetica/Arial-class font — there's no text-layout
// engine available in the main process, but this is close enough to size a tile so the text
// doesn't overlap its own next repeat. Without this, a long phrase at a fixed tile width
// overlapped so badly on itself that it became unreadable (confirmed with a real multi-word
// watermark: a full sentence at the "medium" tile size was illegible).
function estimateTextWidth(text, fontSize) {
    return text.length * fontSize * 0.6;
}

// Cap on how wide the tile is allowed to grow for a long phrase — beyond this, shrink the font
// instead, so the repeat spacing doesn't become absurdly sparse on a long sentence.
const MAX_TILE_WIDTH = 900;

async function buildTextTile(text, opacity, sizeConfig) {
    const { height } = sizeConfig;
    let fontSize = sizeConfig.fontSize;
    let width = Math.max(sizeConfig.width, Math.ceil(estimateTextWidth(text, fontSize) + fontSize * 1.4));

    if (width > MAX_TILE_WIDTH) {
        const shrink = MAX_TILE_WIDTH / width;
        fontSize = Math.max(10, Math.floor(fontSize * shrink));
        width = MAX_TILE_WIDTH;
    }

    const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <text x="50%" y="50%" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
                font-weight="600" fill="black" fill-opacity="${opacity}"
                text-anchor="middle" dominant-baseline="middle"
                transform="rotate(${DEFAULT_ANGLE} ${width / 2} ${height / 2})">${escapeXml(text)}</text>
        </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { buffer, width, height };
}

async function buildLogoTile(logoPath, opacity, sizeConfig) {
    const { width: tileWidth, height: tileHeight } = sizeConfig;

    // Rotating a W×H box by DEFAULT_ANGLE expands its bounding box to roughly
    // W·cos(θ) + H·sin(θ) — resizing to the tile's full size *before* rotating left the
    // rotated result bigger than the tile itself, which sharp's composite() rejects outright
    // ("must have same dimensions or smaller"). Resize to a safe box that still fits the tile
    // after rotation, with margin.
    const angleRad = (Math.abs(DEFAULT_ANGLE) * Math.PI) / 180;
    const expansion = Math.cos(angleRad) + Math.sin(angleRad); // ~1.37 at 30°
    const safeSize = Math.floor(Math.min(tileWidth, tileHeight) / expansion) - 20;

    const resized = await sharp(logoPath)
        .resize({ width: safeSize, height: safeSize, fit: 'inside' })
        .ensureAlpha()
        .toBuffer();

    // Scale down the alpha channel to `opacity` via a dest-in blend against a translucent mask —
    // sharp has no direct "set overall opacity" option for raster composites.
    const meta = await sharp(resized).metadata();
    const maskSvg = `<svg width="${meta.width}" height="${meta.height}"><rect width="100%" height="100%" fill="white" fill-opacity="${opacity}"/></svg>`;
    const faded = await sharp(resized)
        .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
        .toBuffer();

    let rotated = await sharp(faded)
        .rotate(DEFAULT_ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();

    // Center the rotated logo on a fixed-size transparent tile so every tile in the grid lines
    // up regardless of the logo's aspect ratio. Belt-and-suspenders: if it still doesn't fit
    // (e.g. a very non-square source), shrink it down to fit rather than erroring.
    let rotatedMeta = await sharp(rotated).metadata();
    if (rotatedMeta.width > tileWidth || rotatedMeta.height > tileHeight) {
        rotated = await sharp(rotated).resize({ width: tileWidth, height: tileHeight, fit: 'inside' }).toBuffer();
        rotatedMeta = await sharp(rotated).metadata();
    }

    const buffer = await sharp({
        create: { width: tileWidth, height: tileHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
        .composite([{ input: rotated, top: Math.round((tileHeight - rotatedMeta.height) / 2), left: Math.round((tileWidth - rotatedMeta.width) / 2) }])
        .png()
        .toBuffer();
    return { buffer, width: tileWidth, height: tileHeight };
}

// Returns { buffer, width, height } — width/height are the ACTUAL tile dimensions (which for
// long text can be wider than the size preset's base width), not just the preset's nominal size.
// applyWatermarkToBuffer must space repeats using these real dimensions, not the preset's.
async function buildTile(options) {
    const opacity = options.opacity ?? DEFAULT_OPACITY;
    const sizeConfig = getSizeConfig(options.size);
    if (options.type === 'logo') return buildLogoTile(options.logoPath, opacity, sizeConfig);
    return buildTextTile(options.text || 'WATERMARK', opacity, sizeConfig);
}

async function applyWatermarkToBuffer(imageBuffer, tile) {
    const image = sharp(imageBuffer);
    const meta = await image.metadata();
    const { buffer: tileBuffer, width: tileWidth, height: tileHeight } = tile;
    const cols = Math.ceil(meta.width / tileWidth) + 1;
    const rows = Math.ceil(meta.height / tileHeight) + 1;

    const composites = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            composites.push({ input: tileBuffer, top: row * tileHeight, left: col * tileWidth });
        }
    }

    return image.composite(composites).toBuffer();
}

function getWatermarkedOutputPath(inputPath, destDir) {
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const ext = path.extname(inputPath);
    let outputPath = path.join(dir, `${base}_watermarked${ext}`);
    let n = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${base}_watermarked_${n}${ext}`);
        n++;
    }
    return outputPath;
}

async function watermarkImage(inputPath, options, destDir) {
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getWatermarkedOutputPath(inputPath, destDir);
    log('Watermarking image:', inputPath, '->', outputPath);
    try {
        const tile = await buildTile(options);
        const inputBuffer = fs.readFileSync(inputPath);
        const outBuffer = await applyWatermarkToBuffer(inputBuffer, tile);

        // Re-encode through the original format so e.g. a JPEG stays a JPEG rather than sharp's
        // default (PNG) — composite() output format follows the input unless told otherwise, but
        // being explicit here avoids surprises for formats sharp can't infer cleanly from a buffer.
        const ext = path.extname(inputPath).toLowerCase();
        let pipeline = sharp(outBuffer);
        if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
        else if (ext === '.webp') pipeline = pipeline.webp({ quality: 90 });
        else if (ext === '.avif') pipeline = pipeline.avif({ quality: 90 });
        else if (ext === '.tiff' || ext === '.tif') pipeline = pipeline.tiff({ quality: 90 });
        else pipeline = pipeline.png();

        await pipeline.toFile(outputPath);
        log('Watermark complete:', outputPath);
        return { ok: true, outputPath };
    } catch (err) {
        logError('Watermark failed:', err.message);
        throw err;
    }
}

async function watermarkPdf(inputPath, options, destDir) {
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getWatermarkedOutputPath(inputPath, destDir);
    log('Watermarking PDF (rasterize):', inputPath, '->', outputPath);

    try {
        const pageBuffers = await rasterizePdf(inputPath, RASTERIZE_DPI);
        const tile = await buildTile(options);

        const pdfDoc = await PDFDocument.create();
        for (const pageBuffer of pageBuffers) {
            const watermarked = await applyWatermarkToBuffer(pageBuffer, tile);
            const jpegBuffer = await sharp(watermarked).jpeg({ quality: 88 }).toBuffer();
            const meta = await sharp(jpegBuffer).metadata();
            const jpegImage = await pdfDoc.embedJpg(jpegBuffer);
            // Convert pixel dimensions at RASTERIZE_DPI back to PDF points (72 per inch) so the
            // output page is the same physical size as the original, not DPI-scaled huge.
            const pageWidth = (meta.width / RASTERIZE_DPI) * 72;
            const pageHeight = (meta.height / RASTERIZE_DPI) * 72;
            const page = pdfDoc.addPage([pageWidth, pageHeight]);
            page.drawImage(jpegImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
        }

        const finalBytes = await pdfDoc.save();
        fs.writeFileSync(outputPath, finalBytes);
        log('Watermark complete:', outputPath);
        return { ok: true, outputPath };
    } catch (err) {
        logError('PDF watermark failed:', err.message);
        throw err;
    }
}

module.exports = {
    watermarkImage,
    watermarkPdf,
    getWatermarkedOutputPath,
};
