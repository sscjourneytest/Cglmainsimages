// ── Exams Index Engine (app-grade rebuild) ──────────────────────────────────
// Renders the exam-board grid (SSC / Railway / State) and, on tap, the
// exam list (CGL / CHSL / …) entirely from /data/exam-categories.json.
// Nothing is hardcoded — edit the JSON to add, remove, or reorder exams.
//
// · Visual system: /css/design.css (same tokens/cards/search as the mock
//   pages) + /css/exams.css (bottom nav, badges, search input ids).
// · Icons: inline SVG map below (per exam id) — no icon-font dependency.
//   A JSON item may set "icon": "<key>" (e.g. "train") to pick one.
// · State: the open board is kept in the URL hash (#ssc). Reload while on
//   the second screen and you land right back on it; browser back works.
// · Search: on BOTH screens, in-content (never in the header), live filter
//   with clear button + empty state — same pattern as the mock pages.
// · Skeleton cards render until the JSON arrives; failures get a retry.

const EXAM_CATEGORIES_URL = '/data/exam-categories.json';

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

let CATEGORY_DATA = null;
let currentView   = 'categories';   // 'categories' | 'subs'
let currentCatId  = null;
let catQuery      = '';
let subQuery      = '';
let _wePushedHash = false;          // did WE set the hash (vs deep link)?

// ── Inline SVG icon set (24×24, stroke = currentColor — design.css style) ───
const _S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const EXAM_ICONS = {
    // boards / categories
    'landmark': `<svg ${_S}><path d="M2.8 20.5h18.4M4.5 20.5V9.8m15 10.7V9.8M8.7 20.5V9.8m6.6 10.7V9.8M2 9.8h20L12 3.2 2 9.8z"/></svg>`,
    'train-front': `<svg ${_S}><rect x="5" y="2.8" width="14" height="13.4" rx="3.6"/><path d="M5 9.6h14M8.2 19.4 6.4 21.8m9.4-2.4 1.8 2.4M6.8 16.2h10.4"/><circle cx="9" cy="12.9" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="12.9" r=".7" fill="currentColor" stroke="none"/></svg>`,
    'map': `<svg ${_S}><path d="M9 4.2 3.7 6.3a1 1 0 0 0-.6.9v11.4a1 1 0 0 0 1.4.9L9 17.7l6 2.3 5.3-2.1a1 1 0 0 0 .6-.9V5.6a1 1 0 0 0-1.4-.9L15 6.5 9 4.2zM9 4.2v13.5m6-11.2v13.5"/></svg>`,
    // exams
    'book-open': `<svg ${_S}><path d="M12 6.6S10.2 5 7.7 5C5.8 5 4.2 5.6 3.2 6.2a1 1 0 0 0-.5.9v10.2a1 1 0 0 0 1.5.8c1-.6 2.5-1.1 4.4-1.1 2.4 0 4.4 1.4 4.4 1.4s1.6-1.4 4-1.4c1.9 0 3.6.5 4.6 1.1a1 1 0 0 0 1.5-.8V7.1a1 1 0 0 0-.5-.9C21.6 5.6 20 5 18.1 5c-2.5 0-4.3 1.6-4.3 1.6"/><path d="M12 6.6v13.2"/></svg>`,
    'star': `<svg ${_S}><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6z"/></svg>`,
    'grad-cap': `<svg ${_S}><path d="M12 3.8 2.6 8.7 12 13.6l9.4-4.9L12 3.8zM5.6 10.4v5c0 1.7 2.9 3.4 6.4 3.4s6.4-1.7 6.4-3.4v-5M21.4 8.7v5.6"/></svg>`,
    'notebook': `<svg ${_S}><rect x="4.8" y="3.2" width="14.4" height="17.6" rx="2.4"/><path d="M9.2 3.2v17.6M12.6 8.2h3.4M12.6 12h3.4M12.6 15.8h3.4"/></svg>`,
    'briefcase': `<svg ${_S}><rect x="3" y="7.4" width="18" height="12.6" rx="2.4"/><path d="M8.6 7.4V6a2 2 0 0 1 2-2h2.8a2 2 0 0 1 2 2v1.4M3 12.6h18M10.8 12.6v1.8h2.4v-1.8"/></svg>`,
    'shield-check': `<svg ${_S}><path d="M12 2.9 19.4 5.7v5.5c0 4.7-3.1 8.3-7.4 9.9-4.3-1.6-7.4-5.2-7.4-9.9V5.7L12 2.9z"/><path d="m8.9 11.9 2.2 2.2 4-4.3"/></svg>`,
    'shield-star': `<svg ${_S}><path d="M12 2.9 19.4 5.7v5.5c0 4.7-3.1 8.3-7.4 9.9-4.3-1.6-7.4-5.2-7.4-9.9V5.7L12 2.9z"/><path d="m12 7.9 1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4L12 7.9z"/></svg>`,
    'keyboard': `<svg ${_S}><rect x="2.6" y="5.8" width="18.8" height="12.4" rx="2.4"/><path d="M6.2 9.4h.01M9.6 9.4h.01M13 9.4h.01M16.4 9.4h.01M6.2 12.4h.01M17.8 12.4h.01M9.4 15.4h5.2M9.6 12.4h4.8"/></svg>`,
    'id-badge': `<svg ${_S}><rect x="4.2" y="3.2" width="15.6" height="17.6" rx="2.4"/><circle cx="12" cy="9.4" r="2.6"/><path d="M7.6 17.2c.8-2.2 2.5-3.4 4.4-3.4s3.6 1.2 4.4 3.4"/></svg>`,
    'tram': `<svg ${_S}><rect x="6" y="3.4" width="12" height="13.2" rx="3"/><path d="M6 9.2h12M9.2 16.6 7.4 21m9.2-4.4 1.8 4.4M12 3.4V1.4M9 1.4h6"/><circle cx="9.2" cy="13.2" r=".7" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.2" r=".7" fill="currentColor" stroke="none"/></svg>`,
    'users': `<svg ${_S}><circle cx="9.2" cy="8" r="3.3"/><path d="M3.4 19.6c.7-3.4 2.9-5.2 5.8-5.2s5.1 1.8 5.8 5.2M15.8 5.1a3.3 3.3 0 0 1 0 5.8M17.6 14.9c2.1.6 3.4 2.3 3.9 4.7"/></svg>`,
    'gauge': `<svg ${_S}><path d="M4 17.6a8.8 8.8 0 1 1 16 0"/><path d="m12 13.8 3.8-3.8"/><circle cx="12" cy="14.6" r="1.3" fill="currentColor" stroke="none"/><path d="M4 17.6h3.2M16.8 17.6H20"/></svg>`,
    'doc': `<svg ${_S}><path d="M6 2.8h7.6L19 8.2v13H6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M13.4 2.8v5.6H19M8.6 12.8h7M8.6 16.4h7"/></svg>`
};

