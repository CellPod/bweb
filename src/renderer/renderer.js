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
    const saved = localStorage.getItem('theme');

    // Settings tab and the onboarding wizard each show their own copy of this toggle,
    // so both need to stay in sync with whichever one the user actually clicked.
    const pairs = [
        ['themeIcon', 'themeToggleLabel', 'themeLabel'],
        ['onboardingThemeIcon', 'onboardingThemeToggleLabel', 'onboardingThemeLabel'],
    ];
    for (const [iconId, labelId, descId] of pairs) {
        const icon = document.getElementById(iconId);
        const label = document.getElementById(labelId);
        const desc = document.getElementById(descId);
        if (icon) icon.innerHTML = dark ? '<use href="#ic-sun"/>' : '<use href="#ic-moon"/>';
        if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
        if (desc) desc.textContent = saved ? (dark ? 'Dark' : 'Light') : 'Follows system';
    }
}

// ── First-run onboarding wizard + one-time responsible-use dialog ─────────────

async function initOnboarding() {
    let completed = false;
    try {
        completed = await window.api.isOnboardingCompleted();
    } catch {}

    if (!completed) {
        try {
            const dlPath = await window.api.getDownloadPath();
            $('onboardingFolderPath').textContent = dlPath || '-';
        } catch {}
        onboardingGoToStep(1);
        $('onboardingModal').style.display = 'flex';
        return;
    }

    await maybeShowLegal();
}

function onboardingGoToStep(step) {
    $('onboardingStep1').style.display = step === 1 ? 'block' : 'none';
    $('onboardingStep2').style.display = step === 2 ? 'block' : 'none';
    $('onboardingProgressFill').style.width = step === 1 ? '50%' : '100%';
}

async function skipOnboarding() {
    await finishOnboarding();
}

async function finishOnboarding() {
    try {
        await window.api.completeOnboarding();
    } catch {}
    $('onboardingModal').style.display = 'none';
    await maybeShowLegal();
}

async function wizardChooseFolder() {
    try {
        const newPath = await window.api.chooseDownloadPath();
        $('onboardingFolderPath').textContent = newPath;
        $('settingsPath').textContent = newPath;
        $('dlDestPath').textContent = newPath;
        addLog('Download folder changed: ' + newPath, 'success');
    } catch (e) {
        addLog('Failed to change folder: ' + e.message, 'error');
    }
}

async function maybeShowLegal() {
    let acknowledged = false;
    try {
        acknowledged = await window.api.isLegalAcknowledged();
    } catch {}
    if (!acknowledged) {
        $('legalModal').style.display = 'flex';
    }
}

async function acknowledgeLegal() {
    try {
        await window.api.acknowledgeLegal();
    } catch {}
    $('legalModal').style.display = 'none';
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
let isVimeoSignedIn = false;
let updateInfo = null;

const $ = (id) => document.getElementById(id);

const $url = $('urlInput');
const $fetchBtn = $('fetchBtn');
const $clearBtn = $('clearBtn');
const $error = $('errorMsg');
const $card = $('videoCard');
const $empty = $('emptyState');
const $emptyFetching = $('emptyStateFetching');
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

const DOWNLOAD_GROUP_TABS = ['download', 'queue', 'history'];

// Convert/Compress/Privacy/QR/BgRemove no longer have their own sidebar row, they're reached
// through the Tools catalog tile grid. The sidebar still needs to show "you are somewhere in
// Tools" while any of them is open, so switchTab() highlights the "tools" nav-item instead of
// looking for a nav-item matching the real tabId (which no longer exists for these five).
const TOOL_TABS = ['tools', 'convert', 'compress', 'privacy', 'qrcode', 'bgremove'];

// Destination popover — shared by every processing tool's "Saving to" + "Open folder after
// X" panel. Only one open at a time; clicking outside (or re-clicking the same trigger)
// closes it.
function closeAllDestPopovers() {
    document.querySelectorAll('.dest-popover.open').forEach((p) => p.classList.remove('open'));
    document.querySelectorAll('.dest-popover-trigger.open').forEach((b) => b.classList.remove('open'));
}

function setDestFolderLabel(elId, path) {
    const el = document.getElementById(elId);
    if (el) el.textContent = path ? path.split('/').pop() : '—';
}

function toggleDestPopover(prefix) {
    const popover = document.getElementById(`${prefix}DestPopover`);
    const trigger = document.getElementById(`${prefix}DestTrigger`);
    if (!popover) return;
    const willOpen = !popover.classList.contains('open');
    closeAllDestPopovers();
    if (willOpen) {
        popover.classList.add('open');
        trigger?.classList.add('open');
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.view-header-actions')) closeAllDestPopovers();
});

// Format picker popover — shared by Convert's Video/Image/Document sub-views. Shows the
// current format on a compact trigger button; clicking it reveals the tile grid instead of
// keeping every format permanently expanded on the page. Only one open at a time.
function closeAllFormatMenus() {
    document.querySelectorAll('.format-picker-menu.open').forEach((m) => m.classList.remove('open'));
    document.querySelectorAll('.format-picker-trigger.open').forEach((b) => b.classList.remove('open'));
}

function toggleFormatMenu(prefix) {
    const menu = document.getElementById(`${prefix}FormatMenu`);
    const trigger = document.getElementById(`${prefix}FormatTrigger`);
    if (!menu) return;
    const willOpen = !menu.classList.contains('open');
    closeAllFormatMenus();
    if (willOpen) {
        menu.classList.add('open');
        trigger?.classList.add('open');
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.format-picker')) closeAllFormatMenus();
});

// Manual override for the Download nav group's expanded/collapsed state — set by clicking the
// chevron (toggleDownloadNavGroup). Without this, switchTab() used to force the group open on
// every single click while on Fetch/Queue/History, making the chevron's collapse have zero
// lasting effect: you could never see e.g. Queue with the sub-tabs list collapsed to save space.
let downloadGroupCollapsed = false;

function switchTab(tabId) {
    const previousTab = document.querySelector('.nav-item.active')?.dataset.tab;
    const navActiveId = TOOL_TABS.includes(tabId) ? 'tools' : tabId;

    document.querySelectorAll('.nav-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === navActiveId);
    });
    document.querySelectorAll('.view').forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    });

    const downloadGroup = document.getElementById('downloadNavGroup');
    if (downloadGroup) {
        const inGroup = DOWNLOAD_GROUP_TABS.includes(tabId);
        const wasInGroup = DOWNLOAD_GROUP_TABS.includes(previousTab);
        // Entering the group from outside (e.g. clicking "Download" from Convert) always reveals
        // the sub-tabs — a manual collapse from a previous visit shouldn't hide them on re-entry.
        // Moving between sub-tabs while already inside the group (Fetch -> Queue) respects
        // whatever the user last chose with the chevron.
        if (inGroup && !wasInGroup) downloadGroupCollapsed = false;
        const expanded = inGroup && !downloadGroupCollapsed;
        downloadGroup.classList.toggle('expanded', expanded);
        document.getElementById('downloadNavToggle')?.setAttribute('aria-expanded', String(expanded));
    }

    if (tabId === 'history') loadHistory();
    if (tabId === 'settings') loadSettings();
    if (tabId === 'about') loadAbout();
    if (tabId === 'convert') initConvertTab();
    if (tabId === 'compress') initCompressTab();
    if (tabId === 'privacy') initPrivacyTab();
    if (tabId === 'qrcode') initQrTab();
    if (tabId === 'bgremove') initBgRemoveTab();
}

// Chevron-only click target: collapses/expands the Download group's sub-tabs list without
// navigating away from whichever of Fetch/Queue/History is currently active (e.g. lets you sit
// on Queue with the sub-tabs list hidden to save sidebar space). Separate from clicking the
// rest of the header row, which still navigates to Fetch via switchTab('download').
function toggleDownloadNavGroup(event) {
    event.stopPropagation();
    downloadGroupCollapsed = !downloadGroupCollapsed;
    const downloadGroup = document.getElementById('downloadNavGroup');
    const inGroup = DOWNLOAD_GROUP_TABS.includes(document.querySelector('.nav-item.active')?.dataset.tab);
    const expanded = inGroup && !downloadGroupCollapsed;
    downloadGroup?.classList.toggle('expanded', expanded);
    document.getElementById('downloadNavToggle')?.setAttribute('aria-expanded', String(expanded));
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

// macOS only (no-op elsewhere, see sparkleUpdater.js) — Sparkle drives this asynchronously
// (checking/available/downloaded/error) instead of the single request/response
// updater.checkForUpdates() call above.
window.api.onSparkleEvent(handleSparkleEvent);

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
let _clipPreviewToken = 0;

async function showClipPreview(url) {
    // Freshness token: if a newer call starts before this one's oEmbed fetch resolves,
    // its result must not overwrite the newer call's title (both target the same DOM nodes).
    const token = ++_clipPreviewToken;

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
            if (token !== _clipPreviewToken) return; // a newer preview call has since started
            if (res.ok) {
                const data = await res.json();
                if (token !== _clipPreviewToken) return;
                $clipTitle.textContent = data.title || domain;
            } else {
                $clipTitle.textContent = domain;
            }
        } catch {
            if (token === _clipPreviewToken) $clipTitle.textContent = domain;
        }
    } else {
        $clipThumb.style.display = 'none';
        $clipTitle.textContent = domain;
        $clipPreview.style.display = 'flex';
    }

    if (token === _clipPreviewToken) $clipPreview.dataset.url = url;
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

    // Disabled to prevent a double-submit while the request is in flight — the loading
    // signal itself lives in the central empty-state animation, not on this button.
    $fetchBtn.disabled = true;

    // Instagram collections and playlists use the original blocking flow because they have streaming UI that needs the main panel
    const isInstaCollection = isInstagramCollection(url);
    if (isInstaCollection) {
        if (isFetching) return;
        hideCard();
        hidePlaylist();
        isFetching = true;
        $fetchBtn.disabled = true;
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
    // Prevent duplicate URLs already in the queue, regardless of their state
    const alreadyQueued = fetchQueue.find((item) => item.url === url);
    if (alreadyQueued) {
        $fetchBtn.disabled = false;
        $fetchBtn.textContent = 'Fetch';
        showToast('This URL is already in the queue');
        return;
    }

    // Keep the button's spinner up until this specific item actually finishes fetching
    // (resolveFetchBtnWatch, called from processFetchQueue) — the item's own network
    // fetch is what takes real time, not the synchronous addToFetchQueue() call below.
    const item = addToFetchQueue(url);
    _fetchBtnWatchId = item.id;

    // Only swap in the big loading state if the empty state is what's currently showing —
    // don't yank away an already-visible video card just to show a central spinner.
    if ($empty.style.display !== 'none') {
        $empty.style.display = 'none';
        $emptyFetching.style.display = 'flex';
    }
    $url.value = '';
    $url.focus();
}

function handleFetchError(err) {
    const msg = err.message || 'Failed to fetch';
    addLog('Fetch failed: ' + msg, 'error');

    hideCard();
    hidePlaylist();
    $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies

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

    return item;
}

// Set by doFetch() to the id of the item it just queued, so the Fetch button's own
// spinner tracks that specific item's real completion (its actual network fetch, handled
// asynchronously below) instead of resetting the instant it's added to the queue.
let _fetchBtnWatchId = null;

function resolveFetchBtnWatch(id) {
    if (id !== _fetchBtnWatchId) return;
    _fetchBtnWatchId = null;
    $fetchBtn.disabled = false;
    $fetchBtn.textContent = 'Fetch';

    $emptyFetching.style.display = 'none';
    // If nothing else has taken over the main panel (e.g. no card got shown for this
    // fetch), fall back to the normal empty state instead of leaving a blank panel.
    if (!$card.classList.contains('visible') && !isPlaylistMode) {
        $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies
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
            resolveFetchBtnWatch(next.id);
            processFetchQueue();
            return;
        }

        next.status = 'ready';
        next.info = result.info;
        next.presets = result.presets;
        resolveFetchBtnWatch(next.id);

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
            resolveFetchBtnWatch(next.id);
            processFetchQueue();
            return;
        }

        next.status = 'error';
        next.error = err.message || 'Failed to fetch';
        resolveFetchBtnWatch(next.id);
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
            $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies
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
        .slice()
        .reverse() // most recently added shown first; processing order stays FIFO
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
                actionsHtml = `<button class="fp-item-remove" data-action="retry" data-id="${item.id}" title="Retry" aria-label="Retry">↻</button>`;
            }
            actionsHtml += `<button class="fp-item-remove" data-action="remove" data-id="${item.id}" title="Remove" aria-label="Remove">×</button>`;

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
    $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies
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
    if (!isPlaylistMode) $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies
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

    // Whether there's anything to actually show in the embed/preview area — an iframe
    // (live YouTube) or a direct <video> (progressive format available). Neither is
    // guaranteed: e.g. long/high-res YouTube videos and livestream VODs frequently have no
    // progressive (single muxed-file) format at all, so pickPreviewUrl() returns null.
    const showVideoArea = (dlIsLive && canIframeEmbed) || dlUsingPreviewVideo;

    if (dlIsLive) {
        // Duration keeps growing while the stream is live — the range slider has nothing
        // meaningful to seek within, so swap it for the embed + mark-in/mark-out flow.
        if (durEl) durEl.textContent = '';
        if (sliderWrap) sliderWrap.style.display = 'none';
        if (hint) {
            const key = canIframeEmbed ? 'dl.trim.liveHint' : 'dl.trim.liveNoPreview';
            hint.dataset.i18n = key; hint.textContent = t(key);
        }
    } else {
        if (durEl) durEl.textContent = dlTrimDuration > 0 ? `Duration: ${formatTime(dlTrimDuration)}` : '';
        if (sliderWrap) sliderWrap.style.display = 'flex';
        if (hint) {
            const key = dlUsingPreviewVideo ? 'dl.trim.hint' : 'dl.trim.noPreview';
            hint.dataset.i18n = key; hint.textContent = t(key);
        }
    }

    // The hint (explaining why there's no preview, if that's the case) must stay visible
    // even when there's no video/iframe to show — only the video area and the mark
    // buttons (which need a video to read the current time from) are conditional.
    if (embedTrim) embedTrim.style.display = 'flex';
    if (embedWrap) embedWrap.style.display = showVideoArea ? 'block' : 'none';
    const markRow = embedTrim ? embedTrim.querySelector('.dl-embed-mark-row') : null;
    if (markRow) markRow.style.display = showVideoArea ? 'flex' : 'none';

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
        + `<button class="trim-seg-remove" onclick="removeTrimSegment(this)" aria-label="Remove segment">×</button>`;
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

// Shared dual-range trim-slider logic for Download's live preview and Convert's local-file
// trim — same percent<->seconds conversion, clamp-to-not-cross-the-other-handle, and
// fill-bar sync, differing only in where the total duration comes from and what "seeking"
// means for that tab's preview. Returns the four handlers; each tab's global entry points
// (called from inline oninput= HTML attributes, so their names must stay stable) are thin
// wrappers around one shared instance.
function makeRangeTrimControls({ startId, endId, timeStartId, timeEndId, fillId, minGapPct, getDuration, onSeek }) {
    function onRangeStartInput() {
        const rangeStart = document.getElementById(startId);
        const rangeEnd = document.getElementById(endId);
        const start = document.getElementById(timeStartId);
        const duration = getDuration();
        if (!rangeStart || !rangeEnd || !duration) return;

        let s = parseFloat(rangeStart.value);
        const e = parseFloat(rangeEnd.value);
        if (s >= e) { rangeStart.value = e - minGapPct; s = parseFloat(rangeStart.value); }

        const seconds = (s / 100) * duration;
        if (start) start.value = formatTime(seconds);
        updateRangeFill();
        onSeek(seconds);
    }

    function onRangeEndInput() {
        const rangeStart = document.getElementById(startId);
        const rangeEnd = document.getElementById(endId);
        const end = document.getElementById(timeEndId);
        const duration = getDuration();
        if (!rangeStart || !rangeEnd || !duration) return;

        let e = parseFloat(rangeEnd.value);
        const s = parseFloat(rangeStart.value);
        if (e <= s) { rangeEnd.value = s + minGapPct; e = parseFloat(rangeEnd.value); }

        const seconds = (e / 100) * duration;
        if (end) end.value = formatTime(seconds);
        updateRangeFill();
        onSeek(seconds);
    }

    function onTimeInput() {
        const start = document.getElementById(timeStartId);
        const end = document.getElementById(timeEndId);
        const rangeStart = document.getElementById(startId);
        const rangeEnd = document.getElementById(endId);
        const duration = getDuration();
        if (!duration) return;

        const s = parseTimeSecs(start?.value);
        const e = parseTimeSecs(end?.value);
        if (s !== null && rangeStart) rangeStart.value = Math.min(100, (s / duration) * 100);
        if (e !== null && rangeEnd) rangeEnd.value = Math.min(100, (e / duration) * 100);
        updateRangeFill();
    }

    function updateRangeFill() {
        const rangeStart = document.getElementById(startId);
        const rangeEnd = document.getElementById(endId);
        const fill = document.getElementById(fillId);
        if (!rangeStart || !rangeEnd || !fill) return;
        const s = parseFloat(rangeStart.value);
        const e = parseFloat(rangeEnd.value);
        fill.style.left = s + '%';
        fill.style.width = (e - s) + '%';
    }

    return { onRangeStartInput, onRangeEndInput, onTimeInput, updateRangeFill };
}

