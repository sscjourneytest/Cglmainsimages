// live-mock-engine.js — Live Mock Tests, "App Edition"
// ─────────────────────────────────────────────────────────────────────────────
// ONE direct page, no drill screens. The ONLY filters are three tabs:
//   · UPCOMING LIVE  — tests whose live window hasn't opened yet
//   · CURRENT LIVE   — tests inside their live window right now (IST)
//   · ATTEMPTED      — EVERY test in the data JSON this user has attempted
//                      (any category, any live status) with score bars,
//                      newest attempt first
// There is intentionally NO "Previous Live" tab, NO "All" tab and NO
// category/sectional/full-live filter rows — categories are flattened and
// only surface as a small tag on each card (+ per-category test link).
// There is intentionally NO reattempt anywhere — attempted tests offer
// ANALYSIS only.
//
// Data source: same convention as the other engines — exam name comes from
// the URL: a bare query token (?live-test) or the parent path segment
// (/live-test/  →  "live-test"), giving {examName}-data.json — here
// live-test-data.json. Standalone previews pin it via window.__EXAM_NAME__
// and embed the JSON as window.__LIVE_JSON__ (no fetch).
//
// Cross-device attempts: IDENTICAL strategy to exam-engine.js /
// ssc-sub-engine.js — cloudflare-config.json worker resolution,
// CLOUD_SYNC_<user>_<exam> cache { workerSynced, local, worker },
// qsum_/result_ absorption, /attempted-status POST, persistent storage
// request, one auto-fetch until worker-confirmed + manual Refetch.
//
// Item contract (all strings):
//   { "id", "title", "type": "free"|"paid", "linkStr": "", "qs", "marks",
//     "time", "liveFrom": "DD-MM-YYYY HH:MM", "liveTo": "DD-MM-YYYY HH:MM",
//     "releaseDate": "" }

let LIVE_JSON = null;
let currentStatusTab = 'live'; // 'upcoming' | 'live' | 'attempted'

// { quizId: { score, createdAt } } map — populated from localStorage cache
// (kept forever — see syncWithCloud below), refreshed only when missing or
// when the user taps "Refetch Attempts" in the header.
let CLOUD_CHECKLIST = {};

let CURRENT_SYNC_USER = null;
let CURRENT_SYNC_EXAM = null;

// ── Per-exam attempts worker — resolved from cloudflare-config.json ──────────
const CLOUDFLARE_CONFIG_URL = "/cloudflare-config.json";

// ── Live-first config loader (online → mockmatrixhub.in, offline → APK) ─────
// Config JSONs are fetched from https://mockmatrixhub.in/<path> when online
// (so content can be updated without shipping a new APK), and fall back to
// the copy bundled inside the APK when offline. Guarded so it stays a single
// shared definition even if two engines load on the same page.
window.MMH_LIVE_BASE = window.MMH_LIVE_BASE || 'https://mockmatrixhub.in';
if (typeof window.fetchLiveFirst !== 'function') {
    window.fetchLiveFirst = async function (localUrl, fetchOpts) {
        let rel = String(localUrl);
        while (rel.charAt(0) === '/') rel = rel.slice(1);
        const liveUrl = window.MMH_LIVE_BASE + '/' + rel;
        try {
            const res = await fetch(liveUrl, fetchOpts);
            if (res && res.ok) return res;
        } catch (e) { /* offline / blocked — fall back to the bundled copy */ }
        const res = await fetch(localUrl, fetchOpts);
        if (!res.ok) throw new Error('Failed to load ' + localUrl);
        return res;
    };
}
let ATTEMPTS_WORKER_CONFIG = null;

async function loadAttemptsWorkerConfig() {
    if (ATTEMPTS_WORKER_CONFIG) return ATTEMPTS_WORKER_CONFIG;
    const res = await fetchLiveFirst(CLOUDFLARE_CONFIG_URL);
    if (!res.ok) throw new Error("Could not load cloudflare-config.json");
    ATTEMPTS_WORKER_CONFIG = await res.json();
    return ATTEMPTS_WORKER_CONFIG;
}

function getAttemptsWorkerURL(config, examName) {
    const idLower = examName.toLowerCase();
    const keyword = Object.keys(config).find(k => idLower.includes(k));
    return keyword ? config[keyword] : null;
}

async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) { /* non-fatal */ }
    }
}

let _countdownInterval = null;
let _lastStatusSignature = '';
let _chromeWired = false;
let _syncUIInjected = false;

