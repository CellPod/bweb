// ── Download mode (Single / Batch) ────────────────────────────────────────────

function setDlMode(mode) {
    document.querySelectorAll('.dl-mode-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const single = document.getElementById('dlModeSingle');
    const batch = document.getElementById('dlModeBatch');
    if (single) single.style.display = mode === 'single' ? '' : 'none';
    if (batch) batch.style.display = mode === 'batch' ? '' : 'none';
}

// ── Download activity strip ────────────────────────────────────────────────────

function updateDownloadStrip(data) {
    const strip = document.getElementById('downloadStrip');
    const dot = document.getElementById('queueActivityDot');
    if (!strip) return;

    const activeItem = (data.items || []).find((i) => i.status === 'downloading');

    if (activeItem) {
        strip.style.display = 'flex';
        if (dot) dot.style.display = 'inline-block';
        const name = document.getElementById('dsName');
        const bar = document.getElementById('dsBar');
        const meta = document.getElementById('dsMeta');
        if (name) name.textContent = activeItem.title || activeItem.url || '';
        const pct = activeItem.progress || 0;
        if (bar) bar.style.width = pct + '%';
        let metaStr = pct > 0 ? `${Math.round(pct)}%` : '';
        if (activeItem.speed) metaStr = activeItem.speed + (pct > 0 ? ` · ${Math.round(pct)}%` : '');
        if (activeItem.eta) metaStr += ` · ${activeItem.eta}`;
        if (meta) meta.textContent = metaStr;
    } else {
        strip.style.display = 'none';
        if (dot) dot.style.display = 'none';
    }
}

// ── Accent colors ──────────────────────────────────────────────────────────────

const ACCENT_PRESETS = {
    blue:   { accent: 'oklch(0.55 0.18 258)', soft: 'oklch(0.94 0.04 258)' },
    indigo: { accent: 'oklch(0.52 0.22 280)', soft: 'oklch(0.94 0.05 280)' },
    purple: { accent: 'oklch(0.52 0.20 305)', soft: 'oklch(0.93 0.05 305)' },
    teal:   { accent: 'oklch(0.53 0.14 185)', soft: 'oklch(0.94 0.04 185)' },
    tomato: { accent: 'oklch(0.57 0.24 28)',  soft: 'oklch(0.95 0.07 28)'  },
    amber:  { accent: 'oklch(0.62 0.20 55)',  soft: 'oklch(0.96 0.07 55)'  },
};

function updateLogo(name) {
    const src = `./bweb-${name}.png`;
    document.querySelectorAll('.bweb-logo').forEach((img) => { img.src = src; });
}

function setAccent(name) {
    const preset = ACCENT_PRESETS[name];
    if (!preset) return;
    document.documentElement.style.setProperty('--accent', preset.accent);
    document.documentElement.style.setProperty('--accent-soft', preset.soft);
    localStorage.setItem('accent', name);
    document.querySelectorAll('.accent-swatch').forEach((s) => {
        s.classList.toggle('active', s.dataset.accent === name);
    });
    updateLogo(name);
}

function initAccent() {
    const saved = localStorage.getItem('accent') || 'blue';
    const preset = ACCENT_PRESETS[saved];
    if (preset) {
        document.documentElement.style.setProperty('--accent', preset.accent);
        document.documentElement.style.setProperty('--accent-soft', preset.soft);
    }
    updateLogo(saved);
    // Mark swatch active after DOM ready (swatches may not exist yet)
    requestAnimationFrame(() => {
        document.querySelectorAll('.accent-swatch').forEach((s) => {
            s.classList.toggle('active', s.dataset.accent === saved);
        });
    });
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    updateThemeBtn();
}

function isDarkMode() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
}

function toggleTheme() {
    const next = isDarkMode() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeBtn();
}

function updateThemeBtn() {
    const dark = isDarkMode();
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeToggleLabel');
    const desc = document.getElementById('themeLabel');
    const saved = localStorage.getItem('theme');
    if (icon) icon.innerHTML = dark
        ? '<use href="#ic-sun"/>'
        : '<use href="#ic-moon"/>';
    if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
    if (desc) desc.textContent = saved ? (dark ? 'Dark' : 'Light') : 'Follows system';
}

// ──────────────────────────────────────────────────────────────────────────────

let videoInfo = null;
let presets = [];
let selectedPreset = null;
let isFetching = false;
let historyCache = [];

// Fetch queue - allows multiple URLs to be fetched without blocking
let fetchQueue = [];
let fetchQueueIdCounter = 0;
let isFetchProcessing = false;
let activeFetchId = null;

let playlistItems = [];
let playlistSelected = new Set();
let isPlaylistMode = false;

let queueData = {
    items: [],
    counts: { total: 0, pending: 0, downloading: 0, completed: 0, failed: 0 },
    isActive: false,
    isPaused: true,
};
let hasAutoSwitchedToQueue = false;
let wasQueueActive = false;

let isSignedIn = false;
let isInstaSignedIn = false;
let updateInfo = null;

const $ = (id) => document.getElementById(id);

const $url = $('urlInput');
const $fetchBtn = $('fetchBtn');
const $clearBtn = $('clearBtn');
const $error = $('errorMsg');
const $card = $('videoCard');
const $empty = $('emptyState');
const $thumbWrap = $('thumbWrap');
const $vThumb = $('vThumb');
const $vDuration = $('vDuration');
const $vTitle = $('vTitle');
const $vChannel = $('vChannel');
const $vMeta = $('vMeta');
const $vidFmts = $('videoFormats');
const $audFmts = $('audioFormats');
const $dlBtn = $('dlBtn');
const $logBody = $('logBody');
const $toastContainer = $('toastContainer');

// Fetch panel
const $fetchPanel = $('fetchPanel');
const $fetchPanelItems = $('fetchPanelItems');

// History
const $historyList = $('historyList');
const $historyEmpty = $('historyEmpty');
const $historyToolbar = $('historyToolbar');
const $historyCountLabel = $('historyCountLabel');
const $historyCount = $('historyCount');

// Playlist
const $plCard = $('playlistCard');
const $plItems = $('playlistItems');
const $plItemCount = $('plItemCount');
const $plFormatSelect = $('plFormatSelect');
const $plDownloadBtn = $('plDownloadBtn');

// Queue
const $queueToolbar = $('queueToolbar');
const $queueItems = $('queueItems');
const $queueEmpty = $('queueEmpty');
const $queueStatus = $('queueStatus');
const $queueCount = $('queueCount');
const $qRetryFailedBtn = $('qRetryFailedBtn');
const $qClearDoneBtn = $('qClearDoneBtn');
const $qCancelAllBtn = $('qCancelAllBtn');

function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.view').forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    });

    if (tabId === 'history') loadHistory();
    if (tabId === 'settings') loadSettings();
    if (tabId === 'about') loadAbout();
    if (tabId === 'convert') initConvertTab();
}

