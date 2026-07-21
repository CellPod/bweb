// Preload Context Bridge
// Exposes a safe API to the renderer process.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
    fetchVideo: (url) => ipcRenderer.invoke('video:fetch', url),
    batchMeta: (urls) => ipcRenderer.invoke('video:batchMeta', urls),
    readClipboard: () => ipcRenderer.invoke('clipboard:read'),
    getPathForFile: (file) => webUtils.getPathForFile(file),

    checkDeps: () => ipcRenderer.invoke('deps:check'),
    getDepVersions: () => ipcRenderer.invoke('deps:versions'),

    getDownloadPath: () => ipcRenderer.invoke('settings:getDownloadPath'),
    chooseDownloadPath: () => ipcRenderer.invoke('settings:chooseDownloadPath'),
    openFolder: (p) => ipcRenderer.invoke('settings:openFolder', p),
    openLogs: () => ipcRenderer.invoke('settings:openLogs'),
    openExternal: (url) => ipcRenderer.invoke('settings:openExternal', url),

    getAppInfo: () => ipcRenderer.invoke('app:info'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),

    // History
    getHistory: () => ipcRenderer.invoke('history:get'),
    removeHistory: (videoId, extractorKey) => ipcRenderer.invoke('history:remove', videoId, extractorKey),
    clearHistory: () => ipcRenderer.invoke('history:clear'),

    // Auth
    checkAuth: () => ipcRenderer.invoke('auth:check'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),

    // Instagram Auth
    checkInstaAuth: () => ipcRenderer.invoke('insta:check'),
    instaLogin: () => ipcRenderer.invoke('insta:login'),
    instaLogout: () => ipcRenderer.invoke('insta:logout'),

    // Instagram Collection Scraper
    scrapeCollection: (url) => ipcRenderer.invoke('scraper:collection', url),

    // Playlist
    fetchPlaylist: (url) => ipcRenderer.invoke('playlist:fetch', url),
    detectPlaylist: (url) => ipcRenderer.invoke('playlist:detect', url),

    // Queue
    queueAdd: (items) => ipcRenderer.invoke('queue:add', items),
    queueGetAll: () => ipcRenderer.invoke('queue:getAll'),
    queueGetCounts: () => ipcRenderer.invoke('queue:getCounts'),
    queueCancelCurrent: () => ipcRenderer.invoke('queue:cancelCurrent'),
    queueCancelAll: () => ipcRenderer.invoke('queue:cancelAll'),
    queueRetry: (itemId) => ipcRenderer.invoke('queue:retry', itemId),
    queueRetryFailed: () => ipcRenderer.invoke('queue:retryFailed'),
    queueClearCompleted: () => ipcRenderer.invoke('queue:clearCompleted'),
    queueRemove: (itemId) => ipcRenderer.invoke('queue:remove', itemId),
    queueStart: () => ipcRenderer.invoke('queue:start'),
    queuePause: () => ipcRenderer.invoke('queue:pause'),

    onLog: (cb) => {
        const handler = (_e, msg) => cb(msg);
        ipcRenderer.on('log', handler);
        return () => ipcRenderer.removeListener('log', handler);
    },
    onQueueUpdate: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('queue:update', handler);
        return () => ipcRenderer.removeListener('queue:update', handler);
    },
    onQueueItemUpdate: (cb) => {
        const handler = (_e, item) => cb(item);
        ipcRenderer.on('queue:itemUpdate', handler);
        return () => ipcRenderer.removeListener('queue:itemUpdate', handler);
    },
    onPlaylistItem: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('playlist:item', handler);
        return () => ipcRenderer.removeListener('playlist:item', handler);
    },
    onScraperItem: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('scraper:item', handler);
        return () => ipcRenderer.removeListener('scraper:item', handler);
    },
    onUpdateAvailable: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('update-available', handler);
        return () => ipcRenderer.removeListener('update-available', handler);
    },

    // Converter
    convertChooseFile: () => ipcRenderer.invoke('convert:chooseFile'),
    convertFile: (inputPath, format, startTime, endTime) => ipcRenderer.invoke('convert:file', { inputPath, format, startTime, endTime }),
    convertCancel: () => ipcRenderer.invoke('convert:cancel'),
    onConvertProgress: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('convert:progress', handler);
        return () => ipcRenderer.removeListener('convert:progress', handler);
    },

    resetApp: () => ipcRenderer.invoke('app:reset'),
});