const dlTrimControls = makeRangeTrimControls({
    startId: 'dlRangeStart', endId: 'dlRangeEnd', timeStartId: 'dlTrimStart', timeEndId: 'dlTrimEnd', fillId: 'dlRangeFill',
    minGapPct: 0.5,
    getDuration: () => dlTrimDuration,
    onSeek: (seconds) => seekPreviewVideo(seconds),
});
function onDlRangeStartInput() { dlTrimControls.onRangeStartInput(); }
function onDlRangeEndInput() { dlTrimControls.onRangeEndInput(); }
function onDlTimeInput() { dlTrimControls.onTimeInput(); }
function updateDlRangeFill() { dlTrimControls.updateRangeFill(); }

function openSourceInBrowser() {
    if (videoInfo?.webpage_url) {
        window.api.openExternal(videoInfo.webpage_url);
    }
}

// ── Converter trim ───────────────────────────────────────────────

// Dragging either handle also seeks the preview so you can hear/see the trim point,
// same as the Download tab's preview scrubbing.
const convertTrimControls = makeRangeTrimControls({
    startId: 'convertRangeStart', endId: 'convertRangeEnd', timeStartId: 'convertTrimStart', timeEndId: 'convertTrimEnd', fillId: 'convertRangeFill',
    minGapPct: 0.1,
    getDuration: () => document.getElementById('convertVideo')?.duration,
    onSeek: (seconds) => {
        const video = document.getElementById('convertVideo');
        if (video) video.currentTime = seconds;
    },
});
function onConvertRangeStartInput() { convertTrimControls.onRangeStartInput(); }
function onConvertRangeEndInput() { convertTrimControls.onRangeEndInput(); }
function onConvertTimeInput() { convertTrimControls.onTimeInput(); }
function updateConvertRangeFill() { convertTrimControls.updateRangeFill(); }

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
                    $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies
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

    // Render items — most recently added first; processing order stays FIFO
    $queueItems.innerHTML = items
        .slice()
        .reverse()
        .map((item) => queueItemHTML(item))
        .join('');
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
        actionsHTML = `<button class="q-item-remove" data-id="${item.id}" title="Remove" aria-label="Remove">×</button>`;
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
        const folderPath = escapeHtml(item.downloadPath || '');
        actionsHTML = `<button class="q-item-open-folder" data-path="${folderPath}" title="Open folder">Open folder</button><button class="q-item-remove" data-id="${item.id}" title="Remove" aria-label="Remove">×</button>`;
    } else if (item.state === 'failed') {
        const errText = escapeHtml(item.error || 'Failed');
        statusHTML = `<span class="q-item-status failed" title="${errText}">${errText}</span>`;
        actionsHTML = `<button class="q-item-retry" data-id="${item.id}" title="Retry">Retry</button><button class="q-item-remove" data-id="${item.id}" title="Remove" aria-label="Remove">×</button>`;
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
    el.querySelectorAll('.q-item-open-folder').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.api.openFolder(btn.dataset.path || undefined);
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

// Shared login/logout/status-UI shape for YouTube/Instagram/Vimeo — same check/act/render
// flow, differing only in which window.api methods back it, the DOM ids it updates, its
// signed-in i18n key, and whether logging in also clears the Fetch error banner (Vimeo's
// flow doesn't — it has no auth-error banner variant to clear, unlike YouTube/Instagram).
function makeAuthController({ label, statusId, actionBtnId, api, signedInI18nKey, clearErrorOnLogin, loginFailedMsg, logoutFailedMsg, getSignedIn, setSignedIn }) {
    async function login() {
        if (clearErrorOnLogin) hideError();
        addLog(`Opening ${label} sign-in...`, 'highlight');
        try {
            const success = await api.login();
            setSignedIn(success);
            updateUI();
            if (success) {
                addLog(`Signed in to ${label} ✓`, 'success');
            }
        } catch (e) {
            addLog(loginFailedMsg + e.message, 'error');
        }
    }

    async function logout() {
        try {
            await api.logout();
            setSignedIn(false);
            updateUI();
            addLog(`Signed out of ${label}`);
        } catch (e) {
            addLog(logoutFailedMsg + e.message, 'error');
        }
    }

    function updateUI() {
        const el = $(statusId);
        if (!el) return;
        const btn = $(actionBtnId);
        if (getSignedIn()) {
            el.innerHTML = `<span class="auth-signed-in">${escapeHtml(t(signedInI18nKey))}</span>`;
            btn.textContent = t('settings.signOut');
            btn.dataset.i18n = 'settings.signOut';
            btn.onclick = logout;
        } else {
            el.innerHTML = `<span class="auth-signed-out">${escapeHtml(t('settings.notSignedIn'))}</span>`;
            btn.textContent = t('settings.signIn');
            btn.dataset.i18n = 'settings.signIn';
            btn.onclick = login;
        }
    }

    return { login, logout, updateUI };
}

const youtubeAuth = makeAuthController({
    label: 'YouTube',
    statusId: 'authStatus',
    actionBtnId: 'authActionBtn',
    api: { login: window.api.login, logout: window.api.logout },
    signedInI18nKey: 'settings.yt.signedIn',
    clearErrorOnLogin: true,
    loginFailedMsg: 'Sign-in failed: ',
    logoutFailedMsg: 'Sign-out failed: ',
    getSignedIn: () => isSignedIn,
    setSignedIn: (v) => { isSignedIn = v; },
});
async function doLogin() { return youtubeAuth.login(); }
async function doLogout() { return youtubeAuth.logout(); }
function updateAuthUI() { youtubeAuth.updateUI(); }

// Instagram auth

function showInstaAuthError() {
    const text = isInstaSignedIn
        ? 'This collection requires Instagram sign-in. Your session may have expired. '
        : 'Instagram sign-in required to access saved collections. ';
    const btnLabel = isInstaSignedIn ? 'Sign in again' : 'Sign in to Instagram';
    $error.innerHTML = escapeHtml(text) + `<button class="auth-error-btn" onclick="doInstaLogin()">${btnLabel}</button>`;
    $error.classList.add('visible', 'auth-error');
}

const instaAuth = makeAuthController({
    label: 'Instagram',
    statusId: 'instaAuthStatus',
    actionBtnId: 'instaAuthActionBtn',
    api: { login: window.api.instaLogin, logout: window.api.instaLogout },
    signedInI18nKey: 'settings.insta.signedIn',
    clearErrorOnLogin: true,
    loginFailedMsg: 'Instagram sign-in failed: ',
    logoutFailedMsg: 'Instagram sign-out failed: ',
    getSignedIn: () => isInstaSignedIn,
    setSignedIn: (v) => { isInstaSignedIn = v; },
});
async function doInstaLogin() { return instaAuth.login(); }
async function doInstaLogout() { return instaAuth.logout(); }
function updateInstaAuthUI() { instaAuth.updateUI(); }

// Vimeo auth

const vimeoAuth = makeAuthController({
    label: 'Vimeo',
    statusId: 'vimeoAuthStatus',
    actionBtnId: 'vimeoAuthActionBtn',
    api: { login: window.api.vimeoLogin, logout: window.api.vimeoLogout },
    signedInI18nKey: 'settings.vimeo.signedIn',
    clearErrorOnLogin: false,
    loginFailedMsg: 'Vimeo sign-in failed: ',
    logoutFailedMsg: 'Vimeo sign-out failed: ',
    getSignedIn: () => isVimeoSignedIn,
    setSignedIn: (v) => { isVimeoSignedIn = v; },
});
async function doVimeoLogin() { return vimeoAuth.login(); }
async function doVimeoLogout() { return vimeoAuth.logout(); }
function updateVimeoAuthUI() { vimeoAuth.updateUI(); }

// Vimeo library import (via API, not scraping — see vimeoApi.js)

let vimeoLibraryItems = [];
let vimeoImportOffset = 0;

async function doSaveVimeoToken() {
    const token = ($('vimeoApiToken')?.value || '').trim();
    try {
        await window.api.saveVimeoToken(token);
        addLog(token ? 'Vimeo API token saved' : 'Vimeo API token cleared');
    } catch (e) {
        addLog('Failed to save Vimeo API token: ' + e.message, 'error');
    }
}

async function doFetchVimeoLibrary() {
    const btn = $('vimeoFetchLibraryBtn');
    const statusEl = $('vimeoLibraryStatus');
    btn.disabled = true;
    btn.textContent = t('settings.vimeo.fetching');

    try {
        const { items, total, manifestPath } = await window.api.fetchVimeoLibrary();
        vimeoLibraryItems = items;
        vimeoImportOffset = 0;

        statusEl.textContent = t('settings.vimeo.libraryFound')(total, manifestPath);
        addLog(`Vimeo library: ${total} videos found, manifest exported`, 'success');

        $('vimeoLibraryBatchRow').style.display = total > 0 ? 'flex' : 'none';
        $('vimeoLibraryBatchHint').style.display = total > 0 ? 'block' : 'none';
        updateVimeoImportBtn();
        showToast(`${total} video${total !== 1 ? 's' : ''} found`);
    } catch (e) {
        statusEl.textContent = '';
        addLog('Vimeo library fetch failed: ' + e.message, 'error');
        showToast(t('settings.vimeo.fetchFailed'), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = t('settings.vimeo.fetch');
        btn.dataset.i18n = 'settings.vimeo.fetch';
    }
}

function updateVimeoImportBtn() {
    const importBtn = $('vimeoImportBatchBtn');
    if (!importBtn) return;
    const remaining = vimeoLibraryItems.length - vimeoImportOffset;
    if (remaining <= 0) {
        importBtn.textContent = t('settings.vimeo.allImported');
        importBtn.disabled = true;
    } else {
        const size = Math.max(1, parseInt($('vimeoBatchSize')?.value, 10) || 20);
        importBtn.textContent = t('settings.vimeo.importNext')(Math.min(size, remaining), remaining);
        importBtn.disabled = false;
    }
}

async function doImportVimeoBatch() {
    const size = Math.max(1, parseInt($('vimeoBatchSize')?.value, 10) || 20);
    const chunk = vimeoLibraryItems.slice(vimeoImportOffset, vimeoImportOffset + size);
    if (!chunk.length) return;

    const importBtn = $('vimeoImportBatchBtn');
    importBtn.disabled = true;

    // Resolve a direct downloadable file link per video via the Vimeo API — yt-dlp's
    // Vimeo extractor is currently blocked by Vimeo's bot detection, so downloads for
    // library imports bypass it entirely (see directDownload.js).
    const items = [];
    let failed = 0;
    for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i];
        importBtn.textContent = t('settings.vimeo.resolving')(i + 1, chunk.length);
        try {
            const file = await window.api.getVimeoVideoFile(v.id);
            if (!file) {
                failed++;
                addLog(`No downloadable file for "${v.name}" (${v.id})`, 'error');
                continue;
            }
            items.push({
                url: v.link,
                title: v.displayTitle || v.name,
                thumbnail: null,
                directUrl: file.url,
            });
        } catch (e) {
            failed++;
            addLog(`Failed to resolve "${v.name}": ${e.message}`, 'error');
        }
    }

    vimeoImportOffset += chunk.length;

    if (items.length) {
        await window.api.queueAdd(items);
        addLog(`Added ${items.length} Vimeo video${items.length !== 1 ? 's' : ''} to queue`, 'highlight');
        showToast(`${items.length} added to queue`);
        switchTab('queue');
    }
    if (failed) {
        addLog(`${failed} video${failed !== 1 ? 's' : ''} could not be resolved`, 'error');
    }

    updateVimeoImportBtn();
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
        $('dlDestPath').textContent = newPath;
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
                    <button class="history-remove" data-id="${escapeHtml(id)}" data-ext="${escapeHtml(ext)}" title="Remove" aria-label="Remove">×</button>
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
        $empty.style.display = ''; // clear the inline override so the CSS class's `display:flex` (needed for centering) applies
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
        $('dlDestPath').textContent = dlPath || '-';
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

    try {
        isVimeoSignedIn = await window.api.checkVimeoAuth();
        updateVimeoAuthUI();
    } catch {}

    try {
        const token = await window.api.getVimeoToken();
        if (token) $('vimeoApiToken').value = token;
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

// Windows/Linux (and macOS if the Sparkle bridge failed to load): check-and-redirect only,
// no silent in-place install. A background auto-installer was tried on Squirrel.Mac/NSIS
// and failed unrecoverably for a real user; pointing people at the GitHub release page for
// a manual download always works. macOS's real path is showUpdateModal() below instead.
function showUpdateBanner() {
    const banner = $('updateBanner');
    if (!banner) return;
    if (!updateInfo || !updateInfo.hasUpdate) return;

    banner.innerHTML =
        `<span>${escapeHtml(t('update.newVersion'))} <strong>v${escapeHtml(updateInfo.latest)}</strong></span>` +
        `<button class="btn-sm" onclick="openExternal('${escapeHtml(updateInfo.url)}')">${escapeHtml(t('update.download'))}</button>` +
        `<button class="update-dismiss" onclick="dismissUpdateBanner()" title="${escapeHtml(t('update.dismiss'))}" aria-label="${escapeHtml(t('update.dismiss'))}">×</button>`;
    banner.classList.add('visible');
}

// macOS only. Sparkle's own native dialogs are suppressed by the bridge (see
// sparkleUpdater.js) so this shows bWeb's own modal instead — changelog, Skip This
// Version, Remind Me Later, and an "auto-install in the future" preference, closer to
// Sparkle's own standard UI than a plain banner.
//
// Sparkle already starts downloading the moment it finds an update (see
// showUpdateFoundWithAppcastItem's immediate SPUUserUpdateChoiceInstall reply in
// sparkle_bridge.mm) — there's no separate "start download" step to gate on our side, so
// "Install Update" either installs immediately (already downloaded) or just marks intent
// and shows live progress until the in-flight download finishes.
let pendingUpdate = null; // { version, releaseNotes, downloaded, installQueued }
let skippedUpdateVersion = null;
let autoInstallUpdates = false;
let currentAppVersion = '';

async function initUpdatePrefs() {
    try { skippedUpdateVersion = await window.api.getSkippedUpdateVersion(); } catch {}
    try { autoInstallUpdates = await window.api.getAutoInstallUpdates(); } catch {}
}

function handleSparkleEvent(event) {
    switch (event.type) {
        case 'update-available':
            if (!event.version || event.version === skippedUpdateVersion) return;
            pendingUpdate = { version: event.version, releaseNotes: event.releaseNotes || '', downloaded: false, installQueued: false };
            if (!autoInstallUpdates) showUpdateModal();
            break;
        case 'download-progress':
            updateModalInstallButton(event);
            break;
        case 'update-downloaded':
            if (event.version && event.version === skippedUpdateVersion) { pendingUpdate = null; return; }
            if (!pendingUpdate) pendingUpdate = { version: event.version || '', releaseNotes: '', downloaded: true, installQueued: false };
            else pendingUpdate.downloaded = true;
            if (autoInstallUpdates) {
                window.api.installSparkleUpdateOnQuit();
                return;
            }
            if (pendingUpdate.installQueued) installFromModal();
            else showUpdateModal();
            break;
        case 'update-not-available':
            pendingUpdate = null;
            hideUpdateModal();
            break;
        case 'error':
            addLog(`Update check failed: ${event.message || ''}`, 'error');
            break;
    }
}

function showUpdateModal() {
    if (!pendingUpdate) return;

    const subtitle = $('updateModalSubtitle');
    if (subtitle) subtitle.textContent = t('update.modalSubtitle')(pendingUpdate.version, currentAppVersion);
    const notes = $('updateModalNotes');
    if (notes) notes.innerHTML = formatReleaseNotes(pendingUpdate.releaseNotes);
    const checkbox = $('updateAutoInstallCheckbox');
    if (checkbox) checkbox.checked = autoInstallUpdates;
    updateModalInstallButton();

    const modal = $('updateModal');
    if (modal) modal.style.display = 'flex';
}

function hideUpdateModal() {
    const modal = $('updateModal');
    if (modal) modal.style.display = 'none';
}

function updateModalInstallButton(progressEvent) {
    const btn = $('updateModalInstallBtn');
    const progress = $('updateModalProgress');
    if (!btn || !pendingUpdate) return;

    if (pendingUpdate.downloaded) {
        btn.disabled = false;
        btn.textContent = t('update.install');
        if (progress) progress.style.display = 'none';
        return;
    }

    if (pendingUpdate.installQueued) {
        btn.disabled = true;
        btn.textContent = t('update.downloadingButton');
        if (progress) progress.style.display = 'flex';
        if (progressEvent && progressEvent.type === 'download-progress' && typeof progressEvent.percent === 'number') {
            const pct = Math.round(progressEvent.percent);
            const fill = $('updateModalProgressFill');
            const label = $('updateModalProgressLabel');
            if (fill) fill.style.width = `${pct}%`;
            if (label) label.textContent = t('update.downloadingPct')(pct);
        }
    } else {
        btn.disabled = false;
        btn.textContent = t('update.install');
        if (progress) progress.style.display = 'none';
    }
}

// Minimal, dependency-free formatting for our own release notes ("- " bullets and
// **bold** spans) — not a full markdown parser, our notes never need more than this.
function formatReleaseNotes(raw) {
    const text = (raw || '').trim();
    if (!text) return `<p>${escapeHtml(t('update.noReleaseNotes'))}</p>`;

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let html = '';
    let inList = false;
    for (const line of lines) {
        const isBullet = line.startsWith('- ');
        const content = escapeHtml(isBullet ? line.slice(2) : line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        if (isBullet) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${content}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            html += `<p>${content}</p>`;
        }
    }
    if (inList) html += '</ul>';
    return html;
}

async function installFromModal() {
    if (!pendingUpdate) return;
    if (pendingUpdate.downloaded) {
        const btn = $('updateModalInstallBtn');
        if (btn) { btn.disabled = true; btn.textContent = t('update.installing'); }
        await window.api.installSparkleUpdate();
        return;
    }
    pendingUpdate.installQueued = true;
    updateModalInstallButton();
}

function skipUpdateVersion() {
    if (!pendingUpdate) return;
    skippedUpdateVersion = pendingUpdate.version;
    window.api.setSkippedUpdateVersion(skippedUpdateVersion);
    pendingUpdate = null;
    hideUpdateModal();
}

function remindUpdateLater() {
    // pendingUpdate stays set on purpose — the next 'update-downloaded' (or the next
    // hourly automatic check, since Sparkle already has this staged) reopens the modal
    // instead of it vanishing for good.
    hideUpdateModal();
}

function onAutoInstallToggle(checkbox) {
    autoInstallUpdates = !!checkbox.checked;
    window.api.setAutoInstallUpdates(autoInstallUpdates);
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

        // macOS: the real answer streams in later via handleSparkleEvent (Sparkle's check
        // is async) — nothing to render from this immediate reply.
        if (result.sparkle) return;

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

    await initOnboarding();

    try {
        const dlPath = await window.api.getDownloadPath();
        $('dlDestPath').textContent = dlPath || '-';
    } catch {}

    try {
        const info = await window.api.getAppInfo();
        currentAppVersion = info.version;
        addLog(`v${info.version} · ${info.platform}/${info.arch} · dev:${info.devMode}`);
    } catch {}

    await initUpdatePrefs();

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

    try {
        isVimeoSignedIn = await window.api.checkVimeoAuth();
        if (isVimeoSignedIn) addLog('Vimeo: signed in ✓', 'success');
        updateVimeoAuthUI();
    } catch {}
}

// Human-readable label per format, used both for the progress-bar's "converting to X"
// indicator and anywhere else a format needs a display name instead of its raw value.
const CONVERT_FORMAT_LABELS = {
    mp4: 'MP4',
    mov: 'MOV',
    mp3: 'MP3',
    wav: 'WAV',
    m4a: 'M4A',
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
    hap: 'HAP',
    dnxhr: 'DNxHR',
};

let convertFormat = 'mp4';

function selectConvertFormat(value) {
    if (!value) return;
    convertFormat = value;

    document.querySelectorAll('#convertFormatGrid .convert-format-tile').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.format === value);
    });
    const triggerLabel = document.getElementById('convertFormatTriggerLabel');
    if (triggerLabel) triggerLabel.textContent = CONVERT_FORMAT_LABELS[value] || value.toUpperCase();
    closeAllFormatMenus();

    const lossyWarn = document.getElementById('convertLossyWarn');
    if (lossyWarn) lossyWarn.style.display = ['flac', 'wav'].includes(value) ? 'block' : 'none';
    const mezzanineWarn = document.getElementById('convertMezzanineWarn');
    if (mezzanineWarn) mezzanineWarn.style.display = value === 'dnxhr' ? 'block' : 'none';
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
        // Capped at 40% (was 60%) — at 60% the panel could squeeze the download
        // buttons out of view on smaller windows.
        const newH = Math.max(34, Math.min(window.innerHeight * 0.4, startH + delta));
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
    best:      { formatId: 'bestvideo+bestaudio/best', extractAudio: false, audioFormat: null },
    '4k':      { formatId: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]', extractAudio: false, audioFormat: null },
    '2k':      { formatId: 'bestvideo[height<=1440]+bestaudio/best[height<=1440]', extractAudio: false, audioFormat: null },
    '1080p':   { formatId: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]', extractAudio: false, audioFormat: null },
    // No re-encode: mkv container, straight stream copy of whatever the source served.
    // Not literal uncompressed lossless — just no extra quality loss on our side.
    lossless:  { formatId: 'bestvideo+bestaudio/best', extractAudio: false, audioFormat: null, noReencode: true },
    mp3:       { formatId: 'bestaudio/best', extractAudio: true,  audioFormat: 'mp3' },
    wav:       { formatId: 'bestaudio/best', extractAudio: true,  audioFormat: 'wav' },
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
    let urls = parseBatchUrls();
    if (!urls.length) return;

    const btn = document.getElementById('batchAddBtn');
    const origText = btn.textContent;
    btn.disabled = true;

    // A single pasted URL that's actually a playlist/showcase page (e.g. a Vimeo
    // showcase) gets expanded into its full list of video URLs before queuing,
    // so the user can paste one link instead of collecting every video URL by hand.
    if (urls.length === 1) {
        try {
            const isPlaylist = await window.api.detectPlaylist(urls[0]);
            if (isPlaylist) {
                btn.textContent = 'Expanding playlist…';
                const { items } = await window.api.fetchPlaylist(urls[0]);
                if (items && items.length) {
                    urls = items.map(i => i.webpage_url || i.url).filter(Boolean);
                    addLog(`Expanded playlist into ${urls.length} URL${urls.length !== 1 ? 's' : ''}`, 'highlight');
                }
            }
        } catch (e) {
            addLog('Playlist expansion failed: ' + e.message, 'error');
        }
    }

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
        noReencode: preset.noReencode || false,
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

