// Background Remover — cuts a subject out of an image, exporting a transparent PNG. Local
// inference via ONNX Runtime (onnxruntime-node, MIT) running withoutbg's WBGNet open-weights
// model (withoutbg/withoutbg-python, Apache-2.0 for withoutBG's own code + Meta DINOv3 License
// for the embedded DINOv3 backbone weights — commercial use is permitted, but the DINOv3 license
// text and a "Built with DINOv3" credit must ship with the app; see licenses/withoutbg/ and the
// About screen). Chosen after testing u2netp, isnet-general-use, BiRefNet-tiny and withoutbg on
// three deliberately hard photos (backlit flyaway hair, a translucent soap bubble, a sheer lace
// veil) — withoutbg was the only one that produced a real graded alpha (not a binary cutout) on
// the sheer fabric case, at the cost of a much bigger model file (433MB vs u2netp's 4.5MB).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { app } = require('electron');
const { log } = require('./utils');

// The model expects a square canvas: the image is scaled to fit inside CANVAS_SIZE and centered
// on a black square (letterboxed) rather than squashed, so aspect ratio is preserved going in —
// the mask is then cropped back out of that same square before being resized to the real image
// dimensions.
const CANVAS_SIZE = 448;

function modelPath() {
    const base = app.isPackaged
        ? path.join(process.resourcesPath, 'models')
        : path.join(__dirname, '..', '..', 'resources', 'models');
    return path.join(base, 'withoutbg-open-weights.onnx');
}

// The ONNX Runtime session (holds the loaded model in memory) is expensive to create — reused
// across calls instead of reloading the model file on every image.
let sessionPromise = null;
function getSession() {
    if (!sessionPromise) {
        const ort = require('onnxruntime-node');
        sessionPromise = ort.InferenceSession.create(modelPath());
    }
    return sessionPromise;
}

async function computeAlphaMask(inputPath, targetWidth, targetHeight) {
    const session = await getSession();

    const meta = await sharp(inputPath).rotate().metadata();
    const { width: origW, height: origH } = meta;
    const scale = CANVAS_SIZE / Math.max(origW, origH);
    const newW = Math.round(origW * scale);
    const newH = Math.round(origH * scale);
    const padLeft = Math.floor((CANVAS_SIZE - newW) / 2);
    const padTop = Math.floor((CANVAS_SIZE - newH) / 2);

    const { data } = await sharp(inputPath)
        .rotate() // apply EXIF orientation before anything else touches pixel buffers
        .resize(newW, newH, { fit: 'fill' })
        .removeAlpha()
        .extend({ top: padTop, bottom: CANVAS_SIZE - newH - padTop, left: padLeft, right: CANVAS_SIZE - newW - padLeft, background: { r: 0, g: 0, b: 0 } })
        .raw()
        .toBuffer({ resolveWithObject: true });

    // withoutbg's own preprocessing is a plain 0-1 scale — no ImageNet mean/std normalization.
    const plane = CANVAS_SIZE * CANVAS_SIZE;
    const floatData = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
        floatData[i] = data[i * 3] / 255;
        floatData[plane + i] = data[i * 3 + 1] / 255;
        floatData[plane * 2 + i] = data[i * 3 + 2] / 255;
    }

    const ort = require('onnxruntime-node');
    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, CANVAS_SIZE, CANVAS_SIZE]);
    const results = await session.run({ [session.inputNames[0]]: inputTensor });
    const output = results[session.outputNames[0]];

    // The model's alpha output is already a 0-1 probability (its own reference code does
    // np.clip(alpha * 255, 0, 255) directly) — no sigmoid, no per-image min-max stretch. Stretching
    // would be wrong here: on an image the model is genuinely unsure about, it would manufacture
    // fake contrast out of noise instead of honestly showing low confidence.
    const maskBuffer = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) {
        maskBuffer[i] = Math.max(0, Math.min(255, Math.round(output.data[i] * 255)));
    }

    // Crop the padding back out (in mask space) before resizing to the real target dimensions —
    // .toColourspace('b-w') pins the output to a single channel, since sharp silently promotes a
    // single-channel raw buffer to 3 channels during resize otherwise (found by testing against a
    // real photo, not assumed).
    return sharp(maskBuffer, { raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 1 } })
        .extract({ left: padLeft, top: padTop, width: newW, height: newH })
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .toColourspace('b-w')
        .raw()
        .toBuffer();
}

