// ── Home Page Engine (app-grade rebuild) ────────────────────────────────────
// Renders every dynamic section (quick-action tiles, hero stats + CTAs,
// recommendations, popups, What's-New ticker) from /data/home-config.json
// + /whats-new.json. Nothing is hardcoded — edit the JSON to change content.
//
// SLOW / FLAKY NETWORK PROTECTION (the "config sometimes doesn't apply" fix):
//   1. fetchWithRetry  — 8s timeout per try, 3 tries, exponential backoff.
//      A hung request can no longer freeze the skeletons forever.
//   2. localStorage cache (stale-while-revalidate): if a config was ever
//      loaded before, it renders INSTANTLY from cache while a background
//      refresh runs; a failed refresh keeps the cached page intact.
//   3. First-ever visit + all tries fail → clear error card with Try Again.
//   4. window.HOME_CONFIG is set on every successful path (cache or fresh),
//      so checkTelegramPopup()/profileUpdated re-renders always have data.

const HOME_CONFIG_URL = '/data/home-config.json';
const APP_UPDATE_URL = '/data/app-update.json';
const CURRENT_APP_VERSION = '1.0.0';
const CURRENT_APP_VERSION_CODE = 1;
const APP_UPDATE_CACHE_KEY = 'mmh_app_update_v1';
const PLAY_STORE_FALLBACK = 'https://play.google.com/store/apps/details?id=com.mockmatrixhub.app';


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
const HOME_CONFIG_CACHE_KEY = 'mmh_home_config_v1';
const WHATS_NEW_CACHE_KEY = 'mmh_whats_new_v1';

// ── Inline SVG icon library (JSON "icon" keys — same idea as exam pages) ───
const _S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const HOME_ICONS = {
    'grad-cap': `<svg ${_S}><path d="M12 3.8 2.6 8.7 12 13.6l9.4-4.9L12 3.8zM5.6 10.4v5c0 1.7 2.9 3.4 6.4 3.4s6.4-1.7 6.4-3.4v-5M21.4 8.7v5.6"/></svg>`,
    'layers':   `<svg ${_S}><path d="M12 3 3 7.6l9 4.6 9-4.6L12 3zM3 12.2l9 4.6 9-4.6M3 16.6l9 4.6 9-4.6"/></svg>`,
    'bolt':     `<svg ${_S}><path d="M13 2 4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>`,
    'file-pdf': `<svg ${_S}><path d="M6 2.8h7.6L19 8.2v13H6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M13.4 2.8v5.6H19M8.6 12.6h2.2a1.6 1.6 0 0 1 0 3.2H8.6v-3.2zm0 3.2v3.4"/></svg>`,
    'notebook': `<svg ${_S}><rect x="4.8" y="3.2" width="14.4" height="17.6" rx="2.4"/><path d="M9.2 3.2v17.6M12.6 8.2h3.4M12.6 12h3.4M12.6 15.8h3.4"/></svg>`,
    'send':     `<svg ${_S}><path d="M21 3.5 10.2 14.3M21 3.5 14 21l-3.8-6.7L3.5 10.5 21 3.5z"/></svg>`,
    'crown':    `<svg ${_S}><path d="M3.5 8.5 8 12l4-6 4 6 4.5-3.5-1.6 10H5.1L3.5 8.5zM5 21h14"/></svg>`,
    'doc':      `<svg ${_S}><path d="M6 2.8h7.6L19 8.2v13H6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M13.4 2.8v5.6H19M8.6 12.8h7M8.6 16.4h7"/></svg>`,
    'users':    `<svg ${_S}><circle cx="9.2" cy="8" r="3.3"/><path d="M3.4 19.6c.7-3.4 2.9-5.2 5.8-5.2s5.1 1.8 5.8 5.2M15.8 5.1a3.3 3.3 0 0 1 0 5.8M17.6 14.9c2.1.6 3.4 2.3 3.9 4.7"/></svg>`,
    /* Real brand glyphs (filled) — WhatsApp & Telegram, exactly like the
       original design's `fab fa-whatsapp` / `fab fa-telegram` icons.     */
    'whatsapp': `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>`,
    'telegram': `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`
};
// Legacy Font-Awesome classes in older configs still resolve:
const FA_ALIASES = {
    'fa-graduation-cap': 'grad-cap', 'fa-layer-group': 'layers', 'fa-bolt': 'bolt',
    'fa-bolt-lightning': 'bolt', 'fa-file-pdf': 'file-pdf', 'fa-file-lines': 'doc',
    'fa-book-open': 'notebook', 'fa-telegram': 'telegram', 'fa-telegram-plane': 'telegram',
    'fa-whatsapp': 'whatsapp', 'fa-crown': 'crown'
};
function _icon(key, fallback) {
    const k = String(key || '');
    const fa = k.match(/fa-[\w-]+/);
    const resolved = HOME_ICONS[k] ? k : (fa && FA_ALIASES[fa[0]]) || fallback || 'doc';
    return HOME_ICONS[resolved] || HOME_ICONS.doc;
}
const TILE_COLORS = ['blue', 'violet', 'teal', 'amber', 'slate'];

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// isPaidUser mirrors the same check used elsewhere on the site.
function _isPaidUser() {
    try {
        const p = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
        return !!(p && p.is_paid);
    } catch (e) { return false; }
}