// Convert tab — Image sub-view (batch image format conversion via sharp/ffmpeg, no trim,
// no percent-based progress — a single sharp/ffmpeg pass per file is fast enough that the
// same indeterminate-per-item bar as Compress/Watermark fits better than a numeric one).
let imageConvertItems = []; // [{ id, path, name, state: 'ready'|'converting'|'done'|'error' }]
let imageConvertItemIdCounter = 0;
let imageConvertRunning = false;
let imageConvertRenderedIds = new Set();
let imageConvertFormat = 'jpeg';

const IMAGE_CONVERT_FORMAT_LABELS = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF', tiff: 'TIFF', gif: 'GIF' };

// Convert tab — Document sub-view (Word/PowerPoint/Excel/OpenDocument/RTF/EPUB/CSV/PDF →
// Markdown via anydoc, or Office-only → PDF via minipdf). Unlike Image/Video, not every
// input can produce every output — "PDF" is only offered when the whole batch is
// docx/pptx/xlsx (see DOC_CONVERT_PDF_EXTS), everything else can only go to Markdown.
const DOC_CONVERT_PDF_EXTS = new Set(['docx', 'pptx', 'xlsx']);
let docConvertItems = []; // [{ id, path, name, ext, state: 'ready'|'converting'|'done'|'error' }]
let docConvertItemIdCounter = 0;
let docConvertRunning = false;
let docConvertRenderedIds = new Set();
let docConvertFormat = 'markdown';

const DOC_CONVERT_FORMAT_LABELS = { markdown: 'Markdown', pdf: 'PDF' };

// Compress tab — batch image compression via sharp (PDF/video to follow)
let compressItems = []; // { id, path, name, type, size, estimates: {max,balanced,small}|null, state, compressedSize }
let compressItemIdCounter = 0;
let compressPreset = 'balanced';
let compressMode = 'presets'; // 'presets' | 'target'
let compressRunning = false;

// No margin: the estimate re-encodes with the exact same function/params the real compression
// uses, so it's deterministic and already exactly matches the final result — a margin here
// only made the number less accurate (confirmed: it made a PDF preset that didn't actually
// grow the file look like it did).
function formatBytes(bytes) {
    // Decimal (1000-based), matching how macOS Finder / Windows Explorer report file sizes —
    // a 1024-based calculation labeled "MB" reads as "wrong" next to what Finder shows.
    if (bytes < 1000) return bytes + ' B';
    const units = ['KB', 'MB', 'GB'];
    let val = bytes / 1000;
    let i = 0;
    while (val >= 1000 && i < units.length - 1) {
        val /= 1000;
        i++;
    }
    return val.toFixed(val < 10 ? 2 : 1) + ' ' + units[i];
}

// Shared drag-and-drop wiring for every tool's drop zone — same dragover/dragleave/drop
// listener trio and drag-over class toggling, differing only in what happens with the
// dropped file paths. Guards against double-wiring the same element (initXTab() reruns on
// every tab switch) via an `_initialized` marker on the element itself.
// Returns true the first time a given element is wired (false on every later call, once
// already initialized) — some callers gate one-time-only setup of their own on this.
function wireDropZone(elId, onFiles) {
    const dropZone = document.getElementById(elId);
    if (!dropZone || dropZone._initialized) return false;
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
        onFiles(paths);
    });
    return true;
}

function initCompressTab() {
    loadCompressDestPath();
    loadCompressAutoOpen();
    wireDropZone('compressDropZone', addFilesToCompressList);
}

// Shared "load/choose destination path + auto-open toggle" shape for every processing
// tool's popover — same four functions, differing only in the window.api method prefix
// and the DOM ids they update (which match 1:1 with the prefix for every tool here).
function makeDestPathControls(prefix) {
    const destPathId = `${prefix}DestPath`;
    const folderNameId = `${prefix}DestFolderName`;
    const autoOpenCheckId = `${prefix}AutoOpenCheck`;

    async function loadDestPath() {
        const p = await window.api[`${prefix}GetDestPath`]();
        document.getElementById(destPathId).textContent = p || '-';
        setDestFolderLabel(folderNameId, p);
    }

    async function chooseDestPath() {
        const p = await window.api[`${prefix}ChooseDestPath`]();
        document.getElementById(destPathId).textContent = p || '-';
        setDestFolderLabel(folderNameId, p);
    }

    async function loadAutoOpen() {
        const enabled = await window.api[`${prefix}GetAutoOpen`]();
        document.getElementById(autoOpenCheckId).checked = !!enabled;
    }

    function onAutoOpenChange(checked) {
        window.api[`${prefix}SetAutoOpen`](checked);
    }

    return { loadDestPath, chooseDestPath, loadAutoOpen, onAutoOpenChange };
}

const compressDestControls = makeDestPathControls('compress');
async function loadCompressDestPath() { return compressDestControls.loadDestPath(); }
async function doChooseCompressDestPath() { return compressDestControls.chooseDestPath(); }
async function loadCompressAutoOpen() { return compressDestControls.loadAutoOpen(); }
function onCompressAutoOpenChange(checked) { return compressDestControls.onAutoOpenChange(checked); }

async function doCompressChooseFile() {
    const filePaths = await window.api.compressChooseFile();
    addFilesToCompressList(filePaths);
}

async function addFilesToCompressList(paths) {
    if (!paths || paths.length === 0) return;

    document.getElementById('compressDropZone').style.display = 'none';
    document.getElementById('compressListWrap').style.display = 'flex';
    document.querySelector('.convert-center-wrapper')?.classList.add('has-content');

    for (const p of paths) {
        const item = {
            id: ++compressItemIdCounter,
            path: p,
            name: p.split('/').pop(),
            type: null,
            size: 0,
            estimates: null,
            state: 'detecting',
        };
        compressItems.push(item);
        renderCompressList();

        const type = await window.api.compressDetectType(p);
        item.type = type;

        if (type !== 'image' && type !== 'pdf') {
            item.state = 'unsupported';
            renderCompressList();
            continue;
        }

        item.state = 'estimating';
        renderCompressList();
        updateCompressPresetsVisibility();

        try {
            const { originalSize, estimates } = await window.api.compressEstimate(p);
            item.size = originalSize;
            item.estimates = estimates;
            item.state = 'ready';
        } catch (err) {
            item.state = 'error';
            addLog(`Compress estimate failed for ${item.name}: ${err.message}`, 'error');
        }
        renderCompressList();
        updateCompressPresetsVisibility();
    }
}

function updateCompressPresetsVisibility() {
    const modeTabsEl = document.getElementById('compressModeTabs');
    const presetsEl = document.getElementById('compressPresets');
    const targetEl = document.getElementById('compressTargetWrap');
    const estimatingEl = document.getElementById('compressEstimating');
    const btn = document.getElementById('compressBtn');

    const readyItems = compressItems.filter((i) => i.state === 'ready' || i.state === 'done');
    const stillWorking = compressItems.some((i) => i.state === 'detecting' || i.state === 'estimating');
    const n = compressItems.filter((i) => i.state === 'ready').length;

    if (readyItems.length === 0) {
        modeTabsEl.style.display = 'none';
        presetsEl.style.display = 'none';
        targetEl.style.display = 'none';
        estimatingEl.style.display = stillWorking ? 'flex' : 'none';
        btn.disabled = true;
        return;
    }

    modeTabsEl.style.display = 'flex';
    estimatingEl.style.display = stillWorking ? 'flex' : 'none';

    if (compressMode === 'presets') {
        presetsEl.style.display = 'grid';
        targetEl.style.display = 'none';
        document.querySelectorAll('.compress-preset-card').forEach((c) => c.classList.toggle('disabled', stillWorking));
        renderCompressPresetTotals();
        btn.disabled = n === 0 || compressRunning;
    } else {
        presetsEl.style.display = 'none';
        targetEl.style.display = 'flex';
        const mb = parseFloat(document.getElementById('compressTargetMb').value);
        btn.disabled = n === 0 || compressRunning || !(mb > 0);
    }

    btn.textContent = t('compress.btn.n') ? t('compress.btn.n')(n) : `Compress ${n}`;
}

// Card positions ('max'/'balanced'/'small') represent a SIZE RANK, not a fixed underlying
// sharp/Ghostscript setting — verified directly that neither is guaranteed monotonic (PNG
// palette quantization AND Ghostscript's PDFSETTINGS presets can both produce a "higher
// quality" output that's smaller than a "lower quality" one, depending on file content). Ranking
// each file's own 3 estimates by actual size guarantees "Maximum quality" position always shows
// the biggest number and "Smallest file" position always shows the smallest, per file.
const COMPRESS_RANK_INDEX = { max: 0, balanced: 1, small: 2 };

function rankedPresetForItem(item, rankIndex) {
    if (!item.estimates) return null;
    const sorted = Object.entries(item.estimates).sort((a, b) => b[1] - a[1]);
    return sorted[rankIndex]; // [presetKey, size]
}

function renderCompressPresetTotals() {
    const readyItems = compressItems.filter((i) => i.estimates);
    for (const preset of ['max', 'balanced', 'small']) {
        const el = document.getElementById('compressSize' + preset.charAt(0).toUpperCase() + preset.slice(1));
        if (!el) continue;
        if (readyItems.length === 0) {
            el.textContent = '—';
            continue;
        }
        const idx = COMPRESS_RANK_INDEX[preset];
        const total = readyItems.reduce((sum, i) => sum + rankedPresetForItem(i, idx)[1], 0);
        el.textContent = formatBytes(total);
    }

    const totalLabel = document.getElementById('compressPresetTotalLabel');
    if (readyItems.length > 1) {
        totalLabel.textContent = t('compress.total.label') ? t('compress.total.label')(readyItems.length) : `Total for ${readyItems.length} files`;
        totalLabel.style.display = 'block';
    } else {
        totalLabel.style.display = 'none';
    }
}

