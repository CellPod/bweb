// Compress tool — image compression via sharp, PDF via Ghostscript-WASM (video to follow)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { log, logError, getUniqueOutputPath } = require('./utils');
const { compressPdf: gsCompressPdf } = require('./ghostscriptClient');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif']);

// Ghostscript's built-in -dPDFSETTINGS presets: /screen (72dpi), /ebook (150dpi),
// /printer (300dpi), /prepress (300dpi, preserves color profiles). Discrete steps only —
// unlike image quality there's no continuous dial, so no "target size" mode for PDF.
const PDF_PRESETS = {
    max: '/prepress',
    balanced: '/ebook',
    small: '/screen',
};

// quality: 0-100, applied per format (sharp ignores it for lossless-only formats like plain PNG unless we force it)
const IMAGE_PRESETS = {
    max:  { quality: 90 },
    balanced: { quality: 75 },
    small: { quality: 45 },
};

function detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (ext === '.pdf') return 'pdf';
    return null;
}

function getCompressedOutputPath(inputPath, destDir) {
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const ext = path.extname(inputPath);
    return getUniqueOutputPath(dir, base, '_compressed', ext);
}

function buildPipeline(inputPath, quality) {
    const ext = path.extname(inputPath).toLowerCase();
    let pipeline = sharp(inputPath);

    if (ext === '.png') {
        // palette:true is what actually makes 'quality' shrink a PNG — without it PNG stays lossless
        // and only compressionLevel (zlib effort) applies, which barely moves file size.
        pipeline = pipeline.png({ quality, palette: true, compressionLevel: 9 });
    } else if (ext === '.webp') {
        pipeline = pipeline.webp({ quality });
    } else if (ext === '.avif') {
        pipeline = pipeline.avif({ quality });
    } else if (ext === '.tiff' || ext === '.tif') {
        pipeline = pipeline.tiff({ quality });
    } else {
        // jpg/jpeg default
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    }
    return pipeline;
}

async function encodeImage(inputPath, outputPath, preset) {
    const { quality } = IMAGE_PRESETS[preset];
    await buildPipeline(inputPath, quality).toFile(outputPath);
}

// Fixed descending sweep rather than a binary search: verified directly that quality->size is
// NOT monotonic for palette PNG (libimagequant + dithering can make quality 90 produce a LARGER
// file than quality 45), so binary search's "narrow the half that's still too big" logic can
// converge on a wrong/worse answer. A full sweep costs a few more encodes but is correct
// regardless of the underlying curve's shape — pick the highest quality among all candidates
// that fits under target, never assume anything about ordering.
const TARGET_SIZE_CANDIDATES = [95, 90, 85, 80, 75, 70, 65, 60, 50, 40, 30, 20, 10, 5, 1];

async function encodeToTargetSize(inputPath, targetBytes) {
    let best = null;
    let smallestOverall = null;

    for (const q of TARGET_SIZE_CANDIDATES) {
        const buffer = await buildPipeline(inputPath, q).toBuffer();
        if (buffer.length <= targetBytes && !best) {
            best = buffer;
        }
        if (!smallestOverall || buffer.length < smallestOverall.length) {
            smallestOverall = buffer;
        }
    }

    // Nothing fit under target — can't do better without resizing the image, so return
    // the smallest we actually produced rather than an arbitrary/untested quality.
    if (!best) {
        best = smallestOverall;
    }
    return best;
}

// Estimates final size for each preset by actually encoding into memory (images are small/fast,
// no need for the sample-and-extrapolate trick video needs).
async function estimateImageCompression(inputPath) {
    const originalSize = fs.statSync(inputPath).size;
    const results = {};

    for (const preset of Object.keys(IMAGE_PRESETS)) {
        const { quality } = IMAGE_PRESETS[preset];
        const buffer = await buildPipeline(inputPath, quality).toBuffer();
        results[preset] = buffer.length;
    }

    return { originalSize, estimates: results };
}

async function compressImage(inputPath, preset, destDir) {
    if (!IMAGE_PRESETS[preset]) throw new Error(`Unknown preset: ${preset}`);
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getCompressedOutputPath(inputPath, destDir);
    log('Compressing image:', inputPath, '->', outputPath, '(preset:', preset + ')');
    try {
        await encodeImage(inputPath, outputPath, preset);
        const originalSize = fs.statSync(inputPath).size;
        const compressedSize = fs.statSync(outputPath).size;
        log('Compress complete:', outputPath, `(${originalSize} -> ${compressedSize} bytes)`);
        return { ok: true, outputPath, originalSize, compressedSize };
    } catch (err) {
        logError('Compress failed:', err.message);
        throw err;
    }
}

async function compressImageToTarget(inputPath, targetBytes, destDir) {
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getCompressedOutputPath(inputPath, destDir);
    log('Compressing image to target size:', inputPath, '->', outputPath, `(target: ${targetBytes} bytes)`);
    try {
        const buffer = await encodeToTargetSize(inputPath, targetBytes);
        fs.writeFileSync(outputPath, buffer);
        const originalSize = fs.statSync(inputPath).size;
        const compressedSize = buffer.length;
        const targetMissed = compressedSize > targetBytes;
        if (targetMissed) {
            log('Compress complete (target not reachable):', outputPath, `(${originalSize} -> ${compressedSize} bytes, target was ${targetBytes})`);
        } else {
            log('Compress complete:', outputPath, `(${originalSize} -> ${compressedSize} bytes, target ${targetBytes})`);
        }
        return { ok: true, outputPath, originalSize, compressedSize, targetMissed };
    } catch (err) {
        logError('Compress (target size) failed:', err.message);
        throw err;
    }
}

async function estimatePdfCompression(inputPath) {
    const originalSize = fs.statSync(inputPath).size;
    const results = {};

    for (const preset of Object.keys(PDF_PRESETS)) {
        const buffer = await gsCompressPdf(inputPath, PDF_PRESETS[preset]);
        results[preset] = buffer.length;
    }

    return { originalSize, estimates: results };
}

async function compressPdf(inputPath, preset, destDir) {
    if (!PDF_PRESETS[preset]) throw new Error(`Unknown preset: ${preset}`);
    if (destDir) fs.mkdirSync(destDir, { recursive: true });
    const outputPath = getCompressedOutputPath(inputPath, destDir);
    log('Compressing PDF:', inputPath, '->', outputPath, '(preset:', preset + ')');
    try {
        const buffer = await gsCompressPdf(inputPath, PDF_PRESETS[preset]);
        fs.writeFileSync(outputPath, buffer);
        const originalSize = fs.statSync(inputPath).size;
        const compressedSize = buffer.length;
        log('Compress complete:', outputPath, `(${originalSize} -> ${compressedSize} bytes)`);
        return { ok: true, outputPath, originalSize, compressedSize };
    } catch (err) {
        logError('PDF compress failed:', err.message);
        throw err;
    }
}

module.exports = {
    detectFileType,
    getCompressedOutputPath,
    estimateImageCompression,
    compressImage,
    compressImageToTarget,
    estimatePdfCompression,
    compressPdf,
    IMAGE_PRESETS,
    PDF_PRESETS,
};
