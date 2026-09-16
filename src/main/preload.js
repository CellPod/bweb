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

    // Vimeo Auth
    checkVimeoAuth: () => ipcRenderer.invoke('vimeo:check'),
    vimeoLogin: () => ipcRenderer.invoke('vimeo:login'),
    vimeoLogout: () => ipcRenderer.invoke('vimeo:logout'),

    // Vimeo API (library import)
    getVimeoToken: () => ipcRenderer.invoke('vimeo:getToken'),
    saveVimeoToken: (token) => ipcRenderer.invoke('vimeo:saveToken', token),
    fetchVimeoLibrary: () => ipcRenderer.invoke('vimeo:fetchLibrary'),
    getVimeoVideoFile: (videoId) => ipcRenderer.invoke('vimeo:getVideoFile', videoId),

    // Instagram Collection Scraper
    scrapeCollection: (url) => ipcRenderer.invoke('scraper:collection', url),

    // Playlist
    fetchPlaylist: (url) => ipcRenderer.invoke('playlist:fetch', url),
    detectPlaylist: (url) => ipcRenderer.invoke('playlist:detect', url),

    // Queue
    queueAdd: (items) => ipcRenderer.invoke('queue:add', items),
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
    onSparkleEvent: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('sparkle:event', handler);
        return () => ipcRenderer.removeListener('sparkle:event', handler);
    },
    installSparkleUpdate: () => ipcRenderer.invoke('sparkle:installUpdateNow'),
    installSparkleUpdateOnQuit: () => ipcRenderer.invoke('sparkle:installUpdateOnQuit'),
    getSkippedUpdateVersion: () => ipcRenderer.invoke('sparkle:getSkippedVersion'),
    setSkippedUpdateVersion: (version) => ipcRenderer.invoke('sparkle:setSkippedVersion', version),
    getAutoInstallUpdates: () => ipcRenderer.invoke('sparkle:getAutoInstall'),
    setAutoInstallUpdates: (enabled) => ipcRenderer.invoke('sparkle:setAutoInstall', enabled),

    // Converter
    convertChooseFile: () => ipcRenderer.invoke('convert:chooseFile'),
    convertFile: (inputPath, format, startTime, endTime) => ipcRenderer.invoke('convert:file', { inputPath, format, startTime, endTime }),
    convertCancel: () => ipcRenderer.invoke('convert:cancel'),
    onConvertProgress: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('convert:progress', handler);
        return () => ipcRenderer.removeListener('convert:progress', handler);
    },
    imgConvertChooseFile: () => ipcRenderer.invoke('imgconvert:chooseFile'),
    imgConvertFile: (inputPath, format) => ipcRenderer.invoke('imgconvert:file', { inputPath, format }),
    docConvertChooseFile: () => ipcRenderer.invoke('docconvert:chooseFile'),
    docConvertFile: (inputPath, format) => ipcRenderer.invoke('docconvert:file', { inputPath, format }),
    convertGetDestPath: () => ipcRenderer.invoke('convert:getDestPath'),
    convertChooseDestPath: () => ipcRenderer.invoke('convert:chooseDestPath'),
    convertOpenDestFolder: () => ipcRenderer.invoke('convert:openDestFolder'),
    convertGetAutoOpen: () => ipcRenderer.invoke('convert:getAutoOpen'),
    convertSetAutoOpen: (value) => ipcRenderer.invoke('convert:setAutoOpen', value),

    resetApp: () => ipcRenderer.invoke('app:reset'),

    // Compress
    compressChooseFile: () => ipcRenderer.invoke('compress:chooseFile'),
    compressDetectType: (filePath) => ipcRenderer.invoke('compress:detectType', filePath),
    compressEstimate: (filePath) => ipcRenderer.invoke('compress:estimate', filePath),
    compressRun: (filePath, preset) => ipcRenderer.invoke('compress:run', { filePath, preset }),
    compressRunTarget: (filePath, targetBytes) => ipcRenderer.invoke('compress:runTarget', { filePath, targetBytes }),
    compressGetDestPath: () => ipcRenderer.invoke('compress:getDestPath'),
    compressChooseDestPath: () => ipcRenderer.invoke('compress:chooseDestPath'),
    compressOpenDestFolder: () => ipcRenderer.invoke('compress:openDestFolder'),
    compressGetAutoOpen: () => ipcRenderer.invoke('compress:getAutoOpen'),
    compressSetAutoOpen: (value) => ipcRenderer.invoke('compress:setAutoOpen', value),

    // Watermark
    watermarkChooseFile: () => ipcRenderer.invoke('watermark:chooseFile'),
    watermarkChooseLogo: () => ipcRenderer.invoke('watermark:chooseLogo'),
    watermarkDetectType: (filePath) => ipcRenderer.invoke('watermark:detectType', filePath),
    watermarkRun: (filePath, options) => ipcRenderer.invoke('watermark:run', { filePath, options }),
    watermarkGetDestPath: () => ipcRenderer.invoke('watermark:getDestPath'),
    watermarkChooseDestPath: () => ipcRenderer.invoke('watermark:chooseDestPath'),
    watermarkOpenDestFolder: () => ipcRenderer.invoke('watermark:openDestFolder'),
    watermarkGetAutoOpen: () => ipcRenderer.invoke('watermark:getAutoOpen'),
    watermarkSetAutoOpen: (value) => ipcRenderer.invoke('watermark:setAutoOpen', value),

    // Redact
    redactChooseFile: () => ipcRenderer.invoke('redact:chooseFile'),
    redactDetectType: (filePath) => ipcRenderer.invoke('redact:detectType', filePath),
    redactRun: (filePath, zones) => ipcRenderer.invoke('redact:run', { filePath, zones }),
    redactGetDestPath: () => ipcRenderer.invoke('redact:getDestPath'),
    redactChooseDestPath: () => ipcRenderer.invoke('redact:chooseDestPath'),
    redactOpenDestFolder: () => ipcRenderer.invoke('redact:openDestFolder'),
    redactGetAutoOpen: () => ipcRenderer.invoke('redact:getAutoOpen'),
    redactSetAutoOpen: (value) => ipcRenderer.invoke('redact:setAutoOpen', value),

    // QR Generator
    qrExport: (bytes, format) => ipcRenderer.invoke('qr:export', { bytes, format }),
    qrGetDestPath: () => ipcRenderer.invoke('qr:getDestPath'),
    qrChooseDestPath: () => ipcRenderer.invoke('qr:chooseDestPath'),
    qrOpenDestFolder: () => ipcRenderer.invoke('qr:openDestFolder'),
    qrGetAutoOpen: () => ipcRenderer.invoke('qr:getAutoOpen'),
    qrSetAutoOpen: (value) => ipcRenderer.invoke('qr:setAutoOpen', value),

    // Background Remover
    saveClipboardImage: (bytes, ext) => ipcRenderer.invoke('clipboard:saveImage', bytes, ext),
    bgRemoveChooseFile: () => ipcRenderer.invoke('bgremove:chooseFile'),
    bgRemovePreview: (filePath) => ipcRenderer.invoke('bgremove:preview', filePath),
    bgRemoveRun: (filePath) => ipcRenderer.invoke('bgremove:run', filePath),
    bgRemoveGetDestPath: () => ipcRenderer.invoke('bgremove:getDestPath'),
    bgRemoveChooseDestPath: () => ipcRenderer.invoke('bgremove:chooseDestPath'),
    bgRemoveOpenDestFolder: () => ipcRenderer.invoke('bgremove:openDestFolder'),
    bgRemoveGetAutoOpen: () => ipcRenderer.invoke('bgremove:getAutoOpen'),
    bgRemoveSetAutoOpen: (value) => ipcRenderer.invoke('bgremove:setAutoOpen', value),
});
