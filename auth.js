const PROXY_URL = 'https://auth.mockmatrixhub.in';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc';

let _supabase = null;

// De-duplicates CONCURRENT getSession() calls into a single underlying
// request — e.g. auth.js's own initAuth() and a page's own on-load check
// both firing within the same tick would otherwise trigger two separate
// (possibly two separate refresh) calls to Supabase. This does NOT cache
// indefinitely: the in-flight flag clears the moment the call resolves,
// so a call made later (a button click minutes after page load) still
// performs its own fresh check, as it correctly should.
let _inFlightSessionCheck = null;
function getSessionOnce(client) {
    if (_inFlightSessionCheck) return _inFlightSessionCheck;
    _inFlightSessionCheck = client.auth.getSession().finally(() => {
        _inFlightSessionCheck = null;
    });
    return _inFlightSessionCheck;
}

async function getClient() {
    if (_supabase) return _supabase;
    _supabase = supabase.createClient(PROXY_URL, SUPABASE_KEY);

    // Single authoritative signal for "the user is really logged out."
    // Supabase fires this only when it has confirmed the session is gone
    // (explicit sign-out, refresh token revoked/invalid) — never on a
    // transient network error. This replaces ad-hoc redirect-to-login
    // decisions scattered across page loads with one reliable source.
    _supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            clearAuthLocal();
            const path = window.location.pathname;
            const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
            if (isGatedPage(path) && !isLoginPage) {
                const returnTo = path + window.location.search;
                window.location.href = "/login.html?redirect=" + encodeURIComponent(returnTo);
            } else if (!isLoginPage) {
                // Public page (home etc.) — storage already cleared above.
                // Don't redirect, just tell the page to refresh its UI.
                window.dispatchEvent(new Event('profileUpdated'));
            }
        }
    });

    return _supabase;
}

const SECRET_SALT = "mmh_vault_key_99";

// ── UTC-safe expiry helpers (handles Supabase format "2027-08-24 09:23:05.553+00") ──
function parseExpiryDate(str){
    if(!str) return null;
    try{
        let s = String(str).trim();
        if(s.includes(' ') && !s.includes('T')){
            s = s.replace(' ', 'T');
        }
        s = s.replace(/\+00$/, 'Z').replace(/\+00:00$/, 'Z').replace(/\+0000$/, 'Z').replace(/\s*\+00$/, 'Z');
        const d = new Date(s);
        if(!isNaN(d.getTime())) return d;
        const d2 = new Date(str);
        return isNaN(d2.getTime()) ? null : d2;
    }catch(e){ return null; }
}
function isPaidStillValid(p){
    if(!p || !p.is_paid) return false;
    if(!p.expires_at) return true;
    const exp = parseExpiryDate(p.expires_at);
    if(!exp) return !!p.is_paid;
    return exp.getTime() > Date.now();
}
function getTimeLeftMs(expires_at){
    const exp = parseExpiryDate(expires_at);
    if(!exp) return null;
    return exp.getTime() - Date.now();
}
window.parseExpiryDate = parseExpiryDate;
window.isPaidStillValid = isPaidStillValid;
window.getTimeLeftMs = getTimeLeftMs;

// Same storage clearing handleLogout() does — minus signOut()/redirect,
// so it's safe to call from anywhere (including from inside the
// SIGNED_OUT listener itself) without recursing or double-navigating.
function clearAuthLocal() {
    localStorage.removeItem('u_vault');
    localStorage.removeItem('mmh_guide_seen');
}

// ── Page gating: WHITELIST, not blacklist ────────────────────────────────
// Only pages listed here truly need a logged-in session just to render
// (they show/manage data that belongs to a specific user — profile,
// bookmarks, purchase, admin/partner tools, or the actual test-attempt
// screen that writes attempt rows). Every other page — home, pricing, the
// exam/mock BROWSING pages — is public by default: a visitor can look
// around without logging in, same as Testbook/Adda247. Personalization
// (username, PRO badge, locked-paid-mocks) still applies via
// getLocalProfile() wherever a session does exist; it just never forces
// a redirect on pages that don't strictly require one.
//
// ⚠ CONFIRM/EDIT THIS LIST for your real URL structure before relying on
// it — this is a best-guess from index.html's sidebar links. Add the
// actual quiz-attempt template path(s) too (e.g. test-t2-s-w.html or
// wherever attempts are recorded), and anything else that reads/writes
// user-specific data.
const GATED_PATHS = [
    '/profile.html',
    '/saved/index.html',
    '/buy-premium.html',
    '/admin-vault.html',
    '/admin-notify.html',
    '/partner-dashboard.html',
    '/apply-coupon.html',
];

