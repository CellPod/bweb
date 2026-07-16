// Download Queue
// Sequential queue with per-item state, retry, and resilience.
// One failure never kills the rest.

const { log, logError } = require('./utils');

// Item states
const STATE = {
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

class DownloadQueue {
    constructor() {
        this._items = [];
        this._isProcessing = false;
        this._paused = true; // starts paused — user clicks "Start Queue" to begin
        this._aborted = false; // "cancel all" flag
        this._callbacks = null; // onProgress, onLog, onItemUpdate, onQueueUpdate
        this._currentProc = null; // ref to kill on cancel
        this._idCounter = 0;
        this._downloadPath = null;
        this._store = null;
        this._pauseCancelled = false; // true when cancel is triggered by pause (reset to PENDING, not FAILED)
    }

    // Register callbacks (call once from main.js)
    setCallbacks(cbs) {
        this._callbacks = cbs;
    }

    // Set download path (call from main.js, and whenever it changes)
    setDownloadPath(p) {
        this._downloadPath = p;
    }

    // Set electron-store instance for queue persistence
    setStore(store) {
        this._store = store;
    }

    // Restore pending items from a previous session (called on startup)
    loadPersisted(items) {
        if (!items || !items.length) return;
        for (const item of items) {
            const qItem = { ...item, id: ++this._idCounter, state: STATE.PENDING, error: null, progress: null };
            this._items.push(qItem);
        }
        log('Queue: restored', items.length, 'pending item(s) from previous session');
        this._emitQueueUpdate();
    }

    // Add one or more items to the queue. Each item: { url, title, formatId extractAudio, audioFormat, thumbnail }
    add(items) {
        const added = [];
        for (const item of items) {
            const qItem = {
                id: ++this._idCounter,
                url: item.url,
                title: item.title || 'Untitled',
                thumbnail: item.thumbnail || null,
                formatId: item.formatId,
                extractAudio: item.extractAudio || false,
                audioFormat: item.audioFormat || 'mp3',
                videoCodec: item.videoCodec || null,
                trimSegments: item.trimSegments || null,
                liveFromStart: item.liveFromStart || false,
                state: STATE.PENDING,
                error: null,
                progress: null, // { percent, speed, eta }
                addedAt: Date.now(),
            };
            this._items.push(qItem);
            added.push(qItem);
            log('Queue: added', qItem.title, '->', qItem.id);
        }

        this._emitQueueUpdate();
        this._persist();

        // Only auto-start if not paused and not already processing
        if (!this._isProcessing && !this._paused) {
            this._processNext();
        }

        return added;
    }

    start() {
        this._paused = false;
        this._aborted = false;
        if (!this._isProcessing) {
            this._processNext();
        }
        this._emitQueueUpdate();
    }

    pause() {
        this._paused = true;
        // Gate on _isProcessing, not _currentProc: the process handle isn't assigned until
        // yt-dlp actually spawns (after an async cookie-file read), so relying on _currentProc
        // alone silently drops pause/cancel requests made in that window. Always record intent
        // here; _killCurrentProc()/the poll loop in _downloadOne() apply it as soon as possible.
        if (this._isProcessing) {
            log('Queue: pausing — stopping current download');
            this._pauseCancelled = true;
            this._cancelled = true;
            this._killCurrentProc();
        }
        this._emitQueueUpdate();
    }

    getAll() {
        return this._items.map((item) => ({ ...item }));
    }

    cancelCurrent() {
        if (this._isProcessing) {
            log('Queue: cancelling current');
            this._cancelled = true;
            this._killCurrentProc();
        }
    }

    _killCurrentProc() {
        if (this._currentProc) {
            try {
                this._currentProc.kill('SIGTERM');
            } catch { /**/ }
            this._currentProc = null;
        }
        // else: yt-dlp hasn't spawned yet — the poll loop in _downloadOne() kills it
        // the instant the process handle appears, since _cancelled is already set.
    }

    cancelAll() {
        log('Queue: cancel all');
        this._aborted = true;
        this.cancelCurrent();

        // Mark pending items as failed
        for (const item of this._items) {
            if (item.state === STATE.PENDING) {
                item.state = STATE.FAILED;
                item.error = 'Cancelled';
            }
        }

        this._isProcessing = false;
        this._emitQueueUpdate();
        this._persist();
    }

    retry(itemId) {
        const item = this._items.find((i) => i.id === itemId);
        if (!item || item.state !== STATE.FAILED) return;

        log('Queue: retrying', item.title);
        item.state = STATE.PENDING;
        item.error = null;
        item.progress = null;
        this._emitQueueUpdate();

        if (!this._isProcessing) {
            this._processNext();
        }
    }

    retryFailed() {
        let count = 0;
        for (const item of this._items) {
            if (item.state === STATE.FAILED) {
                item.state = STATE.PENDING;
                item.error = null;
                item.progress = null;
                count++;
            }
        }
        log('Queue: retrying', count, 'failed items');
        this._emitQueueUpdate();

        if (!this._isProcessing && count > 0) {
            this._processNext();
        }
    }

    clearCompleted() {
        this._items = this._items.filter((i) => i.state === STATE.PENDING || i.state === STATE.DOWNLOADING);
        // Reset id counter if queue is empty
        if (this._items.length === 0) this._idCounter = 0;
        this._emitQueueUpdate();
    }

    remove(itemId) {
        const item = this._items.find((i) => i.id === itemId);
        if (!item) return;

        if (item.state === STATE.DOWNLOADING) {
            this.cancelCurrent();
        }

        this._items = this._items.filter((i) => i.id !== itemId);
        this._emitQueueUpdate();
        this._persist();
    }

    get isActive() {
        return this._isProcessing;
    }

    get isPaused() {
        return this._paused;
    }

    get counts() {
        let pending = 0,
            downloading = 0,
            completed = 0,
            failed = 0;
        for (const item of this._items) {
            if (item.state === STATE.PENDING) pending++;
            else if (item.state === STATE.DOWNLOADING) downloading++;
            else if (item.state === STATE.COMPLETED) completed++;
            else if (item.state === STATE.FAILED) failed++;
        }
        return {
            total: this._items.length,
            pending,
            downloading,
            completed,
            failed,
        };
    }

    // Internal

    async _processNext() {
        if (this._aborted) {
            this._aborted = false;
            this._isProcessing = false;
            return;
        }

        if (this._paused) {
            this._isProcessing = false;
            this._emitQueueUpdate();
            return;
        }

        // Find next pending item
        const nextItem = this._items.find((i) => i.state === STATE.PENDING);
        if (!nextItem) {
            this._isProcessing = false;
            log('Queue: all done');
            this._emit('log', 'Queue complete');
            this._emitQueueUpdate();
            return;
        }

        this._isProcessing = true;
        nextItem.state = STATE.DOWNLOADING;
        nextItem.progress = { percent: '0%', speed: '', eta: '' };
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();

        const counts = this.counts;
        const position = counts.completed + counts.failed + 1;
        const total = counts.total;
        this._emit('log', `Downloading ${position}/${total}: ${nextItem.title}`);

        try {
            this._cancelled = false;
            await this._downloadOne(nextItem);
            nextItem.state = STATE.COMPLETED;
            nextItem.progress = { percent: '100%', speed: '', eta: '' };
            this._emit('log', `Completed: ${nextItem.title} ✓`);
            log('Queue: completed', nextItem.title);
            this._emitItemComplete(nextItem);
        } catch (err) {
            if (this._cancelled && this._pauseCancelled) {
                // Paused mid-download — reset to pending so it can resume
                nextItem.state = STATE.PENDING;
                nextItem.error = null;
                nextItem.progress = null;
                this._emit('log', `Paused: ${nextItem.title}`);
                log('Queue: paused', nextItem.title);
                this._pauseCancelled = false;
            } else if (this._cancelled) {
                nextItem.state = STATE.FAILED;
                nextItem.error = 'Cancelled';
                this._emit('log', `Skipped: ${nextItem.title}`);
                log('Queue: cancelled', nextItem.title);
            } else {
                nextItem.state = STATE.FAILED;
                nextItem.error = err.message || 'Download failed';
                this._emit('log', `Failed: ${nextItem.title} - ${nextItem.error}`);
                logError('Queue: failed', nextItem.title, err.message);
            }
            this._cancelled = false;
        }

        this._currentProc = null;
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();
        this._persist();

        // Continue to next, always, even after failure
        // Use setTimeout to avoid stack buildup on large queues
        setTimeout(() => this._processNext(), 0);
    }

    _downloadOne(item) {
        // Lazy-require to avoid circular deps
        const ytdlp = require('./ytdlp');
        const path = require('path');
        const fs = require('fs');

        // Get download path from the store passed during callback setup
        const downloadPath = this._downloadPath || require('path').join(require('electron').app.getPath('downloads'), 'bWeb');
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath, { recursive: true });
        }

        const callbacks = {
            onProgress: (p) => {
                item.progress = p;
                this._emitItemUpdate(item);
            },
            onLog: (msg) => {
                this._emit('log', msg);
            },
        };

        const downloadPromise = ytdlp.download(
            {
                url: item.url,
                formatId: item.formatId,
                outputDir: downloadPath,
                extractAudio: item.extractAudio,
                audioFormat: item.audioFormat,
                videoCodec: item.videoCodec,
                trimSegments: item.trimSegments,
                liveFromStart: item.liveFromStart,
            },
            callbacks,
        );

        this._currentProc = callbacks._proc;

        const pollInterval = setInterval(() => {
            if (callbacks._proc) {
                this._currentProc = callbacks._proc;
                clearInterval(pollInterval);
                // A pause/cancel came in before yt-dlp had spawned — honor it now.
                if (this._cancelled) {
                    this._killCurrentProc();
                }
            }
        }, 50);

        return downloadPromise.finally(() => clearInterval(pollInterval));
    }

    _emit(type, data) {
        if (!this._callbacks) return;
        if (type === 'log' && this._callbacks.onLog) {
            this._callbacks.onLog(data);
        }
    }

    _emitItemUpdate(item) {
        if (this._callbacks?.onItemUpdate) {
            this._callbacks.onItemUpdate({ ...item });
        }
    }

    _emitItemComplete(item) {
        if (this._callbacks?.onItemComplete) {
            this._callbacks.onItemComplete({ ...item });
        }
    }

    _emitQueueUpdate() {
        if (this._callbacks?.onQueueUpdate) {
            this._callbacks.onQueueUpdate({
                items: this.getAll(),
                counts: this.counts,
                isActive: this.isActive,
                isPaused: this.isPaused,
            });
        }
    }

    _persist() {
        if (!this._store) return;
        // Include DOWNLOADING items too — if the app quits or crashes mid-download, that item
        // would otherwise vanish from the queue instead of resuming as pending next launch.
        const pending = this._items
            .filter((i) => i.state === STATE.PENDING || i.state === STATE.DOWNLOADING)
            .map(({ url, title, thumbnail, formatId, extractAudio, audioFormat, videoCodec, trimSegments, liveFromStart }) => ({
                url, title, thumbnail, formatId, extractAudio, audioFormat, videoCodec, trimSegments, liveFromStart,
            }));
        this._store.set('queue.pending', pending);
    }
}

const queue = new DownloadQueue();
module.exports = { queue, STATE };
