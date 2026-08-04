// Runs as an isolated Electron utilityProcess (separate OS process, not the main process).
//
// Why this exists: @jspawn/ghostscript-wasm installs its own `process.on('uncaughtException')`
// handler that re-throws any non-clean Ghostscript error. Re-throwing from inside an
// uncaughtException handler is fatal in Node — there is no way to catch or recover from it in
// the same process. Running Ghostscript here means a malformed/encrypted/unusual PDF that trips
// that path only kills this utility process, not all of bWeb.
async function mountInput(mod, inputPath) {
    const path = require('path');
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath);
    mod.FS.mkdir('/in');
    mod.FS.mount(mod.NODEFS, { root: inputDir }, '/in');
    return `/in/${inputName}`;
}

async function compress(inputPath, gsSetting) {
    const GhostscriptModule = require('@jspawn/ghostscript-wasm');
    const mod = await GhostscriptModule();
    const inputArg = await mountInput(mod, inputPath);

    const outputName = 'out.pdf';
    const args = [
        '-sDEVICE=pdfwrite',
        `-dPDFSETTINGS=${gsSetting}`,
        '-dNOPAUSE', '-dBATCH', '-dSAFER',
        `-sOutputFile=/${outputName}`,
        inputArg,
    ];

    const exitStatus = await mod.callMain(args);
    if (exitStatus !== 0) throw new Error(`Ghostscript exited with code ${exitStatus}`);
    return { buffer: mod.FS.readFile(`/${outputName}`) };
}

async function rasterize(inputPath, dpi) {
    const GhostscriptModule = require('@jspawn/ghostscript-wasm');
    const mod = await GhostscriptModule();
    const inputArg = await mountInput(mod, inputPath);

    const args = [
        '-sDEVICE=png16m',
        `-r${dpi || 200}`,
        // Ghostscript renders text/vector edges aliased (jagged) by default — these turn on
        // anti-aliasing for text and graphics. Without them the output looks visibly degraded
        // regardless of DPI (confirmed: a 200dpi render without these flags looked worse than
        // the DPI number alone would suggest).
        '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
        '-dNOPAUSE', '-dBATCH', '-dSAFER',
        '-sOutputFile=/page_%04d.png',
        inputArg,
    ];

    const exitStatus = await mod.callMain(args);
    if (exitStatus !== 0) throw new Error(`Ghostscript exited with code ${exitStatus}`);

    const files = mod.FS.readdir('/').filter((f) => /^page_\d+\.png$/.test(f)).sort();
    const buffers = files.map((f) => mod.FS.readFile(`/${f}`));
    return { buffers };
}

process.parentPort.once('message', async (e) => {
    const { mode, inputPath, gsSetting, dpi } = e.data;
    try {
        if (mode === 'rasterize') {
            const { buffers } = await rasterize(inputPath, dpi);
            const bytesList = buffers.map((b) => (b instanceof Uint8Array ? b : new Uint8Array(b)));
            process.parentPort.postMessage({ ok: true, buffers: bytesList }, bytesList.map((b) => b.buffer));
        } else {
            const { buffer } = await compress(inputPath, gsSetting);
            const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
            process.parentPort.postMessage({ ok: true, buffer: bytes }, [bytes.buffer]);
        }
    } catch (err) {
        process.parentPort.postMessage({ ok: false, error: err.message });
    }
});
