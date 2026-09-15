// ── App Core (home page shell logic) ────────────────────────────────────────
// Sidebar, theme, auth UI, bottom dock, notification badge, PWA install,
// payment recovery, service-worker registration. Visual language = design.css.

// ── Theme (mmh_theme key shared by every page) ──────────────────────────────
const CORE_THEME_ICONS = {
    sun:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`
};
function coreApplyTheme(t) {
    const isDark = t === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = isDark ? '#121a30' : '#ffffff';   // = header surface: status bar blends
    document.querySelectorAll('.theme-btn').forEach(b => {
        b.innerHTML = isDark ? CORE_THEME_ICONS.sun : CORE_THEME_ICONS.moon;
        b.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    });
    try { localStorage.setItem('mmh_theme', t); } catch (e) { /* ignore */ }
}
window.coreApplyTheme = coreApplyTheme;

function toggleTheme() {
    coreApplyTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark');
}
window.toggleTheme = toggleTheme;

// ── Sidebar ──────────────────────────────────────────────────────────────────
function toggleSidebar() {
    const sb = document.getElementById('appSidebar');
    const ov = document.getElementById('sidebarOverlay');
    if (!sb || !ov) return;
    sb.classList.toggle('show');
    ov.style.display = sb.classList.contains('show') ? 'block' : 'none';
}
window.toggleSidebar = toggleSidebar;

// ── In-app-only sidebar entry: Score Calculator ────────────────────────────
// Shows ONLY inside the Android wrapper; on mockmatrixhub.in /
// *.pages.dev it stays hidden. Uses the modern Capacitor 8 API
// (isNativePlatform) — the old AndroidBridge / Capacitor.platform
// checks were removed in Capacitor 5+ and silently returned false.
(function () {
    function isNative() {
        try {
            var C = window.Capacitor;
            if (!C) return false;
            if (typeof C.isNativePlatform === 'function') return !!C.isNativePlatform();
            if (typeof C.getPlatform === 'function') return C.getPlatform() !== 'web';
            return false;
        } catch (e) { return false; }
    }
    function addCalcLink() {
        if (!isNative()) return;
        const scroll = document.querySelector('#appSidebar .sidebar-scroll');
        if (!scroll || document.getElementById('mmhCalcSidebarLink')) return;
        const a = document.createElement('a');
        a.id = 'mmhCalcSidebarLink';
        a.href = '/score-calculator/index.html';
        a.className = 'menu-item';
        a.innerHTML = '<svg class="c-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2.4"/><path d="M8.2 7.2h7.6"/><path d="M8.4 11.4h.01M12 11.4h.01M15.6 11.4h.01M8.4 14.6h.01M12 14.6h.01M15.6 14.6h.01M8.4 17.8h.01M12 17.8h.01M15.6 17.8h.01"/></svg> Score Calculator';
        const home = scroll.querySelector('a[href="/"], a[href="/index.html"]');
        if (home && home.nextSibling) scroll.insertBefore(a, home.nextSibling);
        else scroll.prepend(a);
    }
    function schedule() {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addCalcLink);
        else addCalcLink();
        window.addEventListener('load', addCalcLink);
        if (window.MutationObserver) {
            const sb = document.getElementById('appSidebar');
            if (sb) new MutationObserver(addCalcLink).observe(sb, { childList: true, subtree: true });
        }
    }
    schedule();
})();

// ── Bottom dock (same floating pill bar as the exams page) ──────────────────
const CORE_NAV_ICONS = {
    'book-open': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.6S10.2 5 7.7 5C5.8 5 4.2 5.6 3.2 6.2a1 1 0 0 0-.5.9v10.2a1 1 0 0 0 1.5.8c1-.6 2.5-1.1 4.4-1.1 2.4 0 4.4 1.4 4.4 1.4s1.6-1.4 4-1.4c1.9 0 3.6.5 4.6 1.1a1 1 0 0 0 1.5-.8V7.1a1 1 0 0 0-.5-.9C21.6 5.6 20 5 18.1 5c-2.5 0-4.3 1.6-4.3 1.6"/><path d="M12 6.6v13.2"/></svg>`,
    'bolt':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>`,
    'grid':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.2"/><rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.2"/><rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.2"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.2"/></svg>`,
    'bell':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9.2a6 6 0 1 0-12 0c0 5-2 6.3-2 6.3h16s-2-1.3-2-6.3"/><path d="M10.3 19.2a2 2 0 0 0 3.4 0"/></svg>`,
    'user':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6"/></svg>`
};
const DEFAULT_BOTTOM_NAV = [
    { id: 'exams',   label: 'Exams',   href: '/exams/index.html',            icon: 'book-open', match: ['/exams/index.html'] },
    { id: 'live',    label: 'Live',    href: '/live-test/index.html',         icon: 'bolt',      match: ['/live'] },
    { id: 'home',    label: 'Home',    href: '/',                  icon: 'grid',      center: true, match: ['/'] },
    { id: 'alerts',  label: 'Alerts',  href: '/notifications.html',icon: 'bell',      match: ['/notifications'] },
    { id: 'profile', label: 'Profile', href: '/profile.html',           icon: 'user',      match: ['/profile.html'] }
];
window.getDefaultBottomNav = function () { return DEFAULT_BOTTOM_NAV.map(o => Object.assign({}, o)); };

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
        <a class="ex-dock-item${it.id === active ? ' active' : ''}" data-nav="${_esc2(it.id)}" href="${_esc2(it.href)}" aria-label="${_esc2(it.label)}">
            ${CORE_NAV_ICONS[it.icon] || CORE_NAV_ICONS.grid}<span>${_esc2(it.label)}</span>
            ${it.id === 'alerts' ? '<span class="dock-badge notif-badge-dot" style="display:none"></span>' : ''}
        </a>`;
    const mid = center ? `
        <a class="ex-dock-item ex-dock-center${center.id === active ? ' active' : ''}" data-nav="${_esc2(center.id)}" href="${_esc2(center.href)}" aria-label="${_esc2(center.label)}">
            <span class="ex-dock-fab">${CORE_NAV_ICONS[center.icon] || CORE_NAV_ICONS.grid}</span>
        </a>` : '';
    nav.innerHTML = left.map(side).join('') + mid + right.map(side).join('');
}
window.renderBottomNav = renderBottomNav;
function _esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ── Auth-driven UI ───────────────────────────────────────────────────────────
function checkTelegramPopup() {
    if (window.HOME_CONFIG && window.HOME_CONFIG.popup && typeof renderPopup === 'function') {
        renderPopup(window.HOME_CONFIG.popup);
    }
}
window.checkTelegramPopup = checkTelegramPopup;

function updateUI(profile) {
    if (!profile) return;
    document.documentElement.classList.remove('user-is-logged-in');
    const authArea = document.getElementById('authHeaderArea');
    if (authArea) { authArea.style.visibility = 'visible'; authArea.style.opacity = '1'; }

    const username = profile.username || 'Aspirant';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set('sidebarUserName', username);
    set('userGreetName', username);
    const logout = document.getElementById('logoutArea');
    if (logout) logout.classList.remove('hidden');

    if (profile.is_paid) {
        const badge = document.getElementById('sidebarPlanBadge');
        if (badge) badge.innerHTML = '<span class="plan-badge pro">PRO USER</span>';
        const buy = document.getElementById('buyPremiumArea');
        if (buy) buy.classList.add('hidden');
        checkTelegramPopup();
        const pc = document.getElementById('privateChannelArea');
        if (pc) pc.classList.remove('hidden');
    } else {
        const badge = document.getElementById('sidebarPlanBadge');
        if (badge) badge.innerHTML = '<span class="plan-badge free">FREE PLAN</span>';
        const buy = document.getElementById('buyPremiumArea');
        if (buy) buy.classList.remove('hidden');
        const pc = document.getElementById('privateChannelArea');
        if (pc) pc.classList.add('hidden');
    }

    if (['admin', 'owner', 'subowner'].includes(profile.role)) {
        const al = document.getElementById('adminLinkArea');
        if (al) al.classList.remove('hidden');
    }

    if (profile.is_partner) {
        const pl = document.getElementById('partnerLinkArea');
        const pa = document.getElementById('partnerApplyArea');
        if (pl) pl.classList.remove('hidden');
        if (pa) pa.classList.add('hidden');
    } else {
        const pl = document.getElementById('partnerLinkArea');
        const pa = document.getElementById('partnerApplyArea');
        if (pl) pl.classList.add('hidden');
        if (pa) pa.classList.remove('hidden');
    }

    if (authArea) {
        authArea.innerHTML = `<button type="button" class="avatar-chip" onclick="toggleSidebar()" aria-label="Open menu">${_esc2(username.charAt(0).toUpperCase())}</button>`;
    }
}
window.updateUI = updateUI;

function resetLoggedOutUI() {
    const authHeaderArea = document.getElementById('authHeaderArea');
    if (authHeaderArea) authHeaderArea.innerHTML = '<a href="/login.html" class="login-chip">LOGIN</a>';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set('sidebarUserName', 'Aspirant');
    set('userGreetName', 'Aspirant');
    const badge = document.getElementById('sidebarPlanBadge');
    if (badge) badge.innerHTML = '';
    ['logoutArea', 'adminLinkArea', 'partnerLinkArea', 'privateChannelArea'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const buy = document.getElementById('buyPremiumArea');
    if (buy) buy.classList.remove('hidden');
    const pa = document.getElementById('partnerApplyArea');
    if (pa) pa.classList.remove('hidden');
}
window.resetLoggedOutUI = resetLoggedOutUI;

function refreshAppUI() {
    const p = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    if (p) {
        updateUI(p);
        document.documentElement.classList.add('user-is-logged-in');
    } else {
        document.documentElement.classList.remove('user-is-logged-in');
        resetLoggedOutUI();
    }
}
window.refreshAppUI = refreshAppUI;

// ── Payment recovery (killed tab mid-payment) ───────────────────────────────
async function checkPendingPayment() {
    const raw = localStorage.getItem('mmh_payment_pending');
    if (!raw) return;
    if (typeof _supabase === 'undefined') return;   // preview / auth not loaded

    let pending;
    try { pending = JSON.parse(raw); } catch (e) { localStorage.removeItem('mmh_payment_pending'); return; }
    const oneHour = 60 * 60 * 1000;
    if (!pending.ts || Date.now() - pending.ts > oneHour) {
        localStorage.removeItem('mmh_payment_pending');
        return;
    }
    try {
        const { data: userData } = await _supabase.auth.getUser();
        const userId = userData && userData.user && userData.user.id;
        if (!userId) return;
        const { data: profile } = await _supabase
            .from('profiles').select('is_paid, expires_at').eq('id', userId).maybeSingle();
        if (profile && profile.is_paid) {
            const cached = getLocalProfile() || {};
            saveLocalProfile(Object.assign({}, cached, { is_paid: true, expires_at: profile.expires_at }));
            localStorage.removeItem('mmh_payment_pending');
            refreshAppUI();
        }
    } catch (e) { /* silent — retried on next visibility/pageshow */ }
}
window.checkPendingPayment = checkPendingPayment;

// ── Notifications badge (header bell + dock Alerts) ─────────────────────────
async function refreshNotificationBadge() {
    try {
        const res = await fetch('https://mmh-notify-worker.mockmatrixsupport.workers.dev/api/notify/list?limit=11');
        const data = await res.json();
        const list = data.notifications || [];
        const lastSeenId = parseInt(localStorage.getItem('mmh_last_seen_notif_id') || '0', 10);
        const unreadCount = list.filter(n => n.id > lastSeenId).length;
        _paintBadge(unreadCount);
    } catch (err) {
        console.error('Failed to refresh notification badge:', err);
    }
}
function _paintBadge(unreadCount) {
    const displayValue = unreadCount > 10 ? '10+' : String(unreadCount);
    document.querySelectorAll('.notif-badge-dot').forEach(el => {
        if (unreadCount > 0) {
            el.textContent = displayValue;
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
}
window.refreshNotificationBadge = refreshNotificationBadge;
window._paintBadge = _paintBadge;

// ── PWA install prompt ───────────────────────────────────────────────────────
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const sidebarBtn = document.getElementById('sidebarInstallBtn');
    if (sidebarBtn) sidebarBtn.style.display = 'flex';
    try {
        if (!sessionStorage.getItem('pwaPromptShown')) {
            setTimeout(() => {
                const modal = document.getElementById('pwaInstallModal');
                if (modal) modal.style.display = 'flex';
                sessionStorage.setItem('pwaPromptShown', 'true');
            }, 3000);
        }
    } catch (e2) { /* ignore */ }
});

async function triggerInstall() {
    if (!deferredPrompt) return;
    const installModal = document.getElementById('pwaInstallModal');
    if (installModal) installModal.style.display = 'none';
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') console.log('User accepted the install prompt');
    deferredPrompt = null;
    const sidebarBtn = document.getElementById('sidebarInstallBtn');
    if (sidebarBtn) sidebarBtn.style.display = 'none';
}
window.triggerInstall = triggerInstall;

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const installModal = document.getElementById('pwaInstallModal');
    if (installModal) installModal.style.display = 'none';
    const sidebarBtn = document.getElementById('sidebarInstallBtn');
    if (sidebarBtn) sidebarBtn.style.display = 'none';
});

// ── Service worker (offline cache) ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    let t = 'light';
    try { t = localStorage.getItem('mmh_theme') || 'light'; } catch (e) { /* ignore */ }
    coreApplyTheme(t);
    document.querySelectorAll('.theme-btn').forEach(b => { b.onclick = toggleTheme; });
    renderBottomNav();
    refreshAppUI();
    refreshNotificationBadge();

    const doInstall = document.getElementById('doInstall');
    if (doInstall) doInstall.onclick = triggerInstall;
    const sidebarBtn = document.getElementById('sidebarInstallBtn');
    if (sidebarBtn) sidebarBtn.onclick = triggerInstall;
    const closeInstall = document.getElementById('closeInstall');
    if (closeInstall) closeInstall.onclick = () => {
        const m = document.getElementById('pwaInstallModal');
        if (m) m.style.display = 'none';
    };
});

window.addEventListener('profileUpdated', () => refreshAppUI());
window.addEventListener('pageshow', () => { refreshAppUI(); checkPendingPayment(); refreshNotificationBadge(); });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkPendingPayment();
});
checkPendingPayment();