function addLog(msg, type = '') {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ' ' + type : '');
    line.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(msg)}`;
    $logBody.appendChild(line);
    $logBody.scrollTop = $logBody.scrollHeight;

    while ($logBody.children.length > 200) {
        $logBody.removeChild($logBody.firstChild);
    }
}

function clearLog() {
    $logBody.innerHTML = '';
    addLog('Log cleared');
}

function showToast(msg, type = '') {
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = msg;
    $toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 150);
    }, 3000);
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// IPC listeners
window.api.onLog((msg) => {
    let type = '';
    if (msg.includes('✓') || msg.includes('complete') || msg.includes('Completed:')) type = 'success';
    else if (msg.startsWith('Error') || msg.includes('failed') || msg.includes('Failed:')) type = 'error';
    else if (msg.startsWith('[') || msg.startsWith('Downloading ')) {
        type = 'highlight';
    }
    addLog(msg, type);
});

// Queue event listeners
window.api.onQueueUpdate((data) => {
    const wasActive = wasQueueActive;
    const isNowActive = data.isActive;
    const hasCompleted = data.counts.completed > 0;

    queueData = data;
    wasQueueActive = isNowActive;

    renderQueue();
    updateQueueCount();
    updateDownloadStrip(data);

    // Show toast when queue finishes (was active, now idle, has completed items)
    if (wasActive && !isNowActive && hasCompleted) {
        const { completed, failed } = data.counts;
        if (failed > 0) {
            showToast(`Downloads complete: ${completed} done, ${failed} failed`);
        } else {
            showToast(`${completed} download${completed !== 1 ? 's' : ''} complete ✓`, 'success');
        }
    }
});

window.api.onQueueItemUpdate((item) => {
    const idx = queueData.items.findIndex((i) => i.id === item.id);
    if (idx !== -1) queueData.items[idx] = item;
    renderQueueItem(item);
    updateDownloadStrip(queueData);
});

// Playlist streaming
window.api.onPlaylistItem(({ item, count }) => {
    if (!playlistItems.find((i) => i.id === item.id)) {
        playlistItems.push(item);
        playlistSelected.add(item.id);
        appendPlaylistItem(item);
        $plItemCount.textContent = `${count} item${count !== 1 ? 's' : ''}`;
        updatePlDownloadBtn();
    }
});

window.api.onScraperItem(({ item, count }) => {
    if (!playlistItems.find((i) => i.id === item.id)) {
        playlistItems.push(item);
        playlistSelected.add(item.id);
        appendPlaylistItem(item);
        $plItemCount.textContent = `${count} post${count !== 1 ? 's' : ''}`;
        updatePlDownloadBtn();
    }
});

// Update notification
window.api.onUpdateAvailable((data) => {
    updateInfo = data;
    addLog(`Update available: v${data.latest}`, 'highlight');
    showUpdateBanner();
});

$url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFetch();
});

const $clipPreview = $('clipPreview');
const $clipThumb = $('clipThumb');
const $clipTitle = $('clipTitle');
const $clipDomain = $('clipDomain');

function extractYouTubeId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
        if (u.hostname.includes('youtube.com')) {
            if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
            return u.searchParams.get('v');
        }
    } catch { /* ignore */ }
    return null;
}

let _lastClipUrl = null;

async function showClipPreview(url) {
    const ytId = extractYouTubeId(url);
    const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();

    $clipDomain.textContent = domain;

    if (ytId) {
        $clipThumb.src = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
        $clipThumb.style.display = 'block';
        $clipTitle.textContent = 'Loading…';
        $clipPreview.style.display = 'flex';
        // Fetch title via oEmbed (no API key required)
        try {
            const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
            if (res.ok) {
                const data = await res.json();
                $clipTitle.textContent = data.title || domain;
            } else {
                $clipTitle.textContent = domain;
            }
        } catch { $clipTitle.textContent = domain; }
    } else {
        $clipThumb.style.display = 'none';
        $clipTitle.textContent = domain;
        $clipPreview.style.display = 'flex';
    }

    $clipPreview.dataset.url = url;
}

function hideClipPreview() {
    $clipPreview.style.display = 'none';
    $clipThumb.src = '';
    $clipTitle.textContent = '';
    $clipDomain.textContent = '';
    _lastClipUrl = null;
}

// Focus: auto-fill only if field is empty; otherwise show suggestion without overwriting
window.addEventListener('focus', async () => {
    try {
        const text = await window.api.readClipboard();
        if (!text) return;
        const clipped = text.trim();
        if (!clipped.startsWith('http://') && !clipped.startsWith('https://')) return;
        if (clipped === $url.value.trim()) return; // same URL, nothing to do
        if (!$url.value.trim()) {
            // Field is empty — auto-fill silently
            $url.value = clipped;
        }
        // Always show the preview (whether auto-filled or as suggestion)
        if (clipped !== _lastClipUrl) {
            _lastClipUrl = clipped;
            showClipPreview(clipped);
        }
    } catch {
        // clipboard read failed, ignore
    }
});

// Manual paste: show preview if pasted content is a valid URL
$url.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text')?.trim();
    if (pasted && (pasted.startsWith('http://') || pasted.startsWith('https://'))) {
        _lastClipUrl = pasted;
        showClipPreview(pasted);
    }
});

$url.addEventListener('input', () => {
    const val = $url.value.trim();
    if (!val || (!val.startsWith('http://') && !val.startsWith('https://'))) {
        hideClipPreview();
    }
});

// Returns true when URL has both v= (single video) and list= (playlist) — ambiguous
function isAmbiguousPlaylistUrl(url) {
    try {
        const u = new URL(url);
        return u.searchParams.has('v') && u.searchParams.has('list');
    } catch { return false; }
}

function stripListParam(url) {
    try {
        const u = new URL(url);
        u.searchParams.delete('list');
        u.searchParams.delete('index');
        return u.toString();
    } catch { return url; }
}

let _playlistChoiceResolve = null;

function showPlaylistChoiceModal() {
    return new Promise(resolve => {
        _playlistChoiceResolve = resolve;
        document.getElementById('playlistChoiceModal').style.display = 'flex';
    });
}

function resolvePlaylistChoice(choice) {
    document.getElementById('playlistChoiceModal').style.display = 'none';
    if (_playlistChoiceResolve) { _playlistChoiceResolve(choice); _playlistChoiceResolve = null; }
}

async function doFetch() {
    const url = $url.value.trim();
    if (!url) return;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        showError('Please enter a valid URL starting with http:// or https://');
        return;
    }

    hideError();
    hideClipPreview();

    // Instagram collections and playlists use the original blocking flow because they have streaming UI that needs the main panel
    const isInstaCollection = isInstagramCollection(url);
    if (isInstaCollection) {
        if (isFetching) return;
        hideCard();
        hidePlaylist();
        isFetching = true;
        $fetchBtn.disabled = true;
        $fetchBtn.innerHTML = '<span class="spinner"></span> Fetching';
        activeFetchId = null;

        try {
            addLog('Detected Instagram saved collection', 'highlight');
            await fetchInstaCollection(url);
        } catch (err) {
            handleFetchError(err);
        } finally {
            isFetching = false;
            $fetchBtn.disabled = false;
            $fetchBtn.textContent = 'Fetch';
        }
        return;
    }

    let isPlaylist = false;
    try {
        isPlaylist = await window.api.detectPlaylist(url);
    } catch {
        //
    }

    if (isPlaylist) {
        // URL has both v= and list= → ambiguous, ask user
        if (isAmbiguousPlaylistUrl(url)) {
            const choice = await showPlaylistChoiceModal();
            if (choice === 'single') {
                // Strip list param and fall through to single-video fetch
                const clean = stripListParam(url);
                $url.value = clean;
                isPlaylist = false;
            }
            // else fall through to playlist fetch below
        }
    }

    if (isPlaylist) {
        if (isFetching) return;
        hideCard();
        hidePlaylist();
        isFetching = true;
        $fetchBtn.disabled = true;
        $fetchBtn.innerHTML = '<span class="spinner"></span> Fetching';
        activeFetchId = null;

        try {
            addLog('Detected playlist URL, fetching items...', 'highlight');
            await fetchPlaylist($url.value.trim());
        } catch (err) {
            handleFetchError(err);
        } finally {
            isFetching = false;
            $fetchBtn.disabled = false;
            $fetchBtn.textContent = 'Fetch';
        }
        return;
    }

    // Single video add to fetch queue
    // Prevent duplicate URLs already in the queue and still fetching
    const alreadyQueued = fetchQueue.find((item) => item.url === url && item.status === 'fetching');
    if (alreadyQueued) {
        showToast('Already fetching this URL');
        return;
    }

    addToFetchQueue(url);
    $url.value = '';
    $url.focus();
}

function handleFetchError(err) {
    const msg = err.message || 'Failed to fetch';
    addLog('Fetch failed: ' + msg, 'error');

    hideCard();
    hidePlaylist();
    $empty.style.display = 'block';

    if (isAuthError(msg)) {
        showAuthError();
    } else if (msg.includes('Instagram login required') || msg.includes('Sign in via Settings')) {
        showInstaAuthError();
    } else if (msg.includes('not found') || msg.includes('Cannot run')) {
        showError('yt-dlp binary not found. Run `npm install` to download it.');
    } else if (msg.includes('Unsupported URL') || msg.includes('No video formats')) {
        showError('This URL is not supported or the video is unavailable.');
    } else if (msg.includes('HTTP Error 403') || msg.includes('HTTP Error 429')) {
        showError('Access denied or rate limited. Try again later.');
    } else if (msg.includes('timed out') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
        showError('Network error. Check your internet connection.');
    } else {
        showError(msg);
    }
}

// Fetch Queue

function addToFetchQueue(url) {
    const item = {
        id: ++fetchQueueIdCounter,
        url: url,
        status: 'fetching', // fetching | ready | error
        info: null,
        presets: [],
        error: null,
    };
    fetchQueue.push(item);
    renderFetchPanel();
    addLog('Fetching: ' + url, 'highlight');

    if (!isFetchProcessing) {
        processFetchQueue();
    }
}

async function processFetchQueue() {
    if (isFetchProcessing) return;

    const next = fetchQueue.find((item) => item.status === 'fetching');
    if (!next) {
        isFetchProcessing = false;
        return;
    }

    isFetchProcessing = true;

    try {
        const result = await window.api.fetchVideo(next.url);
        // Item may have been removed while we were fetching
        if (!fetchQueue.find((item) => item.id === next.id)) {
            isFetchProcessing = false;
            processFetchQueue();
            return;
        }

        next.status = 'ready';
        next.info = result.info;
        next.presets = result.presets;

        addLog(`Fetched: ${next.info.title}`, 'success');

        // Auto-select the first completed item, or if nothing is currently shown
        // But don't clobber the playlist/collection UI if one is active
        if (!isPlaylistMode) {
            const nothingShown = !activeFetchId || !fetchQueue.find((i) => i.id === activeFetchId && i.status === 'ready');
            if (nothingShown) {
                selectFetchItem(next.id);
            }
        }

        renderFetchPanel();
        updateHistoryCount();
    } catch (err) {
        // item may have been removed
        if (!fetchQueue.find((item) => item.id === next.id)) {
            isFetchProcessing = false;
            processFetchQueue();
            return;
        }

        next.status = 'error';
        next.error = err.message || 'Failed to fetch';
        addLog('Fetch failed: ' + next.error, 'error');
        renderFetchPanel();
    }

    isFetchProcessing = false;

    // Process next item in queue
    const hasMore = fetchQueue.find((item) => item.status === 'fetching');
    if (hasMore) {
        processFetchQueue();
    }
}

function selectFetchItem(id) {
    const item = fetchQueue.find((i) => i.id === id);
    if (!item || item.status !== 'ready') return;

    activeFetchId = id;
    videoInfo = item.info;
    presets = item.presets;
    selectedPreset = null;
    isPlaylistMode = false;

    hideError();
    hidePlaylist();
    showCard();
    showClearBtn();
    renderFetchPanel();
}

function removeFetchItem(id) {
    fetchQueue = fetchQueue.filter((i) => i.id !== id);
    if (activeFetchId === id) {
        activeFetchId = null;
        // show next ready item if available, otherwise show empty state
        const nextReady = fetchQueue.find((i) => i.status === 'ready');
        if (nextReady) {
            selectFetchItem(nextReady.id);
        } else {
            hideCard();
            hidePlaylist();
            $empty.style.display = 'block';
            videoInfo = null;
            presets = [];
            selectedPreset = null;
            $clearBtn.style.display = 'none';
        }
    }
    renderFetchPanel();
}

function clearFetchQueue() {
    fetchQueue = [];
    activeFetchId = null;
    renderFetchPanel();
}

function retryFetchItem(id) {
    const item = fetchQueue.find((i) => i.id === id);
    if (!item || item.status !== 'error') return;

    item.status = 'fetching';
    item.error = null;
    renderFetchPanel();
    addLog('Retrying: ' + item.url, 'highlight');

    if (!isFetchProcessing) {
        processFetchQueue();
    }
}

function renderFetchPanel() {
    if (fetchQueue.length === 0) {
        $fetchPanel.classList.remove('visible');
        return;
    }

    $fetchPanel.classList.add('visible');

    $fetchPanelItems.innerHTML = fetchQueue
        .map((item) => {
            const isActive = item.id === activeFetchId;
            const stateClass = item.status === 'error' ? 'error' : item.status === 'fetching' ? 'fetching' : '';
            const activeClass = isActive ? 'active' : '';
            const title = item.info ? escapeHtml(item.info.title || 'Untitled') : escapeHtml(truncateUrl(item.url));

            let thumbHtml;
            if (item.info && item.info.thumbnail) {
                thumbHtml = `<img class="fp-item-thumb" src="${escapeHtml(item.info.thumbnail)}" alt="" onerror="this.style.display='none'" />`;
            } else {
                thumbHtml = `<div class="fp-item-thumb-placeholder">${item.status === 'fetching' ? '<div class="fp-item-spinner"></div>' : '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><use href="#ic-film"/></svg>'}</div>`;
            }

            let statusHtml;
            if (item.status === 'fetching') {
                statusHtml = '<span class="fp-item-status fetching-status">Fetching...</span>';
            } else if (item.status === 'error') {
                statusHtml = `<span class="fp-item-status error-status">${escapeHtml(truncateText(item.error, 30))}</span>`;
            } else {
                const source = item.info?.extractor_key || '';
                const duration = item.info?.duration_string || '';
                const parts = [source, duration].filter(Boolean).join(' · ');
                statusHtml = `<span class="fp-item-status ready-status">${parts || 'Ready'}</span>`;
            }

            let actionsHtml = '';
            if (item.status === 'error') {
                actionsHtml = `<button class="fp-item-remove" data-action="retry" data-id="${item.id}" title="Retry">↻</button>`;
            }
            actionsHtml += `<button class="fp-item-remove" data-action="remove" data-id="${item.id}" title="Remove">×</button>`;

            return `
                <div class="fp-item ${stateClass} ${activeClass}" data-id="${item.id}">
                    ${thumbHtml}
                    <div class="fp-item-info">
                        <div class="fp-item-title">${title}</div>
                        ${statusHtml}
                    </div>
                    ${actionsHtml}
                </div>`;
        })
        .join('');

    // Attach click listeners
    $fetchPanelItems.querySelectorAll('.fp-item').forEach((el) => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('[data-action]')) return;
            const id = parseInt(el.dataset.id);
            selectFetchItem(id);
        });
    });

    $fetchPanelItems.querySelectorAll('[data-action="remove"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFetchItem(parseInt(btn.dataset.id));
        });
    });

    $fetchPanelItems.querySelectorAll('[data-action="retry"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            retryFetchItem(parseInt(btn.dataset.id));
        });
    });
}

function truncateUrl(url) {
    try {
        const u = new URL(url);
        const path = u.pathname.length > 20 ? u.pathname.slice(0, 20) + '...' : u.pathname;
        return u.hostname + path;
    } catch {
        return url.length > 40 ? url.slice(0, 40) + '...' : url;
    }
}

function truncateText(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function doClear() {
    $url.value = '';
    hideError();
    hideCard();
    hidePlaylist();
    $empty.style.display = 'block';
    videoInfo = null;
    presets = [];
    selectedPreset = null;
    activeFetchId = null;
    $clearBtn.style.display = 'none';
    renderFetchPanel();
    $url.focus();
}

function showClearBtn() {
    $clearBtn.style.display = '';
}

async function fetchPlaylist(url) {
    isPlaylistMode = true;
    playlistItems = [];
    playlistSelected = new Set();
    $plItems.innerHTML = '';

    showPlaylist();

    const result = await window.api.fetchPlaylist(url);

    for (const item of result.items) {
        if (!playlistItems.find((i) => i.id === item.id)) {
            playlistItems.push(item);
            playlistSelected.add(item.id);
            appendPlaylistItem(item);
        }
    }

    $plItemCount.textContent = `${playlistItems.length} item${playlistItems.length !== 1 ? 's' : ''}`;
    updatePlDownloadBtn();
    showPlaylistFooter();
    showClearBtn();
    addLog(`Playlist loaded: ${playlistItems.length} items`, 'success');
}

async function fetchInstaCollection(url) {
    // Check Instagram auth first
    const instaAuth = await window.api.checkInstaAuth();
    if (!instaAuth) {
        throw new Error('Instagram login required. Sign in via Settings first.');
    }

    isPlaylistMode = true;
    playlistItems = [];
    playlistSelected = new Set();
    $plItems.innerHTML = '';

    showPlaylist();

    // Update badge to say COLLECTION instead of PLAYLIST
    const badge = document.querySelector('.playlist-badge');
    if (badge) badge.textContent = 'COLLECTION';

    addLog('Scraping collection page (this may take a moment)...', 'highlight');

    const result = await window.api.scrapeCollection(url);

    for (const item of result.items) {
        if (!playlistItems.find((i) => i.id === item.id)) {
            playlistItems.push(item);
            playlistSelected.add(item.id);
            appendPlaylistItem(item);
        }
    }

    $plItemCount.textContent = `${playlistItems.length} post${playlistItems.length !== 1 ? 's' : ''}`;
    updatePlDownloadBtn();
    showPlaylistFooter();
    showClearBtn();
    addLog(`Collection scraped: ${playlistItems.length} posts`, 'success');
}

function isInstagramCollection(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        return u.hostname.includes('instagram.com') && u.pathname.includes('/saved/');
    } catch {
        return false;
    }
}

// Video Card
function showCard() {
    $empty.style.display = 'none';
    $plCard.classList.remove('visible');

    $thumbWrap.classList.remove('broken');
    $vThumb.src = '';
    if (videoInfo.thumbnail) {
        $vThumb.src = videoInfo.thumbnail;
        $vThumb.onerror = () => {
            $thumbWrap.classList.add('broken');
        };
    } else {
        $thumbWrap.classList.add('broken');
    }

    $vDuration.textContent = videoInfo.duration_string || '';
    $vDuration.style.display = videoInfo.duration_string ? 'block' : 'none';
    $vTitle.textContent = videoInfo.title || 'Untitled';
    $vChannel.textContent = videoInfo.uploader || videoInfo.channel || '';

    const meta = [];
    if (videoInfo.extractor_key) {
        meta.push(`<span class="meta-item"><span class="meta-badge">${escapeHtml(videoInfo.extractor_key)}</span></span>`);
    }
    if (videoInfo.live_status === 'is_live') {
        meta.push(`<span class="meta-item"><span class="meta-badge live">LIVE</span></span>`);
    }
    if (videoInfo.webpage_url_domain) {
        meta.push(`<span class="meta-item">${escapeHtml(videoInfo.webpage_url_domain)}</span>`);
    }
    if (videoInfo.view_count) {
        meta.push(`<span class="meta-item">${formatNumber(videoInfo.view_count)} views</span>`);
    }
    if (videoInfo.like_count) {
        meta.push(`<span class="meta-item">👍 ${formatNumber(videoInfo.like_count)}</span>`);
    }
    if (videoInfo.upload_date) {
        meta.push(`<span class="meta-item">${formatDate(videoInfo.upload_date)}</span>`);
    }
    $vMeta.innerHTML = meta.join('<span class="meta-sep">·</span>');

    const videoPresets = presets.filter((p) => p.type === 'video');
    const audioPresets = presets.filter((p) => p.type === 'audio');

    $vidFmts.innerHTML = videoPresets.map((p) => formatOptionHTML(p)).join('');
    $audFmts.innerHTML = audioPresets.map((p) => formatOptionHTML(p)).join('');

    $card.querySelectorAll('.format-pill').forEach((el) => {
        el.addEventListener('click', () => selectFormat(el.dataset.id));
    });

    if (videoPresets.length > 0) {
        selectFormat(videoPresets[0].id);
    } else if (audioPresets.length > 0) {
        selectFormat(audioPresets[0].id);
    }

    $dlBtn.disabled = false;
    $dlBtn.className = 'btn-download';
    $dlBtn.textContent = 'Add to Queue';

    // Init trim with video duration + URL (for YouTube player)
    initDlTrim(videoInfo.duration || 0, videoInfo.webpage_url || '', {
        isLive: videoInfo.live_status === 'is_live',
        releaseTimestamp: videoInfo.release_timestamp || null,
        videoId: videoInfo.id || null,
        extractorKey: videoInfo.extractor_key || '',
        previewUrl: videoInfo.preview_url || null,
    });

    $card.classList.add('visible');
}

function formatNumber(n) {
    if (!n && n !== 0) return '';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
}

function formatDate(yyyymmdd) {
    if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || '';
    try {
        const y = parseInt(yyyymmdd.slice(0, 4));
        const m = parseInt(yyyymmdd.slice(4, 6)) - 1;
        const d = parseInt(yyyymmdd.slice(6, 8));
        return new Date(y, m, d).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return yyyymmdd;
    }
}

function formatOptionHTML(p) {
    const tag = p.tag ? `<span class="pill-tag">${escapeHtml(p.tag)}</span>` : '';
    const size = p.size ? `<span class="pill-size">${escapeHtml(p.size)}</span>` : '';
    const label = escapeHtml(p.label);
    return `<button class="format-pill" data-id="${escapeHtml(p.id)}">${label}${tag ? ' ' + tag : ''}${size ? ' ' + size : ''}</button>`;
}

function selectFormat(id) {
    selectedPreset = presets.find((p) => p.id === id) || null;
    $card.querySelectorAll('.format-pill').forEach((el) => {
        el.classList.toggle('selected', el.dataset.id === id);
    });
    // Show codec selector only for video presets
    const codecRow = document.getElementById('videoCodecRow');
    if (codecRow) codecRow.style.display = (selectedPreset?.type === 'video') ? 'flex' : 'none';
}

function hideCard() {
    $card.classList.remove('visible');
    if (!isPlaylistMode) $empty.style.display = 'block';
}

// ── Download trim ────────────────────────────────────────────────

let dlTrimDuration = 0; // seconds, set from videoInfo.duration
let dlIsLive = false;
let dlLiveReleaseTimestamp = null; // epoch seconds when the live broadcast actually started
let dlUsingPreviewVideo = false; // true when marking reads from the <video> preview's currentTime

function initDlTrim(duration, url, opts = {}) {
    dlTrimDuration = duration || 0;
    dlIsLive = !!opts.isLive;
    dlLiveReleaseTimestamp = opts.releaseTimestamp || null;

    const section = document.getElementById('dlTrimSection');
    const durEl = document.getElementById('dlTrimDuration');
    const rangeEnd = document.getElementById('dlRangeEnd');
    const sliderWrap = document.getElementById('dlSliderWrap');
    const embedTrim = document.getElementById('dlEmbedTrim');
    const embedWrap = document.getElementById('dlEmbedWrap');
    const embed = document.getElementById('dlEmbed');
    const previewVideo = document.getElementById('dlPreviewVideo');
    const hint = document.getElementById('dlTrimHint');
    if (!section) return;
    section.style.display = 'flex'; // always show for fetched videos

    // Live streams rarely expose a progressive (single-file) format yt-dlp can hand to a
    // plain <video> tag — they're normally HLS/DASH-only — so live falls back to the
    // YouTube iframe embed (playback preview only, marking uses wall-clock time instead).
    const canIframeEmbed = opts.extractorKey === 'Youtube' && !!opts.videoId;
    dlUsingPreviewVideo = !dlIsLive && !!opts.previewUrl;

    if (dlIsLive) {
        // Duration keeps growing while the stream is live — the range slider has nothing
        // meaningful to seek within, so swap it for the embed + mark-in/mark-out flow.
        if (durEl) durEl.textContent = '';
        if (sliderWrap) sliderWrap.style.display = 'none';
        if (hint) { hint.dataset.i18n = 'dl.trim.liveHint'; hint.textContent = t('dl.trim.liveHint'); }
    } else {
        if (durEl) durEl.textContent = dlTrimDuration > 0 ? `Duration: ${formatTime(dlTrimDuration)}` : '';
        if (sliderWrap) sliderWrap.style.display = 'flex';
        if (hint) { hint.dataset.i18n = 'dl.trim.hint'; hint.textContent = t('dl.trim.hint'); }
    }

    const showEmbedBlock = (dlIsLive && canIframeEmbed) || dlUsingPreviewVideo;
    if (embedTrim) embedTrim.style.display = showEmbedBlock ? 'flex' : 'none';
    if (embedWrap) embedWrap.style.display = showEmbedBlock ? 'block' : 'none';

    if (embed) {
        embed.style.display = (dlIsLive && canIframeEmbed) ? 'block' : 'none';
        embed.src = (dlIsLive && canIframeEmbed) ? `https://www.youtube.com/embed/${opts.videoId}?autoplay=1&mute=1` : '';
    }
    if (previewVideo) {
        previewVideo.style.display = dlUsingPreviewVideo ? 'block' : 'none';
        previewVideo.src = dlUsingPreviewVideo ? opts.previewUrl : '';
    }

    if (rangeEnd) rangeEnd.value = 100;
    clearDlTrim();
}