function isGatedPage(path) {
    return GATED_PATHS.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p));
}

// Call this before any ACTION that needs a logged-in user on an otherwise
// public page — "Start Test", "Save Question", "Buy Premium", "Reattempt",
// etc. Returns the user if already logged in. If not, sends them to
// login.html with a return path (so they land back on the exact action
// they meant to do) and returns null — caller should stop right there.
async function requireLogin(returnPath) {
    const client = await getClient();
    let session = null;
    try {
        const { data } = await getSessionOnce(client);
        session = data.session;
    } catch (e) {
        // Network hiccup — don't falsely claim "not logged in" and wipe
        // their progress toward this action. Let them know and stop.
        alert("Could not verify your login. Please check your connection and try again.");
        return null;
    }
    if (session && session.user) return session.user;

    const target = returnPath || (window.location.pathname + window.location.search);
    window.location.href = "/login.html?redirect=" + encodeURIComponent(target);
    return null;
}

/**
 * Fetches (and caches) the full profile for a logged-in user.
 * Used both by initAuth() and by login.html's login/signup flows so that
 * nobody gets redirected to another page before their profile data
 * has actually arrived.
 * Returns the profile object on success, or null if it could not be loaded.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempts the profiles fetch up to `retries` times with a short backoff
 * between attempts (network blips, cold-start Worker, etc). Throws the
 * last error if every attempt fails. A "no row found" response is also
 * treated as a failure here (single() errors on 0 rows) so it goes
 * through the same retry path — cheap insurance in case it was actually
 * transient replication lag rather than a truly missing profile.
 */
async function fetchProfileWithRetry(client, userId, retries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
            if (error) throw error;
            if (data) return data;
            throw new Error('Profile row not found');
        } catch (e) {
            lastError = e;
            if (attempt < retries) await sleep(attempt * 700); // 700ms, then 1400ms
        }
    }
    throw lastError;
}

async function fetchAndCacheProfile(client, user) {
    // 1. BACKGROUND SYNC: If user has a pending request, check status automatically
    if (localStorage.getItem('pending_premium_request') === 'true') {
        await syncPendingPremiumStatus(client, user.email);
    }

    let profile = getLocalProfile();
    const urlParams = new URLSearchParams(window.location.search);
    // A cached profile only counts as "current" if it actually belongs to
    // the user who is now authenticated. Without this, a still-valid (not
    // yet expired) cache left over from a PREVIOUS user on this same
    // browser/device gets returned as-is for the NEW logged-in user —
    // showing the wrong username/is_paid/etc until the old cache happens
    // to expire on its own 7-day timer.
    const cacheBelongsToOtherUser = profile && profile.id !== user.id;
    const forceFetch = urlParams.get('type') === 'recovery' || !profile || cacheBelongsToOtherUser;

    if (cacheBelongsToOtherUser) {
        profile = null; // don't hand back stale data from a different account while the fresh fetch is in flight
    }

    // 2. CACHE MANAGEMENT: Fetch profile if missing or expired
    if (forceFetch || isCacheExpired()) {
        try {
            const dbProfile = await fetchProfileWithRetry(client, user.id, 3);

            // Partner status lives in the coupons table, not profiles.
            // Resolve it HERE — only when we're already doing a fresh
            // fetch (once per login / once every 7 days) — instead of
            // querying it separately on every page load.
            //
            // NOTE: an owner_user_id can have MORE THAN ONE active coupon
            // row (confirmed in production data). maybeSingle() throws
            // when a query matches more than one row, which was silently
            // failing here for those users and leaving is_partner=false
            // even though they do have active coupons. Using a plain
            // select + limit(1) instead — we only need to know whether
            // at least one active coupon exists, not fetch a single row.
            let isPartner = false;
            try {
                const { data: activeCoupons } = await client
                    .from('coupons')
                    .select('code')
                    .eq('owner_user_id', dbProfile.id)
                    .eq('is_active', true)
                    .limit(1);
                isPartner = !!(activeCoupons && activeCoupons.length > 0);
            } catch (e) {
                // Leave isPartner false on error; next cache refresh will retry.
            }

            let freshProfile = { ...dbProfile, is_partner: isPartner };
            // ── enforce expiry before caching (zero API) ──
            if(freshProfile.is_paid && freshProfile.expires_at){
                const exp = parseExpiryDate(freshProfile.expires_at);
                if(exp && exp.getTime() <= Date.now()){
                    try{
                        const oldRaw = localStorage.getItem('u_vault');
                        if(oldRaw){
                            const oldDec = decodeURIComponent(escape(atob(oldRaw))).replace(SECRET_SALT,'');
                            const oldData = JSON.parse(oldDec);
                            if(oldData && oldData.is_paid){
                                localStorage.setItem('mmh_just_expired','1');
                                localStorage.setItem('mmh_just_expired_ts', String(Date.now()));
                            }
                        }
                    }catch(e){}
                    freshProfile.is_paid = false;
                }
            }
            saveLocalProfile(freshProfile);

            // GUARANTEE: never treat this as a successful load unless it's
            // actually readable back from localStorage. Protects against a
            // silent write failure (quota exceeded, private-browsing storage
            // caps, etc) where saveLocalProfile() ran but nothing actually
            // persisted — we don't want to hand back a "profile loaded"
            // result that isn't backed by cache.
            const verify = getLocalProfile();
            if (!verify || verify.id !== freshProfile.id) {
                throw new Error('Profile save to localStorage could not be verified');
            }

            // Only now — save confirmed — does this become "the" profile.
            profile = freshProfile;
        } catch (e) {
            console.error('Profile fetch failed after retries:', e);

            // Deliberately NOT signing the user out here, even when there's
            // no cached fallback. A failed profile read (network hiccup,
            // Worker cold start, DB briefly slow) says nothing about whether
            // the auth session itself is valid — only Supabase's own
            // onAuthStateChange('SIGNED_OUT') is treated as proof of that.
            // Callers handle profile === null by showing a retry message
            // (login.html) or simply proceeding with whatever getLocalProfile()
            // already has cached (every other page) — the user stays logged
            // in and the UI self-corrects once the fetch succeeds.
            return profile || null;
        }
    }

    return profile;
}

