// exam-engine.js
// Exam mocks engine — SSC-SUB style multi-screen flow:
//   Screen 1: Category (PYQ MOCKS / NEW MOCK — auto-wrapped when absent)
//   Screen 2: Tier (only when more than one tier exists — else skipped)
//   Screen 3: Mocks (year chips → type pills → section pills, title search)
// Cross-device attempt sync: Worker → Firebase user_attempts index (no GitHub)

let EXAM_JSON = null;
let currentFilters = { category: '', tier: null, year: '', type: 'full_mocks', section: '' };
// { quizId: { score, createdAt } } map — populated from localStorage cache
// (kept forever — see syncWithCloud below), refreshed only when missing or
// when the user taps "Refetch Attempts" in the header.
let CLOUD_CHECKLIST = {};

let CURRENT_SYNC_USER = null;
let CURRENT_SYNC_EXAM = null;

// ── Per-exam attempts worker — resolved from cloudflare-config.json ──────────
const CLOUDFLARE_CONFIG_URL = "/cloudflare-config.json?v=260908f";

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
let ATTEMPTS_WORKER_CONFIG = null; // cached in memory after first load this page session

async function loadAttemptsWorkerConfig() {
    if (ATTEMPTS_WORKER_CONFIG) return ATTEMPTS_WORKER_CONFIG;
    const res = await fetchLiveFirst(CLOUDFLARE_CONFIG_URL);
    if (!res.ok) throw new Error("Could not load cloudflare-config.json");
    ATTEMPTS_WORKER_CONFIG = await res.json();
    return ATTEMPTS_WORKER_CONFIG;
}

// Same keyword-match rule used elsewhere: first config key that's a substring
// of the (lowercased) exam name wins.
function getAttemptsWorkerURL(config, examName) {
    const idLower = examName.toLowerCase();
    const keyword = Object.keys(config).find(k => idLower.includes(k));
    return keyword ? config[keyword] : null;
}

// Ask the browser to exempt this origin's storage from eviction (relevant on
// Safari/iOS, which otherwise auto-clears localStorage after 7 days of no
// visits). Best-effort — the browser can still say no.
async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) { /* non-fatal */ }
    }
}

// ── HTML-attribute JS-string escape helper ──────────────────────────────────
// Used whenever a category/tier/year/section name is embedded inside a
// single-quoted JS string literal in an onclick="..." attribute. Without this,
// any name containing an apostrophe breaks the inline JS handler.
function _escJs(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── Tier Label Formatter ──────────────────────────────────────────────────────
// Converts any raw key into a human-readable pill/card label.
// Known patterns: tier1→"Tier I", tier2→"Tier II", tier3→"Tier III", etc.
// Snake_case keys: higher_secondary→"Higher Secondary", matriculation→"Matriculation", etc.
// Unknown keys: title-cased as-is.
function formatTierLabel(key) {
    const tierMatch = String(key).match(/^tier(\d+)$/i);
    if (tierMatch) {
        const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
        const n = parseInt(tierMatch[1], 10);
        return 'Tier ' + (roman[n - 1] || n);
    }
    const cbtMatch = String(key).match(/^cbt(\d+)$/i);
    if (cbtMatch) {
        const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
        const n = parseInt(cbtMatch[1], 10);
        return 'CBT ' + (roman[n - 1] || n);
    }
    // snake_case / camelCase → Title Case words
    return String(key)
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Exam Name Resolution Helper ──────────────────────────────────────────────
// Exam name is the bare token in the query string (e.g. "?ssc-cgl-2025"),
// picked out from any other real params (like &filter=...) using URLSearchParams
// so it keeps working exactly as before even when extra params are present.
// Standalone previews can pin it with window.__EXAM_NAME__.
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

// ── Case-insensitive key matcher ────────────────────────────────────────────
// Finds the actual key from `list` that matches `value` regardless of case,
// and returns it with the ORIGINAL casing from `list` (important — later code
// does exact-case property lookups, so we must normalize to the real key).
function _matchCaseInsensitive(list, value) {
    if (!value) return null;
    const lower = String(value).toLowerCase();
    return list.find(item => String(item).toLowerCase() === lower) || null;
}

// ── URL Filter Helper ─────────────────────────────────────────────────────────
// Reads &filter=category=PYQ MOCK,tier=tier1,year=2025,type=sectional,section=GK
// Any subset of levels can be given; applied top-down and validated afterwards
// by the fallback logic in initExamEngine.
//
// NOTE: pair-separator is a comma, but values can legitimately contain commas.
// We only treat a comma as a pair-separator when it's immediately followed by
// one of the known keys + "=". Any other comma stays part of its value.
function _getUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('filter');
    if (!raw) return null;

    const allowedKeys = ['category', 'tier', 'year', 'type', 'section'];
    const splitPattern = new RegExp(`,(?=(?:${allowedKeys.join('|')})=)`);

    const result = {};
    raw.split(splitPattern).forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (allowedKeys.includes(key) && value) {
            result[key] = value;
        }
    });
    return Object.keys(result).length ? result : null;
}

// ── URL Filter Writer ─────────────────────────────────────────────────────────
// Mirrors currentFilters into the address bar as &filter=category=...,tier=...
// using history.replaceState — updates the URL with zero page reload/navigation.
// Exam-name token (bare key before &filter=) is preserved exactly as-is.
function _updateUrlFilter() {
    try {
        const filterString = ['category', 'tier', 'year', 'type', 'section']
            .filter(k => currentFilters[k])
            .map(k => `${k}=${currentFilters[k]}`)
            .join(',');

        const examToken = window.location.search
            ? window.location.search.slice(1).split('&').find(p => !p.startsWith('filter='))
            : null;

        const query = examToken
            ? `?${examToken}${filterString ? `&filter=${encodeURIComponent(filterString)}` : ''}`
            : (filterString ? `?filter=${encodeURIComponent(filterString)}` : '');

        history.replaceState(history.state, '', window.location.pathname + query);
    } catch (e) { /* cosmetic only — never block filter UI on URL update failure */ }
}

// ── Filter Persistence Helpers ──────────────────────────────────────────────
function _filterCacheKey() {
    const examName = _getExamNameFromUrl();
    return `examFilters_${examName}`;
}

function saveFilters() {
    try {
        sessionStorage.setItem(_filterCacheKey(), JSON.stringify(currentFilters));
    } catch (e) { /* quota / private-mode – silently ignore */ }
    _updateUrlFilter();
}

function loadSavedFilters() {
    try {
        const saved = sessionStorage.getItem(_filterCacheKey());
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(currentFilters, parsed);
        }
    } catch (e) { /* corrupt data – ignore and use defaults */ }
}

// ── Data-shape helpers ───────────────────────────────────────────────────────
// "Visibility" is metadata sitting alongside tier1/tier2 in the category
// object, not a tier itself — excluded everywhere so it's never mistaken
// for one.
function _tierKeys(categoryData) {
    return Object.keys(categoryData || {}).filter(k => k !== "Visibility");
}

// Only "Visibility": "paid" (exact match) hides a category from free users;
// any other value, or the field missing entirely, keeps existing behavior —
// visible to everyone, per the "if not this exact structure, same as now" rule.
function isCategoryVisible(categoryData, isPaidUser) {
    return !(categoryData && categoryData.Visibility === "paid" && !isPaidUser);
}