function liveElapsedSeconds() {
    if (!dlLiveReleaseTimestamp) return 0;
    return Math.max(0, Math.floor(Date.now() / 1000 - dlLiveReleaseTimestamp));
}

function currentMarkSeconds() {
    if (dlIsLive) return liveElapsedSeconds();
    if (dlUsingPreviewVideo) return document.getElementById('dlPreviewVideo')?.currentTime || 0;
    return 0;
}

function markTrimStart() {
    const start = document.getElementById('dlTrimStart');
    if (!start) return;
    start.value = formatTime(currentMarkSeconds());
    onSegmentInput(start);
}

function markTrimEnd() {
    const end = document.getElementById('dlTrimEnd');
    if (!end) return;
    end.value = formatTime(currentMarkSeconds());
    onSegmentInput(end);
}

function clearDlTrim() {
    // Remove extra segments, keep only the first
    const list = document.getElementById('trimSegmentsList');
    if (list) Array.from(list.querySelectorAll('.trim-segment')).slice(1).forEach(r => r.remove());
    const start = document.getElementById('dlTrimStart');
    const end = document.getElementById('dlTrimEnd');
    if (start) start.value = '';
    if (end) end.value = '';
    const rangeStart = document.getElementById('dlRangeStart');
    const rangeEnd = document.getElementById('dlRangeEnd');
    if (rangeStart) rangeStart.value = 0;
    if (rangeEnd) rangeEnd.value = 100;
    updateDlRangeFill();
}

