// renderer.js is a classic (non-module) script — every function it defines needs to stay a real
// global so inline onclick="..." handlers in index.html can find it. pdf.js only ships as an ES
// module (pdf.min.mjs), so this tiny module script is the bridge: import it once, hang it on
// `window`, and renderer.js just reads `window.pdfjsLib` like any other global.
import * as pdfjsLib from './pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