/**
 * Works out where to send the user after they finish logging in / registering.
 * Priority: explicit ?redirect= param (the page that bounced them to login) >
 * same-origin referrer (if it isn't the login page itself) > home page.
 */
function getSafeRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('redirect');
    if (raw) {
        try {
            const decoded = decodeURIComponent(raw);
            // Only allow internal, same-site paths (never redirect off-site)
            if (decoded.startsWith('/') && !decoded.startsWith('//')) {
                return decoded;
            }
        } catch (e) {}
    }

    if (document.referrer) {
        try {
            const refUrl = new URL(document.referrer);
            if (refUrl.origin === window.location.origin && !refUrl.pathname.endsWith('login.html')) {
                return refUrl.pathname + refUrl.search;
            }
        } catch (e) {}
    }

    return "/index.html";
}

async function initAuth() {
    const client = await getClient();

    const path = window.location.pathname;
    const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    // Whitelist-based: only pages in GATED_PATHS require a session to
    // render. Everything else — including exam/mock browsing pages — is
    // public; personalization still applies if a session exists, but an
    // anonymous visitor is never redirected off of it.
    const requiresLogin = isGatedPage(path) && !isLoginPage;

    // getSession() reads the locally persisted session (refreshing it only
    // if actually near expiry) instead of round-tripping to the auth server
    // on every page load. Deliberately NOT retried here: calling it twice
    // in quick succession risks two refresh attempts racing on the same
    // refresh token, which Supabase can treat as reuse and revoke the whole
    // session over — turning a harmless retry into a real logout. If this
    // single check fails, we treat it as "couldn't tell" rather than "logged
    // out" (see checkFailed below) — onAuthStateChange is the only thing
    // authorized to actually sign the user out.
    let user = null;
    let checkFailed = false;
    try {
        const { data: { session } } = await getSessionOnce(client);
        user = session ? session.user : null;
    } catch (e) {
        console.error('Session check failed:', e);
        checkFailed = true;
    }

    if (user) {
        // Fetch the full profile and WAIT for it before doing anything that
        // depends on it (like leaving the login page).
        const profile = await fetchAndCacheProfile(client, user);

        // VARIABLE EXPOSURE: Extracting required data for other page functions
        const username = profile ? profile.username : "User";
        const isPaid = profile ? profile.is_paid : false;
        const isAdmin = profile ? profile.role === 'admin' : false;
        const isPartner = profile ? profile.is_partner : false;
        const expiryDate = profile && profile.expires_at ? new Date(profile.expires_at) : null;

        let daysLeft = 0;
        if (expiryDate) {
            daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        }

        // (Note: UI rendering logic moved to individual index.html files)

        if (isLoginPage && profile) {
            // Profile confirmed loaded — safe to leave the login page now.
            window.location.href = getSafeRedirectTarget();
        }
        // If profile is null here, the session is still perfectly valid —
        // fetchAndCacheProfile() no longer signs anyone out over a failed
        // profile read. The page just keeps whatever getLocalProfile() has
        // cached (or sensible defaults) and self-corrects once a fetch
        // succeeds and fires 'profileUpdated'.
        return;
    }

    if (checkFailed) {
        // Could not determine auth state at all (rare — storage blocked,
        // client init error). This is NOT proof of a logout, so we do not
        // redirect on it — doing so is exactly what caused users to be
        // bounced to login.html over ordinary network blips. If the session
        // really is gone, onAuthStateChange('SIGNED_OUT') will catch it.
        return;
    }

    // Confirmed: getSession() explicitly returned no session.
    if (requiresLogin) {
        clearAuthLocal();
        const returnTo = path + window.location.search;
        window.location.href = "/login.html?redirect=" + encodeURIComponent(returnTo);
    }
}