function addTrimSegment() {
    const list = document.getElementById('trimSegmentsList');
    if (!list) return;
    const n = list.querySelectorAll('.trim-segment').length + 1;
    const row = document.createElement('div');
    row.className = 'trim-segment';
    row.innerHTML = `<span class="trim-seg-label">Seg ${n}</span>`
        + `<input class="trim-time-input" type="text" placeholder="00:00" oninput="onSegmentInput(this)">`
        + `<span class="trim-time-sep">→</span>`
        + `<input class="trim-time-input" type="text" placeholder="end">`
        + `<button class="trim-seg-remove" onclick="removeTrimSegment(this)">×</button>`;
    list.appendChild(row);
}

function removeTrimSegment(btn) {
    const list = document.getElementById('trimSegmentsList');
    btn.closest('.trim-segment').remove();
    // Renumber remaining extra segments
    const rows = list.querySelectorAll('.trim-segment');
    rows.forEach((row, i) => {
        if (i > 0) {
            const label = row.querySelector('.trim-seg-label');
            if (label) label.textContent = `Seg ${i + 1}`;
        }
    });
}

function getTrimSegments() {
    const rows = document.querySelectorAll('#trimSegmentsList .trim-segment');
    const segments = [];
    for (const row of rows) {
        const inputs = row.querySelectorAll('.trim-time-input');
        const start = inputs[0]?.value.trim() || null;
        const end = inputs[1]?.value.trim() || null;
        if (start || end) segments.push({ start, end });
    }
    return segments.length > 0 ? segments : null;
}

function onSegmentInput(input) {
    // Sync slider only for the first segment's inputs
    const firstRow = document.querySelector('#trimSegmentsList .trim-segment');
    if (firstRow && firstRow.contains(input)) onDlTimeInput();
}

function seekPreviewVideo(seconds) {
    if (!dlUsingPreviewVideo) return;
    const video = document.getElementById('dlPreviewVideo');
    if (video) video.currentTime = seconds;
}

function onDlRangeStartInput() {
    const rangeStart = document.getElementById('dlRangeStart');
    const rangeEnd = document.getElementById('dlRangeEnd');
    const start = document.getElementById('dlTrimStart');
    if (!rangeStart || !rangeEnd || !dlTrimDuration) return;

    let s = parseFloat(rangeStart.value);
    const e = parseFloat(rangeEnd.value);
    if (s >= e) { rangeStart.value = e - 0.5; s = parseFloat(rangeStart.value); }

    const seconds = (s / 100) * dlTrimDuration;
    if (start) start.value = formatTime(seconds);
    updateDlRangeFill();
    seekPreviewVideo(seconds);
}

function onDlRangeEndInput() {
    const rangeStart = document.getElementById('dlRangeStart');
    const rangeEnd = document.getElementById('dlRangeEnd');
    const end = document.getElementById('dlTrimEnd');
    if (!rangeStart || !rangeEnd || !dlTrimDuration) return;

    let e = parseFloat(rangeEnd.value);
    const s = parseFloat(rangeStart.value);
    if (e <= s) { rangeEnd.value = s + 0.5; e = parseFloat(rangeEnd.value); }

    const seconds = (e / 100) * dlTrimDuration;
    if (end) end.value = formatTime(seconds);
    updateDlRangeFill();
    seekPreviewVideo(seconds);
}

function onDlTimeInput() {
    const start = document.getElementById('dlTrimStart');
    const end = document.getElementById('dlTrimEnd');
    const rangeStart = document.getElementById('dlRangeStart');
    const rangeEnd = document.getElementById('dlRangeEnd');
    if (!dlTrimDuration) return;

    const s = parseTimeSecs(start?.value);
    const e = parseTimeSecs(end?.value);
    if (s !== null && rangeStart) rangeStart.value = Math.min(100, (s / dlTrimDuration) * 100);
    if (e !== null && rangeEnd) rangeEnd.value = Math.min(100, (e / dlTrimDuration) * 100);
    updateDlRangeFill();
}

function updateDlRangeFill() {
    const rangeStart = document.getElementById('dlRangeStart');
    const rangeEnd = document.getElementById('dlRangeEnd');
    const fill = document.getElementById('dlRangeFill');
    if (!rangeStart || !rangeEnd || !fill) return;
    const s = parseFloat(rangeStart.value);
    const e = parseFloat(rangeEnd.value);
    fill.style.left = s + '%';
    fill.style.width = (e - s) + '%';
}

function openSourceInBrowser() {
    if (videoInfo?.webpage_url) {
        window.api.openExternal(videoInfo.webpage_url);
    }
}

// ── Converter trim ───────────────────────────────────────────────

// Dragging either handle also seeks the preview so you can hear/see the trim point,
// same as the Download tab's preview scrubbing.
function onConvertRangeStartInput() {
    const video = document.getElementById('convertVideo');
    const rangeStart = document.getElementById('convertRangeStart');
    const rangeEnd = document.getElementById('convertRangeEnd');
    const start = document.getElementById('convertTrimStart');
    if (!video || !rangeStart || !rangeEnd || !video.duration) return;

    let s = parseFloat(rangeStart.value);
    const e = parseFloat(rangeEnd.value);
    if (s >= e) { rangeStart.value = e - 0.1; s = parseFloat(rangeStart.value); }

    const seconds = (s / 100) * video.duration;
    if (start) start.value = formatTime(seconds);
    updateConvertRangeFill();
    video.currentTime = seconds;
}

function onConvertRangeEndInput() {
    const video = document.getElementById('convertVideo');
    const rangeStart = document.getElementById('convertRangeStart');
    const rangeEnd = document.getElementById('convertRangeEnd');
    const end = document.getElementById('convertTrimEnd');
    if (!video || !rangeStart || !rangeEnd || !video.duration) return;

    let e = parseFloat(rangeEnd.value);
    const s = parseFloat(rangeStart.value);
    if (e <= s) { rangeEnd.value = s + 0.1; e = parseFloat(rangeEnd.value); }

    const seconds = (e / 100) * video.duration;
    if (end) end.value = formatTime(seconds);
    updateConvertRangeFill();
    video.currentTime = seconds;
}

function onConvertTimeInput() {
    const video = document.getElementById('convertVideo');
    const rangeStart = document.getElementById('convertRangeStart');
    const rangeEnd = document.getElementById('convertRangeEnd');
    const start = document.getElementById('convertTrimStart');
    const end = document.getElementById('convertTrimEnd');
    if (!video || !video.duration) return;

    const s = parseTimeSecs(start?.value);
    const e = parseTimeSecs(end?.value);
    if (s !== null && rangeStart) rangeStart.value = Math.min(100, (s / video.duration) * 100);
    if (e !== null && rangeEnd) rangeEnd.value = Math.min(100, (e / video.duration) * 100);
    updateConvertRangeFill();
}

function updateConvertRangeFill() {
    const rangeStart = document.getElementById('convertRangeStart');
    const rangeEnd = document.getElementById('convertRangeEnd');
    const fill = document.getElementById('convertRangeFill');
    if (!rangeStart || !rangeEnd || !fill) return;
    const s = parseFloat(rangeStart.value);
    const e = parseFloat(rangeEnd.value);
    fill.style.left = s + '%';
    fill.style.width = (e - s) + '%';
}

function parseTimeSecs(str) {
    if (!str || !str.trim()) return null;
    const parts = str.trim().split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || null;
}

async function doDownload() {
    if (!videoInfo || !selectedPreset) return;

    $dlBtn.disabled = true;
    $dlBtn.textContent = 'Adding...';

    const isAudio = selectedPreset.type === 'audio';

    try {
        const codecSelect = document.getElementById('videoCodecSelect');
        const videoCodec = (!isAudio && codecSelect) ? codecSelect.value : undefined;

        await window.api.queueAdd([
            {
                url: videoInfo.webpage_url,
                title: videoInfo.title,
                thumbnail: videoInfo.thumbnail,
                formatId: selectedPreset.formatId,
                extractAudio: isAudio,
                audioFormat: isAudio ? selectedPreset.audioFormat || 'mp3' : undefined,
                videoCodec: videoCodec,
                trimSegments: getTrimSegments(),
                liveFromStart: videoInfo.live_status === 'is_live',
            },
        ]);

        addLog(`Added to queue: ${videoInfo.title}`, 'highlight');
        showToast('Added to queue');

        // Remove from fetch panel and load next ready item
        if (activeFetchId) {
            const removedId = activeFetchId;
            fetchQueue = fetchQueue.filter((i) => i.id !== removedId);
            activeFetchId = null;

            const nextReady = fetchQueue.find((i) => i.status === 'ready');
            if (nextReady) {
                selectFetchItem(nextReady.id);
            } else {
                videoInfo = null;
                presets = [];
                selectedPreset = null;
                hideCard();
                $clearBtn.style.display = 'none';
                if (fetchQueue.length === 0) {
                    $empty.style.display = 'block';
                }
            }
            renderFetchPanel();
        }

        // Auto-switch to queue tab on first add, but only if no more items need attention
        const hasMoreFetchItems = fetchQueue.some((i) => i.status === 'ready' || i.status === 'fetching');
        if (!hasAutoSwitchedToQueue && !hasMoreFetchItems) {
            hasAutoSwitchedToQueue = true;
            switchTab('queue');
        }

        // Reset button after brief feedback
        setTimeout(() => {
            $dlBtn.disabled = false;
            $dlBtn.className = 'btn-download';
            $dlBtn.textContent = 'Add to Queue';
        }, 1500);
    } catch (err) {
        showError(err.message || 'Failed to add to queue');
        addLog('Queue error: ' + (err.message || 'Unknown'), 'error');
        $dlBtn.disabled = false;
        $dlBtn.textContent = 'Add to Queue';
    }
}