function selectCompressPreset(preset) {
    compressPreset = preset;
    document.querySelectorAll('.compress-preset-card').forEach((c) => c.classList.toggle('selected', c.dataset.preset === preset));
    renderCompressList();
}

function setCompressMode(mode) {
    compressMode = mode;
    document.querySelectorAll('#compressModeTabs .dl-mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    updateCompressPresetsVisibility();
    renderCompressList();
}

function onCompressTargetInput() {
    updateCompressPresetsVisibility();
}

function compressStatusLabel(item) {
    switch (item.state) {
        case 'detecting':
        case 'estimating': return t('compress.estimating') || 'Calculating…';
        case 'unsupported': return t('compress.unsupported') || 'Unsupported';
        case 'pending': return t('compress.status.pending') || 'Pending';
        case 'compressing': return t('compress.status.compressing') || 'Compressing…';
        case 'done': return `${formatBytes(item.size)} → ${formatBytes(item.compressedSize)}`;
        case 'error': return t('compress.status.error') || 'Failed';
        case 'ready':
            // Presets mode: show what this specific file would become at the selected preset —
            // that's the number people actually want per-file, the total row above is just a bonus.
            if (compressMode === 'presets' && item.estimates) {
                const [, size] = rankedPresetForItem(item, COMPRESS_RANK_INDEX[compressPreset]);
                return `${formatBytes(item.size)} → ${formatBytes(size)}`;
            }
            return formatBytes(item.size);
        default: return '';
    }
}

const COMPRESS_BUSY_STATES = new Set(['detecting', 'estimating', 'compressing']);

// Tracks which item ids have already rendered once, so newly-added files get an entrance
// animation without re-triggering it on every status re-render (mirrors convertRenderedIds).
let compressRenderedIds = new Set();

// Shared list-rendering shape for Compress/Watermark's batch file lists — same markup,
// entrance-animation tracking, and progress-bar-if-busy logic, differing only in which
// items/state-check/status-label function backs them. Returns the new renderedIds set —
// callers reassign it to their own module-level tracking variable.
function renderBatchList({ listId, countId, items, renderedIds, isBusy, statusLabelFn, badgeCategoryFn }) {
    const list = document.getElementById(listId);
    const count = document.getElementById(countId);
    if (!list) return renderedIds;

    count.textContent = items.length ? `${items.length}` : '';

    const currentIds = new Set(items.map((i) => i.id));
    list.innerHTML = items.map((item) => {
        const isNew = !renderedIds.has(item.id);
        const progressBar = isBusy(item)
            ? `<div class="convert-batch-item-progress-track"><div class="convert-batch-item-progress-fill indeterminate"></div></div>`
            : '';
        const category = badgeCategoryFn ? badgeCategoryFn(item) : (item.type === 'pdf' ? 'pdf' : 'image');
        return `<div class="convert-batch-item convert-batch-item-${item.state}${isNew ? ' convert-batch-item-entering' : ''}" data-item-id="${item.id}">` +
            fileTypeBadgeHtml(item.name, category) +
            `<div class="convert-batch-item-info">` +
                `<span class="convert-batch-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>` +
                `<div class="convert-batch-item-meta">` +
                    `<span class="convert-batch-item-status">${escapeHtml(statusLabelFn(item))}</span>` +
                    progressBar +
                `</div>` +
            `</div>` +
        `</div>`;
    }).join('');
    return currentIds;
}

function renderCompressList() {
    compressRenderedIds = renderBatchList({
        listId: 'compressList',
        countId: 'compressListCount',
        items: compressItems,
        renderedIds: compressRenderedIds,
        isBusy: (item) => COMPRESS_BUSY_STATES.has(item.state),
        statusLabelFn: compressStatusLabel,
    });

    // Once every item is done/error/unsupported (nothing left pending or in flight), swap
    // the single Compress button for an explicit "Open folder" + "Compress another file"
    // pair — the batch no longer auto-clears itself, so there needs to be a clear way
    // forward instead of a dead-end disabled button.
    const finished = compressItems.length > 0 && !compressRunning && compressItems.every((i) =>
        i.state === 'done' || i.state === 'error' || i.state === 'unsupported'
    );
    const btn = document.getElementById('compressBtn');
    const doneActions = document.getElementById('compressDoneActions');
    if (btn) btn.style.display = finished ? 'none' : '';
    if (doneActions) doneActions.style.display = finished ? 'flex' : 'none';
}

function doCompressClear() {
    if (compressRunning) return;
    compressItems = [];
    compressRenderedIds.clear();
    compressPreset = 'balanced';
    compressMode = 'presets';

    document.getElementById('compressDropZone').style.display = 'flex';
    document.getElementById('compressListWrap').style.display = 'none';
    document.getElementById('compressModeTabs').style.display = 'none';
    document.getElementById('compressPresets').style.display = 'none';
    document.getElementById('compressTargetWrap').style.display = 'none';
    document.getElementById('compressEstimating').style.display = 'none';
    document.getElementById('compressTargetMb').value = '';
    document.getElementById('compressBtn').disabled = true;
    document.getElementById('compressBtn').textContent = t('compress.btn');
    document.getElementById('compressBtn').style.display = '';
    document.getElementById('compressDoneActions').style.display = 'none';
    document.querySelectorAll('.compress-preset-card').forEach((c) => c.classList.toggle('selected', c.dataset.preset === 'balanced'));
    document.querySelectorAll('#compressModeTabs .dl-mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'presets'));
    document.querySelector('.convert-center-wrapper')?.classList.remove('has-content');
}

async function doCompress() {
    let readyItems = compressItems.filter((i) => i.state === 'ready');
    if (readyItems.length === 0 || compressRunning) return;

    let targetBytes = null;
    if (compressMode === 'target') {
        const mb = parseFloat(document.getElementById('compressTargetMb').value);
        if (!(mb > 0)) return;
        targetBytes = mb * 1000 * 1000; // decimal MB, matching formatBytes/Finder convention

        // Target size is a continuous quality dial — only images support it. PDF only has
        // Ghostscript's 4 discrete presets, so it stays on the Presets tab.
        const skipped = readyItems.filter((i) => i.type !== 'image');
        skipped.forEach((i) => addLog(`Skipped ${i.name}: target size only supports images, not PDF`, 'error'));
        readyItems = readyItems.filter((i) => i.type === 'image');
        if (readyItems.length === 0) return;
    }

    compressRunning = true;
    const btn = document.getElementById('compressBtn');
    btn.disabled = true;

    for (const item of readyItems) {
        item.state = 'compressing';
        renderCompressList();
        try {
            const rawPreset = targetBytes ? null : rankedPresetForItem(item, COMPRESS_RANK_INDEX[compressPreset])[0];
            const result = targetBytes
                ? await window.api.compressRunTarget(item.path, targetBytes)
                : await window.api.compressRun(item.path, rawPreset);
            item.compressedSize = result.compressedSize;
            item.state = 'done';
            if (result.targetMissed) {
                addLog(`${item.name}: couldn't reach the target size — smallest possible is ${formatBytes(result.compressedSize)} (target was ${formatBytes(targetBytes)})`, 'error');
            } else {
                addLog(`Compressed: ${result.outputPath} (${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)})`);
            }
        } catch (err) {
            item.state = 'error';
            addLog(`Compress failed for ${item.name}: ${err.message}`, 'error');
        }
        renderCompressList();
    }

    compressRunning = false;
    renderCompressList();

    if (readyItems.some((i) => i.state === 'done') && document.getElementById('compressAutoOpenCheck').checked) {
        window.api.compressOpenDestFolder();
    }
}

// Privacy / Watermark tab — batch, images + PDF (PDF rasterized, see watermark.js)
let watermarkItems = [];
let watermarkItemIdCounter = 0;
let watermarkType = 'text';
let watermarkSize = 'medium';
let watermarkLogoPath = null;
let watermarkRunning = false;

function initPrivacyTab() {
    loadWatermarkDestPath();
    loadWatermarkAutoOpen();
    wireDropZone('watermarkDropZone', addFilesToWatermarkList);
    wireDropZone('redactDropZone', (paths) => {
        if (paths[0]) loadRedactFile(paths[0]);
    });
}

const watermarkDestControls = makeDestPathControls('watermark');
async function loadWatermarkDestPath() { return watermarkDestControls.loadDestPath(); }
async function doChooseWatermarkDestPath() { return watermarkDestControls.chooseDestPath(); }
async function loadWatermarkAutoOpen() { return watermarkDestControls.loadAutoOpen(); }
function onWatermarkAutoOpenChange(checked) { return watermarkDestControls.onAutoOpenChange(checked); }

async function doWatermarkChooseFile() {
    const filePaths = await window.api.watermarkChooseFile();
    addFilesToWatermarkList(filePaths);
}

async function addFilesToWatermarkList(paths) {
    if (!paths || paths.length === 0) return;

    document.getElementById('watermarkDropZone').style.display = 'none';
    document.getElementById('watermarkListWrap').style.display = 'flex';
    document.getElementById('watermarkOptions').style.display = 'flex';
    document.querySelector('#tab-privacy .convert-center-wrapper')?.classList.add('has-content');

    for (const p of paths) {
        const type = await window.api.watermarkDetectType(p);
        watermarkItems.push({
            id: ++watermarkItemIdCounter,
            path: p,
            name: p.split('/').pop(),
            type,
            state: (type === 'image' || type === 'pdf') ? 'ready' : 'unsupported',
        });
    }
    renderWatermarkList();
    onWatermarkOptionsChange();
}

function setWatermarkType(type) {
    watermarkType = type;
    document.querySelectorAll('#watermarkOptions [data-wmtype]').forEach((b) => b.classList.toggle('active', b.dataset.wmtype === type));
    document.getElementById('watermarkTextWrap').style.display = type === 'text' ? 'flex' : 'none';
    document.getElementById('watermarkLogoWrap').style.display = type === 'logo' ? 'flex' : 'none';
    onWatermarkOptionsChange();
    renderWatermarkPreview();
}

function setWatermarkSize(size) {
    watermarkSize = size;
    document.querySelectorAll('#watermarkOptions [data-wmsize]').forEach((b) => b.classList.toggle('active', b.dataset.wmsize === size));
    renderWatermarkPreview();
}

// Live preview of the actual tiling pattern (angle, spacing, size) that will be burned into the
// file — mirrors watermark.js's buildTile()/applyWatermarkToBuffer() closely enough to be a
// faithful sample, not just a decorative sketch. Pure canvas, no IPC round-trip needed.
const WM_PREVIEW_ANGLE = -30;
const WM_PREVIEW_SIZE_PRESETS = {
    small:  { width: 180, height: 100, fontSize: 15 },
    medium: { width: 280, height: 160, fontSize: 22 },
    large:  { width: 440, height: 250, fontSize: 34 },
};
let wmPreviewLogoImg = null;
let wmPreviewLogoPathLoaded = null;

function renderWatermarkPreview() {
    const canvas = document.getElementById('watermarkPreviewCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const preset = WM_PREVIEW_SIZE_PRESETS[watermarkSize] || WM_PREVIEW_SIZE_PRESETS.medium;
    // Scale is computed once from the LARGEST preset, not from whichever preset is currently
    // selected — computing it per-preset (against the same canvas-width target) made medium and
    // large both get clamped down to the exact same on-screen tile size, since both exceed the
    // cap. Sharing one scale factor preserves the real size difference between presets.
    const maxPresetWidth = WM_PREVIEW_SIZE_PRESETS.large.width;
    const scale = Math.min(1, (w / 2.2) / maxPresetWidth);
    let tileW = preset.width * scale;
    const tileH = preset.height * scale;
    const fontSize = preset.fontSize * scale;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#000';

    const text = (document.getElementById('watermarkText')?.value || 'CONFIDENTIEL').toUpperCase();
    if (watermarkType !== 'logo') {
        // Widen the tile to fit the actual measured text (real canvas measurement, more accurate
        // than the backend's character-count heuristic) — otherwise a long phrase overlaps its
        // own next repeat so badly it becomes unreadable (confirmed with a real multi-word
        // watermark). Capped, same rationale as watermark.js's MAX_TILE_WIDTH: beyond a point,
        // sparser repeats stop being useful and we'd rather the tile just not keep growing.
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        const measured = ctx.measureText(text).width;
        tileW = Math.max(tileW, measured + fontSize * 1.4);
        tileW = Math.min(tileW, 900 * scale); // mirrors watermark.js's MAX_TILE_WIDTH, scaled down to preview size
    }

    const cols = Math.ceil(w / tileW) + 1;
    const rows = Math.ceil(h / tileH) + 1;

    const drawTile = (drawOne) => {
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cx = col * tileW + tileW / 2;
                const cy = row * tileH + tileH / 2;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((WM_PREVIEW_ANGLE * Math.PI) / 180);
                drawOne();
                ctx.restore();
            }
        }
    };

    if (watermarkType === 'logo' && watermarkLogoPath) {
        if (wmPreviewLogoPathLoaded !== watermarkLogoPath) {
            wmPreviewLogoImg = new Image();
            wmPreviewLogoImg.onload = () => renderWatermarkPreview();
            wmPreviewLogoImg.src = `bweb-file://${encodeURIComponent(watermarkLogoPath)}`;
            wmPreviewLogoPathLoaded = watermarkLogoPath;
            return; // redraws once loaded
        }
        if (wmPreviewLogoImg && wmPreviewLogoImg.complete && wmPreviewLogoImg.naturalWidth) {
            const boxSize = Math.min(tileW, tileH) * 0.6;
            const ratio = wmPreviewLogoImg.naturalWidth / wmPreviewLogoImg.naturalHeight;
            const logoW = ratio >= 1 ? boxSize : boxSize * ratio;
            const logoH = ratio >= 1 ? boxSize / ratio : boxSize;
            ctx.globalAlpha = 0.35;
            drawTile(() => ctx.drawImage(wmPreviewLogoImg, -logoW / 2, -logoH / 2, logoW, logoH));
            ctx.globalAlpha = 1;
        }
    } else {
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = ink;
        drawTile(() => ctx.fillText(text, 0, 0));
        ctx.globalAlpha = 1;
    }
}

async function doWatermarkChooseLogo() {
    const p = await window.api.watermarkChooseLogo();
    if (p) {
        watermarkLogoPath = p;
        document.getElementById('watermarkLogoName').textContent = p.split('/').pop();
        // Same real-file preview mechanism already used for Background Remover's before/after
        // images — the app's own bweb-file:// protocol, not a data URL round-trip.
        const preview = document.getElementById('watermarkLogoPreview');
        preview.style.backgroundImage = `url(bweb-file://${encodeURIComponent(p)})`;
        preview.style.display = 'block';
        document.getElementById('watermarkLogoPickerIcon').style.display = 'none';
    }
    onWatermarkOptionsChange();
}

function onWatermarkOptionsChange() {
    renderWatermarkPreview();
    const btn = document.getElementById('watermarkBtn');
    const readyCount = watermarkItems.filter((i) => i.state === 'ready').length;
    const hasValidOptions = watermarkType === 'text'
        ? document.getElementById('watermarkText').value.trim().length > 0
        : !!watermarkLogoPath;

    btn.disabled = readyCount === 0 || !hasValidOptions || watermarkRunning;
    btn.textContent = t('watermark.btn.n') ? t('watermark.btn.n')(readyCount) : `Watermark ${readyCount}`;
}

function watermarkStatusLabel(item) {
    switch (item.state) {
        case 'unsupported': return t('watermark.unsupported') || 'Unsupported';
        case 'ready': return t('watermark.status.pending') || 'Pending';
        case 'watermarking': return t('watermark.status.watermarking') || 'Watermarking…';
        case 'done': return t('watermark.status.done') || '✓ Done';
        case 'error': return t('watermark.status.error') || 'Failed';
        default: return '';
    }
}

// Tracks which item ids have already rendered once, so newly-added files get an entrance
// animation without re-triggering it on every status re-render (mirrors convertRenderedIds).
let watermarkRenderedIds = new Set();

function renderWatermarkList() {
    watermarkRenderedIds = renderBatchList({
        listId: 'watermarkList',
        countId: 'watermarkListCount',
        items: watermarkItems,
        renderedIds: watermarkRenderedIds,
        isBusy: (item) => item.state === 'watermarking',
        statusLabelFn: watermarkStatusLabel,
    });
}

function doWatermarkClear() {
    if (watermarkRunning) return;
    watermarkItems = [];
    watermarkRenderedIds.clear();
    watermarkType = 'text';
    watermarkSize = 'medium';
    watermarkLogoPath = null;

    document.getElementById('watermarkDropZone').style.display = 'flex';
    document.getElementById('watermarkListWrap').style.display = 'none';
    document.getElementById('watermarkOptions').style.display = 'none';
    document.getElementById('watermarkText').value = '';
    document.getElementById('watermarkLogoName').textContent = t('watermark.logo.none');
    document.getElementById('watermarkLogoPreview').style.display = 'none';
    document.getElementById('watermarkLogoPreview').style.backgroundImage = '';
    document.getElementById('watermarkLogoPickerIcon').style.display = '';
    document.getElementById('watermarkBtn').disabled = true;
    document.getElementById('watermarkBtn').textContent = t('watermark.btn');
    document.querySelectorAll('#watermarkOptions [data-wmtype]').forEach((b) => b.classList.toggle('active', b.dataset.wmtype === 'text'));
    document.querySelectorAll('#watermarkOptions [data-wmsize]').forEach((b) => b.classList.toggle('active', b.dataset.wmsize === 'medium'));
    document.getElementById('watermarkTextWrap').style.display = 'flex';
    document.getElementById('watermarkLogoWrap').style.display = 'none';
    document.querySelector('#tab-privacy .convert-center-wrapper')?.classList.remove('has-content');
    wmPreviewLogoImg = null;
    wmPreviewLogoPathLoaded = null;
    const previewCanvas = document.getElementById('watermarkPreviewCanvas');
    if (previewCanvas) previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);
}

