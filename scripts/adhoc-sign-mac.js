// Ad-hoc signs the mac app bundle after packaging.
//
// Ad-hoc signing (codesign --sign -) is free and needs no Apple Developer account —
// it's enough for electron-updater/Squirrel.Mac to accept and install auto-updates
// (verified: full check → download → quitAndInstall cycle works with it).
// It does NOT remove Gatekeeper's "unidentified developer" warning on first launch —
// only a paid Developer ID certificate + notarization would avoid that prompt entirely.
const { execFileSync } = require('child_process');

exports.default = async function (context) {
    if (context.electronPlatformName !== 'darwin') return;

    const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
    console.log('Ad-hoc signing:', appPath);
    execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' });
};
