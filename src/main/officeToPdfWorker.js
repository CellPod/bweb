// Worker thread entry point for minipdf's synchronous convertToPdf() — see docConverter.js
// for why this needs to run off the main thread.
const { workerData, parentPort } = require('worker_threads');
const minipdf = require('minipdf');

try {
    minipdf.convertToPdf(workerData.inputPath, workerData.outputPath);
    parentPort.postMessage({ ok: true });
} catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
}