function _visibleCategories() {
    const profile    = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid : false;
    // Any category whose data carries "Visibility": "paid" is left out of this
    // list entirely for free users — it never appears as a card, and nothing
    // nested under it (tiers/years/mocks) is reachable. Paid users see it.
    return Object.keys((EXAM_JSON && EXAM_JSON.data) || {}).filter(cat =>
        isCategoryVisible((EXAM_JSON.data || {})[cat], isPaidUser)
    );
}

// ── Count helper — total leaf mock items under any node ─────────────────────
// Non-container values (e.g. the "Visibility": "paid" metadata string that
// can sit alongside tier keys) count as 0 and are never recursed into.
function _countItems(node) {
    if (!node) return 0;
    if (Array.isArray(node)) return node.length;
    if (typeof node !== 'object') return 0;
    let count = 0;
    Object.values(node).forEach(v => count += _countItems(v));
    return count;
}

// Mocks reachable in one year bucket — full + subject-wise items, plus the
// sectional views derived from every full mock (one per configured section).
function _yearMockCount(yearData, tier) {
    if (!yearData) return 0;
    const full    = (yearData.full_mocks   || []).length;
    const subject = (yearData.subject_wise || []).length;
    const cfg     = ((EXAM_JSON.config || {})[tier] || {});
    const sections = (cfg.sections || []).length;
    return full + subject + (sections ? full * sections : 0);
}