// ── Demo profile fallback ──────────────────────────────────────────────────
// On the live site auth.js defines getLocalProfile() before this file runs —
// this fallback only kicks in when nothing else provides one (standalone
// previews), so the page can exercise its real logged-in code paths.
if (typeof window !== 'undefined' && typeof window.getLocalProfile !== 'function') {
    window.getLocalProfile = function () { return { username: 'DemoStudent', is_paid: false }; };
}

// ── localStorage-safe getter (render paths must never throw) ────────────────
function _lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ── Theme (same `mmh_theme` key the whole app shares) ───────────────────────
const LM_THEME_KEY = 'mmh_theme';
const LM_SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const LM_ICONS = {
    sun  : `<svg ${LM_SVG}><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4 1.4"/></svg>`,
    moon : `<svg ${LM_SVG}><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a7 7 0 0 0 9.7 9.7z"/></svg>`,
    check: `<svg ${LM_SVG} stroke-width="2.4"><path d="M4.5 12.5l5 5L20 6.5"/></svg>`,
    info : `<svg ${LM_SVG}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11.5V16"/></svg>`
};

function lmCurrentTheme() {
    const s = _lsGet(LM_THEME_KEY);
    if (s === 'dark' || s === 'light') return s;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function lmApplyTheme(t) {
    document.body.classList.toggle('dark-mode', t === 'dark');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === 'dark' ? '#121a30' : '#ffffff';
    const btns = document.querySelectorAll('.theme-btn');
    Array.prototype.forEach.call(btns || [], function (b) {
        b.innerHTML = t === 'dark' ? LM_ICONS.sun : LM_ICONS.moon;
        b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
}
function lmToggleTheme() {
    const t = lmCurrentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(LM_THEME_KEY, t); } catch (e) { /* ignore */ }
    lmApplyTheme(t);
}
window.lmCurrentTheme = lmCurrentTheme;
window.lmApplyTheme = lmApplyTheme;

// ── Toasts (same look/behavior as app-shell's, self-contained here) ─────────
function showToast(msg, type) {
    let root = document.getElementById('toastRoot');
    if (!root) {
        root = document.createElement('div');
        root.id = 'toastRoot';
        root.setAttribute('aria-live', 'polite');
        document.body.appendChild(root);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    const ico = document.createElement('span');
    ico.innerHTML = type === 'error' ? LM_ICONS.info : LM_ICONS.check;
    if (ico.firstElementChild && type) ico.firstElementChild.classList.add(type === 'error' ? 'error' : 'success');
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(ico);
    t.appendChild(span);
    root.appendChild(t);
    setTimeout(function () {
        t.classList.add('out');
        setTimeout(function () { t.remove(); }, 260);
    }, 2400);
}
window.showToast = showToast;

// ── Exam Name Resolution — same helper as exam-engine.js / ssc-sub-engine.js ─
// Bare query token wins (?live-test…); otherwise the parent path segment —
// /live-test/  →  "live-test". Standalone previews pin window.__EXAM_NAME__.
function _getExamNameFromUrl() {
    if (typeof window !== 'undefined' && window.__EXAM_NAME__) return window.__EXAM_NAME__;
    const pathParts = window.location.pathname.split('/');
    if (!window.location.search) return pathParts[pathParts.length - 2];

    const params = new URLSearchParams(window.location.search);
    for (const key of params.keys()) {
        if (key !== 'filter') return key;
    }
    return pathParts[pathParts.length - 2];
}

// ── IST "now" helper ──────────────────────────────────────────────────────────
// liveFrom/liveTo are authored in IST — always compare against IST wall time,
// whatever timezone the device clock is in.
function _nowIST() {
    const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    return new Date(istString);
}

// Parses "DD-MM-YYYY HH:MM" as an IST wall-clock time, directly comparable
// to _nowIST() (both are "IST-as-if-local").
function _parseLiveDateTime(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const [, dd, mm, yyyy, hh, min] = m;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
}

// ── Status bucket: upcoming | live | previous ─────────────────────────────────
function _getItemStatus(item) {
    const from = _parseLiveDateTime(item.liveFrom);
    const to   = _parseLiveDateTime(item.liveTo);
    if (!from || !to) return 'live'; // malformed/missing times — don't hide it
    const now = _nowIST();
    if (now < from) return 'upcoming';
    if (now > to)   return 'previous';
    return 'live';
}

// ── Countdown text: "Ends in 2h 14m 5s" / "Starts in 1d 3h" / "Ended" ────────
function _formatCountdown(item) {
    const from = _parseLiveDateTime(item.liveFrom);
    const to   = _parseLiveDateTime(item.liveTo);
    const now  = _nowIST();

    if (from && now < from) return { text: 'Starts in ' + _relativeTime(from - now), cls: 'upcoming' };
    if (to && now <= to)    return { text: 'Ends in ' + _relativeTime(to - now, true), cls: 'live' };
    return { text: 'Ended', cls: 'ended' };
}

function _relativeTime(ms, short) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (short) return `${h}h ${m}m ${s}s`;
    return `${h}h ${m}m`;
}

// ── Flatten the whole JSON (all categories) into one item list ──────────────
// No category filters exist on this page — every category's tests feed the
// same three tabs. Each item remembers its category for the card tag and for
// per-category test-link resolution.
function _allItems() {
    const out = [];
    const data = (LIVE_JSON && LIVE_JSON.data) || {};
    Object.keys(data).forEach(cat => {
        (function walk(node) {
            if (Array.isArray(node)) {
                node.forEach(it => { if (it && it.id) out.push({ ...it, _category: cat }); });
                return;
            }
            if (node && typeof node === 'object') Object.values(node).forEach(walk);
        })(data[cat]);
    });
    return out;
}

function _formatAttemptedDate(createdAtStr) {
    if (!createdAtStr) return null;
    const d = new Date(String(createdAtStr).replace(' ', 'T'));
    if (isNaN(d.getTime())) return null;
    const day = d.getDate();
    const month = d.toLocaleString('en-US', { month: 'short' });
    const now = new Date();
    return d.getFullYear() === now.getFullYear() ? `${day} ${month}` : `${day} ${month} ${d.getFullYear()}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initLiveMockEngine() {
    const examName = _getExamNameFromUrl();

    const gridSync = document.getElementById('grid-sync');
    if (gridSync) gridSync.innerText = "";
    renderSkeleton();
    _wireChrome();   // wire back/theme/back-to-top up front — must work even if the data fetch below fails

    try {
        if (window.__LIVE_JSON__) {
            LIVE_JSON = window.__LIVE_JSON__;       // standalone preview embed
        } else {
            const rawUrl = `https://mock-matrix-hub-api.pages.dev/data/${examName}-data.json?t=${Date.now()}`;
            const response = await fetch(rawUrl);
            LIVE_JSON = await response.json();
        }

        if (!['upcoming', 'live', 'attempted'].includes(currentStatusTab)) {
            currentStatusTab = 'live';
        }

        renderMocks();

        // Sync cross-device status in background (non-blocking)
        syncWithCloud(examName);
        _startCountdownTicker();

    } catch (e) {
        console.error("Live engine initialization failed", e);
        const grid = document.getElementById('quizGrid');
        if (grid) grid.innerHTML = _emptyState('clock', "Couldn't load live mocks", 'Please check your connection and try again.');
    }
}