// Automatic fallback for when the AI subject cutout below finds nothing at all — crops
// solid-color padding bars (e.g. white pillarboxing from a portrait photo fit into a wider
// frame) instead. Added after finding that "remove the white" is sometimes actually this, not
// AI background removal: the withoutbg model is a salient-subject cutout, and fed a full
// landscape photo with no isolated foreground subject (trees/road/sky, the whole frame IS the
// scene), it has nothing confident to call "foreground" and wipes the entire image to fully
// transparent — a real photo tested this exact way, confirmed pixel-by-pixel: every pixel's
// alpha came back 0, including the actual photo content, not just the white bars.
//
// sharp's `.trim()` DEFAULT threshold (10) was found — by checking actual per-column pixel
// values on a real exported file, not just eyeballing it — to leave a ~7-8px sliver of
// near-white still uncropped on one edge (JPEG compression softens the true white/content
// boundary just enough that a strict default threshold stops a few pixels early). 30 cut that
// down to ~1px but a user re-check (denser sampling, every 10 rows instead of 20 — the first
// pass' sampling was too sparse to rule out a thin remainder) caught that 1px was still visibly
// white at real display scale. 50 removes it completely — re-verified column-by-column across
// both edges with the denser sampling, output width stable from 50 through 110 (i.e. there's a
// real, stable content boundary there, not a threshold creeping into actual photo content).
const TRIM_THRESHOLD = 50;

// A real subject cutout always leaves large confident regions (alpha near 0 or near 255
// somewhere) — a mask that's near-uniformly close to zero everywhere means the model found
// nothing to call foreground at all, not a subtle/uncertain result worth keeping.
const EMPTY_MASK_THRESHOLD = 3; // average alpha (0-255)

function isMaskEmpty(maskRaw) {
    let sum = 0;
    for (let i = 0; i < maskRaw.length; i++) sum += maskRaw[i];
    return sum / maskRaw.length < EMPTY_MASK_THRESHOLD;
}

// Returns a full-resolution, already-trimmed PNG buffer if the image has a meaningful uniform
// border to crop (>2% of width or height), or null if there's nothing worth trimming.
async function getTrimmedBufferIfMeaningful(inputPath) {
    const untrimmed = await sharp(inputPath).rotate().metadata();
    const { data, info } = await sharp(inputPath).rotate().trim({ threshold: TRIM_THRESHOLD }).png().toBuffer({ resolveWithObject: true });
    const shrankMeaningfully = info.width < untrimmed.width * 0.98 || info.height < untrimmed.height * 0.98;
    return shrankMeaningfully ? { buffer: data, width: info.width, height: info.height } : null;
}

function getOutputPath(inputPath, destDir, forceExt) {
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const suffix = forceExt ? '_trimmed' : '_nobg';
    const ext = forceExt || '.png';
    let outputPath = path.join(dir, `${base}${suffix}${ext}`);
    let n = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${base}${suffix}_${n}${ext}`);
        n++;
    }
    return outputPath;
}

async function removeBackground(inputPath, destDir) {
    fs.mkdirSync(destDir || path.dirname(inputPath), { recursive: true });

    const original = await sharp(inputPath).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = original.info;
    const maskRaw = await computeAlphaMask(inputPath, width, height);

    // No isolated subject found at all (e.g. a full landscape/scene photo, not a product-on-
    // background shot) — automatically fall back to a plain border crop instead of silently
    // handing back a fully transparent, unusable image. Native/automatic on purpose: a user
    // shouldn't have to notice the AI failed and go find a separate "Trim borders" button.
    if (isMaskEmpty(maskRaw)) {
        const trimmed = await getTrimmedBufferIfMeaningful(inputPath);
        if (trimmed) {
            const outputPath = getOutputPath(inputPath, destDir, path.extname(inputPath));
            fs.writeFileSync(outputPath, trimmed.buffer);
            log('Background removed: no subject detected, fell back to border trim ->', outputPath);
            return { outputPath, fallback: 'trimmed' };
        }
        // No borders to trim either — nothing more to automatically do; fall through and return
        // the honest (fully transparent) AI result rather than inventing a result.
    }

    const outBuffer = Buffer.from(original.data);
    for (let i = 0; i < width * height; i++) {
        outBuffer[i * 4 + 3] = maskRaw[i];
    }

    const outputPath = getOutputPath(inputPath, destDir);
    await sharp(outBuffer, { raw: { width, height, channels: 4 } }).png().toFile(outputPath);
    log('Background removed:', inputPath, '->', outputPath);
    return { outputPath };
}

// Data-URL preview at a capped size — full-resolution masks/composites aren't needed just to
// look at the result on screen, and this keeps the IPC payload small for large source photos.
async function previewBackground(inputPath) {
    const PREVIEW_SIZE = 640;
    const original = await sharp(inputPath)
        .rotate()
        .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height } = original.info;
    const maskRaw = await computeAlphaMask(inputPath, width, height);

    // Same automatic fallback as removeBackground() — the preview should already show what
    // export will actually produce, not a blank checkerboard the real export then "mysteriously"
    // avoids.
    if (isMaskEmpty(maskRaw)) {
        const trimmed = await getTrimmedBufferIfMeaningful(inputPath);
        if (trimmed) {
            const previewBuffer = await sharp(trimmed.buffer)
                .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();
            return { dataUrl: `data:image/png;base64,${previewBuffer.toString('base64')}`, fallback: 'trimmed' };
        }
    }

    const outBuffer = Buffer.from(original.data);
    for (let i = 0; i < width * height; i++) {
        outBuffer[i * 4 + 3] = maskRaw[i];
    }
    const pngBuffer = await sharp(outBuffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return { dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`, fallback: null };
}

module.exports = { removeBackground, previewBackground };