// id → icon key + colour variant (design.css .nc-ico palettes)
const EXAM_ICON_MAP = {
    'ssc':            { icon: 'landmark',    color: 'blue'   },
    'railway':        { icon: 'train-front', color: 'teal'   },
    'state':          { icon: 'map',         color: 'amber'  },
    'ssc-sub':        { icon: 'book-open',   color: 'violet' },
    'ssc-sub-top':    { icon: 'star',        color: 'amber'  },
    'cgl':            { icon: 'grad-cap',    color: 'blue'   },
    'chsl':           { icon: 'notebook',    color: 'violet' },
    'mts':            { icon: 'briefcase',   color: 'teal'   },
    'cpo':            { icon: 'shield-check',color: 'slate'  },
    'steno':          { icon: 'keyboard',    color: 'amber'  },
    'selection-post': { icon: 'id-badge',    color: 'blue'   },
    'gd':             { icon: 'shield-star', color: 'teal'   },
    'ntpcg':          { icon: 'train-front', color: 'blue'   },
    'ntpc-ug':        { icon: 'tram',        color: 'violet' },
    'group-d':        { icon: 'users',       color: 'teal'   },
    'alp':            { icon: 'gauge',       color: 'amber'  }
};
const _COLOR_CYCLE = ['blue', 'violet', 'teal', 'amber', 'slate'];