// Same signal the sidebar uses (app-core) to swap "Become a Partner"
// for the "Earnings" link: profile.is_partner.
function _isPartnerUser() {
    try {
        const p = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
        return !!(p && p.is_partner);
    } catch (e) { return false; }
}

function _getProfile(){
    try{ return typeof getLocalProfile === 'function' ? getLocalProfile() : null; }catch(e){ return null; }
}
function _parseExp(str){
    if(window.parseExpiryDate) return window.parseExpiryDate(str);
    if(!str) return null;
    try{
        let t=String(str).trim().replace(' ','T').replace(/\+00$/,'Z');
        const d=new Date(t);
        return isNaN(d) ? new Date(str) : d;
    }catch(e){ return null; }
}
function _getExpiryInfo(){
    const p=_getProfile();
    if(!p || !p.expires_at) return null;
    const exp=_parseExp(p.expires_at);
    if(!exp) return null;
    const msLeft=exp.getTime()-Date.now();
    const totalSec=Math.floor(msLeft/1000);
    return {
        expDate:exp, msLeft:msLeft, totalSec:totalSec,
        hours:Math.floor(totalSec/3600),
        minutes:Math.floor((totalSec%3600)/60),
        seconds:totalSec%60,
        totalHours:msLeft/3600000,
        isExpired:msLeft<=0,
        isExpiringSoon:msLeft>0 && msLeft<48*60*60*1000
    };
}
window._getExpiryInfo=_getExpiryInfo;
let _expiryInterval=null;
function formatTwo(n){ return String(Math.max(0,n)).padStart(2,'0'); }

// ── Resilient fetch: timeout + retries + backoff ────────────────────────────
async function fetchWithRetry(url, opts) {
    const tries = (opts && opts.tries) || 3;
    const timeoutMs = (opts && opts.timeoutMs) || 8000;
    const backoff = (opts && opts.backoffMs) || 700;
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        try {
            const res = await fetchLiveFirst(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Date.now(),
                ctrl ? { signal: ctrl.signal, cache: 'no-store' } : { cache: 'no-store' });
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch (e) {
            if (timer) clearTimeout(timer);
            lastErr = e;
            if (i < tries - 1) await new Promise(r => setTimeout(r, backoff * (i + 1)));
        }
    }
    throw lastErr || new Error('fetch failed');
}
window.fetchWithRetry = fetchWithRetry;

function _readCache(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function _writeCache(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota/private */ }
}

// ── Skeletons (design.css skeleton-nav-card / lines) ────────────────────────
function _skeletonTiles(n) {
    return Array(n).fill(
        `<div class="home-tile skeleton-nav-card"><span class="nc-ico skeleton-line"></span><span class="ht-body"><span class="skeleton-line skeleton-nc-title"></span><span class="skeleton-line skeleton-nc-meta"></span></span></div>`
    ).join('');
}
function _skeletonRecs(n) {
    return Array(n).fill(
        `<div class="nav-card skeleton-nav-card"><span class="nc-ico skeleton-line"></span><span class="nc-body"><span class="skeleton-line skeleton-nc-title"></span><span class="skeleton-line skeleton-nc-meta"></span></span></div>`
    ).join('');
}

// ── Init ─────────────────────────────────────────────────────────────────────
// ── Boot splash release ─────────────────────────────────────────────────────
// The static frame carries body.home-booting: everything below the header is
// hidden behind the branded splash until config/stats actually paint. This
// is what stops the reload flash of an empty home page.
function homeReady() {
    // idempotent (class removal is a no-op when already revealed); defer a
    // tick so app-core's theme (body.dark-mode) lands before the reveal
    setTimeout(() => document.body.classList.remove('home-booting'), 0);
}
window.homeReady = homeReady;

async function initHomeEngine() {
    const actionRow = document.getElementById('actionRow');
    const recGrid   = document.getElementById('recGrid');
    if (actionRow && !window.HOME_CONFIG) actionRow.innerHTML = _skeletonTiles(4);
    if (recGrid && !window.HOME_CONFIG)   recGrid.innerHTML   = _skeletonRecs(2);

    // 1) Instant paint from cache when we have one (stale-while-revalidate)
    const cached = window.__HOME_CONFIG__ || _readCache(HOME_CONFIG_CACHE_KEY);
    if (cached && !window.HOME_CONFIG) _applyConfig(cached, /*fromCache=*/true);
    if (window.HOME_CONFIG) homeReady();             // painted → reveal now

    // 2) Fresh config in background (or as the only attempt on first visit)
    try {
        const config = window.__HOME_CONFIG__ || await fetchWithRetry(HOME_CONFIG_URL);
        _writeCache(HOME_CONFIG_CACHE_KEY, config);
        _applyConfig(config, false);
        homeReady();
    } catch (e) {
        console.error('Failed to load home config', e);
        if (window.HOME_CONFIG) return;              // cached page stays as-is
        _renderConfigError();
        homeReady();                                 // show the error card, not splash
    }
}
window.initHomeEngine = initHomeEngine;

