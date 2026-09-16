// macOS Auto-Update via Sparkle
//
// Squirrel.Mac (electron-updater's macOS engine) was tried and removed in July 2026 — see
// TODO.md and updater.js's comment — after a silent, undiagnosable failure for a real user
// on an ad-hoc-signed build. Sparkle is the alternative: the de-facto standard update
// framework for non-App-Store Mac apps, and — critically — it explicitly supports ad-hoc
// signing (this project's `adhoc-sign-mac.js`/afterPack signing already proved sufficient
// for Squirrel.Mac's own signature check too, per that script's old comment; the actual
// July failure was more likely Gatekeeper's quarantine check on the *downloaded* update,
// which Sparkle documents handling explicitly — see PR/TODO discussion). Update authenticity
// is verified with Sparkle's own free EdDSA signature (generated locally via `generate_keys`,
// no Apple account needed), separate from Apple code signing.
//
// This is macOS-only. Windows/Linux keep using updater.js's existing GitHub-check-and-
// redirect flow untouched — see TODO.md for the plan there.
//
// This bridge intentionally suppresses Sparkle's native dialogs (see the README of
// electron-sparkle-updater) so bWeb can show its own UI consistent with the rest of the
// app, via events forwarded to the renderer.

const { loadSparkleBridgeForApp } = require('electron-sparkle-updater');
const { log, logError } = require('./utils');

const FEED_URL = 'https://github.com/CellPod/bweb/releases/latest/download/appcast.xml';
const PUBLIC_ED_KEY = '6CtElULhDYjuHj8gWulXU31KQBJvdXzHutM3l970ohs=';

let bridge = null;

// Returns true if Sparkle is wired up and ready. False means the caller should fall back
// to updater.js's manual GitHub-release check (non-darwin, or anything went wrong loading
// the native addon — this must never throw or block startup).
async function init(onEvent) {
    if (process.platform !== 'darwin') return false;

    try {
        bridge = await loadSparkleBridgeForApp((msg) => log('[sparkle]', msg));
        if (!bridge) {
            log('Sparkle bridge unavailable — falling back to manual update check');
            return false;
        }

        const ok = bridge.init({ appcastUrl: FEED_URL, publicEdKey: PUBLIC_ED_KEY });
        if (!ok) {
            logError('Sparkle bridge failed to initialize');
            bridge = null;
            return false;
        }

        bridge.setEventHandler((event) => {
            log('[sparkle event]', event.type);
            onEvent(event);
        });
        bridge.setAutomaticChecks(true);
        return true;
    } catch (err) {
        logError('Sparkle init failed, falling back to manual update check:', err.message);
        bridge = null;
        return false;
    }
}

function checkForUpdates() {
    if (bridge) bridge.checkForUpdates();
}

function installUpdateNow() {
    if (bridge) bridge.installUpdateNow();
}

function isAvailable() {
    return !!bridge;
}

module.exports = { init, checkForUpdates, installUpdateNow, isAvailable };