const ICO_UI = {
    chev:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
    search: `<svg class="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/></svg>`,
    x:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    sun:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    moon:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    warn:   `<svg class="error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3h.01"/></svg>`,
    check:  `<svg class="success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>`
};

// ── Bottom dock (floating pill bar with a raised center button) ───────────
// One list drives the whole bar on every screen size. To add an item later
// just append it here (or set window.MMH_BOTTOM_NAV before this script runs)
// — left/right halves re-balance around the `center` entry automatically.
const NAV_ICONS = {
    'grid':      `<svg ${_S} stroke-width="2"><rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.2"/><rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.2"/><rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.2"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.2"/></svg>`,
    'bolt':      `<svg ${_S}><path d="M13 2 4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>`,
    'bookmark':  `<svg ${_S}><path d="M6.6 3.4h10.8a1 1 0 0 1 1 1V21l-6.4-4-6.4 4V4.4a1 1 0 0 1 1-1z"/></svg>`,
    'user':      `<svg ${_S}><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6"/></svg>`,
    'book-open': EXAM_ICONS['book-open'],
    'train-front': EXAM_ICONS['train-front'],
    'star':      EXAM_ICONS['star'],
    'grad-cap':  EXAM_ICONS['grad-cap'],
    'gauge':     EXAM_ICONS['gauge']
};

const DEFAULT_BOTTOM_NAV = [
    { id: 'exams',   label: 'Exams',   href: '/exams/index.html',    icon: 'book-open',   match: ['/exams/index.html'] },
    { id: 'live',    label: 'Live',    href: '/live-test/index.html', icon: 'bolt',        match: ['/live'] },
    { id: 'home',    label: 'Home',    href: '/',          icon: 'grid',        center: true, match: ['/'] },
    { id: 'saved',   label: 'Saved',   href: '/saved/index.html',     icon: 'bookmark',    match: ['/saved/index.html'] },
    { id: 'profile', label: 'Profile', href: '/profile.html',   icon: 'user',        match: ['/profile.html'] }
];
function getDefaultBottomNav() { return DEFAULT_BOTTOM_NAV.map(o => Object.assign({}, o)); }
window.getDefaultBottomNav = getDefaultBottomNav;

function _activeNavId(items) {
    if (window.__NAV_ACTIVE__) return window.__NAV_ACTIVE__;
    let path = '';
    try { path = window.location.pathname; } catch (e) { /* ignore */ }
    const hit = items.find(i => !i.center && (i.match || []).some(m => m !== '/' && path.indexOf(m) === 0));
    if (hit) return hit.id;
    if (path === '/' || /index\.html?$/.test(path) || path === '') {
        const c = items.find(i => i.center);
        if (c) return c.id;
    }
    return '';
}

function renderBottomNav() {
    const nav = document.getElementById('bottomNav');
    if (!nav) return;
    const items = (window.MMH_BOTTOM_NAV && window.MMH_BOTTOM_NAV.length) ? window.MMH_BOTTOM_NAV : DEFAULT_BOTTOM_NAV;
    const ci = items.findIndex(i => i.center);
    const center = ci >= 0 ? items[ci] : null;
    const left   = center ? items.slice(0, ci) : items.slice(0, Math.floor(items.length / 2));
    const right  = center ? items.slice(ci + 1) : items.slice(Math.floor(items.length / 2));
    const active = _activeNavId(items);

    const side = it => `
        <a class="ex-dock-item${it.id === active ? ' active' : ''}" href="${_esc(it.href)}" aria-label="${_esc(it.label)}">
            ${NAV_ICONS[it.icon] || NAV_ICONS.grid}<span>${_esc(it.label)}</span>
        </a>`;
    const mid = center ? `
        <a class="ex-dock-item ex-dock-center${center.id === active ? ' active' : ''}" href="${_esc(center.href)}" aria-label="${_esc(center.label)}">
            <span class="ex-dock-fab">${NAV_ICONS[center.icon] || NAV_ICONS.grid}</span>
        </a>` : '';

    nav.innerHTML = left.map(side).join('') + mid + right.map(side).join('');
}
window.renderBottomNav = renderBottomNav;