function _applyConfig(config, fromCache) {
    window.HOME_CONFIG = config;   // checkTelegramPopup() + profileUpdated use this
    renderButtons(config.buttons || []);
    renderHeroStats(config.stats);
    renderHeroCtas();
    renderRecommendations(config.recommendations || []);
    renderSalePopup(config.salePopup);
    checkExpiryCountdown();
    checkExpiredBanner();
    if (fromCache) {
        const note = document.getElementById('gridSyncNote');
        if (note) note.textContent = '';
    }
}

function _renderConfigError() {
    const actionRow = document.getElementById('actionRow');
    const recGrid = document.getElementById('recGrid');
    const html = `
        <div class="empty-state home-error">
            <div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3h.01"/></svg></div>
            <div class="empty-title">Couldn't load home content</div>
            <div class="empty-sub">Your connection seems slow or offline. Check it and try again.</div>
            <button type="button" class="retry-btn" onclick="initHomeEngine()">Try Again</button>
        </div>`;
    if (actionRow) actionRow.innerHTML = html;
    if (recGrid) recGrid.innerHTML = '';
    // hero CTAs are plain links — keep them usable even when the config failed
    renderHeroCtas();
    const heroStats = document.getElementById('heroStats');
    if (heroStats) heroStats.style.display = 'none';
}

// ── Quick-action tiles ───────────────────────────────────────────────────────
function renderButtons(buttons) {
    const container = document.getElementById('actionRow');
    if (!container) return;

    const shown = buttons.filter(b => b.visible !== false);
    container.innerHTML = shown.map((b, i) => {
        const badgeHtml = b.badge
            ? (String(b.badge).toUpperCase() === 'NEW'
                ? `<span class="nc-badge new">${_esc(b.badge)}</span>`
                : `<span class="nc-badge free">${_esc(b.badge)}</span>`)
            : '';
        const clickAttr = b.comingSoonMessage
            ? ` onclick="homeComingSoon('${_esc(b.comingSoonMessage)}'); return false;"`
            : '';
        return `
            <a href="${_esc(b.url)}" class="home-tile" id="btn-${_esc(b.id)}"${clickAttr}>
                <span class="nc-ico ${TILE_COLORS[i % TILE_COLORS.length]}">${_icon(b.icon, 'doc')}</span>
                <span class="ht-body">
                    <span class="ht-title">${_esc(b.title)} ${badgeHtml}</span>
                </span>
                <span class="nc-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span>
            </a>`;
    }).join('');
}
window.homeComingSoon = function (msg) {
    if (window.showToast) showToast(msg, 'error');
    else alert(msg);
};

// ── Recommendations ──────────────────────────────────────────────────────────
function renderRecommendations(items) {
    const container = document.getElementById('recGrid');
    if (!container) return;

    const shown = items.filter(r => r.visible !== false);
    container.innerHTML = shown.map((r, i) => `
        <a href="${_esc(r.url)}" class="nav-card">
            <span class="nc-ico ${TILE_COLORS[i % TILE_COLORS.length]}" data-icon-html="${encodeURIComponent(_icon(r.icon, 'grad-cap'))}">
                ${r.logo ? `<img class="nc-logo" src="${_esc(r.logo)}" alt="" loading="lazy" onerror="window._homeLogoFailed(this)">` : _icon(r.icon, 'grad-cap')}
            </span>
            <span class="nc-body">
                <span class="nc-title">${_esc(r.title)}</span>
                <span class="nc-meta">${_esc(r.subtitle || '')}</span>
            </span>
            <span class="nc-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span>
        </a>`).join('');
}
window._homeLogoFailed = function (img) {
    try {
        const wrap = img.closest('.nc-ico');
        if (wrap) wrap.innerHTML = decodeURIComponent(wrap.dataset.iconHtml || '');
    } catch (e) { if (img && img.remove) img.remove(); }
};