async function doWatermark() {
    const readyItems = watermarkItems.filter((i) => i.state === 'ready');
    if (readyItems.length === 0 || watermarkRunning) return;

    const options = watermarkType === 'text'
        ? { type: 'text', text: document.getElementById('watermarkText').value.trim(), size: watermarkSize }
        : { type: 'logo', logoPath: watermarkLogoPath, size: watermarkSize };

    watermarkRunning = true;
    const btn = document.getElementById('watermarkBtn');
    btn.disabled = true;

    for (const item of readyItems) {
        item.state = 'watermarking';
        renderWatermarkList();
        try {
            const result = await window.api.watermarkRun(item.path, options);
            item.state = 'done';
            addLog(`Watermarked: ${result.outputPath}`);
        } catch (err) {
            item.state = 'error';
            addLog(`Watermark failed for ${item.name}: ${err.message}`, 'error');
        }
        renderWatermarkList();
    }

    watermarkRunning = false;
    btn.disabled = false;
    btn.textContent = t('watermark.done') || 'Done ✓';

    if (readyItems.some((i) => i.state === 'done') && document.getElementById('watermarkAutoOpenCheck')?.checked) {
        window.api.watermarkOpenDestFolder();
    }

    setTimeout(() => { if (!watermarkRunning) doWatermarkClear(); }, 1800);
}

// Privacy / Redact tab — single file at a time, by design. Zones are drawn per-file against the
// exact pixels of that one file's preview; batching several unrelated files (the pattern used by
// Compress/Watermark) would either force the same zones onto images with different layouts, or
// require a separate zone-drawing pass per file anyway. A "choose another file" flow after
// finishing one file gets the repeat-usage benefit of batch without that mismatch.
let redactFilePath = null;
let redactFileType = null; // 'image' | 'pdf'
// PDF pages render live via pdf.js straight into a <canvas>, at whatever zoom scale the user
// picks — replaced a fixed-110-DPI Ghostscript rasterization that had no zoom at all, unusable
// for a high-resolution/detailed source PDF (e.g. cartography). redactPdfDoc is a pdf.js
// PDFDocumentProxy; redactPdfPageCount avoids an extra await just to read .numPages elsewhere.
let redactPdfDoc = null;
let redactPdfPageCount = 0;
let redactCurrentPage = 1;
let redactZoomScale = 1;        // 1 = "100%" (1 PDF point = 1 CSS px at the display's own pixel ratio)
let redactPdfRenderToken = 0;   // guards a slow render from clobbering a newer one (rapid zoom clicks)
// Each zone carries its OWN method/color/intensity, captured from the sidebar's current
// settings at the moment it's drawn — not a single global look applied to every zone. Changing
// the color or intensity afterward only affects zones drawn from then on, matching how a real
// annotation tool behaves (each mark keeps what it was made with) and letting a document have
// zones with different colors, per explicit user request.
let redactZones = [];      // { page, xPct, yPct, wPct, hPct, method, color, intensity }
// redactPen holds what NEW zones will be drawn with. redactMethod/Color/Intensity are what the
// sidebar currently DISPLAYS/EDITS — normally a mirror of redactPen, but temporarily overridden
// to mirror the SELECTED zone's own settings while editing one (see selectRedactZone). Keeping
// these separate means deselecting a zone restores the pen exactly as the user left it, instead
// of leaking whatever that zone happened to be set to.
let redactPen = { method: 'blackout', color: '#000000', intensity: 50 };
let redactMethod = redactPen.method;
let redactColor = redactPen.color;
let redactIntensity = redactPen.intensity; // 0-100, meaning depends on method (see intensityToBlur/intensityToBlocks)
let redactRunning = false;
let redactDraft = null;    // { startXPct, startYPct, el } — drawing a brand new zone
let redactSelectedZone = null; // the zone object currently selected for move/resize/edit, or null
let redactZoneDrag = null; // { zone, mode: 'move'|'resize', handle, rect, start: {xPct,yPct,wPct,hPct}, startMouse: {x,y} }
// Space-to-pan (the Photoshop/Figma convention) — held space swaps the zones-layer from
// "click-drag draws a new zone" to "click-drag scrolls the viewport", since those two gestures
// would otherwise collide on the exact same mousedown-drag. redactPanDrag holds the scroll
// position + pointer position at pan-start while a pan is actually in progress.
let redactSpaceHeld = false;
let redactPanDrag = null; // { startScrollLeft, startScrollTop, startX, startY }

function initPrivacyRedactTab() {
    const layer = document.getElementById('redactZonesLayer');
    if (!layer || layer._initialized) return;
    layer._initialized = true;

    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || redactFileType !== 'pdf' || document.activeElement?.matches?.('input, textarea')) return;
        e.preventDefault(); // stop the page from scrolling on space
        if (!redactSpaceHeld) {
            redactSpaceHeld = true;
            layer.classList.add('redact-zones-layer-pan');
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code !== 'Space') return;
        redactSpaceHeld = false;
        redactPanDrag = null;
        layer.classList.remove('redact-zones-layer-pan');
    });

    // Ctrl/Cmd+wheel (and trackpad pinch, which Chromium reports as a wheel event with
    // ctrlKey=true) zooms centered on the pointer; a plain wheel/trackpad scroll pans via the
    // browser's own native scrolling on #redactStageScroll — no handler needed for that half.
    document.getElementById('redactStageScroll')?.addEventListener('wheel', (e) => {
        if (!e.ctrlKey || redactFileType !== 'pdf') return;
        e.preventDefault();
        // Clamp deltaY first — a real mouse wheel notch is often ~100-120 and a trackpad pinch
        // can spike much higher for one event; without a cap either would jump several zoom
        // levels in a single tick instead of a smooth continuous feel.
        const clampedDelta = Math.max(-100, Math.min(100, e.deltaY));
        const factor = Math.exp(-clampedDelta * 0.0025);
        setRedactZoom(redactZoomScale * factor, { x: e.clientX, y: e.clientY });
    }, { passive: false });

    layer.addEventListener('mousedown', (e) => {
        if (redactRunning) return;
        if (redactSpaceHeld) {
            const scroll = document.getElementById('redactStageScroll');
            redactPanDrag = { startScrollLeft: scroll.scrollLeft, startScrollTop: scroll.scrollTop, startX: e.clientX, startY: e.clientY };
            return;
        }
        if (e.target !== layer) return;
        deselectRedactZone();
        const rect = layer.getBoundingClientRect();
        const startXPct = (e.clientX - rect.left) / rect.width;
        const startYPct = (e.clientY - rect.top) / rect.height;
        const el = document.createElement('div');
        el.className = 'redact-zone-draft';
        layer.appendChild(el);
        redactDraft = { startXPct, startYPct, el, rect };
    });

    layer.addEventListener('mousemove', (e) => {
        if (redactPanDrag) {
            const scroll = document.getElementById('redactStageScroll');
            scroll.scrollLeft = redactPanDrag.startScrollLeft - (e.clientX - redactPanDrag.startX);
            scroll.scrollTop = redactPanDrag.startScrollTop - (e.clientY - redactPanDrag.startY);
            return;
        }
        if (redactZoneDrag) {
            handleRedactZoneDragMove(e);
            return;
        }
        if (!redactDraft) return;
        const { startXPct, startYPct, el, rect } = redactDraft;
        const curXPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const curYPct = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        const x = Math.min(startXPct, curXPct);
        const y = Math.min(startYPct, curYPct);
        const w = Math.abs(curXPct - startXPct);
        const h = Math.abs(curYPct - startYPct);
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = `${w * 100}%`;
        el.style.height = `${h * 100}%`;
        redactDraft._last = { x, y, w, h };
    });

    const finishDraft = () => {
        if (redactPanDrag) {
            redactPanDrag = null;
            return;
        }
        if (redactZoneDrag) {
            const { zone, moved } = redactZoneDrag;
            redactZoneDrag = null;
            if (!moved) selectRedactZone(zone);
            else updateRedactButton(); // zone coordinates changed, nothing else did
            return;
        }
        if (!redactDraft) return;
        const { el, _last } = redactDraft;
        el.remove();
        redactDraft = null;
        // Ignore accidental clicks/micro-drags — require a real rectangle.
        if (_last && _last.w > 0.01 && _last.h > 0.01) {
            redactZones.push({
                page: redactCurrentPage, xPct: _last.x, yPct: _last.y, wPct: _last.w, hPct: _last.h,
                method: redactPen.method, color: redactPen.color, intensity: redactPen.intensity,
            });
            renderRedactZones();
            updateRedactButton();
        }
    };
    layer.addEventListener('mouseup', finishDraft);
    layer.addEventListener('mouseleave', finishDraft);
}