function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Icon resolution: JSON "icon" key (when it names one of ours) → id map → doc.
function _iconFor(item, idx) {
    const byField = item && item.icon && EXAM_ICONS[String(item.icon).replace(/^fa[srlbd]? fa-/, '')]
        ? String(item.icon).replace(/^fa[srlbd]? fa-/, '') : null;
    const cfg = EXAM_ICON_MAP[item && item.id] || null;
    const key = byField || (cfg && cfg.icon) || 'doc';
    const color = (cfg && cfg.color) || _COLOR_CYCLE[(idx || 0) % _COLOR_CYCLE.length];
    return { html: EXAM_ICONS[key] || EXAM_ICONS.doc, color };
}

// Logo image with a graceful fall back to the SVG icon when it 404s.
function _icoHtml(item, idx) {
    const ic = _iconFor(item, idx);
    if (item && item.logo) {
        return `<span class="nc-ico ${ic.color}" data-icon-html="${encodeURIComponent(ic.html)}">
                    <img class="nc-logo" src="${_esc(item.logo)}" alt="" loading="lazy"
                         onerror="window._logoFailed(this)">
                </span>`;
    }
    return `<span class="nc-ico ${ic.color}">${ic.html}</span>`;
}
window._logoFailed = function (img) {
    try {
        const wrap = img.closest('.nc-ico');
        if (wrap) wrap.innerHTML = decodeURIComponent(wrap.dataset.iconHtml || '');
    } catch (e) { if (img && img.remove) img.remove(); }
};

function _badgeHtml(badge) {
    if (!badge) return '';
    const soon = /soon/i.test(String(badge));
    return `<span class="nc-badge ${soon ? 'soon' : 'new'}">${_esc(badge)}</span>`;
}

function _chev() { return `<span class="nc-chev">${ICO_UI.chev}</span>`; }

// ── Toast (design.css #toastRoot/.toast styles) ─────────────────────────────
function showToast(message, type) {
    let root = document.getElementById('toastRoot');
    if (!root) {
        root = document.createElement('div');
        root.id = 'toastRoot';
        root.setAttribute('aria-live', 'polite');
        document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = (type === 'error' ? ICO_UI.warn : ICO_UI.check) + `<span>${_esc(message)}</span>`;
    root.appendChild(el);
    setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 260);
    }, 2400);
}
window.showToast = showToast;