/**
 * Background Sync Logic: Checks if a pending payment has been approved
 */
async function syncPendingPremiumStatus(client, email) {
    const { data } = await client.from('payment_requests')
        .select('status')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (data && data.status === 'success') {
        const { data: dbProfile } = await client.from('profiles').select('*').eq('email', email).single();
        if (dbProfile) {
            const profile = { ...dbProfile, email: email, is_paid: true };
            saveLocalProfile(profile);
            localStorage.removeItem('pending_premium_request');
            location.reload(); // Refresh to update premium UI across the site
        }
    } else if (data && data.status === 'rejected') {
        localStorage.removeItem('pending_premium_request');
    }
}

function saveLocalProfile(data) {
    const payload = { ...data, cache_expiry: Date.now() + (7 * 24 * 60 * 60 * 1000) };
    const json = JSON.stringify(payload) + SECRET_SALT;
    // btoa() only handles Latin1 — a Hindi/Devanagari full_name (unrestricted
    // free-text field at signup) would throw here and silently break caching
    // for that user on every save. encodeURIComponent/unescape round-trip
    // makes this Unicode-safe without changing the stored format.
    const encrypted = btoa(unescape(encodeURIComponent(json)));
    try {
        localStorage.setItem('u_vault', encrypted);
    } catch (e) {
        // Storage quota exceeded (or otherwise unwritable — private mode,
        // disk full, etc). Don't let this throw and break the caller —
        // the user stays logged in via the Supabase session itself; they
        // just won't get the 7-day local profile cache this time, and the
        // page will fall back to a fresh fetch next load.
        console.error('saveLocalProfile: localStorage write failed', e);
        return;
    }

    // ADD THIS LINE: It tells index.html to update RIGHT NOW
    window.dispatchEvent(new Event('profileUpdated'));
}


function getLocalProfile() {
    const raw = localStorage.getItem('u_vault');
    if (!raw) return null;
    try {
        const decrypted = decodeURIComponent(escape(atob(raw))).replace(SECRET_SALT, '');
        const data = JSON.parse(decrypted);
        let base = {
            username: "User",
            email: "",
            is_paid: false,
            is_partner: false,
            ...data
        };
        // ── expiry enforcement - zero extra Supabase API call ──
        // Handles "2027-08-24 09:23:05.553+00" robustly (UTC)
        if(data.is_paid && data.expires_at){
            const exp = parseExpiryDate(data.expires_at);
            if(exp && exp.getTime() <= Date.now()){
                try{
                    if(data.is_paid){
                        const lastShown = parseInt(localStorage.getItem('mmh_expired_banner_shown_ts')||'0',10);
                        if(!lastShown || Date.now() - lastShown > 24*60*60*1000){
                            localStorage.setItem('mmh_just_expired','1');
                            localStorage.setItem('mmh_just_expired_ts', String(Date.now()));
                        }
                    }
                }catch(e){}
                base.is_paid = false;
                try{
                    const corrected = { ...data, is_paid: false };
                    const payload = { ...corrected, cache_expiry: data.cache_expiry || Date.now() + (7 * 24 * 60 * 60 * 1000) };
                    const json = JSON.stringify(payload) + SECRET_SALT;
                    const encrypted = btoa(unescape(encodeURIComponent(json)));
                    localStorage.setItem('u_vault', encrypted);
                    setTimeout(()=>{ try{ window.dispatchEvent(new Event('profileUpdated')); }catch(e){} }, 0);
                }catch(e){}
            }
        }
        return base;
    } catch (e) { return null; }
}

