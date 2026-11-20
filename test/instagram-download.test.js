const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const instagram = 'https://www.instagram.com/reel/';
const callbacks = { onLog() {}, onProgress() {} };

function loadMain(name, dependencies) {
    const filename = require.resolve(`../src/main/${name}`);
    const module = { exports: {} };
    runInNewContext(readFileSync(filename, 'utf8'), {
        module, process, URL, setTimeout, clearTimeout, setInterval, clearInterval,
        __dirname: require('node:path').dirname(filename),
        require: (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
    }, { filename });
    return module.exports;
}

function makeDownloader(failures = {}) {
    const launches = [];
    const cookieReads = [];
    const utils = { log() {}, logError() {} };
    const fs = { existsSync: () => true };
    const ytdlp = loadMain('ytdlp', {
        './utils': utils,
        fs,
        electron: { app: { getPath: () => '/fake' } },
        './cookies': {
            getInstaCookieFile: async () => { cookieReads.push('instagram'); return '/fake/instagram.txt'; },
            getCookieFile: async () => { cookieReads.push('youtube'); return '/fake/youtube.txt'; },
            getVimeoCookieFile: async () => { cookieReads.push('vimeo'); return '/fake/vimeo.txt'; },
        },
        child_process: {
            spawn(_bin, args) {
                const argsArray = Array.from(args);
                launches.push(argsArray);
                const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
                queueMicrotask(() => {
                    const error = failures[argsArray.at(-1)];
                    if (error) proc.stderr.emit('data', error);
                    else if (argsArray.includes('--print')) proc.stdout.emit('data', 'Example\thttps://example.com/cover.jpg');
                    proc.emit('close', error ? 1 : 0, null);
                });
                return proc;
            },
        },
    });
    const { queue } = loadMain('queue', { './utils': utils, './ytdlp': ytdlp, fs });
    queue.setDownloadPath('/fake/downloads');
    return { ytdlp, queue, launches, cookieReads };
}

test('Instagram lookup and download never read account cookies while YouTube and Vimeo keep theirs', async () => {
    const { ytdlp, launches, cookieReads } = makeDownloader();
    await ytdlp.fetchMeta(`${instagram}Public/`);
    await ytdlp.download({ url: `${instagram}Public/`, outputDir: '/fake' }, callbacks);
    await ytdlp.fetchMeta('https://youtube.com/watch?v=example');
    await ytdlp.fetchMeta('https://vimeo.com/12345');

    assert.deepEqual(cookieReads, ['youtube', 'vimeo']);
    for (const args of launches.slice(0, 2)) {
        assert.ok(args.includes('--ignore-config'));
        assert.ok(args.includes('--no-cookies'));
        assert.ok(args.includes('--no-cookies-from-browser'));
        assert.ok(!args.includes('--cookies'));
    }
    assert.ok(launches[2].includes('/fake/youtube.txt'));
    assert.ok(launches[3].includes('/fake/vimeo.txt'));
});

test('the queue skips a login-only Reel and pauses with remaining items pending on rate limit', { timeout: 1000 }, async () => {
    const privateUrl = `${instagram}Private/`;
    const limitedUrl = `${instagram}Limited/`;
    const pendingUrl = `${instagram}Pending/`;
    const { queue, launches, cookieReads } = makeDownloader({
        [privateUrl]: 'ERROR: [Instagram] This content is only available for registered users who follow this account',
        [limitedUrl]: 'ERROR: [Instagram] Unable to download webpage: HTTP Error 429: Too Many Requests',
    });
    const settled = new Promise((resolve) => queue.setCallbacks({
        onQueueUpdate(data) { if (!data.isActive && data.counts.failed > 0) resolve(data); },
    }));
    queue.loadPersisted([{ url: privateUrl }]);
    queue.add([{ url: limitedUrl }, { url: pendingUrl }]);
    const data = await settled;

    assert.equal(data.isPaused, true);
    assert.deepEqual(Array.from(data.items, (item) => item.state), ['failed', 'failed', 'pending']);
    assert.deepEqual(launches.map((args) => args.at(-1)), [privateUrl, limitedUrl]);
    assert.deepEqual(cookieReads, []);
});

test('resolution presets use the shorter edge for portrait videos, including saved queue presets', async () => {
    const { ytdlp, launches } = makeDownloader();
    for (const formatId of [
        'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        'bv*[height<=720]+ba/b[height<=720]/b',
    ]) {
        await ytdlp.download({ url: `${instagram}Portrait/`, formatId, outputDir: '/fake' }, callbacks);
    }
    for (const [index, limit] of ['1080', '720'].entries()) {
        const args = launches[index];
        assert.equal(args[args.indexOf('-f') + 1], 'bv*+ba/b');
        assert.ok(args.includes('-S'));
        assert.equal(args[args.indexOf('-S') + 1], `res:${limit}`);
        assert.ok(args.includes('--no-cookies'));
    }
});

test('explicit video formats and audio presets retain their selection', async () => {
    const { ytdlp, launches } = makeDownloader();
    await ytdlp.download({ url: `${instagram}Exact/`, formatId: '137+140', noReencode: true, outputDir: '/fake' }, callbacks);
    await ytdlp.download({ url: `${instagram}Audio/`, formatId: 'ba/b', extractAudio: true, outputDir: '/fake' }, callbacks);
    assert.equal(launches[0][launches[0].indexOf('-f') + 1], '137+140');
    assert.ok(!launches[0].includes('-S'));
    assert.ok(launches[1].includes('-x'));
    assert.ok(!launches[1].includes('-S'));
});