// ── Theme (same `mmh_theme` key as every other page) ────────────────────────
const THEME_KEY = 'mmh_theme';
function currentTheme() {
    try {
        const s = localStorage.getItem(THEME_KEY);
        if (s === 'dark' || s === 'light') return s;
    } catch (e) { /* private mode */ }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme(t) {
    document.body.classList.toggle('dark-mode', t === 'dark');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === 'dark' ? '#121a30' : '#ffffff';   /* = --surface: status bar blends with header */
    document.querySelectorAll('.theme-btn').forEach(b => {
        b.innerHTML = t === 'dark' ? ICO_UI.sun : ICO_UI.moon;
        b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
}
function toggleTheme() {
    const t = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    applyTheme(t);
}
window.toggleTheme = toggleTheme;

// ── Skeletons (design.css .skeleton-nav-card) ───────────────────────────────
function _skeletonCards(n) {
    return Array(n).fill(
        `<div class="nav-card skeleton-nav-card"><div class="nc-ico skeleton-line"></div><div class="nc-body"><div class="skeleton-line skeleton-nc-title"></div><div class="skeleton-line skeleton-nc-meta"></div></div></div>`
    ).join('');
}

// ── Search helpers ───────────────────────────────────────────────────────────
function _norm(s) { return String(s || '').toLowerCase().trim(); }
function _matches(q, ...fields) {
    if (!q) return true;
    return fields.some(f => _norm(f).includes(q));
}
function _wireSearch(inputId, clearId, onInput) {
    const input = document.getElementById(inputId);
    const clear = document.getElementById(clearId);
    if (!input) return;
    input.addEventListener('input', () => {
        if (clear) clear.classList.toggle('show', !!input.value);
        onInput(_norm(input.value));
    });
    if (clear) clear.addEventListener('click', () => {
        input.value = '';
        clear.classList.remove('show');
        onInput('');
        input.focus();
    });
}

// ── Categories screen ────────────────────────────────────────────────────────
function renderCategories() {
    const list = document.getElementById('categoryCards');
    if (!list) return;
    const cats = (CATEGORY_DATA && CATEGORY_DATA.categories) || [];
    const q = catQuery;

    const shown = cats.filter(c =>
        _matches(q, c.title, c.subtitle) ||
        (c.items || []).some(it => _matches(q, it.title, it.subtitle))
    );

    const totalExams = cats.reduce((n, c) => n + ((c.items || []).length), 0);
    const intro = document.getElementById('catsIntroSub');
    if (intro) {
        intro.textContent = q
            ? `${shown.length} match${shown.length === 1 ? '' : 'es'} for “${catQuery}”`
            : `${cats.length} boards · ${totalExams} exams`;
    }

    list.innerHTML = shown.length ? shown.map((cat, i) => {
        const n = (cat.items || []).length;
        const soon = cat.comingSoon || !n;
        return `
        <button type="button" class="nav-card${soon ? ' is-soon' : ''}" onclick="showSubCategory('${_esc(cat.id)}')">
            ${_icoHtml(cat, i)}
            <span class="nc-body">
                <span class="nc-title">${_esc(cat.title)} ${_badgeHtml(cat.badge)}</span>
                <span class="nc-meta">${_esc(cat.subtitle || (n ? n + ' exams' : ''))}</span>
            </span>
            ${n ? `<span class="nc-count">${n}</span>` : ''}
            ${_chev()}
        </button>`;
    }).join('') : `
        <div class="empty-state">
            <div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/></svg></div>
            <div class="empty-title">No boards found</div>
            <div class="empty-sub">Nothing matches “${_esc(catQuery)}”. Try a different search.</div>
        </div>`;
}

// ── Sub-category (exam list) screen ─────────────────────────────────────────
function renderSubs() {
    const list = document.getElementById('subCards');
    if (!list) return;
    const cat = ((CATEGORY_DATA && CATEGORY_DATA.categories) || []).find(c => c.id === currentCatId);
    if (!cat) return;

    const items = cat.items || [];
    const q = subQuery;
    const shown = items.filter(it => _matches(q, it.title, it.subtitle));

    list.innerHTML = shown.length ? shown.map((item, i) => `
        <a class="nav-card" href="${_esc(item.url || '#')}" data-exam-url="${_esc(item.url || '')}">
            ${_icoHtml(item, i)}
            <span class="nc-body">
                <span class="nc-title">${_esc(item.title)} ${_badgeHtml(item.badge)}</span>
                <span class="nc-meta">${_esc(item.subtitle || '')}</span>
            </span>
            ${_chev()}
        </a>`).join('') : `
        <div class="empty-state">
            <div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/></svg></div>
            <div class="empty-title">No exams found</div>
            <div class="empty-sub">Nothing matches “${_esc(subQuery)}” in ${_esc(cat.title)}.</div>
        </div>`;
}

// ── Screen switching (hash-backed — survives reload) ────────────────────────
function _setScreen(view) {
    const cats = document.getElementById('screenCategories');
    const subs = document.getElementById('screenSubs');
    if (!cats || !subs) return;
    if (view === 'subs') {
        cats.classList.remove('active', 'from-left');
        subs.classList.add('active');
        subs.classList.remove('from-left');
    } else {
        subs.classList.remove('active');
        cats.classList.add('active', 'from-left');
    }
    currentView = view;
    try { window.scrollTo(0, 0); } catch (e) { /* jsdom */ }
    const sc = document.querySelector(`#${view === 'subs' ? 'screenSubs' : 'screenCategories'} .screen-scroll`);
    if (sc) sc.scrollTop = 0;
}

function showSubCategory(catId, opts) {
    opts = opts || {};
    const cat = ((CATEGORY_DATA && CATEGORY_DATA.categories) || []).find(c => c.id === catId);
    if (!cat) return;

    if (cat.comingSoon || !cat.items || cat.items.length === 0) {
        showToast(`${cat.title.replace(/\s*EXAMS?$/i, '')} exams are coming soon — stay tuned!`, 'error');
        return;
    }

    currentCatId = catId;
    const t = document.getElementById('subsTitle');
    const s = document.getElementById('subsSubtitle');
    if (t) t.textContent = cat.title;
    if (s) s.textContent = cat.subtitle || '';
    document.title = `${cat.title} — Mock Matrix Hub`;

    subQuery = '';
    const si = document.getElementById('subSearch');
    const sc = document.getElementById('subSearchClear');
    if (si) si.value = '';
    if (sc) sc.classList.remove('show');

    renderSubs();
    _setScreen('subs');

    if (opts.pushHash !== false) {
        _wePushedHash = true;
        try { location.hash = '#' + catId; } catch (e) { /* file:// etc. */ }
    }
}
window.showSubCategory = showSubCategory;

function showCategories(opts) {
    opts = opts || {};
    _setScreen('categories');
    document.title = 'Exams — Mock Matrix Hub';
    if (opts.clearHash !== false) {
        _wePushedHash = false;
        try {
            // replace (not push) — in-page back shouldn't create a new entry
            history.replaceState(null, '', location.pathname + location.search);
        } catch (e) {
            try { location.hash = ''; } catch (e2) { /* ignore */ }
        }
    }
}
window.showCategories = showCategories;

// Browser back/forward + deep links (#ssc) drive the same switch.
function _syncFromHash() {
    if (!CATEGORY_DATA) return;
    let h = '';
    try { h = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (e) { h = ''; }
    if (h) {
        const cat = (CATEGORY_DATA.categories || []).find(c => c.id === h);
        if (cat && !cat.comingSoon && cat.items && cat.items.length) {
            if (currentView !== 'subs' || currentCatId !== h) showSubCategory(h, { pushHash: false });
            return;
        }
        if (cat) { showToast(`${cat.title.replace(/\s*EXAMS?$/i, '')} exams are coming soon — stay tuned!`, 'error'); }
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }
    if (currentView === 'subs') showCategories({ clearHash: false });
}
window._syncFromHash = _syncFromHash;

// Back buttons: subs → categories; categories → home.
function handleBack() {
    if (currentView === 'subs') {
        if (_wePushedHash) { try { history.back(); return; } catch (e) { /* fall through */ } }
        showCategories();
    } else {
        window.location.href = '/';
    }
}
window.handleBack = handleBack;

// ── Init ─────────────────────────────────────────────────────────────────────
async function initExamsIndex() {
    applyTheme(currentTheme());
    renderBottomNav();
    document.querySelectorAll('.theme-btn').forEach(b => { b.onclick = toggleTheme; });

    const backCats = document.getElementById('backFromCategories');
    const backSubs = document.getElementById('backFromSubs');
    if (backCats) backCats.onclick = handleBack;
    if (backSubs) backSubs.onclick = handleBack;

    _wireSearch('catSearch', 'catSearchClear', q => { catQuery = q; renderCategories(); });
    _wireSearch('subSearch', 'subSearchClear', q => { subQuery = q; renderSubs(); });

    window.addEventListener('hashchange', _syncFromHash);

    const list = document.getElementById('categoryCards');
    if (list && !CATEGORY_DATA) list.innerHTML = _skeletonCards(3);

    try {
        if (window.__EXAM_CATEGORIES__) {
            CATEGORY_DATA = window.__EXAM_CATEGORIES__;      // standalone preview embed
        } else {
            const res = await fetchLiveFirst(EXAM_CATEGORIES_URL + '?v=' + Date.now());
            if (!res.ok) throw new Error('HTTP ' + res.status);
            CATEGORY_DATA = await res.json();
        }
        renderCategories();
        _syncFromHash();                                      // reload lands you back on screen 2
    } catch (e) {
        console.error('Failed to load exam categories', e);
        if (list) list.innerHTML = `
            <div class="empty-state">
                <div class="empty-ico">${ICO_UI.warn}</div>
                <div class="empty-title">Couldn't load exams</div>
                <div class="empty-sub">Please check your connection and try again.</div>
                <button type="button" class="ex-retry" onclick="initExamsIndex()">Try Again</button>
            </div>`;
    }
}
window.initExamsIndex = initExamsIndex;

document.addEventListener('DOMContentLoaded', initExamsIndex);