function isCacheExpired() {
    const p = getLocalProfile();
    return !p || !p.cache_expiry || Date.now() > p.cache_expiry;
}

async function handleChangePassword() {
    const client = await getClient();
    const { data: { session } } = await getSessionOnce(client);
    const user = session ? session.user : null;
    if (user) {
        const { error } = await client.auth.resetPasswordForEmail(user.email, {
            redirectTo: window.location.origin + '/login.html?type=recovery',
        });
        alert(error ? "Error: " + error.message : "A password reset link has been sent to your Gmail!");
    }
}

async function handleLogout(redirectTo) {
    const client = await getClient();
    clearAuthLocal();
    // Clear all exam caches to keep data private
        
        await client.auth.signOut();
        window.location.href = redirectTo || ("/index.html?v=" + Date.now()); // Force fresh load
   
}


// -----------------------------------------------------------
// Auto-clear old quiz cache when storage is nearly full.
// Runs on every page EXCEPT the quiz page itself (test.html sets
// window.MMH_QUIZ_PAGE_ACTIVE = true before this file loads, since
// an exam may be in progress there and its keys must not be touched).
// Only clears keys belonging to the CURRENTLY logged-in username —
// never another user's leftover data on a shared device.
// -----------------------------------------------------------
async function clearOldQuizCacheIfNeeded() {
    if (window.MMH_QUIZ_PAGE_ACTIVE) return;
    if (!navigator.storage || !navigator.storage.estimate) return; // unsupported browser — skip safely

    let usage = 0, quota = 0;
    try {
        const estimate = await navigator.storage.estimate();
        usage = estimate.usage || 0;
        quota = estimate.quota || 0;
    } catch (e) {
        return; // can't measure — don't guess
    }
    if (!quota) return;

    const path = window.location.pathname;
    const isLoginPage = path.endsWith("login.html") || path.endsWith("/login");
    const profileForPageCheck = typeof getLocalProfile === 'function' ? getLocalProfile() : null;

    // Special case: login page, nobody logged in. There's no "current
    // user" to protect here — anything sitting in localStorage belongs to
    // some PAST session, not the one about to be established. A lower 25%
    // threshold (vs the normal 75% below) is used deliberately: full
    // storage here can silently break login itself — the Supabase SDK's
    // own session-persist write can fail the same way, so it's worth
    // clearing well before things get critical. No username filtering,
    // no CLOUD_SYNC tier — just clear the big keys broadly and stop.
    if (isLoginPage && !profileForPageCheck) {
        if (usage / quota < 0.25) return;

        const broadPrefixes = ['state_', 'result_', 'qstats_', 'stream_', 'rankLastAutoRefreshedAt_'];
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            for (const p of broadPrefixes) {
                if (key.startsWith(p)) {
                    keysToRemove.push(key);
                    break;
                }
            }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
        if (keysToRemove.length) {
            console.log(`Login page, no active session, storage was ${(usage / quota * 100).toFixed(1)}% full — cleared ${keysToRemove.length} old cache entries (all users).`);
        }
        return; // no other logic needed for this case
    }

    const THRESHOLD = 0.75; // start clearing once 75% of the browser's quota for this origin is used
    if (usage / quota < THRESHOLD) return;

    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : null;
    if (!username) return; // don't know who's logged in — don't guess whose data to remove

    // Prefixes test.html uses for per-user, per-quiz keys:
    //   state_<username>_<quizId>, result_<username>_<quizId>,
    //   qstats_<username>_<quizId>, stream_<username>_<quizId>,
    //   rankLastAutoRefreshedAt_<username>_<quizId>
    // plus saved_status_<username> (no quiz id suffix).
    // Deliberately excludes qsum_<user>_<id> and CLOUD_SYNC_<user>_<exam> —
    // those are the small, permanent per-quiz summaries (score/attempted/
    // date only) that exam-engine.js/ssc-sub-engine.js rely on for the
    // "attempted" checklist across quiz listing pages. They must survive
    // this cleanup regardless of when it runs relative to the engine's own
    // absorb step, so they're never listed here.
    const dynamicPrefixes = ['state_', 'result_', 'qstats_', 'stream_', 'rankLastAutoRefreshedAt_'];
    const staticKey = 'saved_status_' + username;

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key === staticKey) {
            keysToRemove.push(key);
            continue;
        }
        for (const p of dynamicPrefixes) {
            if (key.startsWith(p + username + '_')) {
                keysToRemove.push(key);
                break;
            }
        }
    }

    keysToRemove.forEach((k) => localStorage.removeItem(k));
    if (keysToRemove.length) {
        console.log(`Storage was ${(usage / quota * 100).toFixed(1)}% full — cleared ${keysToRemove.length} old quiz cache entries for "${username}".`);
    }

    // Last resort — only reached if storage is STILL >=75% after clearing
    // the big per-attempt keys above. Drops the single LARGEST
    // CLOUD_SYNC_<username>_<exam> key (the small "attempted" checklist
    // cache the exam engines maintain — see exam-engine.js/ssc-sub-
    // engine.js). Safe: syncWithCloud() re-populates it from the server
    // on next visit, so this costs one extra fetch, not real data loss.
    // In practice this realistically only triggers once a user has
    // attempted an enormous number of DISTINCT quizzes (each entry is
    // only ~100-150 bytes), so this is a defensive final tier, not
    // something expected to fire for typical usage.
    let recheck;
    try {
        recheck = await navigator.storage.estimate();
    } catch (e) {
        return;
    }
    if (!recheck.quota || recheck.usage / recheck.quota < THRESHOLD) return;

    const cloudSyncPrefix = 'CLOUD_SYNC_' + username + '_';
    let biggestKey = null;
    let biggestSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(cloudSyncPrefix)) continue;
        const size = (localStorage.getItem(key) || '').length;
        if (size > biggestSize) {
            biggestSize = size;
            biggestKey = key;
        }
    }
    if (biggestKey) {
        localStorage.removeItem(biggestKey);
        console.log(`Storage still >=75% after clearing attempt cache — removed largest CLOUD_SYNC key "${biggestKey}" (${biggestSize} bytes) for "${username}".`);
    }
}