function setPrivacyMode(mode) {
    document.querySelectorAll('#tab-privacy > .dl-mode-tabs [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('privacyWatermarkView').style.display = mode === 'watermark' ? '' : 'none';
    document.getElementById('privacyRedactView').style.display = mode === 'redact' ? '' : 'none';
    document.getElementById('watermarkDestActions').style.display = mode === 'watermark' ? '' : 'none';
    document.getElementById('redactDestActions').style.display = mode === 'redact' ? '' : 'none';
    closeAllDestPopovers();
    if (mode === 'redact') {
        initPrivacyRedactTab();
        loadRedactDestPath();
        loadRedactAutoOpen();
    }
}

const redactDestControls = makeDestPathControls('redact');
async function loadRedactDestPath() { return redactDestControls.loadDestPath(); }
async function doChooseRedactDestPath() { return redactDestControls.chooseDestPath(); }
async function loadRedactAutoOpen() { return redactDestControls.loadAutoOpen(); }
function onRedactAutoOpenChange(checked) { return redactDestControls.onAutoOpenChange(checked); }

async function doRedactChooseFile() {
    const p = await window.api.redactChooseFile();
    if (p) loadRedactFile(p);
}

async function loadRedactFile(filePath) {
    const type = await window.api.redactDetectType(filePath);
    if (type !== 'image' && type !== 'pdf') {
        addLog(`Redact: unsupported file type for ${filePath.split('/').pop()}`, 'error');
        return;
    }

    redactFilePath = filePath;
    redactFileType = type;
    redactZones = [];
    redactCurrentPage = 1;
    redactPdfDoc = null;
    redactPdfPageCount = 0;
    redactZoomScale = 1;

    document.getElementById('redactDropZone').style.display = 'none';
    document.getElementById('redactEditorWrap').style.display = 'flex';
    document.getElementById('redactBtn').style.display = '';
    document.getElementById('redactFileName').textContent = filePath.split('/').pop();
    document.querySelector('#privacyRedactView .convert-center-wrapper')?.classList.add('has-content');

    const stage = document.getElementById('redactStage');
    const img = document.getElementById('redactStageImg');
    const canvas = document.getElementById('redactStageCanvas');

    if (type === 'pdf') {
        img.style.display = 'none';
        img.removeAttribute('src');
        canvas.style.display = 'block';
        stage.classList.add('redact-stage-zoom');
        document.getElementById('redactZoomControls').style.display = 'flex';
        addLog('Loading PDF…');
        try {
            redactPdfDoc = await window.pdfjsLib.getDocument({ url: `/__media/${encodeURIComponent(filePath)}` }).promise;
            redactPdfPageCount = redactPdfDoc.numPages;
        } catch (err) {
            addLog(`Redact: failed to load PDF — ${err.message}`, 'error');
            doRedactClear();
            return;
        }
        document.getElementById('redactPageNav').style.display = redactPdfPageCount > 1 ? 'flex' : 'none';
        await renderRedactPdfPage(true);
    } else {
        canvas.style.display = 'none';
        stage.classList.remove('redact-stage-zoom');
        document.getElementById('redactZoomControls').style.display = 'none';
        document.getElementById('redactPageNav').style.display = 'none';
        img.style.display = 'block';
        renderRedactStage();
    }
    updateRedactButton();
}

// Images only — PDF pages render via renderRedactPdfPage() (pdf.js + canvas) below.
function renderRedactStage() {
    const img = document.getElementById('redactStageImg');
    // Pixelate zones/swatch sample real pixels via canvas — re-render once the image has
    // actually decoded, not just when its src attribute is set.
    img.onload = () => { renderRedactZones(); renderRedactPenPreview(); };
    img.src = `bweb-file://${encodeURIComponent(redactFilePath)}`;
    renderRedactZones();
    renderRedactPenPreview();
}

// Renders the current PDF page into #redactStageCanvas at redactZoomScale via pdf.js — real
// vector rendering at whatever resolution the zoom level needs, not a fixed-DPI raster. Pass
// computeFit=true to (re)compute a "fit to the stage's available width" scale first (used on
// initial load, page change, and the explicit Fit button); zoom in/out reuse the current scale.
async function renderRedactPdfPage(computeFit) {
    if (!redactPdfDoc) return;
    const page = await redactPdfDoc.getPage(redactCurrentPage);
    const canvas = document.getElementById('redactStageCanvas');

    if (computeFit) {
        const naturalViewport = page.getViewport({ scale: 1 });
        const availableWidth = document.getElementById('redactStageScroll').clientWidth || naturalViewport.width;
        redactZoomScale = Math.min(2, availableWidth / naturalViewport.width) || 1;
    }

    // Rendered at the display's real device pixel ratio so zooming in on a high-resolution PDF
    // (the exact case this replaced a fixed-DPI rasterizer for) actually shows more detail
    // instead of an upscaled blur — canvas.width/height are the real backing-store pixels,
    // style.width/height is what CSS/layout (and the zone overlay's percentages) sees.
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: redactZoomScale * dpr });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.round(viewport.height / dpr)}px`;

    const myToken = ++redactPdfRenderToken;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (myToken !== redactPdfRenderToken) return; // a newer render started meanwhile — discard

    document.getElementById('redactPageLabel').textContent =
        (t('redact.page.of') ? t('redact.page.of')(redactCurrentPage, redactPdfPageCount) : `Page ${redactCurrentPage} of ${redactPdfPageCount}`);
    document.getElementById('redactZoomLabel').textContent = `${Math.round(redactZoomScale * 100)}%`;

    renderRedactZones();
    renderRedactPenPreview();
}

const REDACT_ZOOM_STEP = 1.25;
const REDACT_ZOOM_MIN = 0.25;
const REDACT_ZOOM_MAX = 4;
const REDACT_ZOOM_DEBOUNCE_MS = 180;
let redactZoomRenderTimer = null;

// Zooming used to feel "mechanical" because every step waited on a full pdf.js re-render (a real
// decode+paint, a few hundred ms on a detailed page) before anything on screen moved. Real map/
// design tools (Google Maps, Figma) fake instant feedback with a CSS transform on the existing
// canvas first, then swap in a freshly rendered, crisp bitmap once things settle — same trick
// here. `cursorPoint` (viewport {x,y}, e.g. from a wheel event) keeps whatever's under the
// pointer visually fixed while scaling instead of always zooming toward the top-left corner,
// which is what actually reads as "natural" vs "mechanical" for this kind of interaction.
function setRedactZoom(newScale, cursorPoint) {
    newScale = Math.max(REDACT_ZOOM_MIN, Math.min(REDACT_ZOOM_MAX, newScale));
    if (newScale === redactZoomScale) return;

    const canvas = document.getElementById('redactStageCanvas');
    const scroll = document.getElementById('redactStageScroll');
    if (!canvas || !scroll) return;
    const scrollRect = scroll.getBoundingClientRect();
    const viewportX = cursorPoint ? cursorPoint.x - scrollRect.left : scroll.clientWidth / 2;
    const viewportY = cursorPoint ? cursorPoint.y - scrollRect.top : scroll.clientHeight / 2;
    const anchorX = scroll.scrollLeft + viewportX;
    const anchorY = scroll.scrollTop + viewportY;

    const ratio = newScale / redactZoomScale;
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `scale(${ratio})`;
    scroll.scrollLeft = anchorX * ratio - viewportX;
    scroll.scrollTop = anchorY * ratio - viewportY;

    redactZoomScale = newScale;
    document.getElementById('redactZoomLabel').textContent = `${Math.round(newScale * 100)}%`;

    clearTimeout(redactZoomRenderTimer);
    redactZoomRenderTimer = setTimeout(() => {
        canvas.style.transform = '';
        renderRedactPdfPage(false);
    }, REDACT_ZOOM_DEBOUNCE_MS);
}

function redactZoomIn() {
    setRedactZoom(redactZoomScale * REDACT_ZOOM_STEP);
}

function redactZoomOut() {
    setRedactZoom(redactZoomScale / REDACT_ZOOM_STEP);
}

function redactZoomFit() {
    clearTimeout(redactZoomRenderTimer);
    const canvas = document.getElementById('redactStageCanvas');
    if (canvas) canvas.style.transform = '';
    renderRedactPdfPage(true);
}

function redactPrevPage() {
    if (redactCurrentPage <= 1) return;
    redactCurrentPage--;
    renderRedactPdfPage(false);
}

function redactNextPage() {
    if (redactCurrentPage >= redactPdfPageCount) return;
    redactCurrentPage++;
    renderRedactPdfPage(false);
}

// Intensity is a single 0-100 slider whose meaning depends on the method — kept in sync with
// the exact same mapping used server-side (redact.js) so the live preview matches the real
// output, not just an approximation of "more/less".
function intensityToBlurPx(intensity) {
    return 2 + (intensity / 100) * 38; // 2-40px
}

function intensityToBlockCount(intensity) {
    // Blocks ACROSS the zone's short side — fewer blocks = coarser/more destructive pixelation.
    return Math.round(30 - (intensity / 100) * 26); // 30 (fine) down to 4 (very blocky)
}

const RESIZE_HANDLES = ['nw', 'ne', 'sw', 'se'];

// Renders each zone showing the ACTUAL method/color/intensity it was drawn with — not just an
// outline — so what's on screen is a real preview, not a placeholder. blackout is a solid fill;
// blur uses a real CSS backdrop-filter over the image underneath (the closest thing to the real
// sharp blur without an IPC round-trip); pixelate draws a small canvas sampling the real image
// pixels under the zone, downscaled then upscaled with `image-rendering: pixelated` — the
// browser does the hard-edged upscale for us, same visual result as the backend's
// downscale+nearest-neighbor-upscale approach. Each zone uses ITS OWN stored settings, captured
// when it was drawn — not the sidebar's current settings — so changing color/intensity/method
// afterward doesn't retroactively repaint zones already on the page (unless that zone is the
// one currently SELECTED — see selectRedactZone). Clicking a zone selects it (for move/resize/
// edit) rather than deleting it outright — deletion is now a deliberate button, not a stray
// click, after feedback that click-to-delete destroyed careful placement too easily.
function renderRedactZones() {
    const layer = document.getElementById('redactZonesLayer');
    // Pixelate zones sample real pixels from whichever element is actually showing content —
    // the <img> for a plain image, or the pdf.js-rendered <canvas> for a PDF page. drawImage()
    // accepts either as a source; naturalWidth/naturalHeight isn't meaningful on a canvas, so
    // width/height (its real backing-store pixel size) is used there instead.
    const stageEl = redactFileType === 'pdf'
        ? document.getElementById('redactStageCanvas')
        : document.getElementById('redactStageImg');
    const stageW = redactFileType === 'pdf' ? stageEl?.width : stageEl?.naturalWidth;
    const stageH = redactFileType === 'pdf' ? stageEl?.height : stageEl?.naturalHeight;
    if (!layer) return;
    layer.innerHTML = '';
    redactZones
        .filter((z) => z.page === redactCurrentPage)
        .forEach((zone) => {
            const method = zone.method || 'blackout';
            const el = document.createElement('div');
            el.className = `redact-zone redact-zone-${method}`;
            if (zone === redactSelectedZone) el.classList.add('selected');
            el.style.left = `${zone.xPct * 100}%`;
            el.style.top = `${zone.yPct * 100}%`;
            el.style.width = `${zone.wPct * 100}%`;
            el.style.height = `${zone.hPct * 100}%`;
            el.title = t('redact.zone.select') || 'Click to select — drag to move';

            if (method === 'blackout') {
                el.style.background = zone.color || '#000000';
            } else if (method === 'blur') {
                const blurPx = intensityToBlurPx(zone.intensity ?? 50);
                el.style.backdropFilter = `blur(${blurPx}px)`;
                el.style.webkitBackdropFilter = `blur(${blurPx}px)`;
            } else if (method === 'pixelate' && stageEl && stageW) {
                const sx = zone.xPct * stageW;
                const sy = zone.yPct * stageH;
                const sw = zone.wPct * stageW;
                const sh = zone.hPct * stageH;
                const blocks = intensityToBlockCount(zone.intensity ?? 50);
                const canvas = document.createElement('canvas');
                canvas.width = blocks;
                canvas.height = Math.max(1, Math.round(blocks * (sh / sw)));
                canvas.className = 'redact-zone-pixelate-canvas';
                const cctx = canvas.getContext('2d');
                try {
                    cctx.drawImage(stageEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                    el.appendChild(canvas);
                } catch { /* canvas draw can throw before the source has decoded/rendered — next render catches it */ }
            }

            const del = document.createElement('span');
            del.className = 'redact-zone-delete';
            del.textContent = '×';
            del.title = t('redact.zone.remove') || 'Delete zone';
            // Not a <button> because it's absolutely positioned inside a drag/resize zone
            // overlay — role="button" + tabindex + a keydown handler give it the same
            // accessible name/keyboard behavior without restyling the drag geometry.
            del.setAttribute('role', 'button');
            del.setAttribute('tabindex', '0');
            del.setAttribute('aria-label', t('redact.zone.remove') || 'Delete zone');
            const deleteZone = (e) => {
                e.stopPropagation();
                redactZones.splice(redactZones.indexOf(zone), 1);
                if (redactSelectedZone === zone) deselectRedactZone();
                renderRedactZones();
                updateRedactButton();
            };
            del.addEventListener('mousedown', (e) => e.stopPropagation());
            del.addEventListener('click', deleteZone);
            del.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') deleteZone(e);
            });
            el.appendChild(del);

            if (zone === redactSelectedZone) {
                RESIZE_HANDLES.forEach((handle) => {
                    const h = document.createElement('span');
                    h.className = `redact-zone-handle redact-zone-handle-${handle}`;
                    h.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        startRedactZoneDrag(e, zone, 'resize', handle);
                    });
                    el.appendChild(h);
                });
            }

            // Body drag = move; a real drag (beyond a few px) moves the zone, a plain click
            // (no meaningful movement) selects it instead — same click-vs-drag distinction used
            // for drawing a brand new zone.
            el.addEventListener('mousedown', (e) => {
                if (e.target !== el) return; // handles/delete button already stopped propagation
                startRedactZoneDrag(e, zone, 'move');
            });
            layer.appendChild(el);
        });
}

function startRedactZoneDrag(e, zone, mode, handle) {
    const layer = document.getElementById('redactZonesLayer');
    const rect = layer.getBoundingClientRect();
    redactZoneDrag = {
        zone, mode, handle, rect,
        start: { xPct: zone.xPct, yPct: zone.yPct, wPct: zone.wPct, hPct: zone.hPct },
        startMouse: { x: e.clientX, y: e.clientY },
        moved: false,
    };
}

function handleRedactZoneDragMove(e) {
    const drag = redactZoneDrag;
    const { zone, mode, handle, rect, start, startMouse } = drag;
    const dxPct = (e.clientX - startMouse.x) / rect.width;
    const dyPct = (e.clientY - startMouse.y) / rect.height;
    if (Math.abs(dxPct) > 0.003 || Math.abs(dyPct) > 0.003) drag.moved = true;
    if (!drag.moved) return;

    const MIN = 0.02;
    if (mode === 'move') {
        zone.xPct = Math.min(Math.max(0, start.xPct + dxPct), 1 - start.wPct);
        zone.yPct = Math.min(Math.max(0, start.yPct + dyPct), 1 - start.hPct);
    } else {
        // Resize from whichever corner was grabbed — the OPPOSITE corner stays fixed.
        let left = start.xPct, top = start.yPct, right = start.xPct + start.wPct, bottom = start.yPct + start.hPct;
        if (handle.includes('w')) left = Math.min(right - MIN, Math.max(0, start.xPct + dxPct));
        if (handle.includes('e')) right = Math.max(left + MIN, Math.min(1, right + dxPct));
        if (handle.includes('n')) top = Math.min(bottom - MIN, Math.max(0, start.yPct + dyPct));
        if (handle.includes('s')) bottom = Math.max(top + MIN, Math.min(1, bottom + dyPct));
        zone.xPct = left;
        zone.yPct = top;
        zone.wPct = right - left;
        zone.hPct = bottom - top;
    }
    renderRedactZones();
}

// The sidebar's Method/Color/Intensity controls double as a "properties panel": with a zone
// selected, they edit THAT zone; with nothing selected, they set the pen new zones will be
// drawn with. This reuses one UI surface instead of building a second one just for editing.
function selectRedactZone(zone) {
    redactSelectedZone = zone;
    redactMethod = zone.method || 'blackout';
    redactColor = zone.color || '#000000';
    redactIntensity = zone.intensity ?? 50;
    syncRedactSidebarToCurrentSettings();
    renderRedactZones();
    renderRedactPenPreview();
}

function deselectRedactZone() {
    if (!redactSelectedZone) return;
    redactSelectedZone = null;
    redactMethod = redactPen.method;
    redactColor = redactPen.color;
    redactIntensity = redactPen.intensity;
    syncRedactSidebarToCurrentSettings();
    renderRedactZones();
    renderRedactPenPreview();
}

function syncRedactSidebarToCurrentSettings() {
    document.querySelectorAll('#privacyRedactView [data-rmethod]').forEach((b) => b.classList.toggle('active', b.dataset.rmethod === redactMethod));
    document.getElementById('redactColorRow').style.display = redactMethod === 'blackout' ? 'flex' : 'none';
    document.getElementById('redactIntensityRow').style.display = redactMethod === 'blackout' ? 'none' : 'flex';
    document.getElementById('redactColorInput').value = redactColor;
    document.getElementById('redactIntensityInput').value = redactIntensity;
    const banner = document.getElementById('redactZoneEditingBanner');
    if (banner) banner.style.display = redactSelectedZone ? 'flex' : 'none';
    const previewLabel = document.getElementById('redactPenPreviewLabel');
    if (previewLabel) {
        previewLabel.textContent = redactSelectedZone
            ? (t('redact.preview.selected') || 'Selected zone preview')
            : (t('redact.preview.label') || 'New zone preview');
    }
}

function deleteSelectedRedactZone() {
    if (!redactSelectedZone) return;
    redactZones.splice(redactZones.indexOf(redactSelectedZone), 1);
    deselectRedactZone();
    updateRedactButton();
}

function setRedactMethod(method) {
    redactMethod = method;
    document.querySelectorAll('#privacyRedactView [data-rmethod]').forEach((b) => b.classList.toggle('active', b.dataset.rmethod === method));
    document.getElementById('redactColorRow').style.display = method === 'blackout' ? 'flex' : 'none';
    document.getElementById('redactIntensityRow').style.display = method === 'blackout' ? 'none' : 'flex';
    if (redactSelectedZone) {
        redactSelectedZone.method = method;
        renderRedactZones();
    } else {
        redactPen.method = method;
    }
    renderRedactPenPreview();
}

function setRedactColor(value) {
    redactColor = value;
    if (redactSelectedZone) {
        redactSelectedZone.color = value;
        renderRedactZones();
    } else {
        redactPen.color = value;
    }
    renderRedactPenPreview();
}

function setRedactIntensity(value) {
    redactIntensity = Number(value);
    if (redactSelectedZone) {
        redactSelectedZone.intensity = redactIntensity;
        renderRedactZones();
    } else {
        redactPen.intensity = redactIntensity;
    }
    renderRedactPenPreview();
}

// A compact swatch showing what a NEW zone would look like with the current pen settings —
// zones already on the page keep their own look (see redactZones), so this is the only place
// a method/color/intensity change is reflected live before you actually draw with it.
function renderRedactPenPreview() {
    const swatch = document.getElementById('redactPenPreview');
    if (!swatch) return;
    swatch.innerHTML = '';
    swatch.style.background = '';
    const img = document.getElementById('redactStageImg');

    if (redactMethod === 'blackout') {
        swatch.style.background = redactColor;
    } else if (redactMethod === 'blur' && img && img.naturalWidth) {
        const sample = document.createElement('img');
        sample.src = img.src;
        sample.className = 'redact-pen-preview-sample';
        sample.style.filter = `blur(${intensityToBlurPx(redactIntensity) / 3}px)`;
        swatch.appendChild(sample);
    } else if (redactMethod === 'pixelate' && img && img.naturalWidth) {
        const blocks = intensityToBlockCount(redactIntensity);
        const canvas = document.createElement('canvas');
        canvas.width = blocks;
        canvas.height = blocks;
        canvas.className = 'redact-zone-pixelate-canvas';
        const cctx = canvas.getContext('2d');
        const cropSize = Math.min(img.naturalWidth, img.naturalHeight) * 0.3;
        try {
            cctx.drawImage(img, img.naturalWidth * 0.15, img.naturalHeight * 0.15, cropSize, cropSize, 0, 0, blocks, blocks);
            swatch.appendChild(canvas);
        } catch { /* image not decoded yet — next call catches it */ }
    }
}

function updateRedactButton() {
    const btn = document.getElementById('redactBtn');
    if (!btn) return;
    const count = redactZones.length;
    btn.disabled = count === 0 || redactRunning;
    btn.textContent = count > 0 && t('redact.btn.n') ? t('redact.btn.n')(count) : (t('redact.btn') || 'Apply redaction');
    const counter = document.getElementById('redactZoneCount');
    if (counter) counter.textContent = count ? (t('redact.zones.count') ? t('redact.zones.count')(count) : `${count} zone(s) marked`) : '';
}

function doRedactClear() {
    if (redactRunning) return;
    redactFilePath = null;
    redactFileType = null;
    redactPdfDoc = null;
    redactPdfPageCount = 0;
    redactCurrentPage = 1;
    redactZoomScale = 1;
    redactZones = [];
    redactSelectedZone = null;
    redactZoneDrag = null;
    redactPen = { method: 'blackout', color: '#000000', intensity: 50 };
    redactMethod = redactPen.method;
    redactColor = redactPen.color;
    redactIntensity = redactPen.intensity;

    document.getElementById('redactDropZone').style.display = 'flex';
    document.getElementById('redactEditorWrap').style.display = 'none';
    document.getElementById('redactBtn').style.display = 'none';
    document.getElementById('redactBtn').disabled = true;
    document.getElementById('redactBtn').textContent = t('redact.btn') || 'Apply redaction';
    document.getElementById('redactZonesLayer').innerHTML = '';
    document.getElementById('redactStageImg').removeAttribute('src');
    document.getElementById('redactPageNav').style.display = 'none';
    document.getElementById('redactZoomControls').style.display = 'none';
    document.getElementById('redactStage').classList.remove('redact-stage-zoom');
    document.querySelectorAll('#privacyRedactView [data-rmethod]').forEach((b) => b.classList.toggle('active', b.dataset.rmethod === 'blackout'));
    const colorInput = document.getElementById('redactColorInput');
    if (colorInput) colorInput.value = '#000000';
    const intensityInput = document.getElementById('redactIntensityInput');
    if (intensityInput) intensityInput.value = 50;
    document.getElementById('redactColorRow').style.display = 'flex';
    document.getElementById('redactIntensityRow').style.display = 'none';
    document.querySelector('#privacyRedactView .convert-center-wrapper')?.classList.remove('has-content');
}

async function doRedact() {
    if (redactZones.length === 0 || redactRunning || !redactFilePath) return;

    redactRunning = true;
    const btn = document.getElementById('redactBtn');
    btn.disabled = true;
    btn.textContent = t('redact.running') || 'Redacting…';

    try {
        const result = await window.api.redactRun(redactFilePath, redactZones);
        addLog(`Redacted: ${result.outputPath}`);
        btn.textContent = t('redact.done') || 'Done ✓';
        if (document.getElementById('redactAutoOpenCheck')?.checked) window.api.redactOpenDestFolder();
        setTimeout(() => { if (!redactRunning) doRedactClear(); }, 1800);
    } catch (err) {
        addLog(`Redact failed: ${err.message}`, 'error');
        btn.textContent = t('redact.error') || 'Redaction failed';
        btn.disabled = false;
    } finally {
        redactRunning = false;
    }
}

function setConvertMode(mode) {
    document.querySelectorAll('#tab-convert > .dl-mode-tabs [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('convertVideoView').style.display = mode === 'video' ? '' : 'none';
    document.getElementById('convertImageView').style.display = mode === 'image' ? '' : 'none';
    document.getElementById('convertDocumentView').style.display = mode === 'document' ? '' : 'none';
}

function initConvertTab() {
    loadConvertDestPath();
    loadConvertAutoOpen();
    wireDropZone('imgConvertDropZone', addFilesToImageConvertList);
    wireDropZone('docConvertDropZone', addFilesToDocConvertList);
    if (!wireDropZone('convertDropZone', addFilesToConvertList)) return;

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

    let removed = false;
    const finishRemoval = () => {
        if (removed) return;
        removed = true;
        convertItems = convertItems.filter((i) => i.id !== id);
        convertRenderedIds.delete(id);

        if (convertItems.length === 0) {
            doConvertClear();
            return;
        }
        if (convertItems.length === 1) {
            loadConvertPreview(convertItems[0].path);
        }
        renderConvertList();
    };

    // Animate the row shrinking away before actually removing it from state — a plain
    // instant list re-render on delete feels abrupt; respects prefers-reduced-motion via
    // the global rule that collapses all transition durations to ~0.
    const el = document.querySelector(`.convert-batch-item[data-item-id="${id}"]`);
    if (el) {
        el.classList.add('convert-batch-item-leaving');
        el.addEventListener('transitionend', finishRemoval, { once: true });
        // Safety net: if the transition never fires (e.g. element detached mid-animation),
        // don't leave the item stuck forever.
        setTimeout(finishRemoval, 400);
    } else {
        finishRemoval();
    }
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
    if (btn) { btn.textContent = t('convert.btn'); btn.disabled = true; btn.style.display = ''; }
    const doneActions = document.getElementById('convertDoneActions');
    if (doneActions) doneActions.style.display = 'none';
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }

    closeConvertTrim();
    clearConvertTrim();
    document.querySelector('.convert-center-wrapper')?.classList.remove('has-content');
}

const CONVERT_AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'opus', 'ogg']);

// File-type badge shown per row — a small colored square with the extension, color-coded
// by category. Shared by Convert (video/audio) and Compress/Watermark (image/pdf).
function fileTypeBadgeHtml(name, category) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return `<div class="file-type-badge file-type-${category}">${escapeHtml(ext.slice(0, 4).toUpperCase())}</div>`;
}

// Tracks which item ids have already been rendered at least once, so a fresh file gets a
// real entrance animation while an in-place status/progress update on an existing row
// doesn't keep re-triggering it on every render (renderConvertList runs on every progress
// tick — a naive "always animate" would look like constant flickering, not motion).
let convertRenderedIds = new Set();

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

    // Once every item is done/error/cancelled (nothing left pending or converting), swap
    // the single Convert button for an explicit "Open folder" + "Convert another file" pair.
    const finished = convertItems.length > 0 && !convertRunning && convertItems.every((i) =>
        i.state === 'done' || i.state === 'error' || i.state === 'cancelled'
    );
    const doneActions = document.getElementById('convertDoneActions');
    if (btn) btn.style.display = finished ? 'none' : '';
    if (doneActions) doneActions.style.display = finished ? 'flex' : 'none';

    const cancelBtn = document.getElementById('convertCancelBtn');
    if (cancelBtn) cancelBtn.style.display = convertRunning ? 'inline' : 'none';

    if (trimToggleWrap) trimToggleWrap.style.display = convertItems.length === 1 ? 'flex' : 'none';

    const currentIds = new Set(convertItems.map((i) => i.id));
    list.innerHTML = convertItems.map((item) => {
        const removable = item.state === 'pending' || item.state === 'error' || item.state === 'cancelled';
        const statusText = {
            pending: t('convert.status.queued'),
            converting: item.percent ? `${item.percent}%` : t('convert.status.converting'),
            done: t('convert.status.done'),
            error: t('convert.status.error'),
            cancelled: t('convert.status.cancelled'),
        }[item.state];
        const progressBar = item.state === 'converting'
            ? `<div class="convert-batch-item-progress-track"><div class="convert-batch-item-progress-fill" style="width:${item.percent || '0%'}"></div></div>`
            : '';
        const removeIcon = item.state === 'done'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17L4 12"/></svg>'
            : '×';
        const isNew = !convertRenderedIds.has(item.id);
        return `<div class="convert-batch-item convert-batch-item-${item.state}${isNew ? ' convert-batch-item-entering' : ''}" data-item-id="${item.id}">` +
            fileTypeBadgeHtml(item.name, CONVERT_AUDIO_EXTS.has((item.name.split('.').pop() || '').toLowerCase()) ? 'audio' : 'video') +
            `<div class="convert-batch-item-info">` +
                `<span class="convert-batch-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>` +
                `<div class="convert-batch-item-meta">` +
                    `<span class="convert-batch-item-status">${escapeHtml(statusText)}</span>` +
                    progressBar +
                `</div>` +
            `</div>` +
            (removable
                ? `<button class="convert-batch-item-remove" onclick="removeConvertItem(${item.id})" aria-label="Remove file">×</button>`
                : (item.state === 'done'
                    ? `<span class="convert-batch-item-remove" aria-hidden="true" style="color:var(--success)">${removeIcon}</span>`
                    : `<span class="convert-batch-item-remove-spacer"></span>`)) +
            `</div>`;
    }).join('');
    convertRenderedIds = currentIds;
}

