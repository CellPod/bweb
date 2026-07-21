const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEV_MODE = !!(process.env.DEV_MODE || process.argv.includes('--dev') || process.argv.includes('--dev-mode'));

// Console output isn't visible anywhere once the app is packaged (no attached terminal),
// so a real bug — like a silent auto-update failure — leaves no trace. Persist logs to a
// small file instead, capped and rotated so it can't grow unbounded.
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB
let logFilePath = null;
let triedInit = false;

function getLogFilePath() {
    if (logFilePath || triedInit) return logFilePath;
    triedInit = true;
    try {
        const dir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'main.log');
        try {
            if (fs.statSync(file).size > MAX_LOG_SIZE) {
                fs.renameSync(file, path.join(dir, 'main.log.old'));
            }
        } catch { /* no existing file yet */ }
        logFilePath = file;
    } catch {
        logFilePath = null;
    }
    return logFilePath;
}

function writeLine(prefix, args) {
    const file = getLogFilePath();
    if (!file) return;
    const line = `[${new Date().toISOString()}] ${prefix} ${args.map(String).join(' ')}`;
    try {
        fs.appendFileSync(file, line + '\n');
    } catch { /* best-effort only, never let logging itself crash the app */ }
}

function log(...args) {
    if (DEV_MODE) console.log('[App]', ...args);
    writeLine('[App]', args);
}

function logError(...args) {
    console.error('[Error]', ...args);
    writeLine('[Error]', args);
}

module.exports = { DEV_MODE, log, logError, getLogFilePath };