// -----------------------------------------------------------
// Hard cap on stored full quiz attempts — same philosophy as the
// Service Worker's MAX_CACHE_ENTRIES: always keep the count bounded,
// checked on every page load. This runs regardless of how full
// storage actually is (proactive), on top of the reactive 75%-full
// wipe above (safety net for anything unusual).
//
// Deliberately NOT recency-sorted: score/attempted history is
// already preserved forever in the small qsum_/CLOUD_SYNC_ keys
// (untouched by this), and full attempt detail is always re-
// fetchable via test.html's own Cloud Recovery path if a pruned
// result_ is ever opened again. Since pruning is never actually
// data-lossy — worst case is one extra fetch on reopen — WHICH
// excess attempts get removed doesn't matter, so this skips
// parsing/sorting by date entirely and just trims by count. Only
// counts COMPLETED attempts (have a result_ key) — an in-progress
// state_-only attempt is never touched.
// -----------------------------------------------------------
const MAX_STORED_ATTEMPTS = 25;

function enforceMaxStoredAttempts() {
    if (window.MMH_QUIZ_PAGE_ACTIVE) return;

    const profile = typeof getLocalProfile === 'function' ? getLocalProfile() : null;
    const username = profile ? profile.username : null;
    if (!username) return;

    const resultPrefix = `result_${username}_`;
    const ids = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(resultPrefix)) ids.push(key.slice(resultPrefix.length));
    }

    if (ids.length <= MAX_STORED_ATTEMPTS) return; // cheap common-case exit

    const excess = ids.length - MAX_STORED_ATTEMPTS;
    const toRemove = ids.slice(0, excess); // no sorting needed — see comment above

    toRemove.forEach((id) => {
        localStorage.removeItem(`result_${username}_${id}`);
        localStorage.removeItem(`state_${username}_${id}`);
        localStorage.removeItem(`qstats_${username}_${id}`);
        localStorage.removeItem(`stream_${username}_${id}`);
        localStorage.removeItem(`rankLastAutoRefreshedAt_${username}_${id}`);
    });

    if (toRemove.length) {
        console.log(`Kept ${MAX_STORED_ATTEMPTS} stored attempts — trimmed ${toRemove.length} excess for "${username}".`);
    }
}

document.addEventListener('DOMContentLoaded', enforceMaxStoredAttempts);

// Fire-and-forget: runs alongside initAuth() without blocking it or
// the page's own scripts.
document.addEventListener('DOMContentLoaded', clearOldQuizCacheIfNeeded);

// Keep this for the very first initial load
document.addEventListener('DOMContentLoaded', initAuth);