function loadConvertPreview(filePath) {
    const name = filePath.split('/').pop();
    const ext = '.' + name.split('.').pop().toLowerCase();
    const video = document.getElementById('convertVideo');
    if (!video) return;

    // Served through the app's own local HTTP server (see localServer.js's `/__media/` route),
    // NOT the bweb-file:// custom protocol — found by testing real playback that Electron's
    // protocol.handle mechanism silently fails to decode certain H.264+AAC files served through
    // it (readyState/duration resolve fine, but every frame is black and currentTime never
    // advances). The exact same bytes play back correctly over a plain http:// origin.
    // .load() is required here: reassigning .src alone while a previous load is still
    // in flight (e.g. switching files back-to-back) leaves the element wedged with a
    // stale MEDIA_ERR_SRC_NOT_SUPPORTED that a later valid .src never clears on its own.
    video.src = `/__media/${encodeURIComponent(filePath)}`;
    video.load();
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
    const formatLabel = document.getElementById('convertProgressFormatLabel');
    if (progressWrap) progressWrap.style.display = 'flex';
    if (bar) bar.style.width = '0%';
    if (label) label.textContent = '0%';
    if (formatLabel) formatLabel.textContent = `${t('convert.progress.to')} ${CONVERT_FORMAT_LABELS[format] || format.toUpperCase()}`;
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

    if (convertItems.some((i) => i.state === 'done') && document.getElementById('convertAutoOpenCheck')?.checked) {
        window.api.convertOpenDestFolder();
    }
}

const convertDestControls = makeDestPathControls('convert');
async function loadConvertDestPath() { return convertDestControls.loadDestPath(); }
async function doChooseConvertDestPath() { return convertDestControls.chooseDestPath(); }
async function loadConvertAutoOpen() { return convertDestControls.loadAutoOpen(); }
function onConvertAutoOpenChange(checked) { return convertDestControls.onAutoOpenChange(checked); }

async function doConvert() {
    if (convertRunning) return;
    runConvertQueue();
}

async function doCancelConvert() {
    convertStopRequested = true;
    await window.api.convertCancel();
}

async function doImageConvertChooseFile() {
    const filePaths = await window.api.imgConvertChooseFile();
    addFilesToImageConvertList(filePaths);
}

function addFilesToImageConvertList(paths) {
    if (!paths || paths.length === 0) return;
    for (const p of paths) {
        imageConvertItems.push({ id: ++imageConvertItemIdCounter, path: p, name: p.split('/').pop(), state: 'ready' });
    }
    document.getElementById('imgConvertDropZone').style.display = 'none';
    document.getElementById('imgConvertListWrap').style.display = 'flex';
    document.querySelector('#convertImageView .convert-center-wrapper')?.classList.add('has-content');
    renderImageConvertList();
}

function doImageConvertClear() {
    imageConvertItems = [];
    imageConvertRunning = false;
    const dropZone = document.getElementById('imgConvertDropZone');
    const listWrap = document.getElementById('imgConvertListWrap');
    const btn = document.getElementById('imgConvertBtn');
    if (dropZone) dropZone.style.display = 'flex';
    if (listWrap) listWrap.style.display = 'none';
    if (btn) { btn.textContent = t('convert.btn'); btn.disabled = true; btn.style.display = ''; }
    const doneActions = document.getElementById('imgConvertDoneActions');
    if (doneActions) doneActions.style.display = 'none';
    document.querySelector('#convertImageView .convert-center-wrapper')?.classList.remove('has-content');
}

function selectImageConvertFormat(value) {
    imageConvertFormat = value;
    document.querySelectorAll('#imgConvertFormatGrid .convert-format-tile').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.format === value);
    });
    const triggerLabel = document.getElementById('imgConvertFormatTriggerLabel');
    if (triggerLabel) triggerLabel.textContent = IMAGE_CONVERT_FORMAT_LABELS[value] || value.toUpperCase();
    closeAllFormatMenus();
}

const IMAGE_CONVERT_BUSY_STATES = new Set(['converting']);

function imageConvertStatusLabel(item) {
    return {
        ready: t('convert.status.queued'),
        converting: t('convert.status.converting'),
        done: t('convert.status.done'),
        error: t('convert.status.error'),
    }[item.state];
}

function renderImageConvertList() {
    imageConvertRenderedIds = renderBatchList({
        listId: 'imgConvertList',
        countId: 'imgConvertListCount',
        items: imageConvertItems,
        renderedIds: imageConvertRenderedIds,
        isBusy: (item) => IMAGE_CONVERT_BUSY_STATES.has(item.state),
        statusLabelFn: imageConvertStatusLabel,
    });
    const btn = document.getElementById('imgConvertBtn');
    if (!btn) return;
    const pending = imageConvertItems.filter((i) => i.state === 'ready').length;
    btn.disabled = pending === 0 || imageConvertRunning;
    if (imageConvertRunning) btn.textContent = t('convert.status.converting');
    else if (imageConvertItems.length > 1 && pending > 0) btn.textContent = t('convert.btn.n') ? t('convert.btn.n')(pending) : `Convert ${pending}`;
    else btn.textContent = t('convert.btn');

    // Once every item is done/error (nothing left ready or converting), swap the single
    // Convert button for an explicit "Open folder" + "Convert another file" pair.
    const finished = imageConvertItems.length > 0 && !imageConvertRunning && imageConvertItems.every((i) =>
        i.state === 'done' || i.state === 'error'
    );
    const doneActions = document.getElementById('imgConvertDoneActions');
    btn.style.display = finished ? 'none' : '';
    if (doneActions) doneActions.style.display = finished ? 'flex' : 'none';
}

async function doImageConvert() {
    if (imageConvertRunning) return;
    imageConvertRunning = true;

    for (const item of imageConvertItems.filter((i) => i.state === 'ready')) {
        item.state = 'converting';
        renderImageConvertList();
        addLog(`Converting: ${item.name} → ${imageConvertFormat.toUpperCase()}`, 'highlight');

        try {
            const result = await window.api.imgConvertFile(item.path, imageConvertFormat);
            item.state = 'done';
            addLog(`Saved: ${result.outputPath}`, 'success');
        } catch (err) {
            item.state = 'error';
            addLog(`Image conversion failed for ${item.name}: ${err.message}`, 'error');
        }
        renderImageConvertList();
    }

    imageConvertRunning = false;
    renderImageConvertList();

    const failed = imageConvertItems.some((i) => i.state === 'error');
    showToast(`Conversion ${failed ? 'finished with errors' : 'complete ✓'}`, failed ? 'error' : 'success');

    if (imageConvertItems.some((i) => i.state === 'done') && document.getElementById('convertAutoOpenCheck')?.checked) {
        window.api.convertOpenDestFolder();
    }
}

async function doDocConvertChooseFile() {
    const filePaths = await window.api.docConvertChooseFile();
    addFilesToDocConvertList(filePaths);
}

function addFilesToDocConvertList(paths) {
    if (!paths || paths.length === 0) return;
    for (const p of paths) {
        const ext = (p.split('.').pop() || '').toLowerCase();
        docConvertItems.push({ id: ++docConvertItemIdCounter, path: p, name: p.split('/').pop(), ext, state: 'ready' });
    }
    document.getElementById('docConvertDropZone').style.display = 'none';
    document.getElementById('docConvertListWrap').style.display = 'flex';
    document.querySelector('#convertDocumentView .convert-center-wrapper')?.classList.add('has-content');
    updateDocConvertFormatAvailability();
    renderDocConvertList();
}

function doDocConvertClear() {
    docConvertItems = [];
    docConvertRunning = false;
    docConvertFormat = 'markdown';
    const dropZone = document.getElementById('docConvertDropZone');
    const listWrap = document.getElementById('docConvertListWrap');
    const btn = document.getElementById('docConvertBtn');
    if (dropZone) dropZone.style.display = 'flex';
    if (listWrap) listWrap.style.display = 'none';
    if (btn) { btn.textContent = t('convert.btn'); btn.disabled = true; btn.style.display = ''; }
    const doneActions = document.getElementById('docConvertDoneActions');
    if (doneActions) doneActions.style.display = 'none';
    selectDocConvertFormat('markdown');
    updateDocConvertFormatAvailability();
    document.querySelector('#convertDocumentView .convert-center-wrapper')?.classList.remove('has-content');
}

function selectDocConvertFormat(value) {
    if (document.getElementById('docConvertFormatPdf')?.disabled && value === 'pdf') return;
    docConvertFormat = value;
    document.querySelectorAll('#docConvertFormatGrid .convert-format-tile').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.format === value);
    });
    const triggerLabel = document.getElementById('docConvertFormatTriggerLabel');
    if (triggerLabel) triggerLabel.textContent = DOC_CONVERT_FORMAT_LABELS[value] || value;
    closeAllFormatMenus();
}

// PDF output only works when every file in the batch is Office (docx/pptx/xlsx, per
// minipdf) — everything else (odt/rtf/epub/csv/pdf/legacy .doc-.ppt-.xls) can only go to
// Markdown. Disable the tile rather than hide it, so it's clear it's conditional, not gone.
function updateDocConvertFormatAvailability() {
    const pdfTile = document.getElementById('docConvertFormatPdf');
    const pdfHint = document.getElementById('docConvertPdfHint');
    if (!pdfTile) return;
    const allPdfEligible = docConvertItems.length > 0 && docConvertItems.every((i) => DOC_CONVERT_PDF_EXTS.has(i.ext));
    pdfTile.disabled = !allPdfEligible;
    if (pdfHint) pdfHint.style.display = (docConvertItems.length > 0 && !allPdfEligible) ? 'block' : 'none';
    if (!allPdfEligible && docConvertFormat === 'pdf') {
        selectDocConvertFormat('markdown');
    }
}

const DOC_CONVERT_BUSY_STATES = new Set(['converting']);

function docConvertStatusLabel(item) {
    return {
        ready: t('convert.status.queued'),
        converting: t('convert.status.converting'),
        done: t('convert.status.done'),
        error: t('convert.status.error'),
    }[item.state];
}

