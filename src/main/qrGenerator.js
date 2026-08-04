// QR Generator — the actual QR rendering (shapes, colors, logo) happens client-side in the
// renderer via qr-code-styling (vendored in src/renderer/vendor/), since Electron's renderer is
// a real Chromium window and can use canvas/SVG directly — no native image library needed just
// for this. The main process only writes the final bytes to disk.
const fs = require('fs');
const path = require('path');
const { log } = require('./utils');

function getOutputPath(destDir, format) {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = format === 'svg' ? '.svg' : '.png';
    let outputPath = path.join(destDir, `qrcode${ext}`);
    let n = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(destDir, `qrcode_${n}${ext}`);
        n++;
    }
    return outputPath;
}

function saveQrFile(bytes, destDir, format) {
    const outputPath = getOutputPath(destDir, format);
    fs.writeFileSync(outputPath, Buffer.from(bytes));
    log('QR code exported:', outputPath);
    return { outputPath };
}

module.exports = { saveQrFile };
