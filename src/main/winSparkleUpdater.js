// Windows Auto-Update via WinSparkle
//
// WinSparkle is the Windows port of Sparkle — same maintainer format (appcast + EdDSA
// signatures, fully compatible with Sparkle's own tools/keys), so this reuses the exact
// same EdDSA keypair already generated for macOS (see sparkleUpdater.js).
//
// Unlike macOS, there is no maintained Electron bridge for WinSparkle, so this talks to
// WinSparkle.dll directly via koffi (a pure-JS FFI library — no native compilation step,
// unlike a hand-rolled N-API addon that would need an MSVC build this project has no way
// to verify without a real Windows machine).
//
// Deliberately simple: WinSparkle shows its OWN native Win32 update dialogs (check/
// download/install prompts) rather than a custom bWeb banner like the macOS side. Building
// a fully silent bridge with a custom UI (like electron-sparkle-updater did for Sparkle)
// would mean wiring many more callbacks with no way to test any of it end-to-end from this
// dev environment — leaning on WinSparkle's own well-tested UI/flow minimizes what can go
// wrong in code nobody here can run.
//
// IMPORTANT — this file has never run on a real Windows machine (koffi and WinSparkle.dll
// are both win32-only). The koffi call syntax itself *was* validated on this Mac against a
// real C function (libSystem's qsort, proving the proto/register/pointer-by-name mechanics
// work as written here) — but the actual WinSparkle.dll integration is unverified. If it
// throws on load, check first: (1) bin/WinSparkle.dll (dev) or resources/bin/WinSparkle.dll
// (packaged) exists and is the x64 build — see scripts/postinstall.js's downloadWinSparkle()
// — (2) koffi's own prebuilt win32-x64 native addon installed correctly via npm.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { log, logError } = require('./utils');

const APPCAST_URL = 'https://github.com/CellPod/bweb/releases/latest/download/appcast-windows.xml';
const PUBLIC_ED_KEY = '6CtElULhDYjuHj8gWulXU31KQBJvdXzHutM3l970ohs=';
const COMPANY_NAME = 'Baba';
const APP_NAME = 'bWeb';

let fns = null;
let registeredCallbacks = [];

function findDllPath() {
    const candidates = [
        path.join(process.resourcesPath || '', 'bin', 'WinSparkle.dll'), // packaged
        path.join(__dirname, '..', '..', 'bin', 'WinSparkle.dll'), // dev
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
}

// Returns true if WinSparkle is wired up and running. False means the caller should fall
// back to updater.js's manual GitHub-release check — non-win32, missing DLL, or anything
// went wrong loading/configuring it. Must never throw or block startup.
function init() {
    if (process.platform !== 'win32') return false;

    try {
        const koffi = require('koffi');

        const dllPath = findDllPath();
        if (!dllPath) {
            log('WinSparkle.dll not found — falling back to manual update check');
            return false;
        }

        const lib = koffi.load(dllPath);

        const CanShutdownCb = koffi.proto('int __cdecl CanShutdownCb()');
        const ShutdownRequestCb = koffi.proto('void __cdecl ShutdownRequestCb()');
        const ErrorCb = koffi.proto('void __cdecl ErrorCb()');

        fns = {
            setAppcastUrl: lib.func('void __cdecl win_sparkle_set_appcast_url(str url)'),
            setEdDsaPublicKey: lib.func('int __cdecl win_sparkle_set_eddsa_public_key(str pubkey)'),
            setAppDetails: lib.func('void __cdecl win_sparkle_set_app_details(str16 company, str16 appName, str16 appVersion)'),
            setAutomaticCheck: lib.func('void __cdecl win_sparkle_set_automatic_check_for_updates(int state)'),
            setCheckInterval: lib.func('void __cdecl win_sparkle_set_update_check_interval(int interval)'),
            setCanShutdownCallback: lib.func('void __cdecl win_sparkle_set_can_shutdown_callback(CanShutdownCb *cb)'),
            setShutdownRequestCallback: lib.func('void __cdecl win_sparkle_set_shutdown_request_callback(ShutdownRequestCb *cb)'),
            setErrorCallback: lib.func('void __cdecl win_sparkle_set_error_callback(ErrorCb *cb)'),
            checkUpdateWithUi: lib.func('void __cdecl win_sparkle_check_update_with_ui()'),
            initFn: lib.func('void __cdecl win_sparkle_init()'),
            cleanupFn: lib.func('void __cdecl win_sparkle_cleanup()'),
        };

        // bWeb has no "unsaved document" concept blocking shutdown (downloads/conversions
        // are queued and resumable) — always allow it, then quit gracefully so Electron's
        // normal shutdown path (flushing electron-store etc.) runs instead of WinSparkle
        // tearing the process down itself.
        const canShutdownPtr = koffi.register(() => 1, koffi.pointer(CanShutdownCb));
        const shutdownRequestPtr = koffi.register(() => {
            log('WinSparkle requested shutdown to install update');
            app.quit();
        }, koffi.pointer(ShutdownRequestCb));
        const errorPtr = koffi.register(() => {
            logError('WinSparkle reported an update check error');
        }, koffi.pointer(ErrorCb));
        registeredCallbacks = [canShutdownPtr, shutdownRequestPtr, errorPtr];

        fns.setCanShutdownCallback(canShutdownPtr);
        fns.setShutdownRequestCallback(shutdownRequestPtr);
        fns.setErrorCallback(errorPtr);

        fns.setAppcastUrl(APPCAST_URL);
        const keyAccepted = fns.setEdDsaPublicKey(PUBLIC_ED_KEY);
        if (!keyAccepted) {
            logError('WinSparkle rejected the EdDSA public key — falling back to manual update check');
            fns = null;
            return false;
        }

        fns.setAppDetails(COMPANY_NAME, APP_NAME, app.getVersion());
        fns.setAutomaticCheck(1);
        fns.setCheckInterval(3600); // seconds; 3600 is WinSparkle's documented minimum

        fns.initFn();
        log('WinSparkle initialized');
        return true;
    } catch (err) {
        logError('WinSparkle init failed, falling back to manual update check:', err.message);
        fns = null;
        return false;
    }
}

function checkForUpdates() {
    if (fns) fns.checkUpdateWithUi();
}

function isAvailable() {
    return !!fns;
}

// Call on app quit — cancels WinSparkle's background thread and frees the registered
// callback slots (koffi caps these at 8192 total; leaking them across repeated init()
// calls in the same process would eventually break registration elsewhere).
function cleanup() {
    try {
        if (fns) fns.cleanupFn();
    } catch (err) {
        logError('WinSparkle cleanup failed:', err.message);
    }
    if (registeredCallbacks.length) {
        try {
            const koffi = require('koffi');
            for (const cb of registeredCallbacks) koffi.unregister(cb);
        } catch {
            //
        }
    }
    registeredCallbacks = [];
    fns = null;
}

module.exports = { init, checkForUpdates, isAvailable, cleanup };