// ── Hero: live stats board + Premium / Partner CTAs ─────────────────────────
// (Replaces the old banner carousel.)
// · Stats come from the STATIC home-config.json "stats" key — a plain JSON
//   file on the website. When you make them live later, only the source of
//   these numbers changes; the board/animation code stays exactly the same.
//   · The "Upgrade to Premium" CTA renders ONLY for free users — paid users
//     just see the partner CTA (re-checked on every `profileUpdated`).
//   · The partner CTA itself swaps: partners get EARNING DASHBOARD
//     (/partner-dashboard.html), everyone else gets BECOME A PARTNER.
const HERO_SVG = {
    crown:     `<svg ${_S}><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>`,
    handshake: `<svg ${_S}><path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/></svg>`,
    gauge:     `<svg ${_S}><path d="M21.2 15.2A9 9 0 1 1 8.8 2.8"/><path d="M21.2 15.2A9 9 0 0 0 8.8 2.8L12 12z"/></svg>`,
    chev:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
    clock:     `<svg ${_S}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
    alert:     `<svg ${_S}><path d="M12 3.2 2.2 19.6h19.6L12 3.2z"/><path d="M12 9v5M12 16.5h.01"/></svg>`
};

// compact number formatting: 15400 → "15k", 2400 → "2.4k", 128 → "128"
function _heroFmt(v) {
    v = Math.max(0, v);
    if (v >= 10000) return Math.round(v / 1000) + 'k';
    if (v >= 1000) {
        let s = (v / 1000).toFixed(1);
        if (s.slice(-2) === '.0') s = s.slice(0, -2);
        return s + 'k';
    }
    return String(Math.round(v));
}

// live count-up (easeOutCubic, staggered). Fires when the tile scrolls into
// view; honours prefers-reduced-motion; never runs twice on the same node.
function _heroAnimate(el, target, suffix, dur, delay) {
    if (el.dataset.heroStarted === '1') return;
    el.dataset.heroStarted = '1';
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = _heroFmt(target) + suffix;
        return;
    }
    let started = false;
    function run() {
        if (started) return;
        started = true;
        let t0 = null;
        function step(ts) {
            if (!t0) t0 = ts;
            const p = Math.min(1, (ts - t0) / dur);
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = _heroFmt(target * e) + suffix;
            if (p < 1) requestAnimationFrame(step);
        }
        setTimeout(() => requestAnimationFrame(step), delay);
    }
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(en => {
            en.forEach(x => { if (x.isIntersecting) { run(); io.disconnect(); } });
        }, { threshold: 0.2 });
        io.observe(el);
        setTimeout(run, 700);            // safety net
    } else run();
}

function renderHeroStats(stats) {
    const board = document.getElementById('heroStats');
    if (!board) return;
    const items = Array.isArray(stats) ? stats : ((stats && stats.items) || []);
    if (!items.length) { board.innerHTML = ''; board.style.display = 'none'; return; }

    const sig = JSON.stringify(items.map(s => [s.value, s.label, s.suffix]));
    if (board.dataset.sig === sig) return;   // cached+fresh double-apply → no re-animation
    board.dataset.sig = sig;
    board.style.display = '';

    board.innerHTML = items.map((s, i) => {
        const color = TILE_COLORS.indexOf(s.color) >= 0 ? s.color : TILE_COLORS[i % TILE_COLORS.length];
        return `
        <div class="hero-tile ${color}">
            <span class="hero-tile-live" aria-hidden="true"></span>
            <span class="hero-tile-ico">${_icon(s.icon, 'doc')}</span>
            <span class="hero-tile-num" data-target="${Number(s.value) || 0}" data-suffix="${_esc(s.suffix || '+')}">0</span>
            <span class="hero-tile-lab">${_esc(s.label || '')}</span>
        </div>`;
    }).join('');

    board.querySelectorAll('.hero-tile-num').forEach((el, i) => {
        _heroAnimate(el, parseFloat(el.dataset.target) || 0, el.dataset.suffix || '+', 1400 + i * 150, i * 120);
    });
}

function renderHeroCtas() {
    const wrap = document.getElementById('heroCtas');
    if (!wrap) return;
    let html = '';
    const expiryInfo = _getExpiryInfo();
    const isPaid = _isPaidUser();
    if(isPaid && expiryInfo && expiryInfo.isExpiringSoon){
        html += `
        <a class="hero-cta hero-cta-expiry" href="/buy-premium.html" id="expiryCtaCard">
            <span class="hero-cta-ico">${HERO_SVG.clock}</span>
            <span class="hero-cta-txt">
                <span class="hero-cta-title">Premium expiring soon!</span>
                <span class="hero-cta-sub">Renew before you lose PRO access</span>
                <span class="expiry-countdown" id="expiryCountdown">
                    <span class="cd-box"><b id="cdH">00</b><small>HRS</small></span>
                    <span class="cd-sep">:</span>
                    <span class="cd-box"><b id="cdM">00</b><small>MIN</small></span>
                    <span class="cd-sep">:</span>
                    <span class="cd-box"><b id="cdS">00</b><small>SEC</small></span>
                </span>
            </span>
            <span class="hero-cta-go">${HERO_SVG.chev}</span>
            <span class="hero-shine" aria-hidden="true"></span>
        </a>`;
    } else if (!_isPaidUser()) {                    // FREE users only — hidden for paid
        html += `
        <a class="hero-cta hero-cta-premium" href="/buy-premium.html">
            <span class="hero-cta-ico">${HERO_SVG.crown}</span>
            <span class="hero-cta-txt">
                <span class="hero-cta-title">Upgrade to Premium</span>
                <span class="hero-cta-sub">All mocks + PYQs unlocked · ₹124 only</span>
            </span>
            <span class="hero-cta-go">${HERO_SVG.chev}</span>
            <span class="hero-shine" aria-hidden="true"></span>
        </a>`;
    }
    if (_isPartnerUser()) {
        // already a partner → the card becomes their earning dashboard entry
        html += `
        <a class="hero-cta hero-cta-partner" href="/partner-dashboard.html" data-hero-cta="dashboard">
            <span class="hero-cta-ico">${HERO_SVG.gauge}</span>
            <span class="hero-cta-txt">
                <span class="hero-cta-title">Earning Dashboard</span>
                <span class="hero-cta-sub">Track your sales &amp; 20% commission</span>
            </span>
            <span class="hero-cta-go">${HERO_SVG.chev}</span>
            <span class="hero-shine" aria-hidden="true" style="animation-delay:1.4s"></span>
        </a>`;
    } else {
        html += `
        <a class="hero-cta hero-cta-partner" href="/apply-coupon.html" data-hero-cta="partner">
            <span class="hero-cta-ico">${HERO_SVG.handshake}</span>
            <span class="hero-cta-txt">
                <span class="hero-cta-title">Become a Partner</span>
                <span class="hero-cta-sub">Earn 20% commission on every sale</span>
            </span>
            <span class="hero-cta-go">${HERO_SVG.chev}</span>
            <span class="hero-shine" aria-hidden="true" style="animation-delay:1.4s"></span>
        </a>`;
    }
    wrap.innerHTML = html;
    if(isPaid && expiryInfo && expiryInfo.isExpiringSoon){
        startExpiryCountdown();
    }
}

// ── Expiry countdown + expired banner ──
function startExpiryCountdown(){
    if(_expiryInterval) clearInterval(_expiryInterval);
    function tick(){
        const info=_getExpiryInfo();
        const hEl=document.getElementById('cdH');
        const mEl=document.getElementById('cdM');
        const sEl=document.getElementById('cdS');
        if(!info || !hEl){ clearInterval(_expiryInterval); return; }
        if(info.isExpired){
            clearInterval(_expiryInterval);
            try{
                localStorage.setItem('mmh_just_expired','1');
                localStorage.setItem('mmh_just_expired_ts', String(Date.now()));
            }catch(e){}
            if(typeof getLocalProfile==='function') getLocalProfile();
            renderHeroCtas();
            checkExpiredBanner();
            return;
        }
        const totalH=Math.floor(info.msLeft/3600000);
        const mins=Math.floor((info.msLeft%3600000)/60000);
        const secs=Math.floor((info.msLeft%60000)/1000);
        hEl.textContent=formatTwo(totalH);
        mEl.textContent=formatTwo(mins);
        sEl.textContent=formatTwo(secs);
    }
    tick();
    _expiryInterval=setInterval(tick,1000);
}
window.startExpiryCountdown=startExpiryCountdown;

function checkExpiryCountdown(){
    const info=_getExpiryInfo();
    if(info && info.isExpiringSoon && _isPaidUser()){
        startExpiryCountdown();
    }
}
function checkExpiredBanner(){
    try{
        const justExpired=localStorage.getItem('mmh_just_expired');
        if(!justExpired) return;
        const isPaid=_isPaidUser();
        if(isPaid){ localStorage.removeItem('mmh_just_expired'); return; }
        showExpiredBanner();
    }catch(e){}
}
window.checkExpiredBanner=checkExpiredBanner;
function showExpiredBanner(){
    let overlay=document.getElementById('expiryExpiredOverlay');
    if(!overlay){
        overlay=document.createElement('div');
        overlay.id='expiryExpiredOverlay';
        overlay.className='expiry-overlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML=`
    <div class="expiry-banner-box">
        <button class="expiry-close" onclick="closeExpiredBanner()" aria-label="Close">✕</button>
        <div class="expiry-icon-wrap">
            <div class="expiry-icon">${HERO_SVG.crown}</div>
            <div class="expiry-pulse"></div>
        </div>
        <h3>Your plan has expired!</h3>
        <p>Your <b>Premium access</b> ended and all paid mocks are now locked. Renew now at <b>₹124</b> to continue your streak and keep your PRO badge.</p>
        <div class="expiry-actions">
            <a href="/buy-premium.html" class="expiry-btn primary" onclick="closeExpiredBanner()">Buy Premium Now</a>
            <button type="button" class="expiry-btn ghost" onclick="closeExpiredBanner()">Maybe Later</button>
        </div>
        <div class="expiry-trust">🔒 Secure payment via Razorpay • Instant activation</div>
    </div>`;
    overlay.style.display='flex';
    try{ localStorage.setItem('mmh_expired_banner_shown_ts', String(Date.now())); }catch(e){}
}
window.showExpiredBanner=showExpiredBanner;
function closeExpiredBanner(){
    const ov=document.getElementById('expiryExpiredOverlay');
    if(ov) ov.style.display='none';
    try{
        localStorage.removeItem('mmh_just_expired');
        localStorage.setItem('mmh_expired_banner_shown','1');
        localStorage.setItem('mmh_expired_banner_shown_ts', String(Date.now()));
    }catch(e){}
}
window.closeExpiredBanner=closeExpiredBanner;

// ── Popups (config-driven; WHEN they show is controlled by auth flow) ───────
function _popupShell(popup, border, iconHtml, onClickMain, onClickDismiss) {
    return `
    <div class="home-modal-box" style="border-color:${border}">
        <div class="home-modal-ico">${iconHtml}</div>
        <h5>${_esc(popup.title)}</h5>
        <p>${_esc(popup.message)}</p>
        <div class="home-modal-actions">
            <a href="${_esc(popup.link)}" target="_blank" rel="noopener" onclick="${onClickMain}" class="home-modal-btn primary">${_esc(popup.buttonLabel)}</a>
            <button type="button" onclick="${onClickDismiss}" class="home-modal-btn ghost">${_esc(popup.dismissLabel)}</button>
        </div>
    </div>`;
}

function renderPopup(popup) {
    if (!popup || !popup.enabled) return;
    if (popup.audience === 'paid' && !_isPaidUser()) return;
    if (popup.audience === 'free' && _isPaidUser()) return;

    const seenKey = 'mmh_popup_seen_' + popup.id;
    try { if (localStorage.getItem(seenKey)) return; } catch (e) { /* ignore */ }

    const overlay = document.getElementById('tgPopupOverlay');
    if (!overlay) return;
    overlay.innerHTML = _popupShell(popup, '#0088cc', _icon(popup.icon, 'send'),
        `closeHomePopup('${_esc(popup.id)}')`, `closeHomePopup('${_esc(popup.id)}')`);
    overlay.style.display = 'flex';
}
window.renderPopup = renderPopup;

function closeHomePopup(id) {
    try { localStorage.setItem('mmh_popup_seen_' + id, 'true'); } catch (e) { /* ignore */ }
    const ov = document.getElementById('tgPopupOverlay');
    if (ov) ov.style.display = 'none';
}
window.closeHomePopup = closeHomePopup;

function renderSalePopup(popup) {
    if (!popup || !popup.enabled) return;
    if (_isPaidUser()) return;

    const seenKey = 'mmh_popup_seen_' + popup.id;
    try { if (localStorage.getItem(seenKey)) return; } catch (e) { /* ignore */ }

    const overlay = document.getElementById('salePopupOverlay');
    if (!overlay) return;
    overlay.innerHTML = _popupShell(popup, 'var(--primary)', _icon(popup.icon, 'crown'),
        `closeSalePopup('${_esc(popup.id)}')`, `closeSalePopup('${_esc(popup.id)}')`);
    overlay.style.display = 'flex';
}
window.renderSalePopup = renderSalePopup;

function closeSalePopup(id) {
    try { localStorage.setItem('mmh_popup_seen_' + id, 'true'); } catch (e) { /* ignore */ }
    const ov = document.getElementById('salePopupOverlay');
    if (ov) ov.style.display = 'none';
}
window.closeSalePopup = closeSalePopup;

// ── What's New ticker (marquee rows, cache-backed too) ──────────────────────
const WHATS_NEW_MAX_ROWS = 3;
const WHATS_NEW_SPEED_PX_PER_SEC = 55;

async function loadWhatsNew() {
    let items = null;
    try {
        if (window.__WHATS_NEW__) {
            items = window.__WHATS_NEW__;
        } else {
            items = await fetchWithRetry('/whats-new.json', { tries: 2, timeoutMs: 6000 });
            _writeCache(WHATS_NEW_CACHE_KEY, items);
        }
    } catch (e) {
        console.error("What's New refresh failed:", e && e.message);
        items = _readCache(WHATS_NEW_CACHE_KEY);   // stale ticker beats no ticker
    }
    if (!Array.isArray(items) || items.length === 0) return;

    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    const card = document.getElementById('whatsNewCard');
    const section = document.getElementById('whatsNewSection');
    if (!card || !section) return;

    card.innerHTML = items.slice(0, WHATS_NEW_MAX_ROWS).map(item => `
        <div class="whats-new-row">
            <div class="whats-new-track">
                <a href="${_esc(item.link)}" class="whats-new-link">${_esc(item.title)}</a>
                ${item.badge ? `<span class="nc-badge new">${_esc(item.badge)}</span>` : ''}
                <span class="whats-new-date">${formatWhatsNewDate(item.date)}</span>
            </div>
        </div>`).join('');

    section.style.display = 'block';
    requestAnimationFrame(() => startMarqueeRows(card));
}
window.loadWhatsNew = loadWhatsNew;

function formatWhatsNewDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
window.formatWhatsNewDate = formatWhatsNewDate;

// ALL rows share ONE duration (sized for the longest track) and start in the
// same frame — so every loop cycle begins with every row aligned together at
// the right edge, no matter how different the text lengths are.
function startMarqueeRows(card) {
    const rows = Array.from(card.querySelectorAll('.whats-new-row'));
    if (!rows.length) return;
    const metrics = rows.map(rowEl => {
        const track = rowEl.querySelector('.whats-new-track');
        const rowWidth = rowEl.offsetWidth;
        const trackWidth = track ? track.scrollWidth : 0;
        return { rowEl, track, rowWidth, trackWidth };
    });
    const maxTotal = Math.max(...metrics.map(m => m.rowWidth + m.trackWidth));
    const duration = Math.max(maxTotal / WHATS_NEW_SPEED_PX_PER_SEC, 6);
    metrics.forEach(m => {
        if (!m.track) return;
        m.track.style.setProperty('--wn-start', m.rowWidth + 'px');
        m.track.style.setProperty('--wn-end', (-m.trackWidth) + 'px');
        m.track.style.animation = `whatsNewMarquee ${duration}s linear infinite`;
    });
}
window.startMarqueeRows = startMarqueeRows;
window.startMarqueeRow = function (rowEl) {
    const card = rowEl && rowEl.closest ? rowEl.closest('.whats-new-card') : null;
    if (card) startMarqueeRows(card);
};

// ── Toast (design.css #toastRoot/.toast) ─────────────────────────────────────
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
    const ico = type === 'error'
        ? '<svg class="error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3h.01"/></svg>'
        : '<svg class="success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>';
    el.innerHTML = ico + `<span>${_esc(message)}</span>`;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2400);
}
window.showToast = showToast;


// ── App Update Checker (Play Store style) ────────────────────────────────
// Live file: /data/app-update.json is fetched live-first (website overrides APK)
// Home page checks current version vs latestVersion. If newer available,
// shows a beautiful strict popup with What's New loaded from live JSON.
// Update Now → Play Store. Works for both web and Capacitor app.

function _compareVersions(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const av = pa[i] || 0, bv = pb[i] || 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
    }
    return 0;
}

async function _getCurrentAppVersion() {
    // Try Capacitor App plugin if available
    try {
        const Cap = window.Capacitor;
        if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()) {
            const App = Cap.Plugins && Cap.Plugins.App;
            if (App && App.getInfo) {
                const info = await App.getInfo();
                if (info && info.version) {
                    return { version: info.version, build: parseInt(info.build || '1', 10) || 1 };
                }
            }
            // Alternative: try to load @capacitor/app via dynamic import? fallback
        }
    } catch (e) {}
    // Fallback to hardcoded + localStorage override (for testing)
    try {
        const stored = localStorage.getItem('mmh_current_app_version');
        if (stored) {
            const j = JSON.parse(stored);
            if (j && j.version) return j;
        }
    } catch (e) {}
    return { version: CURRENT_APP_VERSION, build: CURRENT_APP_VERSION_CODE };
}

async function checkAppUpdate() {
    try {
        const data = await fetchWithRetry(APP_UPDATE_URL, { tries: 2, timeoutMs: 6000 });
        if (!data || !data.latestVersion) return;
        _writeCache(APP_UPDATE_CACHE_KEY, data);

        const current = await _getCurrentAppVersion();
        const cmp = _compareVersions(current.version, data.latestVersion);
        const codeCmp = (data.latestVersionCode || 0) > (current.build || 0);

        // Show if version newer (either semver or versionCode)
        const shouldShow = cmp < 0 || codeCmp;
        if (!shouldShow) return;

        // If user already dismissed this version and not force, skip
        const dismissedKey = 'mmh_update_dismissed_' + data.latestVersion;
        try {
            if (!data.forceUpdate && localStorage.getItem(dismissedKey)) return;
        } catch (e) {}

        // Don't show if already shown in this session
        if (window._appUpdateShownVersion === data.latestVersion) return;
        window._appUpdateShownVersion = data.latestVersion;

        showAppUpdatePopup(data, current);
    } catch (e) {
        // Try cached version as fallback
        try {
            const cached = _readCache(APP_UPDATE_CACHE_KEY);
            if (!cached || !cached.latestVersion) return;
            const current = await _getCurrentAppVersion();
            const cmp = _compareVersions(current.version, cached.latestVersion);
            const codeCmp = (cached.latestVersionCode || 0) > (current.build || 0);
            if (cmp < 0 || codeCmp) {
                const dismissedKey = 'mmh_update_dismissed_' + cached.latestVersion;
                if (!cached.forceUpdate) {
                    try { if (localStorage.getItem(dismissedKey)) return; } catch (ex) {}
                }
                if (window._appUpdateShownVersion === cached.latestVersion) return;
                window._appUpdateShownVersion = cached.latestVersion;
                showAppUpdatePopup(cached, current);
            }
        } catch (ex) {}
    }
}
window.checkAppUpdate = checkAppUpdate;

function showAppUpdatePopup(data, current) {
    let overlay = document.getElementById('mmhAppUpdateOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'mmhAppUpdateOverlay';
        overlay.className = 'mmh-update-overlay';
        document.body.appendChild(overlay);
    }

    const isForce = !!data.forceUpdate;
    const whatsNew = Array.isArray(data.whatsNew) ? data.whatsNew : [];
    const whatsNewHtml = whatsNew.length ? `<ul class="mmh-update-list">${whatsNew.map(t => `<li>${_esc(t)}</li>`).join('')}</ul>` : '';
    const playUrl = _esc(data.playStoreUrl || PLAY_STORE_FALLBACK);
    const currentVer = _esc(current.version || CURRENT_APP_VERSION);
    const latestVer = _esc(data.latestVersion);

    overlay.innerHTML = `
    <div class="mmh-update-box ${isForce ? 'force' : ''}">
        ${!isForce ? `<button class="mmh-update-close" onclick="closeAppUpdatePopup('${_esc(data.latestVersion)}')" aria-label="Close">✕</button>` : ''}
        <div class="mmh-update-icon-wrap">
            <div class="mmh-update-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 2.5 7v10L12 21.5 21.5 17V7L12 2.5z"/><path d="M12 2.5v19"/><path d="M2.5 7l9.5 5 9.5-5"/><path d="M12 12L2.5 7"/><path d="M12 12l9.5-5"/></svg>
            </div>
            <div class="mmh-update-pulse"></div>
            <span class="mmh-update-badge">NEW</span>
        </div>
        <div class="mmh-update-ver">v${currentVer} → v${latestVer}</div>
        <h3>${_esc(data.title || 'New Update Available! 🚀')}</h3>
        <p>${_esc(data.message || 'A new version with improvements is available. Update now for best experience.')}</p>
        ${whatsNewHtml}
        <div class="mmh-update-actions">
            <a href="${playUrl}" target="_blank" rel="noopener" class="mmh-update-btn primary" onclick="handleUpdateNow('${playUrl}', ${isForce ? 'true' : 'false'})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Update Now
            </a>
            ${!isForce ? `<button type="button" class="mmh-update-btn ghost" onclick="closeAppUpdatePopup('${_esc(data.latestVersion)}')">Maybe Later</button>` : `<div class="mmh-update-force-note">This update is required to continue</div>`}
        </div>
        <div class="mmh-update-trust">🔒 Secure update via Google Play Store</div>
    </div>`;

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    try { localStorage.setItem('mmh_update_last_shown', String(Date.now())); } catch (e) {}
}

window.showAppUpdatePopup = showAppUpdatePopup;

function closeAppUpdatePopup(version) {
    const ov = document.getElementById('mmhAppUpdateOverlay');
    if (ov) ov.style.display = 'none';
    document.body.style.overflow = '';
    try {
        if (version) localStorage.setItem('mmh_update_dismissed_' + version, '1');
    } catch (e) {}
}
window.closeAppUpdatePopup = closeAppUpdatePopup;

function handleUpdateNow(url, isForce) {
    try {
        // Try to open Play Store via Capacitor if available
        const Cap = window.Capacitor;
        if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()) {
            const Browser = Cap.Plugins && Cap.Plugins.Browser;
            if (Browser && Browser.open) {
                Browser.open({ url: url });
                return;
            }
        }
    } catch (e) {}
    // Fallback: window.open
    window.open(url, '_blank');
}
window.handleUpdateNow = handleUpdateNow;


// ── Adaptive appbar ─────────────────────────────────────────────────────────
// The header carries a lot (menu, brand, theme, bell, auth chip). On tight
// widths the brand name / tagline must NEVER show an ellipsis — fitAppbar()
// walks a shrink ladder (.appbar-fit-1…5, smaller font AND lighter weight)
// until the COMPLETE text fits. The header BOX itself never changes size —
// same height, same padding, same 38px icon buttons — only the INNER items
// shrink (fonts, icon glyphs, logo tile, chips, inner gaps), so the fitted
// state persists. Roomy screens: nothing applied, header as designed.
const APPBAR_FIT_LEVELS = 5;
function fitAppbar() {
    const bar = document.querySelector('.appbar');
    const title = bar && bar.querySelector('.brand-title');
    const sub = bar && bar.querySelector('.brand-sub');
    if (!bar || !title) return;

    // Measure with transitions killed — mid-animation widths gave false
    // "it fits" reads and the fit bounced straight back to normal.
    bar.classList.add('appbar-measuring');
    bar.classList.remove('appbar-compact', 'appbar-wrap');   // compact = legacy, never re-added
    for (let i = 1; i <= APPBAR_FIT_LEVELS; i++) bar.classList.remove('appbar-fit-' + i);

    const stripped = () =>
        title.scrollWidth > title.clientWidth + 1 ||
        !!(sub && sub.scrollWidth > sub.clientWidth + 1);

    let lvl = 0;
    while (stripped() && lvl < APPBAR_FIT_LEVELS) {
        lvl++;
        bar.classList.add('appbar-fit-' + lvl);   // inner items step down, boxes stay
    }
    if (stripped()) bar.classList.add('appbar-wrap');   // last resort: wrap, never "…"
    bar.classList.remove('appbar-measuring');
}
window.fitAppbar = fitAppbar;

let _appbarFitT = null;
window.addEventListener('resize', () => {
    clearTimeout(_appbarFitT);
    _appbarFitT = setTimeout(fitAppbar, 150);
});
window.addEventListener('load', fitAppbar);
window.addEventListener('pageshow', fitAppbar);   // bfcache back-navigation restores stale widths
// webfonts landing change text metrics — refit once they are ready
if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(() => fitAppbar()).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
    initHomeEngine();
    loadWhatsNew();
    fitAppbar();
    setTimeout(fitAppbar, 500);      // after auth chip / badges settle
    setTimeout(()=>{ checkExpiryCountdown(); checkExpiredBanner(); }, 800);
    setTimeout(()=>{ checkAppUpdate(); }, 1200);

    // The auth chip (LOGIN pill ↔ avatar) and the Android app-switch slot
    // land in the header AFTER the first fit runs — that late content was
    // what knocked the header back to "normal". Refit on every header-content
    // mutation so the fitted state persists.
    if (window.MutationObserver) {
        const _appbarMO = new MutationObserver(() => fitAppbar());
        ['authHeaderArea', 'appSwitchSlot'].forEach(id => {
            const node = document.getElementById(id);
            if (node) _appbarMO.observe(node, { childList: true, subtree: true, attributes: true, characterData: true });
        });
    }

    // header images (logo) can land late on slow connections — refit when
    // they finally paint, or fail and swap to the fallback svg
    document.querySelectorAll('.screen-header img').forEach(im => {
        im.addEventListener('load', fitAppbar);
        im.addEventListener('error', fitAppbar);
    });

    // absolute watchdog: never leave the splash up if something unexpected threw
    setTimeout(homeReady, 8000);
});

// auth.js fires this once the real profile lands — re-run audience-dependent
// renders against the config we already have (cache or fresh).
window.addEventListener('profileUpdated', () => {
    fitAppbar();                     // auth chip swap can change header width
    const config = window.HOME_CONFIG;
    if (config){
        renderButtons(config.buttons || []);
        renderHeroCtas();               // premium CTA appears/disappears with plan
        renderSalePopup(config.salePopup);
    }
    checkExpiryCountdown();
    checkExpiredBanner();
    setTimeout(()=>{ checkAppUpdate(); }, 500);
});