function showPlaylist() {
    $empty.style.display = 'none';
    $card.classList.remove('visible');
    $plCard.classList.add('visible');
    $('plFooter').style.display = 'none'; // hidden until fetch completes
}

function showPlaylistFooter() {
    $('plFooter').style.display = '';
}

function hidePlaylist() {
    $plCard.classList.remove('visible');
    $('plFooter').style.display = 'none';
    playlistItems = [];
    playlistSelected = new Set();
    isPlaylistMode = false;
    // Reset badge text
    const badge = document.querySelector('.playlist-badge');
    if (badge) badge.textContent = 'PLAYLIST';
}

function appendPlaylistItem(item) {
    const el = document.createElement('div');
    el.className = 'pl-item';
    el.dataset.id = item.id;

    const checked = playlistSelected.has(item.id) ? 'checked' : '';
    const duration = item.duration_string || '';
    const title = escapeHtml(item.title || 'Untitled');
    const idx = item._playlist_index || playlistItems.length;
    const thumb = item.thumbnail ? escapeHtml(item.thumbnail) : '';

    el.innerHTML = `
        <label class="pl-item-check">
            <input type="checkbox" ${checked} onchange="togglePlaylistItem('${escapeHtml(item.id)}', this.checked)" />
            <span class="pl-check-box"></span>
        </label>
        <span class="pl-item-idx">${idx}</span>
        <div class="pl-item-thumb">
            ${thumb ? `<img src="${thumb}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="pl-item-thumb-fallback"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><use href="#ic-film"/></svg></span>` : `<span class="pl-item-thumb-fallback" style="display:flex;"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><use href="#ic-film"/></svg></span>`}
        </div>
        <div class="pl-item-info">
            <div class="pl-item-title">${title}</div>
            <div class="pl-item-meta">${duration}</div>
        </div>
    `;
    $plItems.appendChild(el);
}

function togglePlaylistItem(id, checked) {
    if (checked) playlistSelected.add(id);
    else playlistSelected.delete(id);
    updatePlDownloadBtn();
}

function playlistSelectAll() {
    playlistItems.forEach((item) => playlistSelected.add(item.id));
    $plItems.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
    updatePlDownloadBtn();
}

function playlistDeselectAll() {
    playlistSelected.clear();
    $plItems.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
    updatePlDownloadBtn();
}

function updatePlDownloadBtn() {
    const count = playlistSelected.size;
    $plDownloadBtn.textContent = count > 0 ? `Add ${count} item${count !== 1 ? 's' : ''} to Queue` : 'Select items to download';
    $plDownloadBtn.disabled = count === 0;
}

async function doPlaylistDownload() {
    if (playlistSelected.size === 0) return;

    const selected = playlistItems.filter((item) => playlistSelected.has(item.id));
    const opt = $plFormatSelect.options[$plFormatSelect.selectedIndex];
    const formatId = opt.value;
    const isAudio = opt.dataset.audio === 'true';

    $plDownloadBtn.disabled = true;
    $plDownloadBtn.textContent = 'Adding to queue...';

    try {
        const queueItems = selected.map((item) => ({
            url: item.webpage_url || item.url,
            title: item.title,
            thumbnail: item.thumbnail,
            formatId: formatId,
            extractAudio: isAudio,
            audioFormat: isAudio ? opt.dataset.format || 'mp3' : undefined,
        }));

        await window.api.queueAdd(queueItems);
        addLog(`Added ${queueItems.length} items to queue`, 'success');
        showToast(`Added ${queueItems.length} item${queueItems.length !== 1 ? 's' : ''} to queue`);

        if (!hasAutoSwitchedToQueue) {
            hasAutoSwitchedToQueue = true;
            switchTab('queue');
        }
    } catch (err) {
        showError(err.message || 'Failed to add to queue');
        addLog('Queue error: ' + (err.message || 'Unknown'), 'error');
    } finally {
        $plDownloadBtn.disabled = false;
        updatePlDownloadBtn();
    }
}

// Queue (own tab)
function updateQueueCount() {
    const { counts } = queueData;
    const active = counts.downloading + counts.pending;
    if (active > 0) {
        $queueCount.textContent = active;
        $queueCount.style.display = 'inline-block';
    } else {
        $queueCount.style.display = 'none';
    }
}

function renderQueue() {
    const { items, counts, isActive, isPaused } = queueData;

    if (items.length === 0) {
        $queueToolbar.style.display = 'none';
        $queueItems.innerHTML = '';
        $queueEmpty.style.display = 'block';
        return;
    }

    $queueEmpty.style.display = 'none';
    $queueToolbar.style.display = 'flex';

    // Status text
    const statusParts = [];
    if (counts.downloading > 0) {
        statusParts.push(`${counts.downloading} downloading`);
    }
    if (counts.pending > 0) statusParts.push(`${counts.pending} waiting`);
    if (counts.completed > 0) statusParts.push(`${counts.completed} done`);
    if (counts.failed > 0) statusParts.push(`${counts.failed} failed`);
    if (isPaused && !isActive) statusParts.push('paused');
    $queueStatus.textContent = statusParts.join(' · ') || '0 items';

    // Start / Pause buttons
    const hasPending = counts.pending > 0;
    const $qStartBtn = $('qStartBtn');
    const $qPauseBtn = $('qPauseBtn');
    $qStartBtn.style.display = (isPaused && hasPending) ? 'inline-block' : 'none';
    $qPauseBtn.style.display = (isActive && !isPaused) ? 'inline-block' : 'none';

    // Show/hide action buttons
    $qCancelAllBtn.style.display = isActive ? 'inline-block' : 'none';
    $qRetryFailedBtn.style.display = counts.failed > 0 ? 'inline-block' : 'none';
    $qClearDoneBtn.style.display = counts.completed > 0 || (counts.failed > 0 && !isActive) ? 'inline-block' : 'none';

    // Render items
    $queueItems.innerHTML = items.map((item) => queueItemHTML(item)).join('');
    attachQueueListeners();
}

function queueItemHTML(item) {
    const stateClass = `q-state-${item.state}`;
    const title = escapeHtml(item.title || 'Untitled');

    let statusHTML = '';
    let actionsHTML = '';
    let progressHTML = '';

    if (item.state === 'pending') {
        statusHTML = '<span class="q-item-status waiting">Waiting...</span>';
        actionsHTML = `<button class="q-item-remove" data-id="${item.id}" title="Remove">×</button>`;
    } else if (item.state === 'downloading') {
        const pct = item.progress?.percent || '0%';
        const speed = item.progress?.speed || '';
        const eta = item.progress?.eta || '';
        const pctNum = parseFloat(pct) || 0;
        const detail = [speed, eta ? 'ETA ' + eta : ''].filter(Boolean).join(' · ');

        statusHTML = `<span class="q-item-status downloading">${pct}${detail ? ' · ' + detail : ''}</span>`;
        progressHTML = `<div class="q-item-progress-track"><div class="q-item-progress-fill" style="width:${pctNum}%"></div></div>`;
        actionsHTML = `<button class="q-item-cancel" title="Stop and skip to next item">Skip</button>`;
    } else if (item.state === 'completed') {
        statusHTML = '<span class="q-item-status completed">Complete ✓</span>';
        actionsHTML = `<button class="q-item-open-folder" title="Open folder" onclick="doOpenFolder()">Open folder</button><button class="q-item-remove" data-id="${item.id}" title="Remove">×</button>`;
    } else if (item.state === 'failed') {
        const errText = escapeHtml(item.error || 'Failed');
        statusHTML = `<span class="q-item-status failed" title="${errText}">${errText}</span>`;
        actionsHTML = `<button class="q-item-retry" data-id="${item.id}" title="Retry">Retry</button><button class="q-item-remove" data-id="${item.id}" title="Remove">×</button>`;
    }

    return `
        <div class="q-item ${stateClass}" data-id="${item.id}">
            <div class="q-item-info">
                <div class="q-item-title">${title}</div>
                ${statusHTML}
            </div>
            <div class="q-item-actions">${actionsHTML}</div>
            ${progressHTML}
        </div>`;
}

function renderQueueItem(item) {
    const el = $queueItems.querySelector(`.q-item[data-id="${item.id}"]`);
    if (!el) return;

    const newEl = document.createElement('div');
    newEl.innerHTML = queueItemHTML(item);
    const replacement = newEl.firstElementChild;
    el.replaceWith(replacement);
    attachQueueListenersOn(replacement);
}

function attachQueueListeners() {
    $queueItems.querySelectorAll('.q-item').forEach(attachQueueListenersOn);
}

function attachQueueListenersOn(el) {
    el.querySelectorAll('.q-item-retry').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            doRetryItem(parseInt(btn.dataset.id));
        });
    });
    el.querySelectorAll('.q-item-remove').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            doRemoveItem(parseInt(btn.dataset.id));
        });
    });
    el.querySelectorAll('.q-item-cancel').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            doCancelCurrent();
        });
    });
}

async function doRetryItem(id) {
    try {
        await window.api.queueRetry(id);
    } catch (e) {
        addLog('Retry failed: ' + e.message, 'error');
    }
}

async function doRemoveItem(id) {
    try {
        await window.api.queueRemove(id);
    } catch (e) {
        addLog('Remove failed: ' + e.message, 'error');
    }
}

async function doCancelCurrent() {
    try {
        await window.api.queueCancelCurrent();
    } catch (e) {
        addLog('Cancel failed: ' + e.message, 'error');
    }
}

async function doCancelAll() {
    try {
        await window.api.queueCancelAll();
        addLog('Queue cancelled', 'highlight');
    } catch (e) {
        addLog('Cancel all failed: ' + e.message, 'error');
    }
}

async function doRetryFailed() {
    try {
        await window.api.queueRetryFailed();
        addLog('Retrying failed items...', 'highlight');
    } catch (e) {
        addLog('Retry failed: ' + e.message, 'error');
    }
}

async function doClearCompleted() {
    try {
        await window.api.queueClearCompleted();
        addLog('Cleared completed items');
    } catch (e) {
        addLog('Clear failed: ' + e.message, 'error');
    }
}

async function doQueueStart() {
    try {
        await window.api.queueStart();
        addLog('Queue started', 'highlight');
    } catch (e) {
        addLog('Start failed: ' + e.message, 'error');
    }
}

async function doQueuePause() {
    try {
        await window.api.queuePause();
        addLog('Queue paused');
    } catch (e) {
        addLog('Pause failed: ' + e.message, 'error');
    }
}

function showError(msg) {
    $error.innerHTML = '';
    $error.textContent = msg;
    $error.classList.add('visible');
    $error.classList.remove('auth-error');
}

function showAuthError() {
    const text = isSignedIn ? 'This video requires sign-in. Your session may have expired. ' : 'This video requires sign-in. ';
    const btnLabel = isSignedIn ? 'Sign in again' : 'Sign in to YouTube';
    $error.innerHTML = escapeHtml(text) + `<button class="auth-error-btn" onclick="doLogin()">${btnLabel}</button>`;
    $error.classList.add('visible', 'auth-error');
}

function hideError() {
    $error.classList.remove('visible', 'auth-error');
    $error.innerHTML = '';
}

function isAuthError(msg) {
    if (!msg) return false;
    // Auth errors only make sense for YouTube
    const url = ($url.value || '').toLowerCase();
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    if (!isYouTube) return false;

    const m = msg.toLowerCase();
    return (
        m.includes('sign in to confirm your age') ||
        m.includes('private video') ||
        m.includes("this video is available to this channel's members") ||
        m.includes('this playlist is private') ||
        m.includes('join this channel') ||
        m.includes('http error 403')
    );
}

async function doLogin() {
    hideError();
    addLog('Opening YouTube sign-in...', 'highlight');
    try {
        const success = await window.api.login();
        isSignedIn = success;
        updateAuthUI();
        if (success) {
            addLog('Signed in to YouTube ✓', 'success');
        }
    } catch (e) {
        addLog('Sign-in failed: ' + e.message, 'error');
    }
}

async function doLogout() {
    try {
        await window.api.logout();
        isSignedIn = false;
        updateAuthUI();
        addLog('Signed out of YouTube');
    } catch (e) {
        addLog('Sign-out failed: ' + e.message, 'error');
    }
}

function updateAuthUI() {
    const el = $('authStatus');
    if (!el) return;
    if (isSignedIn) {
        el.innerHTML = '<span class="auth-signed-in">Signed in to YouTube</span>';
        $('authActionBtn').textContent = 'Sign out';
        $('authActionBtn').onclick = doLogout;
    } else {
        el.innerHTML = '<span class="auth-signed-out">Not signed in</span>';
        $('authActionBtn').textContent = 'Sign in';
        $('authActionBtn').onclick = doLogin;
    }
}

// Instagram auth

function showInstaAuthError() {
    const text = isInstaSignedIn
        ? 'This collection requires Instagram sign-in. Your session may have expired. '
        : 'Instagram sign-in required to access saved collections. ';
    const btnLabel = isInstaSignedIn ? 'Sign in again' : 'Sign in to Instagram';
    $error.innerHTML = escapeHtml(text) + `<button class="auth-error-btn" onclick="doInstaLogin()">${btnLabel}</button>`;
    $error.classList.add('visible', 'auth-error');
}

async function doInstaLogin() {
    hideError();
    addLog('Opening Instagram sign-in...', 'highlight');
    try {
        const success = await window.api.instaLogin();
        isInstaSignedIn = success;
        updateInstaAuthUI();
        if (success) {
            addLog('Signed in to Instagram ✓', 'success');
        }
    } catch (e) {
        addLog('Instagram sign-in failed: ' + e.message, 'error');
    }
}

async function doInstaLogout() {
    try {
        await window.api.instaLogout();
        isInstaSignedIn = false;
        updateInstaAuthUI();
        addLog('Signed out of Instagram');
    } catch (e) {
        addLog('Instagram sign-out failed: ' + e.message, 'error');
    }
}

function updateInstaAuthUI() {
    const el = $('instaAuthStatus');
    if (!el) return;
    if (isInstaSignedIn) {
        el.innerHTML = '<span class="auth-signed-in">Signed in to Instagram</span>';
        $('instaAuthActionBtn').textContent = 'Sign out';
        $('instaAuthActionBtn').onclick = doInstaLogout;
    } else {
        el.innerHTML = '<span class="auth-signed-out">Not signed in</span>';
        $('instaAuthActionBtn').textContent = 'Sign in';
        $('instaAuthActionBtn').onclick = doInstaLogin;
    }
}

async function doOpenFolder() {
    window.api.openFolder();
}

async function doOpenLogs() {
    window.api.openLogs();
}

async function doChooseFolder() {
    try {
        const newPath = await window.api.chooseDownloadPath();
        $('settingsPath').textContent = newPath;
        addLog('Download folder changed: ' + newPath, 'success');
    } catch (e) {
        addLog('Failed to change folder: ' + e.message, 'error');
    }
}

function openExternal(url) {
    window.api.openExternal(url);
}

async function loadHistory() {
    try {
        historyCache = await window.api.getHistory();
    } catch (e) {
        addLog('History load error: ' + e.message, 'error');
        historyCache = [];
    }
    renderHistory();
}

function renderHistory() {
    const list = historyCache;
    updateHistoryCount();

    if (list.length === 0) {
        $historyToolbar.style.display = 'none';
        $historyList.innerHTML = '';
        $historyEmpty.style.display = 'block';
        return;
    }

    $historyEmpty.style.display = 'none';
    $historyToolbar.style.display = 'flex';
    $historyCountLabel.textContent = `${list.length} item${list.length !== 1 ? 's' : ''}`;

    $historyList.innerHTML = list
        .map((entry, idx) => {
            const info = entry.info || {};
            const ago = timeAgo(entry.fetchedAt);
            const source = info.extractor_key || '';
            const uploader = info.uploader || info.channel || '';
            const thumb = info.thumbnail || '';
            const title = info.title || 'Untitled';
            const id = info.id || '';
            const ext = info.extractor_key || '';
            const duration = info.duration_string || '';

            const subParts = [];
            if (source) {
                subParts.push(`<span class="source-badge">${escapeHtml(source)}</span>`);
            }
            if (uploader) subParts.push(escapeHtml(uploader));
            if (duration) subParts.push(duration);
            subParts.push(ago);

            return `
            <div class="history-item" data-idx="${idx}">
                ${
                    thumb
                        ? `<img class="history-thumb" src="${escapeHtml(
                              thumb,
                          )}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="history-thumb-error"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><use href="#ic-film"/></svg></div>`
                        : `<div class="history-thumb-error" style="display:flex;"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><use href="#ic-film"/></svg></div>`
                }
                <div class="history-info">
                    <div class="history-title">${escapeHtml(title)}</div>
                    <div class="history-sub">${subParts.join(' <span class="meta-sep">·</span> ')}</div>
                </div>
                <div class="history-actions">
                    <button class="history-remove" data-id="${escapeHtml(id)}" data-ext="${escapeHtml(ext)}" title="Remove">×</button>
                </div>
            </div>`;
        })
        .join('');

    $historyList.querySelectorAll('.history-item').forEach((el) => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-remove')) return;
            const idx = parseInt(el.dataset.idx);
            if (historyCache[idx]) loadFromHistory(idx);
        });
    });

    $historyList.querySelectorAll('.history-remove').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeHistoryItem(btn.dataset.id, btn.dataset.ext);
        });
    });
}

function loadFromHistory(idx) {
    const entry = historyCache[idx];
    if (!entry || !entry.info) return;

    // Queue-completed items have no presets - just set the URL and let user fetch
    if (!entry.presets || entry.presets.length === 0) {
        $url.value = entry.info.webpage_url || '';
        hideError();
        hidePlaylist();
        hideCard();
        $empty.style.display = 'block';
        switchTab('download');
        setDlMode('single');
        addLog('URL loaded from history - click Fetch to get video info', 'highlight');
        return;
    }

    addLog('Loaded from history: ' + entry.info.title, 'highlight');

    videoInfo = entry.info;
    presets = entry.presets;
    selectedPreset = null;
    isPlaylistMode = false;
    activeFetchId = null;

    $url.value = videoInfo.webpage_url || '';
    hideError();
    hidePlaylist();
    switchTab('download');
    setDlMode('single');
    showCard();
    showClearBtn();
    renderFetchPanel();
}

async function removeHistoryItem(videoId, extractorKey) {
    try {
        historyCache = await window.api.removeHistory(videoId, extractorKey);
        renderHistory();
        addLog('Removed from history');
    } catch (e) {
        addLog('Failed to remove: ' + e.message, 'error');
    }
}

async function doClearHistory() {
    try {
        historyCache = await window.api.clearHistory();
        renderHistory();
        addLog('History cleared');
    } catch (e) {
        addLog('Failed to clear history: ' + e.message, 'error');
    }
}

function updateHistoryCount() {
    const count = historyCache.length;
    if (count > 0) {
        $historyCount.textContent = count;
        $historyCount.style.display = 'inline-block';
    } else {
        $historyCount.style.display = 'none';
    }
}

function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    return Math.floor(days / 30) + 'mo ago';
}

async function loadSettings() {
    try {
        const dlPath = await window.api.getDownloadPath();
        $('settingsPath').textContent = dlPath || '-';
    } catch {}

    try {
        const deps = await window.api.checkDeps();

        const ytdlpEl = $('depYtdlpPath');
        const ytdlpDot = document.querySelector('#depYtdlpStatus .dep-dot');
        ytdlpEl.textContent = deps.ytdlp.found ? deps.ytdlp.path : 'Not found - run npm install';
        ytdlpDot.className = 'dep-dot ' + (deps.ytdlp.found ? 'ok' : 'missing');

        const ffEl = $('depFfmpegPath');
        const ffDot = document.querySelector('#depFfmpegStatus .dep-dot');
        ffEl.textContent = deps.ffmpeg.found ? deps.ffmpeg.path : 'Not found - run npm install';
        ffDot.className = 'dep-dot ' + (deps.ffmpeg.found ? 'ok' : 'missing');

        const denoEl = $('depDenoPath');
        const denoDot = document.querySelector('#depDenoStatus .dep-dot');
        denoEl.textContent = deps.deno.found ? deps.deno.path : 'Not found - run npm install';
        denoDot.className = 'dep-dot ' + (deps.deno.found ? 'ok' : 'missing');
    } catch {}

    try {
        const versions = await window.api.getDepVersions();
        if (versions.ytdlp) $('depYtdlpVersion').textContent = 'v' + versions.ytdlp;
        if (versions.ffmpeg) $('depFfmpegVersion').textContent = 'v' + versions.ffmpeg;
        if (versions.deno) $('depDenoVersion').textContent = 'v' + versions.deno;
    } catch {}

    try {
        isSignedIn = await window.api.checkAuth();
        updateAuthUI();
    } catch {}

    try {
        isInstaSignedIn = await window.api.checkInstaAuth();
        updateInstaAuthUI();
    } catch {}
}

async function doResetApp() {
    const confirmReset = confirm('This will delete ALL app data (cookies, history, settings) and restart the app.\n\nContinue?');

    if (!confirmReset) return;

    try {
        addLog('Resetting app...', 'highlight');
        await window.api.resetApp();
    } catch (err) {
        addLog('Reset failed: ' + err.message, 'error');
        showToast('Reset failed', 'error');
    }
}

async function loadAbout() {
    try {
        const info = await window.api.getAppInfo();
        $('aboutVersion').textContent = `v${info.version}${info.devMode ? ' · dev' : ''}`;
    } catch {}

    // Show update status if already known
    renderAboutUpdate();
}

// Updates are check-and-redirect only — no silent in-place install. A background
// auto-installer was tried and failed unrecoverably on an ad-hoc-signed mac build;
// pointing people at the GitHub release page for a manual download always works.
function showUpdateBanner() {
    const banner = $('updateBanner');
    if (!banner) return;
    if (!updateInfo || !updateInfo.hasUpdate) return;

    banner.innerHTML =
        `<span>${escapeHtml(t('update.newVersion'))} <strong>v${escapeHtml(updateInfo.latest)}</strong></span>` +
        `<button class="btn-sm" onclick="openExternal('${escapeHtml(updateInfo.url)}')">${escapeHtml(t('update.download'))}</button>` +
        `<button class="update-dismiss" onclick="dismissUpdateBanner()" title="${escapeHtml(t('update.dismiss'))}">×</button>`;
    banner.classList.add('visible');
}

function dismissUpdateBanner() {
    const banner = $('updateBanner');
    if (banner) banner.classList.remove('visible');
}

function renderAboutUpdate() {
    const el = $('aboutUpdateStatus');
    if (!el) return;

    if (updateInfo && updateInfo.hasUpdate) {
        const notes = (updateInfo.body || '').trim();
        el.innerHTML =
            `<div class="about-update-available">` +
            `<span>${escapeHtml(t('update.availableAbout')(updateInfo.latest))}</span>` +
            `<a href="#" onclick="openExternal('${escapeHtml(updateInfo.url)}'); return false;">${escapeHtml(t('update.viewRelease'))}</a>` +
            `</div>` +
            (notes ? `<div class="about-release-notes">${escapeHtml(notes)}</div>` : '');
    } else if (updateInfo && !updateInfo.hasUpdate && !updateInfo.error) {
        el.textContent = t('update.upToDate');
    } else {
        el.textContent = '';
    }
}

async function doCheckForUpdates() {
    const btn = $('checkUpdateBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Checking...';
    }

    try {
        const result = await window.api.checkForUpdates();
        updateInfo = result;
        renderAboutUpdate();

        if (result.hasUpdate) {
            addLog(`Update available: v${result.latest}`, 'highlight');
            showUpdateBanner();
        } else if (result.error) {
            addLog('Update check failed: ' + result.error, 'error');
        } else {
            addLog("You're on the latest version ✓", 'success');
        }
    } catch (e) {
        addLog('Update check failed: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Check for updates';
        }
    }
}

async function init() {
    addLog('App starting...');

    try {
        const info = await window.api.getAppInfo();
        addLog(`v${info.version} · ${info.platform}/${info.arch} · dev:${info.devMode}`);
    } catch {}

    try {
        const deps = await window.api.checkDeps();
        addLog(`yt-dlp: ${deps.ytdlp.found ? '✓' : '✗ NOT FOUND'}`, deps.ytdlp.found ? 'success' : 'error');
        addLog(`ffmpeg: ${deps.ffmpeg.found ? '✓' : '✗ NOT FOUND'}`, deps.ffmpeg.found ? 'success' : 'error');

        const missing = [];
        if (!deps.ytdlp.found) missing.push('yt-dlp');
        if (!deps.ffmpeg.found) missing.push('ffmpeg');

        if (missing.length > 0) {
            const banner = $('depBanner');
            banner.textContent = `⚠ Missing: ${missing.join(', ')}. Run npm install to download them.`;
            banner.classList.add('visible');
        }
    } catch (e) {
        addLog('Dep check error: ' + e.message, 'error');
    }

    addLog('Ready');

    try {
        historyCache = await window.api.getHistory();
        updateHistoryCount();
    } catch {}

    try {
        isSignedIn = await window.api.checkAuth();
        if (isSignedIn) addLog('YouTube: signed in ✓', 'success');
        updateAuthUI();
    } catch {}

    try {
        isInstaSignedIn = await window.api.checkInstaAuth();
        if (isInstaSignedIn) addLog('Instagram: signed in ✓', 'success');
        updateInstaAuthUI();
    } catch {}
}

// Just the 5 formats that cover almost everyone (MP4/MOV, MP3/WAV/M4A) live in the
// plain primary select; rarer ones (other containers, re-encode variants, lossless
// FLAC, legacy formats) live behind "More formats" in their own select.
const CONVERT_COMMON_FORMATS = new Set(['mp4', 'mov', 'mp3', 'wav', 'm4a']);

const CONVERT_ADVANCED_FORMAT_LABELS = {
    mkv: 'MKV',
    webm: 'WebM',
    'mp4-h264': 'MP4 · H.264',
    'mp4-h265': 'MP4 · H.265',
    flac: 'FLAC',
    opus: 'Opus',
    avi: 'AVI',
    ts: 'TS',
    mts: 'MTS',
    vob: 'VOB',
    flv: 'FLV',
    '3gp': '3GP',
    dav: 'DAV',
};

let convertFormat = 'mp4';

function selectConvertFormat(value) {
    if (!value) return;
    convertFormat = value;

    const primarySelect = document.getElementById('convertFormat');
    const advancedSelect = document.getElementById('convertFormatAdvanced');
    const moreBtn = document.getElementById('convertMoreFormatsBtn');

    if (CONVERT_COMMON_FORMATS.has(value)) {
        if (primarySelect) primarySelect.value = value;
        if (advancedSelect) advancedSelect.value = '';
        if (moreBtn) moreBtn.querySelector('span').textContent = t('convert.format.more');
    } else {
        if (advancedSelect) advancedSelect.value = value;
        const label = CONVERT_ADVANCED_FORMAT_LABELS[value] || value.toUpperCase();
        if (moreBtn) moreBtn.querySelector('span').textContent = `${t('convert.format.more')}: ${label}`;
    }

    const lossyWarn = document.getElementById('convertLossyWarn');
    if (lossyWarn) lossyWarn.style.display = ['flac', 'wav'].includes(value) ? 'block' : 'none';
}

function toggleMoreFormats() {
    const wrap = document.getElementById('convertMoreFormatsWrap');
    const btn = document.getElementById('convertMoreFormatsBtn');
    const opening = wrap.style.display === 'none';
    wrap.style.display = opening ? 'block' : 'none';
    if (btn) btn.classList.toggle('open', opening);
}

// ── Batch ─────────────────────────────────────────────────────────────────────

function toggleBatch() {
    const section = document.getElementById('batchSection');
    if (section) section.classList.toggle('open');
}

let _logOpenHeight = 180;

function toggleLog() {
    const panel = document.getElementById('logPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) {
        _logOpenHeight = Math.max(60, panel.offsetHeight);
        panel.style.height = '34px';
        panel.classList.remove('open');
    } else {
        panel.style.height = _logOpenHeight + 'px';
        panel.classList.add('open');
    }
}

function initLogResize() {
    const handle = document.getElementById('logResizeHandle');
    const panel = document.getElementById('logPanel');
    if (!handle || !panel) return;

    let active = false;
    let startY = 0;
    let startH = 0;

    handle.addEventListener('mousedown', (e) => {
        active = true;
        startY = e.clientY;
        startH = panel.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        panel.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!active) return;
        const delta = startY - e.clientY;
        const newH = Math.max(34, Math.min(window.innerHeight * 0.6, startH + delta));
        panel.style.height = newH + 'px';
        if (newH > 34) panel.classList.add('open');
        else panel.classList.remove('open');
    });

    document.addEventListener('mouseup', () => {
        if (!active) return;
        active = false;
        panel.style.transition = '';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

function initSidebarResize() {
    const handle = document.getElementById('sidebarResizeHandle');
    const sidebar = document.querySelector('.sidebar');
    if (!handle || !sidebar) return;

    let active = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener('mousedown', (e) => {
        active = true;
        startX = e.clientX;
        startW = sidebar.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        handle.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!active) return;
        const delta = e.clientX - startX;
        const newW = Math.max(140, Math.min(280, startW + delta));
        sidebar.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!active) return;
        active = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

const BATCH_PRESETS = {
    // No codec restriction — YouTube only offers 4K/2K in AV1/VP9, H.264 maxes at 1080p
    best:    { formatId: 'bestvideo+bestaudio/best', extractAudio: false, audioFormat: null },
    '4k':    { formatId: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]', extractAudio: false, audioFormat: null },
    '2k':    { formatId: 'bestvideo[height<=1440]+bestaudio/best[height<=1440]', extractAudio: false, audioFormat: null },
    '1080p': { formatId: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]', extractAudio: false, audioFormat: null },
    mp3:     { formatId: 'bestaudio/best', extractAudio: true,  audioFormat: 'mp3' },
    wav:     { formatId: 'bestaudio/best', extractAudio: true,  audioFormat: 'wav' },
};

let batchSelectedPreset = '1080p';

function parseBatchUrls() {
    const text = document.getElementById('batchUrls')?.value || '';
    return text.split('\n').map(l => l.trim()).filter(l => /^https?:\/\/.+/.test(l));
}

function onBatchUrlsInput() {
    const count = parseBatchUrls().length;
    const countEl = document.getElementById('batchCount');
    if (countEl) countEl.textContent = count > 0 ? `${count} URL${count !== 1 ? 's' : ''}` : '';
    const btn = document.getElementById('batchAddBtn');
    if (btn) btn.disabled = count === 0;
}

function selectBatchPreset(preset) {
    batchSelectedPreset = preset;
    document.querySelectorAll('.batch-q-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === preset);
    });
}

async function doBatchAdd() {
    const urls = parseBatchUrls();
    if (!urls.length) return;

    const btn = document.getElementById('batchAddBtn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = `Fetching metadata… (0/${urls.length})`;

    let metas;
    try {
        // Fetch title + thumbnail for each URL in parallel (with fallback to URL on error)
        const raw = await window.api.batchMeta(urls);
        metas = raw;
    } catch {
        metas = urls.map(url => ({ url, title: url, thumbnail: null }));
    }

    btn.textContent = origText;

    const preset = BATCH_PRESETS[batchSelectedPreset];
    const items = metas.map(m => ({
        url: m.url,
        title: m.title || m.url,
        thumbnail: m.thumbnail || null,
        formatId: preset.formatId,
        extractAudio: preset.extractAudio,
        audioFormat: preset.audioFormat || 'mp3',
    }));

    await window.api.queueAdd(items);

    document.getElementById('batchUrls').value = '';
    onBatchUrlsInput();

    const n = urls.length;
    addLog(`Added ${n} URL${n !== 1 ? 's' : ''} to queue`, 'highlight');
    showToast(`${n} item${n !== 1 ? 's' : ''} added to queue`);
    switchTab('queue');
}

// ── Convert Tab ──────────────────────────────────────────────────────────────
// One unified file list for 1 file or many (mirrors how the Download queue works —
// dropping N files just queues N items, no separate "batch mode" UI). Trim only
// applies when there's exactly one file, since a shared trim range across a batch
// of unrelated files wouldn't make sense.

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.opus', '.flac', '.wav', '.ogg', '.wma']);

let convertItems = []; // [{ id, path, name, state: 'pending'|'converting'|'done'|'error'|'cancelled', percent }]
let convertItemIdCounter = 0;
let convertRunning = false;
let convertStopRequested = false;
let convertTrimOpen = false;

function initConvertTab() {
    const dropZone = document.getElementById('convertDropZone');
    if (!dropZone || dropZone._initialized) return;
    dropZone._initialized = true;

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const paths = Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f));
        addFilesToConvertList(paths);
    });

    window.api.onConvertProgress((p) => {
        const current = convertItems.find((i) => i.state === 'converting');
        if (current) current.percent = p.percent;
        renderConvertList();
        const bar = document.getElementById('convertProgressBar');
        const label = document.getElementById('convertProgressLabel');
        if (bar) bar.style.width = p.percent;
        if (label) label.textContent = p.percent + (p.total > 0 ? ` — ${p.elapsed}s / ${p.total}s` : '');
    });
}

async function doConvertChooseFile() {
    const filePaths = await window.api.convertChooseFile();
    addFilesToConvertList(filePaths);
}

function addFilesToConvertList(paths) {
    if (!paths || paths.length === 0) return;
    for (const p of paths) {
        convertItems.push({ id: ++convertItemIdCounter, path: p, name: p.split('/').pop(), state: 'pending', percent: null });
    }

    document.getElementById('convertDropZone').style.display = 'none';
    document.getElementById('convertListWrap').style.display = 'flex';
    document.getElementById('convertBtn').disabled = false;
    document.querySelector('.convert-center-wrapper')?.classList.add('has-content');

    if (convertItems.length === 1) {
        loadConvertPreview(convertItems[0].path);
    } else {
        // Trim doesn't apply to a batch of unrelated files — collapse it if it was open.
        closeConvertTrim();
    }
    renderConvertList();
}

function removeConvertItem(id) {
    const item = convertItems.find((i) => i.id === id);
    if (!item || item.state === 'converting') return;
    convertItems = convertItems.filter((i) => i.id !== id);

    if (convertItems.length === 0) {
        doConvertClear();
        return;
    }
    if (convertItems.length === 1) {
        loadConvertPreview(convertItems[0].path);
    }
    renderConvertList();
}

function doConvertClear() {
    if (convertRunning) {
        convertStopRequested = true;
        window.api.convertCancel();
    }
    convertItems = [];
    convertRunning = false;

    const dropZone = document.getElementById('convertDropZone');
    const listWrap = document.getElementById('convertListWrap');
    const progressWrap = document.getElementById('convertProgressWrap');
    const btn = document.getElementById('convertBtn');
    const video = document.getElementById('convertVideo');
    if (dropZone) dropZone.style.display = 'flex';
    if (listWrap) listWrap.style.display = 'none';
    if (progressWrap) progressWrap.style.display = 'none';
    if (btn) { btn.textContent = t('convert.btn'); btn.disabled = true; }
    if (video) { video.pause(); video.src = ''; }

    closeConvertTrim();
    clearConvertTrim();
    document.querySelector('.convert-center-wrapper')?.classList.remove('has-content');
}

function renderConvertList() {
    const list = document.getElementById('convertList');
    const count = document.getElementById('convertListCount');
    const btn = document.getElementById('convertBtn');
    const trimToggleWrap = document.getElementById('convertTrimToggleWrap');
    if (!list) return;

    const done = convertItems.filter((i) => i.state === 'done').length;
    const pending = convertItems.filter((i) => i.state === 'pending').length;
    if (count) count.textContent = convertItems.length > 1 ? `${done}/${convertItems.length}` : '';

    if (btn) {
        btn.disabled = pending === 0 && !convertRunning;
        if (convertRunning) btn.textContent = t('convert.status.converting');
        else if (convertItems.length > 1 && pending > 0) btn.textContent = t('convert.btn.n')(pending);
        else btn.textContent = t('convert.btn');
    }

    const cancelBtn = document.getElementById('convertCancelBtn');
    if (cancelBtn) cancelBtn.style.display = convertRunning ? 'inline' : 'none';

    if (trimToggleWrap) trimToggleWrap.style.display = convertItems.length === 1 ? 'flex' : 'none';

    list.innerHTML = convertItems.map((item) => {
        const removable = item.state === 'pending' || item.state === 'error' || item.state === 'cancelled';
        const statusText = {
            pending: t('convert.status.queued'),
            converting: item.percent ? `${item.percent}%` : t('convert.status.converting'),
            done: t('convert.status.done'),
            error: t('convert.status.error'),
            cancelled: t('convert.status.cancelled'),
        }[item.state];
        return `<div class="convert-batch-item convert-batch-item-${item.state}">` +
            `<span class="convert-batch-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>` +
            `<span class="convert-batch-item-status">${escapeHtml(statusText)}</span>` +
            (removable ? `<button class="convert-batch-item-remove" onclick="removeConvertItem(${item.id})">×</button>` : `<span class="convert-batch-item-remove-spacer"></span>`) +
            `</div>`;
    }).join('');
}

