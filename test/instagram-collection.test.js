const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const origin = 'https://www.instagram.com';
const scraper = readFileSync(require.resolve('../src/main/scraper'), 'utf8');

async function scan(tiles) {
    const anchors = tiles.map(([href, alt]) => ({
        getAttribute: () => href,
        querySelector: () => ({ alt }),
    }));

    class BrowserWindow extends EventEmitter {
        webContents = Object.assign(new EventEmitter(), {
            executeJavaScript: async (script) => runInNewContext(script, {
                URL,
                document: { querySelectorAll: () => anchors, body: { scrollHeight: 0 } },
                window: { location: { origin }, scrollTo() {} },
            }),
        });

        loadURL() { this.webContents.emit('did-finish-load'); }
        isDestroyed() { return false; }
        close() { this.emit('closed'); }
    }

    const module = { exports: {} };
    runInNewContext(scraper, {
        module,
        require: (name) => {
            if (name === 'electron') return { BrowserWindow };
            assert.equal(name, './utils');
            return { log() {}, logError: (message, error) => assert.fail(`${message} ${error}`) };
        },
        setTimeout: (fn, ms) => ms === 240000 ? undefined : queueMicrotask(fn),
        clearTimeout() {},
    });

    const emitted = [];
    const { items } = await module.exports.scrapeCollection(`${origin}/owner/saved/favorites/123/`, null, {
        onItem: (item) => emitted.push(item.url),
    });
    const urls = Array.from(items, (item) => item.url);
    assert.deepEqual(emitted, urls);
    return urls;
}

test('reads profile-prefixed reels in a named collection and emits canonical download URLs', async () => {
    assert.deepEqual(await scan([
        ['/creator.name/reel/Reel_1/?source=saved', 'Photo by creator'],
        [`${origin}/reel/Reel_1/#preview`, 'Duplicate'],
        [`${origin}/other_creator/reel/Reel-2/`, 'A reel'],
    ]), [`${origin}/reel/Reel_1/`, `${origin}/reel/Reel-2/`]);
});

test('keeps canonical post links and skips photo posts and unrelated links', async () => {
    assert.deepEqual(await scan([
        ['/p/Post_1/', 'A video'],
        ['/p/Photo_1/', 'Photo by creator'],
        ['https://example.com/reel/Foreign_1/', 'Other site'],
        ['/reels/', 'Navigation'],
        ['/p/Post_1/other/', 'Other page'],
    ]), [`${origin}/p/Post_1/`]);
});