// Header buttons: theme toggle, back (strips the last URL segment), back-to-top
function _wireChrome() {
    if (_chromeWired) return;
    _chromeWired = true;

    const tbtns = document.querySelectorAll('.theme-btn');
    Array.prototype.forEach.call(tbtns || [], function (b) { b.onclick = lmToggleTheme; });

    const back = document.getElementById('backBtn');
    if (back) back.onclick = function (e) {
        e.preventDefault();
        try {
            const path = window.location.pathname.replace(/\/+$/, '');
            if (path.endsWith('/index.html')) path = path.slice(0, -11);
            const parts = path.split('/');
            parts.pop();
            let parentPath = parts.join('/') || '/';
            if (!parentPath.endsWith('/')) parentPath += '/';
            window.location.href = parentPath + 'index.html';
        } catch (err) {
            try { history.back(); } catch (e2) { /* nowhere to go */ }
        }
    };

    const scroller = document.querySelector('.scrollable-grid-area');
    const btt = document.getElementById('backTop');
    if (scroller && btt) {
        scroller.addEventListener('scroll', function () {
            btt.classList.toggle('show', scroller.scrollTop > 520);
        }, { passive: true });
        btt.onclick = function () { scroller.scrollTo({ top: 0, behavior: 'smooth' }); };
    }
}