function renderDocConvertList() {
    docConvertRenderedIds = renderBatchList({
        listId: 'docConvertList',
        countId: 'docConvertListCount',
        items: docConvertItems,
        renderedIds: docConvertRenderedIds,
        isBusy: (item) => DOC_CONVERT_BUSY_STATES.has(item.state),
        statusLabelFn: docConvertStatusLabel,
        badgeCategoryFn: (item) => (item.ext === 'pdf' ? 'pdf' : 'doc'),
    });
    const btn = document.getElementById('docConvertBtn');
    if (!btn) return;
    const pending = docConvertItems.filter((i) => i.state === 'ready').length;
    btn.disabled = pending === 0 || docConvertRunning;
    if (docConvertRunning) btn.textContent = t('convert.status.converting');
    else if (docConvertItems.length > 1 && pending > 0) btn.textContent = t('convert.btn.n') ? t('convert.btn.n')(pending) : `Convert ${pending}`;
    else btn.textContent = t('convert.btn');

    const finished = docConvertItems.length > 0 && !docConvertRunning && docConvertItems.every((i) =>
        i.state === 'done' || i.state === 'error'
    );
    const doneActions = document.getElementById('docConvertDoneActions');
    btn.style.display = finished ? 'none' : '';
    if (doneActions) doneActions.style.display = finished ? 'flex' : 'none';
}

async function doDocConvert() {
    if (docConvertRunning) return;
    docConvertRunning = true;

    for (const item of docConvertItems.filter((i) => i.state === 'ready')) {
        item.state = 'converting';
        renderDocConvertList();
        addLog(`Converting: ${item.name} → ${docConvertFormat.toUpperCase()}`, 'highlight');

        try {
            const result = await window.api.docConvertFile(item.path, docConvertFormat);
            item.state = 'done';
            addLog(`Saved: ${result.outputPath}`, 'success');
        } catch (err) {
            item.state = 'error';
            addLog(`Document conversion failed for ${item.name}: ${err.message}`, 'error');
        }
        renderDocConvertList();
    }

    docConvertRunning = false;
    renderDocConvertList();

    const failed = docConvertItems.some((i) => i.state === 'error');
    showToast(`Conversion ${failed ? 'finished with errors' : 'complete ✓'}`, failed ? 'error' : 'success');

    if (docConvertItems.some((i) => i.state === 'done') && document.getElementById('convertAutoOpenCheck')?.checked) {
        window.api.convertOpenDestFolder();
    }
}

// --- QR Generator ---
// Rendered entirely client-side via the vendored qr-code-styling (MIT, kozakdenys) — Electron's
// renderer is a real Chromium window, so its canvas/SVG APIs work natively here without any
// native Node dependency (no node-canvas, no image-processing library needed just for this).
// The main process is only asked to write the final bytes to disk.

let qrFormat = 'png';
let qrSize = 1024;
let qrFrame = 'square';
let qrDebounceTimer = null;
let qrCodeInstance = null;
let qrLogoDataUrl = null;

function initQrTab() {
    loadQrDestPath();
    loadQrAutoOpen();
}

const qrDestControls = makeDestPathControls('qr');
async function loadQrAutoOpen() { return qrDestControls.loadAutoOpen(); }
function onQrAutoOpenChange(checked) { return qrDestControls.onAutoOpenChange(checked); }
async function loadQrDestPath() { return qrDestControls.loadDestPath(); }
async function doChooseQrDestPath() { return qrDestControls.chooseDestPath(); }

function setQrFormat(format) {
    qrFormat = format;
    document.querySelectorAll('#tab-qrcode [data-qrformat]').forEach((b) => b.classList.toggle('active', b.dataset.qrformat === format));
}

// Canva-style slider with 3 snap points instead of a row of preset buttons — a row of
// full-width-text buttons ("512 × 512" / "1024 × 1024" / "2048 × 2048") doesn't fit the QR
// sidebar's fixed column width and was overflowing past its right edge (found by testing at a
// realistic window size). A slider has no such overflow risk since it's just width: 100%.
const QR_SIZE_STEPS = [512, 1024, 2048];

function setQrSize(size) {
    qrSize = size;
    const idx = QR_SIZE_STEPS.indexOf(size);
    const slider = document.getElementById('qrSizeSlider');
    if (slider && idx !== -1) slider.value = idx;
    const label = document.getElementById('qrSizeValue');
    if (label) label.textContent = `${size} × ${size}`;
}

function onQrSizeSliderInput(stepIndex) {
    setQrSize(QR_SIZE_STEPS[Number(stepIndex)]);
}

// "Frame" is the actual thing people picture when they say "customize the QR code" — a shaped
// card/badge the code sits inside — as opposed to the individual module dot style, which is a
// much smaller, optional flourish (see the collapsed "Dot style" control below). Applied live via
// CSS on the preview wrapper, and baked into the exported PNG by compositing onto a bigger canvas
// (see applyFrameToPngBlob) — SVG export stays frame-less for now, noted in the UI via the format
// picker rather than silently dropping it.
function setQrFrame(frame) {
    qrFrame = frame;
    document.querySelectorAll('#tab-qrcode [data-qrframe]').forEach((b) => b.classList.toggle('active', b.dataset.qrframe === frame));
    applyQrFrameToPreview();
}

// Framed on #qrPreviewContainer, NOT the outer .qr-preview-wrap: the wrap is a flex box that
// stretches to fill its grid column on wide windows, so its own width/height ratio is never
// actually square — border-radius: 50% on it produces a squashed oval that clips the QR, not a
// circle (found by testing at a realistic wide window size, not just the small one used during
// development). #qrPreviewContainer instead hugs the canvas tightly and the canvas is always
// square, so padding it equally on all sides keeps the framed box itself square too.
// A circle only fully contains a square if its radius reaches the square's corners — i.e. at
// least half the diagonal (side * √2/2 ≈ 70.7% of the side), not just half the side. Padding
// smaller than that (an earlier version of this used a small fixed CSS padding) still leaves the
// QR's own corners poking out past the circle. framePaddingRatio returns, per frame, how much
// padding (as a fraction of the QR's side) to add on each edge before clipping — mirrored exactly
// in applyFrameToPngBlob below so the live preview and the exported file agree.
function framePaddingRatio(frame) {
    if (frame === 'circle') return Math.SQRT2 / 2 - 0.5 + 0.04; // touch-the-corners minimum + a small breathing-room buffer
    if (frame === 'rounded') return 0.08;
    return 0;
}

function applyQrFrameToPreview() {
    const container = document.getElementById('qrPreviewContainer');
    const lightColor = document.getElementById('qrLightColor').value;
    const isFramed = qrFrame !== 'square';
    container.classList.toggle('qr-preview-framed', isFramed);
    if (!isFramed) {
        container.style.borderRadius = '';
        container.style.background = '';
        container.style.padding = '';
        return;
    }
    const content = container.querySelector('canvas, svg');
    const size = content ? content.getBoundingClientRect().width : 280;
    const pad = Math.round(size * framePaddingRatio(qrFrame));
    container.style.padding = `${pad}px`;
    container.style.borderRadius = qrFrame === 'circle' ? '50%' : '20px';
    container.style.background = lightColor;
}

function onQrLogoChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        qrLogoDataUrl = reader.result;
        const preview = document.getElementById('qrLogoPreview');
        preview.style.backgroundImage = `url(${qrLogoDataUrl})`;
        preview.style.display = 'block';
        document.getElementById('qrLogoPickerIcon').style.display = 'none';
        document.getElementById('qrLogoClearBtn').style.display = 'flex';
        onQrInputChange();
    };
    reader.readAsDataURL(file);
}

function clearQrLogo() {
    qrLogoDataUrl = null;
    document.getElementById('qrLogoInput').value = '';
    document.getElementById('qrLogoPreview').style.display = 'none';
    document.getElementById('qrLogoPickerIcon').style.display = '';
    document.getElementById('qrLogoClearBtn').style.display = 'none';
    onQrInputChange();
}

// `size` is the actual export resolution — the preview itself is rendered smaller (see
// renderQrPreview) since there's no reason to draw a 2048px canvas just to display it at 280px
// on screen, but export always uses the real value. Error correction is never shown to the user
// (it's meaningless jargon to anyone who isn't building QR codes) — it's set automatically here
// instead: high when a logo covers part of the code, since that needs the redundancy to still
// scan; normal otherwise.
function currentQrOptions(size) {
    return {
        width: size,
        height: size,
        type: 'canvas',
        data: document.getElementById('qrText').value.trim(),
        image: qrLogoDataUrl || undefined,
        margin: Math.round(size * 0.03),
        qrOptions: { errorCorrectionLevel: qrLogoDataUrl ? 'H' : 'M' },
        dotsOptions: {
            type: document.getElementById('qrShape').value,
            color: document.getElementById('qrDarkColor').value,
        },
        backgroundOptions: { color: document.getElementById('qrLightColor').value },
        imageOptions: { crossOrigin: 'anonymous', margin: Math.round(size * 0.02), imageSize: 0.3 },
    };
}

// Debounced so a live preview regenerates as you type/adjust colors without redrawing on every
// single keystroke.
function onQrInputChange() {
    clearTimeout(qrDebounceTimer);
    qrDebounceTimer = setTimeout(renderQrPreview, 150);
}

function renderQrPreview() {
    const text = document.getElementById('qrText').value.trim();
    const container = document.getElementById('qrPreviewContainer');
    const empty = document.getElementById('qrPreviewEmpty');
    const btn = document.getElementById('qrExportBtn');

    if (!text) {
        container.innerHTML = '';
        container.style.display = 'none';
        empty.style.display = '';
        btn.disabled = true;
        return;
    }

    const previewOptions = currentQrOptions(280);
    if (!qrCodeInstance) {
        qrCodeInstance = new QRCodeStyling(previewOptions);
        container.innerHTML = '';
        qrCodeInstance.append(container);
    } else {
        qrCodeInstance.update(previewOptions);
    }
    container.style.display = 'block';
    empty.style.display = 'none';
    btn.disabled = false;
    applyQrFrameToPreview();
}

// Bakes the "Shape" choice into the actual exported file — without this, "Circle" would only
// ever be a preview trick that disappears the moment the file is saved. Draws the plain QR onto
// a bigger canvas with a padded rounded/circular background in the chosen light color.
async function applyFrameToPngBlob(blob, frame, bgColor) {
    if (frame === 'square') return blob;
    const bitmap = await createImageBitmap(blob);
    const pad = Math.round(bitmap.width * framePaddingRatio(frame));
    const size = bitmap.width + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColor;
    if (frame === 'circle') {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        const r = Math.round(size * 0.08);
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.arcTo(size, 0, size, size, r);
        ctx.arcTo(size, size, 0, size, r);
        ctx.arcTo(0, size, 0, 0, r);
        ctx.arcTo(0, 0, size, 0, r);
        ctx.closePath();
        ctx.fill();
    }
    ctx.drawImage(bitmap, pad, pad);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function doQrExport() {
    const text = document.getElementById('qrText').value.trim();
    if (!text) return;
    const btn = document.getElementById('qrExportBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = t('qrcode.exporting') || 'Exporting…';

    try {
        const exportInstance = new QRCodeStyling(currentQrOptions(qrSize));
        let blob = await exportInstance.getRawData(qrFormat);
        if (qrFormat === 'png') {
            blob = await applyFrameToPngBlob(blob, qrFrame, document.getElementById('qrLightColor').value);
        }
        const buffer = await blob.arrayBuffer();
        const result = await window.api.qrExport(new Uint8Array(buffer), qrFormat);
        addLog(`QR code exported: ${result.outputPath}`);
        btn.textContent = t('qrcode.done') || 'Done ✓';
        if (document.getElementById('qrAutoOpenCheck')?.checked) window.api.qrOpenDestFolder();
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
    } catch (err) {
        addLog(`QR export failed: ${err.message}`, 'error');
        btn.textContent = t('qrcode.error') || 'Export failed';
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
    }
}

// --- Background Remover ---

let bgRemoveFilePath = null;
let bgRemoveRunning = false;

function initBgRemoveTab() {
    loadBgRemoveDestPath();
    loadBgRemoveAutoOpen();
    wireDropZone('bgRemoveDropZone', (paths) => {
        if (paths[0]) loadBgRemoveFile(paths[0]);
    });
}

const bgRemoveDestControls = makeDestPathControls('bgRemove');
async function loadBgRemoveDestPath() { return bgRemoveDestControls.loadDestPath(); }
async function doChooseBgRemoveDestPath() { return bgRemoveDestControls.chooseDestPath(); }
async function loadBgRemoveAutoOpen() { return bgRemoveDestControls.loadAutoOpen(); }
function onBgRemoveAutoOpenChange(checked) { return bgRemoveDestControls.onAutoOpenChange(checked); }

async function doBgRemoveChooseFile() {
    const p = await window.api.bgRemoveChooseFile();
    if (p) loadBgRemoveFile(p);
}

// Cmd/Ctrl+V an image (from another app, a browser, a screenshot) straight into Background
// Remover — an explicit "choose file"/drag-and-drop round trip is unnecessary friction when the
// image is already on the clipboard. Every processing pipeline in this app works off a real file
// path, so the pasted bytes get written to a temp file (via the main process — the renderer has
// no direct filesystem access) before handing that path to the exact same loadBgRemoveFile() a
// chosen/dropped file would use.
document.addEventListener('paste', async (e) => {
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab !== 'bgremove' || bgRemoveRunning) return;

    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    e.preventDefault();
    const blob = imageItem.getAsFile();
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const ext = imageItem.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const tempPath = await window.api.saveClipboardImage(buffer, ext);
    if (tempPath) loadBgRemoveFile(tempPath);
});

async function loadBgRemoveFile(filePath) {
    bgRemoveFilePath = filePath;
    document.getElementById('bgRemoveDropZone').style.display = 'none';
    document.getElementById('bgRemoveResultWrap').style.display = 'none';
    document.getElementById('bgRemoveLoading').style.display = 'flex';
    document.querySelector('#tab-bgremove .convert-center-wrapper')?.classList.add('has-content');

    try {
        const beforeUrl = `bweb-file://${encodeURIComponent(filePath)}`;
        const { dataUrl: afterUrl, fallback } = await window.api.bgRemovePreview(filePath);
        document.getElementById('bgRemoveLoading').style.display = 'none';
        document.getElementById('bgRemoveResultWrap').style.display = 'flex';
        document.getElementById('bgRemoveFileName').textContent = filePath.split('/').pop();
        document.getElementById('bgRemoveBeforeImg').src = beforeUrl;
        document.getElementById('bgRemoveAfterImg').src = afterUrl;
        // No isolated subject found (e.g. a full scene/landscape photo, not a product-on-
        // background shot) — the automatic border-trim fallback already ran (see bgRemover.js),
        // so what's shown is a plain crop, not a transparent cutout. Say so, since an opaque
        // photo sitting on the "transparent" checkerboard would otherwise look like a bug.
        const note = document.getElementById('bgRemoveFallbackNote');
        if (note) note.style.display = fallback === 'trimmed' ? 'block' : 'none';
    } catch (err) {
        addLog(`Background Remover: failed — ${err.message}`, 'error');
        document.getElementById('bgRemoveLoading').style.display = 'none';
        doBgRemoveClear();
    }
}

function doBgRemoveClear() {
    bgRemoveFilePath = null;
    document.getElementById('bgRemoveDropZone').style.display = '';
    document.getElementById('bgRemoveLoading').style.display = 'none';
    document.getElementById('bgRemoveResultWrap').style.display = 'none';
    document.getElementById('bgRemoveBeforeImg').removeAttribute('src');
    document.getElementById('bgRemoveAfterImg').removeAttribute('src');
    const note = document.getElementById('bgRemoveFallbackNote');
    if (note) note.style.display = 'none';
    document.querySelector('#tab-bgremove .convert-center-wrapper')?.classList.remove('has-content');
}

async function doBgRemoveExport() {
    if (!bgRemoveFilePath || bgRemoveRunning) return;
    bgRemoveRunning = true;
    const btn = document.getElementById('bgRemoveExportBtn');
    btn.disabled = true;
    btn.textContent = t('bgremove.exporting') || 'Exporting…';

    try {
        const result = await window.api.bgRemoveRun(bgRemoveFilePath);
        addLog(result.fallback === 'trimmed'
            ? `No subject detected — exported a border-trimmed crop instead: ${result.outputPath}`
            : `Background removed: ${result.outputPath}`);
        btn.textContent = t('bgremove.done') || 'Done ✓';
        if (document.getElementById('bgRemoveAutoOpenCheck')?.checked) window.api.bgRemoveOpenDestFolder();
        setTimeout(() => { btn.textContent = t('bgremove.export') || 'Export PNG'; btn.disabled = false; }, 1500);
    } catch (err) {
        addLog(`Background Remover export failed: ${err.message}`, 'error');
        btn.textContent = t('bgremove.error') || 'Export failed';
        setTimeout(() => { btn.textContent = t('bgremove.export') || 'Export PNG'; btn.disabled = false; }, 1500);
    } finally {
        bgRemoveRunning = false;
    }
}

initLang();
initTheme();
initSidebarResize();
initLogResize();
init();