// Tier config with a safe fallback (some JSONs only define config.default).
function _tierConfig(tier) {
    const cfg = (EXAM_JSON && EXAM_JSON.config) || {};
    return cfg[tier] || cfg.default || {};
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initExamEngine() {
    loadSavedFilters();

    // URL filters take precedence over saved session filters
    const urlFilters = _getUrlFilters();
    if (urlFilters) Object.assign(currentFilters, urlFilters);

    let examName = _getExamNameFromUrl();

    const gridSync = document.getElementById('grid-sync');
    if (gridSync) gridSync.innerText = "";
    const gridEl = document.getElementById('quizGrid');
    if (gridEl) gridEl.innerHTML = Array(6).fill(`
        <div class="skeleton-card">
            <div class="card-info">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line skeleton-meta"></div>
            </div>
            <div class="skeleton-line skeleton-btn"></div>
        </div>`).join('');
    try {
        if (window.__EXAM_JSON__) {
            // Standalone preview embeds the exam JSON directly — no fetch.
            EXAM_JSON = window.__EXAM_JSON__;
        } else {
            const rawUrl = `https://mock-matrix-hub-api.pages.dev/data/${examName}-data.json?t=${Date.now()}`;
            const response = await fetch(rawUrl);
            EXAM_JSON = await response.json();
        }

        // Exams whose JSON has no category layer (data starts straight at
        // tier1/tier2 — or cbt1/cbt2 for exams that call tiers CBT) get
        // wrapped into the default "PYQ MOCK" category by script — the
        // category screen + filter flow then works identically for every exam.
        if (!EXAM_JSON.data['PYQ MOCK'] && Object.keys(EXAM_JSON.data).some(k => /^(tier|cbt)\d+$/i.test(k))) {
            EXAM_JSON.data = { "PYQ MOCK": EXAM_JSON.data };
        }

        // Page title / brand sub from the JSON's examCode (SSC CGL, SSC CHSL…)
        _applyExamTitle();

        // Validate category (case-insensitive) against what this user can see
        const categories = _visibleCategories();
        const matchedCat = _matchCaseInsensitive(categories, currentFilters.category);
        if (matchedCat) {
            currentFilters.category = matchedCat;
        } else {
            currentFilters.category = categories[0] || '';
            currentFilters.tier = null;
            currentFilters.year = '';
        }

        // Validate tier
        const availableTiers = _tierKeys(EXAM_JSON.data[currentFilters.category]);
        const matchedTier = _matchCaseInsensitive(availableTiers, currentFilters.tier);
        if (matchedTier) {
            currentFilters.tier = matchedTier;
        } else {
            // Auto-detect: null means first load or new category — always pick from data
            currentFilters.tier = availableTiers[0] || null;
            currentFilters.year = '';
        }

        // Validate year (latest first; "default" bucket wins when present)
        const years = Object.keys((EXAM_JSON.data[currentFilters.category] || {})[currentFilters.tier] || {});
        if (!years.includes(currentFilters.year)) {
            if (years.includes("default") || years.length === 0) {
                currentFilters.year = "default";
            } else {
                currentFilters.year = years.slice().sort().reverse()[0];
            }
        }

        setupFilters();
        renderMocks();

        // Sync cross-device status in background (non-blocking)
        syncWithCloud(examName);
        _wireSearchInput();

    } catch (e) {
        console.error("Engine initialization failed", e);
        if (gridSync) gridSync.innerText = "";
    }
}

// Sets the brand subtitle / tab title from examCode — e.g. "SSC CGL Mocks".
// Purely cosmetic; every lookup is null-checked so any host page works.
function _applyExamTitle() {
    const code = EXAM_JSON && EXAM_JSON.examCode;
    if (!code) return;
    const label = `${code} Mocks`;
    const brandSub = document.getElementById('brandSub');
    if (brandSub) brandSub.textContent = label;
    try {
        if (!window.__examNavBooted) document.title = `${label} — Mock Matrix Hub`;
    } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
//  syncWithCloud  —  Cross-device attempt checker
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
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return { workerSynced: false, local: {}, worker: {} };
    try {
        const parsed = JSON.parse(raw);
        return {
            workerSynced: !!parsed.workerSynced,
            local: parsed.local || {},
            worker: parsed.worker || {}
        };
    } catch (e) {
        localStorage.removeItem(cacheKey); // corrupted — treat as empty
        return { workerSynced: false, local: {}, worker: {} };
    }
}

function _saveCacheObject(cacheKey, cache) {
    localStorage.setItem(cacheKey, JSON.stringify(cache));
}

function _mergedChecklist(cache) {
    return { ...cache.worker, ...cache.local };
}

// Scans this device's own result_<user>_<id> keys for this exam and adds any
// quizId not already known (in local OR worker) into cache.local — this is
// what lets a just-submitted test show up immediately, no fetch required.
function _absorbLocalResultsIntoCache(user, exam) {
    const cacheKey = _cloudCacheKey(user, exam);
    const cache = _loadCacheObject(cacheKey);
    let changed = false;

    // Preferred path: the small qsum_<user>_<id> key test.html writes on
    // every submit ({quizId, score, attempted, submittedAt}). Cheap to
    // read — no big result_ blob involved — and safe to delete right
    // after absorbing: its data now lives permanently in this CLOUD_SYNC
    // cache, so the small key has done its job.
    Object.keys(localStorage).forEach(key => {
        if (!key.startsWith(`qsum_${user}_`)) return;
        const id = key.replace(`qsum_${user}_`, "");
        if (!id.toLowerCase().includes(exam)) return;

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
    // place afterward — deleting big keys is storage-pressure cleanup's
    // job, not this function's.
    Object.keys(localStorage).forEach(key => {
        if (!key.startsWith(`result_${user}_`)) return;
        const id = key.replace(`result_${user}_`, "");
        if (!id.toLowerCase().includes(exam)) return;
        if (cache.worker[id] || cache.local[id]) return; // already known either way

        try {
            const resultData = JSON.parse(localStorage.getItem(key));
            const fp = resultData.firebasePayload || {};
            cache.local[id] = {
                score: typeof fp.score === 'number' ? fp.score : null,
                createdAt: fp.submittedAt ? new Date(fp.submittedAt).toISOString() : new Date().toISOString()
            };
            changed = true;
        } catch (e) { /* unreadable result — skip, don't crash the page over it */ }
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
let _syncUIInjected = false;

function injectSyncUI() {
    if (_syncUIInjected) return;
    _syncUIInjected = true;

    const headerRow =
        document.getElementById('syncAnchor') ||
        document.querySelector('.sticky-header-section .p-3.d-flex.align-items-center.border-bottom') ||
        document.querySelector('.sticky-header-section > div:first-child');

    if (headerRow) {
        const btn = document.createElement('button');
        btn.id = 'cloudSyncBtn';
        btn.type = 'button';
        btn.className = 'sync-btn ms-auto';
        btn.title = 'Refetch Attempts';
        btn.innerHTML = `<i class="fas fa-rotate"></i><span class="sync-btn-label">Refetch Attempts</span>`;
        btn.onclick = openSyncModal;
        headerRow.appendChild(btn);
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

// ── Filters & Rendering (mock screen filter layer) ───────────────────────────
// Year chips → Type pills (Full / Sectional / Subject Wise) → Section pills.
// The year row only appears when the selected tier has more than one year —
// with a single year it stays hidden and Full Mock + Sectional Mocks show
// directly, exactly like the requested flow.
function setupFilters() {
    if (!EXAM_JSON) return;
    const categoryData = EXAM_JSON.data[currentFilters.category] || {};
    const tierData     = categoryData[currentFilters.tier] || {};
    const years        = Object.keys(tierData);

    // 1. Year chips — hidden entirely when there's only one (or zero) years
    const yearWrap   = document.getElementById('year-wrap');
    const yearScroll = document.getElementById('year-scroll');
    if (yearScroll) {
        if (years.length > 1) {
            yearWrap && yearWrap.classList.remove('hidden');
            yearScroll.innerHTML = years.slice().sort().reverse().map(y => {
                const count = _yearMockCount(tierData[y], currentFilters.tier);
                const label = (y === 'default') ? 'Tests' : y;
                return `<div class="pill-filter ${y === currentFilters.year ? 'active' : ''}" onclick="setYear('${_escJs(y)}')">${label}<span class="pill-count">${count}</span></div>`;
            }).join('');
        } else {
            yearWrap && yearWrap.classList.add('hidden');
            yearScroll.innerHTML = '';
        }
    }

    // 2. Type pills — rebuilt from data with live counts; only types that
    //    actually have content are shown.
    const source        = tierData[currentFilters.year] || {};
    const config        = _tierConfig(currentFilters.tier);
    const fullCount     = (source.full_mocks   || []).length;
    const sectionsCount = (config.sections     || []).length;
    const sectionalCount = fullCount * sectionsCount;
    const subjectCount  = (source.subject_wise || []).length;

    const typeScroll = document.getElementById('type-filters');
    if (typeScroll) {
        const types = [
            { id: 'full_mocks',   label: 'Full Mocks',   count: fullCount,      show: fullCount > 0 },
            { id: 'sectional',    label: 'Sectionals',   count: sectionalCount, show: sectionsCount > 0 && fullCount > 0 },
            { id: 'subject_wise', label: 'Subject Wise', count: subjectCount,   show: subjectCount > 0 }
        ];

        // If the currently active type has no items, fall back to the first visible one
        const visibility = {};
        types.forEach(t => visibility[t.id] = t.show);
        if (!visibility[currentFilters.type]) {
            const fallback = types.find(t => t.show);
            currentFilters.type = fallback ? fallback.id : 'full_mocks';
        }

        typeScroll.innerHTML = types.filter(t => t.show).map(t =>
            `<div class="pill-filter ${t.id === currentFilters.type ? 'active' : ''}" onclick="filterType('${t.id}', this)">${t.label} (${t.count})</div>`
        ).join('');
    }

    // 3. Section pills — only when Sectionals is the active type
    const secWrap = document.getElementById('section-wrap');
    if (currentFilters.type === 'sectional' && sectionsCount > 0) {
        secWrap && secWrap.classList.remove('hidden');
        renderSectionPills(false); // renders mocks itself
    } else {
        secWrap && secWrap.classList.add('hidden');
    }

    // Scroll active pills into view
    ['#year-scroll', '#type-filters', '#section-scroll'].forEach(sel => {
        const active = document.querySelector(`${sel} .pill-filter.active`);
        if (active && active.scrollIntoView) active.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    });
}

// ── Score bar + footer helpers (shared by renderMocks below) ────────────────
// Formats a createdAt string into "18 Aug" if it's this year, or
// "18 Aug 2025" if it's a past year — exactly your date-display rule.
function _formatAttemptedDate(createdAtStr) {
    if (!createdAtStr) return null;
    const d = new Date(String(createdAtStr).replace(' ', 'T')); // D1 gives "YYYY-MM-DD HH:MM"
    if (isNaN(d.getTime())) return null;
    const day = d.getDate();
    const month = d.toLocaleString('en-US', { month: 'short' });
    const now = new Date();
    return d.getFullYear() === now.getFullYear() ? `${day} ${month}` : `${day} ${month} ${d.getFullYear()}`;
}

// Builds the score bar (only if attempted + score known) and the footer
// (Attempted on <date> / Not Attempted — Share). item.marks (from the exam
// JSON snippet) is the total; score comes from CLOUD_CHECKLIST, already
// merged from local + worker data by syncWithCloud/_absorbLocalResultsIntoCache.
function _buildScoreAndFooterHtml(item, isSubmitted, startLink) {
    const record     = CLOUD_CHECKLIST[item.id] || null;
    const totalMarks = typeof item.marks === 'number' ? item.marks : null;

    let scoreRowHtml = '';
    if (isSubmitted && record && typeof record.score === 'number' && totalMarks) {
        const score      = record.score;
        // Cutoff: item.cutoff if the exam JSON defines one, else 70% of total marks.
        const cutoff     = typeof item.cutoff === 'number' ? item.cutoff : totalMarks * 0.7;
        const scorePct   = Math.max(0, Math.min(100, (score / totalMarks) * 100));
        const cutoffPct  = Math.max(0, Math.min(100, (cutoff / totalMarks) * 100));
        // Green if the score cleared the cutoff, yellow if it didn't.
        const fillClass  = score >= cutoff ? 'fill-green' : 'fill-yellow';

        scoreRowHtml = `
            <div class="score-row">
                <div class="score-bar-bg">
                    <div class="score-bar-fill ${fillClass}" style="width:${scorePct}%;"></div>
                    <div class="cutoff-marker" style="left:${cutoffPct}%;"></div>
                </div>
                <div class="score-text">${Number.isInteger(score) ? score : parseFloat(score.toFixed(2))} / ${totalMarks}</div>
            </div>`;
    }

    const attemptedText = isSubmitted
        ? `Attempted on ${_formatAttemptedDate(record && record.createdAt) || '—'}`
        : 'Not Attempted';

    const shareTitle  = String(item.title || '').replace(/'/g, "\\'");
    // Absolute share URL — falls back to the relative link on opaque origins
    // (about:blank / srcdoc, e.g. a sandboxed preview frame) where URL
    // resolution against location.href throws.
    let shareUrlAbs = startLink;
    try { shareUrlAbs = new URL(startLink, window.location.href).href; } catch (e) { /* keep relative */ }

    const footerHtml = `
        <div class="card-footer">
            <span class="attempted-on"><svg class="aoc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>${attemptedText}</span>
            <button type="button" class="share-link" onclick="shareMock('${shareUrlAbs}', '${shareTitle}')">
                <svg class="shi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M12 15V4M8 7.5L12 4l4 3.5"/></svg> Share
            </button>
        </div>`;

    return scoreRowHtml + footerHtml;
}

// Native share sheet on click — falls back to a clipboard copy if the Web
// Share API isn't available on this browser.
async function shareMock(url, title) {
    if (window.mmhShare) {
        try { await window.mmhShare({ title, url }); } catch (e) { /* user cancelled — ignore */ }
    } else if (navigator.share) {
        try { await navigator.share({ title, url }); } catch (e) { /* user cancelled — ignore */ }
    } else if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(url);
            (window.showToast ? window.showToast('Link copied!') : alert('Link copied!'));
        } catch (e) { /* ignore */ }
    }
}

function renderMocks() {
    const grid = document.getElementById('quizGrid');
    if (!grid || !EXAM_JSON) return;

    const config = _tierConfig(currentFilters.tier);
    const source = ((EXAM_JSON.data[currentFilters.category] || {})[currentFilters.tier] || {})[currentFilters.year] || {};

    const searchEl  = document.getElementById('mockSearch');
    const searchVal = (searchEl ? searchEl.value : '').trim().toLowerCase();

    const profile    = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const isPaidUser = profile ? profile.is_paid  : false;
    const username   = profile ? profile.username : "Guest";

    let cardEntries    = []; // { html, isSubmitted } — collected first so a Recommended Mock can be picked
    let itemsToDisplay = [];

    if (currentFilters.type === 'sectional') {
        const fullMocksForSection = source.full_mocks || [];
        const sectionDef = (config.sections || []).find(s => s.id === currentFilters.section);
        if (sectionDef) {
            const cleanSec = sectionDef.backendName.replace(/\s+/g, '').toLowerCase();
            fullMocksForSection.forEach(mock => {
                itemsToDisplay.push({
                    ...mock,
                    id:         `${mock.id}-${cleanSec}`,
                    originalId: mock.id,
                    title:      `${mock.title} - ${sectionDef.name}`,
                    qs:         sectionDef.qs,
                    time:       sectionDef.time,
                    marks:      sectionDef.marks,
                    linkParam:  `id=${mock.id}&section=${encodeURIComponent(sectionDef.backendName)}`
                });
            });
        }
    } else {
        const rawList = source[currentFilters.type] || [];
        itemsToDisplay = rawList.map(item => ({ ...item, linkParam: `id=${item.id}`, originalId: item.id }));
    }

    itemsToDisplay.forEach(item => {
        // Title search — live filter over the current list
        if (searchVal && !String(item.title || '').toLowerCase().includes(searchVal)) return;

        // Date lock
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

        // Check attempt: localStorage (device) OR CLOUD_CHECKLIST (cross-device via Worker)
        const localResult = localStorage.getItem(`result_${username}_${item.id}`);
        const savedState  = JSON.parse(localStorage.getItem(`state_${username}_${item.id}`) || "{}");
        const isSubmitted = localResult !== null || !!CLOUD_CHECKLIST[item.id];

        let actionHtml = '';
        if (isManuallyLocked) {
            actionHtml = `<div class="action-btn locked-btn" style="opacity:0.6;cursor:default;pointer-events:none;">🔒 Locked</div>`;
        } else if (isLockedDate) {
            actionHtml = `<div class="action-btn unlock-btn" style="opacity:0.6;cursor:default;">Available ${item.releaseDate}</div>`;
        } else if (accessDenied) {
            actionHtml = `<a href="/buy-premium.html" class="action-btn unlock-btn">🔒 UNLOCK TEST</a>`;
        } else if (isSubmitted) {
            actionHtml = `
                <div class="btn-grid btn-dual">
                    <a href="${getLink(config)}?${item.linkParam}" class="action-btn analysis-btn">ANALYSIS</a>
                    <button onclick="reattempt('${item.id}', '${getLink(config)}?${item.linkParam}')" class="action-btn reattempt-btn">REATTEMPT</button>
                </div>`;
        } else if (savedState.isPaused) {
            actionHtml = `<a href="${getLink(config)}?${item.linkParam}" class="action-btn resume-btn">▶️ RESUME TEST</a>`;
        } else {
            actionHtml = `<a href="${getLink(config)}?${item.linkParam}" class="action-btn start-btn">START TEST</a>`;
        }

        const startLink = `${getLink(config)}?${item.linkParam}`;
        const scoreFooterHtml = _buildScoreAndFooterHtml(item, isSubmitted, startLink);
        const cardHtml = `
            <div class="mock-card${item.type === 'paid' ? ' is-paid' : ''}">
                <div class="card-clip">
                    <div class="card-row">
                        <div class="card-top">
                            <div class="card-info">
                                <div class="card-title">${item.title} <span class="badge-type ${item.type === 'free' ? 'free-badge' : 'paid-badge'}">${String(item.type || 'free').toUpperCase()}</span></div>
                                <div class="card-meta"><span class="cm"><svg class="cmi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6H21M8.5 12H21M8.5 18H21M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>${item.qs || 100} Qs</span><span class="cm"><svg class="cmi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>${item.time || '60 Min'}</span><span class="cm"><svg class="cmi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></svg>${item.marks || 0} Marks</span></div>
                            </div>
                        </div>
                        <div class="btn-grid">${actionHtml}</div>
                    </div>
                    ${scoreFooterHtml}
                </div>
            </div>`;
        const rec      = CLOUD_CHECKLIST[item.id] || null;
        const recScore = (rec && typeof rec.score === 'number') ? rec.score : null;
        const recMarks = (typeof item.marks === 'number' && item.marks > 0) ? item.marks : null;
        cardEntries.push({ html: cardHtml, isSubmitted, score: recScore, marks: recMarks });
    });

    grid.innerHTML = buildGridHtml(cardEntries, searchVal);
    const gridSync = document.getElementById('grid-sync');
    if (gridSync) gridSync.innerText = "";
}

// ── Recommended Mock block ────────────────────────────────────────────────────
// Recommendation priority (in on-page order):
//   1. The mock right after the last attempted one — natural "continue" pick.
//   2. If that slot doesn't exist or is also attempted — first unattempted mock overall.
//   3. If every mock is attempted — the weakest one: lowest score ÷ total
//      marks (score percentage). Improve it, and the next-lowest is recommended.
// The recommended card is a plain copy of that mock's card — it is NOT
// removed from its normal spot in the list below.
function pickRecommendedIndex(cardEntries) {
    const n = cardEntries.length;
    if (!n) return -1;

    let lastAttemptedIdx = -1;
    for (let i = n - 1; i >= 0; i--) {
        if (cardEntries[i].isSubmitted) { lastAttemptedIdx = i; break; }
    }

    if (lastAttemptedIdx !== -1 && lastAttemptedIdx + 1 < n && !cardEntries[lastAttemptedIdx + 1].isSubmitted) {
        return lastAttemptedIdx + 1;
    }

    const firstUnattemptedIdx = cardEntries.findIndex(c => !c.isSubmitted);
    if (firstUnattemptedIdx !== -1) return firstUnattemptedIdx;

    // All attempted → recommend the weakest mock by score percentage
    // (score ÷ total marks). Re-attempt + improve it, and the next-lowest
    // automatically becomes the recommendation on the next re-render.
    let weakestIdx = -1, weakestPct = Infinity;
    for (let i = 0; i < n; i++) {
        const c = cardEntries[i];
        if (typeof c.score === 'number' && typeof c.marks === 'number' && c.marks > 0) {
            const pct = c.score / c.marks;
            if (pct < weakestPct) { weakestPct = pct; weakestIdx = i; }
        }
    }
    return weakestIdx !== -1 ? weakestIdx : 0;
}

function buildGridHtml(cardEntries, searchVal) {
    if (!cardEntries.length) {
        const searching = !!searchVal;
        return `<div class="empty-state">
                    <div class="empty-ico"><svg class="eic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.8 7.3 12 3l8.2 4.3v9.4L12 21l-8.2-4.3V7.3z"/><path d="M3.8 7.3 12 11.7l8.2-4.4M12 11.7V21"/></svg></div>
                    <div class="empty-title">${searching ? 'No mocks match your search' : 'No mocks here yet'}</div>
                    <div class="empty-sub">${searching ? 'Try a different title, or clear the search to browse all mocks.' : '🚀 Tests coming soon — try a different year or filter.'}</div>
                </div>`;
    }

    const recommended = cardEntries[pickRecommendedIndex(cardEntries)];

    const recommendedCardHtml = recommended.html.replace('class="mock-card', 'class="mock-card recommended-card');
    const recommendBlock = `
        <div class="recommend-heading"><span class="bolt-chip"><svg class="bi" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg></span> Recommended Mock</div>
        ${recommendedCardHtml}
        <div class="recommend-divider"><span>All Mocks · ${cardEntries.length}</span></div>
    `;

    return recommendBlock + cardEntries.map(c => c.html).join('');
}

function getLink(config) {
    if (currentFilters.type === 'full_mocks') return "../" + (config.full_link || 'test.html');
    if (currentFilters.type === 'sectional')  return "../" + (config.sectional_link || 'test.html');
    return "../" + (config.subject_link || 'test.html');
}

// ── Filter setters ────────────────────────────────────────────────────────────
function setYear(y) {
    currentFilters.year = y;
    saveFilters();
    setupFilters();
    renderMocks();
}

function setTier(t) {
    currentFilters.tier = t;
    const years = Object.keys((EXAM_JSON.data[currentFilters.category] || {})[currentFilters.tier] || {});
    currentFilters.year = years.includes("default") ? "default" : (years.slice().sort().reverse()[0] || 'default');
    saveFilters();
    setupFilters();
    renderMocks();
}

function setCategory(cat) {
    currentFilters.category = cat;

    const categoryData   = EXAM_JSON.data[cat] || {};
    const availableTiers = _tierKeys(categoryData);
    if (!availableTiers.includes(currentFilters.tier)) {
        currentFilters.tier = availableTiers[0] || null;
    }
    const years = Object.keys(categoryData[currentFilters.tier] || {});
    currentFilters.year = years.includes("default") ? "default" : (years.slice().sort().reverse()[0] || 'default');
    saveFilters();
    setupFilters();
    renderMocks();
}

function filterType(type, el) {
    currentFilters.type = type;
    saveFilters();
    // setupFilters rebuilds the year/type/section pills so the ACTIVE state
    // moves onto the pill just tapped (and shows/hides the section row);
    // it renders section pills without a double mock render when sectional.
    setupFilters();
    renderMocks();
}

function renderSectionPills(doRender = true) {
    const sections = _tierConfig(currentFilters.tier).sections || [];
    const source   = ((EXAM_JSON.data[currentFilters.category] || {})[currentFilters.tier] || {})[currentFilters.year] || {};
    const fullMockCount = (source.full_mocks || []).length;

    const validIds = sections.map(s => s.id);
    if (!validIds.includes(currentFilters.section)) {
        currentFilters.section = sections.length ? sections[0].id : '';
    }

    const scroll = document.getElementById('section-scroll');
    if (scroll) {
        scroll.innerHTML = sections.map(s =>
            `<div class="pill-filter ${s.id === currentFilters.section ? 'active' : ''}" onclick="setSection('${_escJs(s.id)}')">${s.name} (${fullMockCount})</div>`
        ).join('');
    }
    if (doRender) renderMocks();
}

function setSection(id) {
    currentFilters.section = id;
    saveFilters();
    renderSectionPills();
}

// ══ Title search — SSC-SUB style dropdown, exam edition ═════════════════════
// Searches MOCK TITLES (not years/topics): every Full Mock and every
// Sectional (plus Subject Wise when present) across ALL years of the current
// category + tier. Clicking a result jumps straight to that mock's
// year/type/section drill — same interaction as the SSC-SUB key search.
const SEARCH_RESULTS_LIMIT = 25;

function _searchTitles(query) {
    const q = String(query).trim().toLowerCase();
    if (!q || !EXAM_JSON) return [];

    const tierData = (EXAM_JSON.data[currentFilters.category] || {})[currentFilters.tier] || {};
    const config   = _tierConfig(currentFilters.tier);
    const sections = config.sections || [];
    const results  = [];

    Object.keys(tierData).slice().sort().reverse().forEach(year => {
        const yd = tierData[year] || {};
        const yearLabel = (year === 'default') ? 'Tests' : year;

        (yd.full_mocks || []).forEach(m => {
            if (String(m.title || '').toLowerCase().includes(q)) {
                results.push({ year, type: 'full_mocks', section: '', title: m.title, meta: `${yearLabel} · Full Mock` });
            }
        });

        sections.forEach(sec => {
            (yd.full_mocks || []).forEach(m => {
                const secTitle = `${m.title} - ${sec.name}`;
                if (secTitle.toLowerCase().includes(q)) {
                    results.push({ year, type: 'sectional', section: sec.id, title: secTitle, meta: `${yearLabel} · Sectional · ${sec.name}` });
                }
            });
        });

        (yd.subject_wise || []).forEach(m => {
            if (String(m.title || '').toLowerCase().includes(q)) {
                results.push({ year, type: 'subject_wise', section: '', title: m.title, meta: `${yearLabel} · Subject Wise` });
            }
        });
    });

    return results.slice(0, SEARCH_RESULTS_LIMIT);
}

function _getSearchDropdown() {
    let dropdown = document.getElementById('searchKeyDropdown');
    if (!dropdown) {
        const searchInput = document.getElementById('mockSearch');
        if (!searchInput) return null;
        const parent = searchInput.parentElement;
        if (parent && getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }
        dropdown = document.createElement('div');
        dropdown.id = 'searchKeyDropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:320px;overflow-y:auto;z-index:50;margin-top:4px;';
        parent.appendChild(dropdown);
    }
    return dropdown;
}

function _hideSearchDropdown() {
    const dropdown = document.getElementById('searchKeyDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function _renderSearchResults(matches, query) {
    const dropdown = _getSearchDropdown();
    if (!dropdown) return;

    if (!matches.length) {
        dropdown.innerHTML = `<div style="padding:12px 16px;color:#94a3b8;font-size:13px;">No mock found for "${query}"</div>`;
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML = matches.map(m => `
        <div class="search-result-item" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b;"
             onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''"
             onclick="_selectSearchResult('${_escJs(m.year)}','${_escJs(m.type)}','${_escJs(m.section)}')">
            <div style="font-weight:600;">${m.title}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600;letter-spacing:.2px;">${m.meta}</div>
        </div>`).join('');
    dropdown.style.display = 'block';
}

function _selectSearchResult(year, type, section) {
    currentFilters.year = year;
    currentFilters.type = type;
    if (type === 'sectional' && section) currentFilters.section = section;
    saveFilters();
    setupFilters();
    renderMocks();

    const input = document.getElementById('mockSearch');
    if (input) input.value = '';
    const clear = document.getElementById('searchClear');
    if (clear) clear.classList.remove('show');
    _hideSearchDropdown();
    const grid = document.getElementById('quizGrid');
    if (grid && grid.scrollIntoView) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let _searchWired = false;
function _wireSearchInput() {
    if (_searchWired) return;
    _searchWired = true;

    const input = document.getElementById('mockSearch');
    if (!input) return;

    input.addEventListener('input', () => {
        const q = input.value.trim();
        renderMocks(); // live title filter over the current list
        if (!q) { _hideSearchDropdown(); return; }
        _renderSearchResults(_searchTitles(q), q);
    });

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('searchKeyDropdown');
        if (dropdown && dropdown.style.display !== 'none' && !dropdown.contains(e.target) && e.target !== input) {
            _hideSearchDropdown();
        }
    });
}

// ── Reattempt ─────────────────────────────────────────────────────────────────
async function reattempt(id, url) {
    const profile  = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : "Guest";

    let examName = _getExamNameFromUrl();

    const ok = window.showAppConfirm
        ? await window.showAppConfirm({ title: "Reattempt this mock?", body: "Your previous attempt for this mock will be cleared on this device.", confirmLabel: "Yes, Reattempt" })
        : confirm("Confirm Reattempt? Are you sure to reattempt.");
    if (!ok) return;

    try {
        // Step 1: Remove all local keys for this quiz
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        localStorage.removeItem(`stream_${username}_${id}`);

        // Step 2: Update in-memory checklist and save updated cache
        const user = username;  // original case — NOT lowercased ("Guest" if not logged in)

        const exam     = examName.toLowerCase();
        const cacheKey = _cloudCacheKey(user, exam);

        const cache = _loadCacheObject(cacheKey);
        delete cache.local[id];
        delete cache.worker[id];
        _saveCacheObject(cacheKey, cache);
        CLOUD_CHECKLIST = _mergedChecklist(cache);

        // Step 4: Verify all keys are actually gone before navigating
        const allCleared = [
            `result_${username}_${id}`,
            `state_${username}_${id}`,
            `stream_${username}_${id}`
        ].every(key => localStorage.getItem(key) === null);

        if (!allCleared) throw new Error("Cache clear failed — some keys still present");

        // Step 5: Navigate only after confirmed cleanup
        window.location.href = url + "&mode=reattempt";

    } catch (err) {
        console.error("Reattempt cleanup failed:", err);
        alert("Something went wrong while clearing your previous attempt. Please try again.");
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  Multi-screen navigation — Category → Tier → Mocks
//  Android-app style flow, mirroring the SSC-SUB hub (Year → Subjects →
//  Mocks) but with the exam drill: category first (PYQ MOCKS / NEW MOCK —
//  wrapped by script when the JSON has no category layer), then tier (only
//  when more than one exists — a single tier lands straight on the mocks).
//  The URL always reflects the current drill as ?filter=category=…,tier=…,
//  so deep links + browser back keep working.
// ════════════════════════════════════════════════════════════════════════════
const EXAM_SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const EXAM_ICONS = {
    archive : `<svg ${EXAM_SVG}><rect x="3.5" y="4" width="17" height="4.5" rx="1.5"/><path d="M5.5 8.5V18a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5M10 12.5h4"/></svg>`,
    calendar: `<svg ${EXAM_SVG}><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>`,
    bolt    : `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>`,
    layers  : `<svg ${EXAM_SVG}><path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 16.8 12 21.3l9-4.5"/></svg>`,
    clip    : `<svg ${EXAM_SVG}><rect x="5.5" y="4" width="13" height="17" rx="2.5"/><path d="M9 2.5h6v3H9z" fill="currentColor" stroke="none"/><path d="M9 11h6M9 15h4"/></svg>`,
    chev    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`
};

function _categoryVisual(name) {
    const n = String(name).toLowerCase();
    if (n.includes('pyq') || n.includes('previous') || n.includes('past')) return { ico: EXAM_ICONS.archive,  cls: 'blue'   };
    if (n.includes('new') || n.includes('live') || n.includes('upcoming')) return { ico: EXAM_ICONS.bolt,     cls: 'amber'  };
    if (n.includes('mock'))                                                return { ico: EXAM_ICONS.calendar, cls: 'violet' };
    return { ico: EXAM_ICONS.clip, cls: 'blue' };
}

const TIER_COLORS = ['blue', 'violet', 'teal', 'amber', 'slate'];

let _examHubCategory = '';
let _examFromDeeper = false; /* category screen reached by stepping back from a deeper screen */
const ROOT_TITLE = document.title; /* this page's own root title, captured before any nav rewrites */

/* Category-page back arrow visibility — same rule as the SSC-SUB hub:
   · stepped back here from tiers/mocks  → show
   · arrived from another page (referrer) → show
   · any earlier history entry to pop    → show (also covers the app WebView,
     where document.referrer is often empty)
   · fresh landing with nothing before it → hide */
function _updateCategoryBack() {
    const b = document.getElementById('backFromCategory');
    if (!b) return;
    b.style.display = ''; // always visible — this page has a defined parent (exams index)
}

function _showExamScreen(id, dir) {
    ['screenCategory', 'screenTiers', 'screenMocks'].forEach(sid => {
        const s = document.getElementById(sid);
        if (s) { s.classList.remove('active'); s.classList.remove('from-left'); }
    });
    const scr = document.getElementById(id);
    if (!scr) return;
    scr.classList.add('active');
    if (dir === -1) scr.classList.add('from-left');
    const sc = scr.querySelector('.screen-scroll') || scr.querySelector('.scrollable-grid-area');
    if (sc) sc.scrollTop = 0;
}

function _isExamScreenActive(id) {
    const s = document.getElementById(id);
    return !!(s && s.classList.contains('active'));
}

/* same URL format the engine's _updateUrlFilter writes */
function _examFilterUrl(o) {
    const fs = ['category', 'tier', 'year', 'type', 'section']
        .filter(k => o[k])
        .map(k => `${k}=${o[k]}`)
        .join(',');
    const examToken = window.location.search
        ? window.location.search.slice(1).split('&').find(p => !p.startsWith('filter='))
        : null;
    const query = examToken
        ? `?${examToken}${fs ? `&filter=${encodeURIComponent(fs)}` : ''}`
        : (fs ? `?filter=${encodeURIComponent(fs)}` : '');
    return window.location.pathname + query;
}

function _buildCategoryCards() {
    const box = document.getElementById('categoryCards');
    if (!box || !EXAM_JSON) return;
    const cats = _visibleCategories();
    box.innerHTML = cats.map(cat => {
        const cd = EXAM_JSON.data[cat] || {};
        const tiers = _tierKeys(cd);
        const total = _countItems(cd);
        const vis = _categoryVisual(cat);
        const meta = tiers.length > 1
            ? `${tiers.length} tiers · ${total} mocks`
            : `${total} mocks`;
        return `<button type="button" class="nav-card" onclick="examNavCategory('${_escJs(cat)}')">
            <span class="nc-ico ${vis.cls}">${vis.ico}</span>
            <span class="nc-body"><span class="nc-title">${cat}</span>
            <span class="nc-meta">${meta}</span></span>
            <span class="nc-chev">${EXAM_ICONS.chev}</span>
        </button>`;
    }).join('');

    const catIntroCount = document.getElementById('categoryIntroCount');
    if (catIntroCount) {
        const totalMocks = cats.reduce((n, c) => n + _countItems(EXAM_JSON.data[c]), 0);
        catIntroCount.textContent = `${cats.length} ${cats.length === 1 ? 'category' : 'categories'} · ${totalMocks} mocks`;
    }
}

function _buildTierCards(cat) {
    const box = document.getElementById('tierCards');
    const cd  = (EXAM_JSON.data[cat] || {});
    const tiers = _tierKeys(cd);
    if (!box) return;
    box.innerHTML = tiers.map((t, i) => {
        const td    = cd[t] || {};
        const years = Object.keys(td);
        const total = _countItems(td);
        const meta  = years.length > 1 ? `${years.length} years · ${total} mocks` : `${total} mocks`;
        const cls   = TIER_COLORS[i % TIER_COLORS.length];
        return `<button type="button" class="nav-card" onclick="examNavTier('${_escJs(t)}')">
            <span class="nc-ico ${cls}">${EXAM_ICONS.layers}</span>
            <span class="nc-body"><span class="nc-title">${formatTierLabel(t)}</span>
            <span class="nc-meta">${meta}</span></span>
            <span class="nc-chev">${EXAM_ICONS.chev}</span>
        </button>`;
    }).join('');

    const tt = document.getElementById('tiersTitle');
    if (tt) tt.textContent = cat;
    const ts = document.getElementById('tiersSub');
    if (ts) ts.textContent = `${tiers.length} tiers · ${_countItems(cd)} mocks`;
}

function _updateMockHeader() {
    if (!EXAM_JSON) return;
    const tiers = _tierKeys(EXAM_JSON.data[currentFilters.category] || {});
    const multiTier = tiers.length > 1;
    const cat       = currentFilters.category || '';
    const tierLabel = multiTier ? formatTierLabel(currentFilters.tier) : '';

    // Small screens: one element only (tier, or category when single-tier).
    // Big screens (≥900px): full breadcrumb — "SSC CGL · PYQ MOCK · Tier I".
    const code  = EXAM_JSON.examCode ? `${EXAM_JSON.examCode}` : '';
    const short = multiTier ? tierLabel : (cat || 'Mocks');
    const full  = [code, cat, tierLabel].filter(Boolean).join(' \u00B7 ');

    const mt = document.getElementById('mockTitle');
    const ms = document.getElementById('mockSub');
    if (mt) mt.textContent = _isBigScreen() ? full : short;
    if (ms) ms.textContent = (_isBigScreen() || !multiTier) ? 'Mock Matrix Hub' : cat;
}

/* ≥900px = the design's desktop breakpoint (grid goes multi-column there) */
function _isBigScreen() {
    try { return !!(window.matchMedia && window.matchMedia('(min-width: 900px)').matches); }
    catch (e) { return false; }
}

/* Enter the mocks screen for the current category+tier (engine renders) */
function _enterMocksScreen(dir) {
    if (typeof setupFilters === 'function') setupFilters();
    if (typeof renderMocks  === 'function') renderMocks();
    _updateMockHeader();
    _showExamScreen('screenMocks', dir);
    const tiers = _tierKeys(EXAM_JSON.data[currentFilters.category] || {});
    document.title = `${tiers.length > 1 ? formatTierLabel(currentFilters.tier) + ' · ' : ''}${currentFilters.category} — Mock Matrix Hub`;
}

/* Category card tapped → tier screen (or straight to mocks for a single tier) */
window.examNavCategory = function(cat) {
    if (!EXAM_JSON || !EXAM_JSON.data[cat]) return;
    _examHubCategory = cat;
    currentFilters.category = cat;
    currentFilters.tier    = null;
    currentFilters.year    = '';
    currentFilters.type    = 'full_mocks';
    currentFilters.section = '';

    const tiers = _tierKeys(EXAM_JSON.data[cat]);
    if (tiers.length > 1) {
        try {
            history.pushState({ mmhNav: 1 }, '', _examFilterUrl({ category: cat }));
            saveFilters();
        } catch (e) { /* history may be unavailable (file://) — screens still work */ }
        _buildTierCards(cat);
        _showExamScreen('screenTiers', 1);
        document.title = `${cat} — Mock Matrix Hub`;
    } else {
        // Only one tier in the data config — no tier to select, land on mocks
        currentFilters.tier = tiers[0] || null;
        const years = Object.keys((EXAM_JSON.data[cat] || {})[currentFilters.tier] || {});
        currentFilters.year = years.includes("default") ? "default" : (years.slice().sort().reverse()[0] || 'default');
        try {
            history.pushState({ mmhNav: 1 }, '', _examFilterUrl({ category: cat, tier: currentFilters.tier }));
            saveFilters();
        } catch (e) {}
        _enterMocksScreen(1);
    }
};

/* Tier card tapped → mocks screen */
window.examNavTier = function(t) {
    const cat = _examHubCategory || currentFilters.category;
    currentFilters.category = cat;
    currentFilters.tier    = t;
    currentFilters.section = '';
    const years = Object.keys((EXAM_JSON.data[cat] || {})[t] || {});
    currentFilters.year = years.includes("default") ? "default" : (years.slice().sort().reverse()[0] || 'default');
    currentFilters.type = 'full_mocks';
    try {
        history.pushState({ mmhNav: 1 }, '', _examFilterUrl({ category: cat, tier: t }));
        saveFilters();
    } catch (e) {}
    _enterMocksScreen(1);
};

/* Back arrow — steps up the drill: mocks → tiers → category.
   Script-defined target (never "wherever the user came from"), but when the
   current history entry is one WE pushed (marker mmhNav), it pops just that
   one entry so the DEVICE back button keeps the exact same step-through
   workflow. If the user landed by a direct/deep link (no marker), it steps
   the screens in place instead — so it can never close the tab or bounce
   into an unrelated page, and the Tier ↔ Category (PYQ/NEW) loop can
   never happen. */
window.examBack = function() {
    if (!EXAM_JSON) return;

    var st = (window.history && window.history.state) || null;
    if (st && st.mmhNav) {
        try { history.back(); return; } catch (e) { /* fall through to in-place step */ }
    }

    const tiers = _tierKeys(EXAM_JSON.data[currentFilters.category] || {});

    if (_isExamScreenActive('screenMocks')) {
        currentFilters.tier    = null;
        currentFilters.year    = '';
        currentFilters.type    = 'full_mocks';
        currentFilters.section = '';
        try { saveFilters(); } catch (e) {}
        if (tiers.length > 1) {
            _buildTierCards(currentFilters.category);
            _showExamScreen('screenTiers', -1);
            document.title = `${currentFilters.category} — Mock Matrix Hub`;
        } else {
            currentFilters.category = '';
            _examFromDeeper = true; /* so the category-page back arrow knows where to return */
            _updateCategoryBack();
            _showExamScreen('screenCategory', -1);
            document.title = ROOT_TITLE;
        }
    } else if (_isExamScreenActive('screenTiers')) {
        currentFilters.category = '';
        currentFilters.tier    = null;
        currentFilters.year    = '';
        currentFilters.type    = 'full_mocks';
        currentFilters.section = '';
        try { saveFilters(); } catch (e) {}
        _examFromDeeper = true;
        _updateCategoryBack();
        _showExamScreen('screenCategory', -1);
        document.title = ROOT_TITLE;
    }
};

/* Category-page back arrow — deterministic parent navigation, NEVER
   history.back(). Always goes to the exams index (the parent page) however
   the user arrived — normal link, shared deep link or direct URL — so it
   can never close the tab or bounce back into the page. */
window.examBackFromCategory = function() {
    try {
        const seg = window.location.pathname.replace(/\/+$/, '').split('/');
        if (seg[seg.length - 1] === 'index.html') seg.pop(); // this page
        seg.pop();                                            // this exam folder
        const parent = seg.join('/') || '/';
        window.location.href = (parent.endsWith('/') ? parent : parent + '/') + 'index.html';
    } catch (e) {
        window.location.href = '../index.html'; // safe fallback to the exams index
    }
};

/* Land on the screen that matches the URL (?filter=…) — used at boot
   (deep links) and on every browser/system back (popstate).
   The URL is the source of truth: engine state is synced to it here. */
window.examLandFromUrl = function() {
    if (!EXAM_JSON) return;
    const p    = _getUrlFilters();
    const cats = _visibleCategories();

    const cat = p && p.category ? (_matchCaseInsensitive(cats, p.category) || '') : '';
    if (!cat) {
        // Fresh landing — category screen
        _examFromDeeper = false; /* any URL landing resets the back-arrow context */
        _updateCategoryBack();
        _buildCategoryCards();
        _showExamScreen('screenCategory', 0);
        document.title = ROOT_TITLE;
        return;
    }

    _examHubCategory = cat;
    currentFilters.category = cat;
    const tiers = _tierKeys(EXAM_JSON.data[cat] || {});

    const tier = tiers.length === 1
        ? tiers[0]                                   // single tier — nothing to select
        : (_matchCaseInsensitive(tiers, p.tier) || '');

    if (!tier) {
        // Category chosen, tier not yet — tier screen
        currentFilters.tier = null;
        _buildTierCards(cat);
        _showExamScreen('screenTiers', 0);
        document.title = `${cat} — Mock Matrix Hub`;
        return;
    }

    // Full drill from the URL — mocks screen
    currentFilters.tier = tier;
    const years = Object.keys((EXAM_JSON.data[cat] || {})[tier] || {});
    const yMatch = _matchCaseInsensitive(years, p && p.year);
    currentFilters.year = yMatch || (years.includes("default") ? "default" : (years.slice().sort().reverse()[0] || 'default'));
    if (p && p.type && ['full_mocks', 'sectional', 'subject_wise'].includes(p.type)) currentFilters.type = p.type;
    if (p && p.section) currentFilters.section = p.section;
    saveFilters();
    _enterMocksScreen(0);
};

/* Boot the exam flow (called after initExamEngine resolves, so
   currentFilters already reflects: URL deep link > saved session > defaults) */
function initExamNav() {
    if (!EXAM_JSON) return;
    window.__examNavBooted = true;

    _buildCategoryCards();
    _examHubCategory = currentFilters.category || '';

    const bc = document.getElementById('backFromCategory');
    if (bc) bc.onclick = window.examBackFromCategory;
    const bt = document.getElementById('backFromTiers');
    if (bt) bt.onclick = window.examBack;
    const bm = document.getElementById('backFromMocks');
    if (bm) bm.onclick = window.examBack;
    _updateCategoryBack(); /* show the first-page arrow when a referrer exists */

    // Re-apply the responsive mock header when crossing the 900px breakpoint
    try {
        const mq = window.matchMedia('(min-width: 900px)');
        const onMq = function() { if (EXAM_JSON && _isExamScreenActive('screenMocks')) _updateMockHeader(); };
        if (mq.addEventListener) mq.addEventListener('change', onMq);
        else if (mq.addListener) mq.addListener(onMq);
    } catch (e) { /* matchMedia unavailable — header stays in small mode */ }

    // app-shell wires the theme buttons inside initHubNav() (SSC-SUB pages
    // only) — exam pages wire them here, same toggleTheme() underneath.
    const tbtns = document.querySelectorAll('.theme-btn');
    Array.prototype.forEach.call(tbtns || [], function(b) {
        b.onclick = function() { if (window.toggleTheme) window.toggleTheme(); };
    });

    window.addEventListener('popstate', function() { window.examLandFromUrl(); });
    window.examLandFromUrl();
}
window.initExamNav = initExamNav;

// ── Page lifecycle ─────────────────────────────────────────────────────────────
window.addEventListener('pageshow', function (event) {
    initExamEngine();
    if (event.persisted || (window.performance && window.performance.navigation && window.performance.navigation.type === 2)) {
        if (typeof renderMocks === 'function' && EXAM_JSON) {
            renderMocks();
        }
    }
});

// If getLocalProfile() was empty/broken at the time initExamEngine() first
// ran (session live, cache not yet populated), the page would have used the
// "Guest"/free default — which affects TWO things, not just mock lock
// state: renderMocks() AND which category cards are shown at all (a "paid"
// category is filtered out of the list entirely for a visitor who looked
// unpaid at that moment). The previous version only re-ran renderMocks()
// here, so a paid user on a fresh device could be stuck missing a whole
// category until a manual reload.
//
// This re-derives categories the same way initExamEngine() does, rather
// than blocking page render on an async wait for auth.js/profile data to
// arrive. Reacting to the real data once it lands is both correct and never
// blocks the initial render.
window.addEventListener('profileUpdated', function () {
    if (!EXAM_JSON) return;

    const categories = _visibleCategories();
    if (!categories.includes(currentFilters.category)) {
        currentFilters.category = categories[0] || '';
        const categoryData   = EXAM_JSON.data[currentFilters.category] || {};
        const availableTiers = _tierKeys(categoryData);
        if (!availableTiers.includes(currentFilters.tier)) {
            currentFilters.tier = availableTiers[0] || null;
        }
        const years = Object.keys(categoryData[currentFilters.tier] || {});
        currentFilters.year = years.includes("default") ? "default" : (years.slice().sort().reverse()[0] || 'default');
        setupFilters();
    }
    _buildCategoryCards();

    if (typeof renderMocks === 'function') {
        renderMocks();
    }
});
