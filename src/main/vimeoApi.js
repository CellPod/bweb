// Vimeo API
// Lists videos from the account's library (personal + team) via the official REST API,
// using a user-supplied Personal Access Token. Avoids the bot-protection/CAPTCHA that
// blocks scraping the vimeo.com/library dashboard directly.

const { net } = require('electron');
const { log } = require('./utils');

const API_BASE = 'https://api.vimeo.com';
const PER_PAGE = 100;

async function fetchLibrary(token, { onLog } = {}) {
    const _log = (msg) => {
        log('VimeoAPI:', msg);
        if (onLog) onLog(msg);
    };

    if (!token) throw new Error('No Vimeo API token configured');

    const items = [];
    let page = 1;
    let total = null;

    for (;;) {
        const fields = 'uri,name,description,link,duration,created_time,modified_time,release_time';
        const url = `${API_BASE}/me/videos?per_page=${PER_PAGE}&page=${page}&fields=${fields}`;

        const res = await net.fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.vimeo.*+json;version=3.4',
            },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Vimeo API error ${res.status}: ${body.slice(0, 200)}`);
        }

        const data = await res.json();
        total = data.total;

        for (const v of data.data || []) {
            const id = (v.uri || '').split('/').pop();
            const name = v.name || `Video ${id}`;
            const description = v.description || '';
            const uploadYear = v.created_time ? new Date(v.created_time).getFullYear() : null;
            const detectedYear = detectYear(`${name} ${description}`) || uploadYear;

            items.push({
                id,
                name,
                description,
                link: v.link,
                duration: v.duration || null,
                createdTime: v.created_time || null,
                detectedYear,
                // "no-op" if a year prefix would just duplicate one already in the name
                displayTitle: detectedYear && !name.includes(String(detectedYear)) ? `${detectedYear} - ${name}` : name,
            });
        }

        _log(`Fetched ${items.length}/${total}`);

        if (!data.paging || !data.paging.next || items.length >= total) break;
        page++;
    }

    return { items, total: total || items.length };
}

// The real content date (as opposed to Vimeo's upload-time created_time/release_time,
// which is all the API otherwise exposes) only ever shows up as free text in the title
// or description. Take the earliest plausible year mentioned — content predates upload.
function detectYear(text) {
    const matches = text.match(/\b(19|20)\d{2}\b/g);
    if (!matches) return null;
    const currentYear = new Date().getFullYear();
    const years = matches.map(Number).filter((y) => y >= 1990 && y <= currentYear);
    if (!years.length) return null;
    return Math.min(...years);
}

// Resolve the best direct-download MP4 link for one video via the official API.
// Used instead of yt-dlp for Vimeo: yt-dlp's Vimeo extractor is currently blocked by
// Vimeo's bot-detection (HTTP 403 on its browser-impersonation fingerprint) even for
// plain public videos, while these authenticated "download" links are a normal HTTPS
// redirect with no such gate.
async function getVideoFile(token, videoId) {
    if (!token) throw new Error('No Vimeo API token configured');

    const res = await net.fetch(`${API_BASE}/videos/${videoId}?fields=name,download,files`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.vimeo.*+json;version=3.4',
        },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Vimeo API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const candidates = data.download && data.download.length ? data.download : data.files || [];
    const mp4s = candidates.filter((f) => f.type === 'video/mp4' && f.link);
    if (!mp4s.length) return null;

    mp4s.sort((a, b) => (b.height || 0) - (a.height || 0));
    const best = mp4s[0];
    return { url: best.link, height: best.height || null, size: best.size || null, rendition: best.rendition || null };
}

module.exports = { fetchLibrary, getVideoFile };