// ── Countdown ticker ──────────────────────────────────────────────────────────
// Every second: countdown pills update IN PLACE (no re-render, no animation
// restart). A full re-render only happens the moment an item crosses a
// upcoming→live→previous boundary (status signature changed), which also
// refreshes the tab counts.
function _startCountdownTicker() {
    if (_countdownInterval) clearInterval(_countdownInterval);
    _countdownInterval = setInterval(function () {
        if (!LIVE_JSON) return;

        document.querySelectorAll('.countdown-pill[data-cd-from]').forEach(function (pill) {
            const cd = _formatCountdown({ liveFrom: pill.getAttribute('data-cd-from'), liveTo: pill.getAttribute('data-cd-to') });
            pill.textContent = cd.text;
            pill.className = 'countdown-pill ' + cd.cls;
        });

        const sig = _allItems().map(i => i.id + ':' + _getItemStatus(i)).join('|');
        if (sig !== _lastStatusSignature) renderMocks();
    }, 1000);
}

// ── Status tabs — the ONLY filters ────────────────────────────────────────────
function _isAttempted(username, id) {
    return _lsGet(`result_${username}_${id}`) !== null || !!CLOUD_CHECKLIST[id];
}

function renderStatusTabs() {
    const wrap = document.getElementById('status-tabs-wrap');
    if (!wrap) return;

    const profile  = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : "Guest";

    const counts = { upcoming: 0, live: 0, attempted: 0 };
    _allItems().forEach(item => {
        counts[_getItemStatus(item)]++;
        if (_isAttempted(username, item.id)) counts.attempted++;
    });

    const tabs = [
        { key: 'upcoming',  long: 'Upcoming Live', short: 'Upcoming'  },
        { key: 'live',      long: 'Current Live',  short: 'Live'      },
        { key: 'attempted', long: 'Attempted',     short: 'Attempted' }
    ];
    wrap.innerHTML = tabs.map(t => `
        <button type="button" class="live-tab ${currentStatusTab === t.key ? 'active' : ''}" data-tab="${t.key}"
                onclick="setStatusTab('${t.key}')">
            <span class="tab-long">${t.long}</span><span class="tab-short">${t.short}</span>
            <span class="tab-count">${counts[t.key]}</span>
        </button>`).join('');
}

function setStatusTab(key) {
    if (!['upcoming', 'live', 'attempted'].includes(key)) return;
    currentStatusTab = key;
    renderMocks();
}
window.setStatusTab = setStatusTab;

// ── Skeleton ─────────────────────────────────────────────────────────────────
function renderSkeleton() {
    const grid = document.getElementById('quizGrid');
    if (!grid) return;
    grid.innerHTML = Array(6).fill(`
        <div class="skeleton-card">
            <div class="card-info">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-meta"></div>
            </div>
            <div class="skeleton-line skeleton-btn"></div>
        </div>`).join('');
}