function loadConvertPreview(filePath) {
    const name = filePath.split('/').pop();
    const ext = '.' + name.split('.').pop().toLowerCase();
    const video = document.getElementById('convertVideo');
    if (!video) return;

    // Plain file:// is blocked by Electron's URL safety check now that the renderer
    // loads over http:// (see localServer.js) — bweb-file:// proxies to a real file
    // read from the main process instead (see main.js's protocol.handle).
    video.src = `bweb-file://${encodeURIComponent(filePath)}`;
    video.style.maxHeight = AUDIO_EXTS.has(ext) ? '40px' : '240px';
    video.onloadedmetadata = () => {
        const durEl = document.getElementById('convertTrimDuration');
        if (durEl) durEl.textContent = `Duration: ${formatTime(video.duration)}`;
        const re = document.getElementById('convertRangeEnd');
        if (re) re.value = 100;
        updateConvertRangeFill();
    };
    clearConvertTrim();
}

function toggleConvertTrim() {
    convertTrimOpen = !convertTrimOpen;
    const wrap = document.getElementById('convertPlayerWrap');
    const btn = document.getElementById('convertTrimToggleBtn');
    if (wrap) wrap.style.display = convertTrimOpen ? 'flex' : 'none';
    if (btn) btn.classList.toggle('open', convertTrimOpen);
}

