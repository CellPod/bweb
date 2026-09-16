// Image Converter — format conversion (not compression, see compressor.js for that).
// Uses sharp directly for every supported output format. HEIC/HEIF input is decoded first
// via the already-bundled ffmpeg binary (its generic ISOBMFF demuxer + HEVC decoder read it
// natively — verified empirically, no extra dependency needed) into a lossless PNG
// intermediate, since sharp's own prebuilt binaries cannot read HEIC directly.

const { spawn } = require('child_process');
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, logError, getUniqueOutputPath } = require('./utils');

const HEIC_EXTS = new Set(['.heic', '.heif']);

const IMAGE_FORMAT_PRESETS = {
    jpeg: { ext: '.jpg' },
    png: { ext: '.png' },
    webp: { ext: '.webp' },
    avif: { ext: '.avif' },
    tiff: { ext: '.tiff' },
    gif: { ext: '.gif' },
};

function getImageOutputPath(inputPath, format, destDir) {
    const preset = IMAGE_FORMAT_PRESETS[format];
    if (!preset) return null;
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    return getUniqueOutputPath(dir, base, '_converted', preset.ext);
}

function decodeHeicToPng(ffmpegBin, inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegBin, ['-y', '-i', inputPath, '-update', '1', outputPath]);
        let stderrBuf = '';

        proc.stderr.on('data', (d) => {
            stderrBuf += d.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                const lastLines = stderrBuf.trim().split('\n').slice(-5).join(' ');
                return reject(new Error(lastLines || `ffmpeg exited with code ${code}`));
            }
            resolve();
        });

        proc.on('error', (err) => {
            reject(new Error(`Cannot run ffmpeg: ${err.message}`));
        });
    });
}

async function convertImage(ffmpegBin, inputPath, outputPath, format) {
    const preset = IMAGE_FORMAT_PRESETS[format];
    if (!preset) throw new Error(`Unknown image format: ${format}`);

    const ext = path.extname(inputPath).toLowerCase();
    let sourcePath = inputPath;
    let heicTempPath = null;

    if (HEIC_EXTS.has(ext)) {
        heicTempPath = path.join(os.tmpdir(), `bweb-heic-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        log('Decoding HEIC via ffmpeg:', inputPath);
        await decodeHeicToPng(ffmpegBin, inputPath, heicTempPath);
        sourcePath = heicTempPath;
    }

    try {
        log('Converting image:', inputPath, '->', outputPath, `(${format})`);
        let pipeline = sharp(sourcePath, { animated: true });
        pipeline = pipeline[format]();
        await pipeline.toFile(outputPath);
        log('Image conversion complete:', outputPath);
        return { ok: true, outputPath };
    } catch (err) {
        logError('Image conversion failed:', err.message);
        throw err;
    } finally {
        if (heicTempPath) {
            fs.unlink(heicTempPath, () => {
                //
            });
        }
    }
}

module.exports = { convertImage, getImageOutputPath, IMAGE_FORMAT_PRESETS };