// ── Empty states ──────────────────────────────────────────────────────────────
const LM_EMPTY_ICONS = {
    clock: `<svg ${LM_SVG}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
    bolt : `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>`,
    chart: `<svg ${LM_SVG}><path d="M4 20h16"/><path d="M6.5 20v-6M12 20V7M17.5 20V10.5"/></svg>`
};
function _emptyState(icon, title, sub) {
    return `<div class="empty-state">
                <div class="empty-ico">${LM_EMPTY_ICONS[icon] || LM_EMPTY_ICONS.clock}</div>
                <div class="empty-title">${title}</div>
                <div class="empty-sub">${sub}</div>
            </div>`;
}

// ── Link resolution — per-category first, then config.default, then fallback ─
function getLiveLink(item) {
    const cfg = (LIVE_JSON && LIVE_JSON.config) || {};
    const perCategory = item && item._category ? cfg[item._category] : null;
    if (perCategory && perCategory.link) return perCategory.link;
    if (cfg.default && cfg.default.link) return cfg.default.link;
    return "/test.html";
}

// ── Share (same behavior as the exam pages: native sheet → clipboard) ────────
async function shareMock(url, title) {
    if (window.mmhShare) {
        try { await window.mmhShare({ title, url }); } catch (e) { /* user cancelled — ignore */ }
    } else if (navigator.share) {
        try { await navigator.share({ title, url }); } catch (e) { /* user cancelled — ignore */ }
    } else if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(url);
            showToast('Link copied!');
        } catch (e) { /* ignore */ }
    }
}
window.shareMock = shareMock;

// ── Score bar html (attempted cards) ──────────────────────────────────────────
function _scoreRowHtml(item, record) {
    const totalMarks = typeof item.marks === 'number' ? item.marks : (parseInt(item.marks, 10) || null);
    if (!record || typeof record.score !== 'number' || !totalMarks) return '';
    const score     = record.score;
    const cutoff    = typeof item.cutoff === 'number' ? item.cutoff : totalMarks * 0.7;
    const scorePct  = Math.max(0, Math.min(100, (score / totalMarks) * 100));
    const cutoffPct = Math.max(0, Math.min(100, (cutoff / totalMarks) * 100));
    const fillClass = score >= cutoff ? 'fill-green' : 'fill-yellow';
    return `
        <div class="score-row">
            <div class="score-bar-bg">
                <div class="score-bar-fill ${fillClass}" style="width:${scorePct}%;"></div>
                <div class="cutoff-marker" style="left:${cutoffPct}%;"></div>
            </div>
            <div class="score-text">${Number.isInteger(score) ? score : parseFloat(score.toFixed(2))} / ${totalMarks}</div>
        </div>`;
}

// ── Render Mocks ──────────────────────────────────────────────────────────────
function renderMocks() {
    const grid = document.getElementById('quizGrid');
    if (!grid || !LIVE_JSON) return;

    renderStatusTabs();
    _lastStatusSignature = _allItems().map(i => i.id + ':' + _getItemStatus(i)).join('|');

    const profile    = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    const username   = profile ? profile.username : "Guest";

    // Pool per tab — upcoming/live by status across ALL categories;
    // attempted = every attempted test in the whole JSON, newest first.
    let pool = [];
    if (currentStatusTab === 'attempted') {
        pool = _allItems()
            .map(item => {
                const rec = CLOUD_CHECKLIST[item.id] || null;
                const localRaw = _lsGet(`result_${username}_${item.id}`);
                let createdAt = rec && rec.createdAt ? rec.createdAt : null;
                if (!createdAt && localRaw) {
                    try {
                        const fp = (JSON.parse(localRaw) || {}).firebasePayload || {};
                        if (fp.submittedAt) createdAt = new Date(fp.submittedAt).toISOString();
                    } catch (e) { /* unreadable — sorts last */ }
                }
                return { item, rec, attempted: localRaw !== null || !!rec, createdAt };
            })
            .filter(x => x.attempted)
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    } else {
        pool = _allItems()
            .filter(item => _getItemStatus(item) === currentStatusTab)
            .map(item => ({ item, rec: CLOUD_CHECKLIST[item.id] || null, attempted: _isAttempted(username, item.id), createdAt: null }));
    }

    let html = '';
    pool.forEach(({ item, rec }) => {
        const status      = _getItemStatus(item);
        const countdown   = _formatCountdown(item);
        const isSubmitted = !!rec || _lsGet(`result_${username}_${item.id}`) !== null;

        // Manual/date lock — same convention as the other engines
        const isManuallyLocked = item.releaseDate && String(item.releaseDate).trim().toLowerCase() === 'locked';
        let isLockedDate = false;
        if (!isManuallyLocked && item.releaseDate && String(item.releaseDate).trim() !== "") {
            const [day, month, year] = String(item.releaseDate).split('-').map(Number);
            const releaseDateObj = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            isLockedDate = releaseDateObj > today;
        }
        const accessDenied = item.type === 'paid' && !isPaidUser;

        const idPart   = (item.linkStr && String(item.linkStr).trim()) ? String(item.linkStr).trim() : item.id;
        const testLink = `${getLiveLink(item)}?id=${idPart}`;

        // Actions — NOTE: no reattempt anywhere; attempted = ANALYSIS only
        let actionHtml = '';
        if (isManuallyLocked) {
            actionHtml = `<div class="action-btn locked-btn">🔒 Locked</div>`;
        } else if (isLockedDate) {
            actionHtml = `<div class="action-btn locked-btn">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 Unlock Test</a>`;
        } else if (isSubmitted) {
            actionHtml = `<a href="${testLink}" class="action-btn analysis-btn">Analysis</a>`;
        } else if (status === 'upcoming') {
            actionHtml = `<div class="action-btn waiting-btn">Starts Soon</div>`;
        } else if (status === 'live') {
            actionHtml = `<a href="${testLink}" class="action-btn start-btn">Start Now</a>`;
        } else {
            actionHtml = `<div class="action-btn ended-btn">Live Ended</div>`;
        }

        const chip = status === 'live'
            ? `<span class="st-chip live"><span class="dot"></span>Live</span>`
            : status === 'upcoming'
                ? `<span class="st-chip upcoming"><span class="dot"></span>Upcoming</span>`
                : `<span class="st-chip ended"><span class="dot"></span>Ended</span>`;

        const attemptedText = isSubmitted
            ? `Attempted on ${_formatAttemptedDate(rec && rec.createdAt) || '—'}`
            : 'Not Attempted';

        const shareTitle  = String(item.title || '').replace(/'/g, "\\'");
        let shareUrlAbs = testLink;
        try { shareUrlAbs = new URL(testLink, window.location.href).href; } catch (e) { /* opaque origin — keep relative */ }

        html += `
        <div class="live-card ${status === 'live' ? 'is-live' : status === 'previous' ? 'is-ended' : 'is-upcoming'}">
            <div class="lc-clip">
                <div class="lc-top">
                    ${chip}
                    <span class="countdown-pill ${countdown.cls}" data-cd-from="${item.liveFrom || ''}" data-cd-to="${item.liveTo || ''}">${countdown.text}</span>
                </div>
                <div class="lc-row">
                    <div class="lc-info">
                        <div class="lc-title">${item.title} <span class="badge-type ${item.type === 'free' ? 'free-badge' : 'paid-badge'}">${String(item.type || 'free').toUpperCase()}</span></div>
                        <div class="lc-window"><svg ${LM_SVG}><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>${item.liveFrom || '—'} → ${item.liveTo || '—'} IST<span class="cat-tag">${item._category || ''}</span></div>
                        <div class="lc-meta"><span class="cm"><svg ${LM_SVG}><path d="M8.5 6H21M8.5 12H21M8.5 18H21M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>${item.qs || '--'} Qs</span><span class="cm"><svg ${LM_SVG}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>${item.time || '--'}</span><span class="cm"><svg ${LM_SVG}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></svg>${item.marks || '--'} Marks</span></div>
                    </div>
                    <div class="btn-grid">${actionHtml}</div>
                </div>
                ${isSubmitted ? _scoreRowHtml(item, rec) : ''}
                <div class="lc-footer">
                    <span class="attempted-on"><svg ${LM_SVG}><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>${attemptedText}</span>
                    <button type="button" class="share-link" onclick="shareMock('${shareUrlAbs}', '${shareTitle}')">
                        <svg ${LM_SVG} stroke-width="2.2"><path d="M4.5 12.5v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M12 15V4M8 7.5L12 4l4 3.5"/></svg> Share
                    </button>
                </div>
            </div>
        </div>`;
    });

    grid.innerHTML = html || (
        currentStatusTab === 'upcoming'
            ? _emptyState('clock', 'No upcoming lives right now', 'New live tests will appear here as soon as they are scheduled.')
            : currentStatusTab === 'live'
                ? _emptyState('bolt', 'Nothing live at this moment', 'Check the Upcoming Live tab to see what starts next.')
                : _emptyState('chart', 'No attempted tests yet', 'Every test you attempt will collect here with your score.')
    );
    const gridSync = document.getElementById('grid-sync');
    if (gridSync) gridSync.innerText = "";
}

// ══════════════════════════════════════════════════════════════════════════════
//  syncWithCloud  —  Cross-device attempt checker
//  IDENTICAL strategy to exam-engine.js / ssc-sub-engine.js:
//
//  CACHE STRUCTURE (local vs worker-confirmed, kept separate):
//    localStorage[CLOUD_SYNC_user_exam] = {
//        workerSynced: bool,   // true once a real worker fetch has completed on this device
//        local:  { quizId: {score, createdAt} },  // written directly by THIS device the
//                                                  // moment a test is submitted here —
//                                                  // optimistic, not yet worker-confirmed
//        worker: { quizId: {score, createdAt} }   // last full snapshot pulled from the worker
//    }
//    CLOUD_CHECKLIST (in-memory, used by renderMocks) = { ...worker, ...local } merged.
//
//  DECISION RULE:
//    - "local" entries get absorbed from this device's own result_<user>_<id> keys
//      every time syncWithCloud runs — no fetch needed for that, it's already on-device.
//    - A worker fetch only happens if workerSynced is still false — i.e. this device
//      has ONLY local (unconfirmed) entries and has never confirmed against the worker.
//      Once workerSynced flips true, it stays true — no more auto-fetches — until the
//      user taps "Refetch Attempts".
//    - On any successful worker fetch (auto or manual), worker is fully replaced with
//      the fresh data AND local is cleared — everything is now worker-confirmed.
// ══════════════════════════════════════════════════════════════════════════════
function _cloudCacheKey(user, exam) {
    return `CLOUD_SYNC_${user}_${exam}`;
}

function _loadCacheObject(cacheKey) {
    const raw = _lsGet(cacheKey);
    if (!raw) return { workerSynced: false, local: {}, worker: {} };
    try {
        const parsed = JSON.parse(raw);
        return {
            workerSynced: !!parsed.workerSynced,
            local: parsed.local || {},
            worker: parsed.worker || {}
        };
    } catch (e) {
        try { localStorage.removeItem(cacheKey); } catch (e2) {}
        return { workerSynced: false, local: {}, worker: {} };
    }
}

function _saveCacheObject(cacheKey, cache) {
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (e) {}
}

function _mergedChecklist(cache) {
    return { ...cache.worker, ...cache.local };
}

// Scans this device's own result_<user>_<id> / qsum_<user>_<id> keys for this
// exam and adds any quizId not already known into cache.local — this is what
// lets a just-submitted test show up immediately, no fetch required.
// Match token: the exam name without a trailing "-test" so that live quiz ids
// (e.g. LIVE-FL-101 / CGL-LIVE-01) match the page's exam name (live-test).
function _absorbLocalResultsIntoCache(user, exam) {
    const cacheKey = _cloudCacheKey(user, exam);
    const cache = _loadCacheObject(cacheKey);
    let changed = false;
    const matchToken = exam.endsWith('-test') ? exam.slice(0, -5) : exam;

    // Preferred path: the small qsum_<user>_<id> key test.html writes on
    // every submit ({quizId, score, attempted, submittedAt}).
    Object.keys(localStorage).forEach(key => {
        if (!key.startsWith(`qsum_${user}_`)) return;
        const id = key.replace(`qsum_${user}_`, "");
        if (!id.toLowerCase().includes(matchToken)) return;

        if (!cache.worker[id] && !cache.local[id]) {
            try {
                const summary = JSON.parse(localStorage.getItem(key));
                cache.local[id] = {
                    score: typeof summary.score === 'number' ? summary.score : null,
                    createdAt: summary.submittedAt ? new Date(summary.submittedAt).toISOString() : new Date().toISOString()
                };
                changed = true;
            } catch (e) { /* unreadable — skip, don't crash */ }
        }
        localStorage.removeItem(key); // absorbed (or already known, or unreadable) — done either way
    });

    // Fallback for older result_ data saved before qsum_ existed. Left in
    // place afterward — deleting big keys is storage-pressure cleanup's job.
    Object.keys(localStorage).forEach(key => {
        if (!key.startsWith(`result_${user}_`)) return;
        const id = key.replace(`result_${user}_`, "");
        if (!id.toLowerCase().includes(matchToken)) return;
        if (cache.worker[id] || cache.local[id]) return;

        try {
            const resultData = JSON.parse(localStorage.getItem(key));
            const fp = resultData.firebasePayload || {};
            cache.local[id] = {
                score: typeof fp.score === 'number' ? fp.score : null,
                createdAt: fp.submittedAt ? new Date(fp.submittedAt).toISOString() : new Date().toISOString()
            };
            changed = true;
        } catch (e) { /* unreadable result — skip */ }
    });

    if (changed) _saveCacheObject(cacheKey, cache);
    return cache;
}

async function fetchAttemptedStatus(user, exam) {
    const config = await loadAttemptsWorkerConfig();
    const workerUrl = getAttemptsWorkerURL(config, exam);
    if (!workerUrl) throw new Error(`No attempts worker configured for "${exam}"`);

    const res = await fetch(`${workerUrl}/attempted-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailKey: user })
    });
    if (!res.ok) throw new Error(`Worker ${res.status}`);
    const data = await res.json();
    return data.results || {};
}