function closeConvertTrim() {
    convertTrimOpen = false;
    const wrap = document.getElementById('convertPlayerWrap');
    const btn = document.getElementById('convertTrimToggleBtn');
    if (wrap) wrap.style.display = 'none';
    if (btn) btn.classList.remove('open');
}

function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function setConvertTrimStart() {
    const video = document.getElementById('convertVideo');
    const input = document.getElementById('convertTrimStart');
    if (!video || !input) return;
    input.value = formatTime(video.currentTime);
    onConvertTimeInput();
}

function setConvertTrimEnd() {
    const video = document.getElementById('convertVideo');
    const input = document.getElementById('convertTrimEnd');
    if (!video || !input) return;
    input.value = formatTime(video.currentTime);
    onConvertTimeInput();
}

function clearConvertTrim() {
    const start = document.getElementById('convertTrimStart');
    const end = document.getElementById('convertTrimEnd');
    const rs = document.getElementById('convertRangeStart');
    const re = document.getElementById('convertRangeEnd');
    if (start) start.value = '';
    if (end) end.value = '';
    if (rs) rs.value = 0;
    if (re) re.value = 100;
    updateConvertRangeFill();
}

async function runConvertQueue() {
    convertRunning = true;
    convertStopRequested = false;

    const format = convertFormat;
    // Trim only applies when there's exactly one file and the trim panel was opened.
    const singleFile = convertItems.length === 1;
    const startTime = (singleFile && convertTrimOpen) ? (document.getElementById('convertTrimStart')?.value.trim() || null) : null;
    const endTime = (singleFile && convertTrimOpen) ? (document.getElementById('convertTrimEnd')?.value.trim() || null) : null;

    const progressWrap = document.getElementById('convertProgressWrap');
    const bar = document.getElementById('convertProgressBar');
    const label = document.getElementById('convertProgressLabel');
    if (progressWrap) progressWrap.style.display = 'flex';
    if (bar) bar.style.width = '0%';
    if (label) label.textContent = '0%';
    renderConvertList();

    while (!convertStopRequested) {
        const item = convertItems.find((i) => i.state === 'pending');
        if (!item) break;

        item.state = 'converting';
        item.percent = null;
        renderConvertList();
        addLog(`Converting: ${item.name} → ${format.toUpperCase()}`, 'highlight');

        try {
            const result = await window.api.convertFile(item.path, format, startTime, endTime);
            item.state = 'done';
            addLog(`Saved: ${result.outputPath}`, 'success');
        } catch (err) {
            item.state = err.message === 'Cancelled' ? 'cancelled' : 'error';
            addLog(`Conversion failed for ${item.name}: ${err.message}`, 'error');
        }
        renderConvertList();
    }

    convertRunning = false;
    // A "Cancel" click stops the whole run, not just the current file — anything still
    // waiting shouldn't look stuck on "Waiting…" forever.
    if (convertStopRequested) {
        convertItems.filter((i) => i.state === 'pending').forEach((i) => { i.state = 'cancelled'; });
    }
    if (progressWrap) progressWrap.style.display = 'none';
    renderConvertList();

    if (convertItems.length > 0 && convertItems.every((i) => i.state !== 'pending' && i.state !== 'converting')) {
        const kind = convertItems.length > 1 ? 'Batch conversion' : 'Conversion';
        const failed = convertItems.some((i) => i.state === 'error');
        if (convertStopRequested) showToast(`${kind} cancelled`, 'info');
        else showToast(`${kind} ${failed ? 'finished with errors' : 'complete ✓'}`, failed ? 'error' : 'success');
    }
}

async function doConvert() {
    if (convertRunning) return;
    runConvertQueue();
}

async function doCancelConvert() {
    convertStopRequested = true;
    await window.api.convertCancel();
}

initLang();
initTheme();
initAccent();
initSidebarResize();
initLogResize();
init();