// Shared by both the first-time auto-fetch and the manual "Refetch Attempts" —
// worker fully replaces "worker", "local" is cleared (everything now
// worker-confirmed), workerSynced flips true so no more auto-fetches happen.
function _overwriteWithWorkerData(user, exam, freshData) {
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`result_${user}_`)) {
            const id = key.replace(`result_${user}_`, "");
            if (id.toLowerCase().includes(exam) && !freshData[id]) {
                localStorage.removeItem(`result_${user}_${id}`);
                localStorage.removeItem(`state_${user}_${id}`);
            }
        }
    });

    const cache = { workerSynced: true, worker: freshData, local: {} };
    _saveCacheObject(_cloudCacheKey(user, exam), cache);

    CLOUD_CHECKLIST = _mergedChecklist(cache); // = freshData, since local is now empty
    renderMocks();
}

async function syncWithCloud(examName) {
    injectSyncUI();
    requestPersistentStorage();

    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") return;

    const user = profile.username;  // original case — NOT lowercased
    const exam = examName.toLowerCase();
    CURRENT_SYNC_USER = user;
    CURRENT_SYNC_EXAM = exam;

    // Absorb any attempts made on this device first — instant, no network.
    const cache = _absorbLocalResultsIntoCache(user, exam);
    CLOUD_CHECKLIST = _mergedChecklist(cache);
    renderMocks();

    if (cache.workerSynced) return; // already worker-confirmed before — no fetch

    // Never confirmed against the worker on this device — fetch once.
    try {
        const freshData = await fetchAttemptedStatus(user, exam);
        _overwriteWithWorkerData(user, exam, freshData);
    } catch (e) {
        console.error("Cloud sync failed (non-fatal):", e.message);
        // Page still works fine off the local-only merged view above.
    }
}

// Manual path — always fetches, regardless of workerSynced state, and fully
// overwrites the cache (worker replaced, local cleared). Used only by the
// header "Refetch Attempts" button/popup.
async function forceSyncWithCloud() {
    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (!profile || profile.username === "Guest") {
        throw new Error("Sign in to refresh your attempts");
    }
    const user = profile.username;
    const exam = CURRENT_SYNC_EXAM || "";
    const freshData = await fetchAttemptedStatus(user, exam);
    _overwriteWithWorkerData(user, exam, freshData);
}

// ── Header button + confirmation popup (injected via JS — no HTML edits) ────
function injectSyncUI() {
    if (_syncUIInjected) return;
    _syncUIInjected = true;

    const anchor = document.getElementById('syncAnchor');
    if (anchor) {
        const btn = document.createElement('button');
        btn.id = 'cloudSyncBtn';
        btn.type = 'button';
        btn.className = 'sync-btn';
        btn.title = 'Refetch Attempts';
        btn.innerHTML = `<i class="fas fa-rotate"></i><span class="sync-btn-label">Refetch Attempts</span>`;
        btn.onclick = openSyncModal;
        anchor.appendChild(btn);
    }

    const overlay = document.createElement('div');
    overlay.id = 'syncModalOverlay';
    overlay.className = 'sync-modal-overlay hidden';
    overlay.innerHTML = `
        <div class="sync-modal-box">
            <div class="sync-modal-icon"><i class="fas fa-rotate"></i></div>
            <h5>Attempted a test but don't see it here?</h5>
            <p>This can happen if you attempted it on another device. Tap refresh to check again.</p>
            <div class="sync-modal-actions">
                <button class="sync-modal-btn cancel" type="button">Cancel</button>
                <button class="sync-modal-btn confirm" type="button" id="syncModalConfirmBtn">Refresh Now</button>
            </div>
            <div id="syncModalStatus" class="sync-modal-status"></div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSyncModal(); });
    overlay.querySelector('.cancel').onclick = closeSyncModal;
    overlay.querySelector('#syncModalConfirmBtn').onclick = confirmSyncRefresh;
}

function openSyncModal() {
    const overlay = document.getElementById('syncModalOverlay');
    if (!overlay) return;
    const status = document.getElementById('syncModalStatus');
    status.textContent = '';
    status.className = 'sync-modal-status';
    overlay.classList.remove('hidden');
}

function closeSyncModal() {
    const overlay = document.getElementById('syncModalOverlay');
    if (overlay) overlay.classList.add('hidden');
}

async function confirmSyncRefresh() {
    const btn = document.getElementById('syncModalConfirmBtn');
    const status = document.getElementById('syncModalStatus');
    btn.disabled = true;
    status.textContent = 'Checking your attempts…';
    status.className = 'sync-modal-status';
    try {
        await forceSyncWithCloud();
        status.textContent = 'Updated!';
        status.className = 'sync-modal-status success';
        setTimeout(closeSyncModal, 900);
    } catch (e) {
        status.textContent = e.message || 'Could not refresh — please try again.';
        status.className = 'sync-modal-status error';
    } finally {
        btn.disabled = false;
    }
}

// ── Page Lifecycle (bfcache-safe, same pattern as the other engines) ─────────
window.addEventListener('pageshow', function (event) {
    initLiveMockEngine();
    if (event.persisted || (window.performance && window.performance.navigation && window.performance.navigation.type === 2)) {
        if (LIVE_JSON) renderMocks();
    }
});

// auth.js may land after first render — re-render once the real profile does
window.addEventListener('profileUpdated', function () {
    if (LIVE_JSON) renderMocks();
});
