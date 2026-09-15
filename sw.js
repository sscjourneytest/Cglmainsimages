// ============================================================
// MOCK MATRIX HUB — Service Worker
// v4: fixes uncontrolled cache growth. Only same-origin static
// assets (html/css/js/images) are cached, capped at 60 entries.
// CDN scripts, fonts, Supabase/gtag calls, exam/mock JSON, and
// any cross-origin request are fetched live and never stored —
// this is what was causing MBs of growth on every visit.
// ============================================================
const CACHE_NAME = 'mock-matrix-v15'; // bumped: dedupes cache entries by pathname (was creating one entry per quiz ID query string)
const MAX_CACHE_ENTRIES = 30;
const STATIC_PATTERNS = [/\.html$/, /\.css$/, /\.js$/, /\.(png|jpg|jpeg|svg|ico)$/];

// Reactive full-clear safety net — mirrors the same 75% threshold used
// on the localStorage side (auth.js). navigator.storage.estimate()
// reports TOTAL origin storage (localStorage + this cache + IndexedDB
// combined, not broken down by type) — so this can fire even when the
// actual pressure comes from localStorage, not this cache. That's fine:
// clearing this cache is harmless (files just re-fetch from network next
// time), so it's a safe, complementary contribution toward bringing the
// whole origin back under threshold, whichever side caused it.
const STORAGE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // don't check more than once per 5 minutes
let lastStorageCheck = 0;

async function checkStorageQuotaAndClear() {
    const now = Date.now();
    if (now - lastStorageCheck < STORAGE_CHECK_INTERVAL_MS) return;
    lastStorageCheck = now;

    if (!navigator.storage || !navigator.storage.estimate) return; // unsupported — skip safely
    try {
        const { usage, quota } = await navigator.storage.estimate();
        if (!quota) return;
        if (usage / quota >= 0.75) {
            await caches.delete(CACHE_NAME);
            await caches.open(CACHE_NAME); // recreate empty, ready for the next write
            console.log('SW: origin storage was >=75% full — cleared cache "' + CACHE_NAME + '".');
        }
    } catch (e) { /* estimate() failed — skip silently, not worth breaking a request over */ }
}

// Install event
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate event — clean up old cache versions and take control of
// any already-open pages immediately.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

// Drop the oldest entries once the cache exceeds MAX_CACHE_ENTRIES,
// so storage never grows without bound.
async function trimCache(cache) {
    const keys = await cache.keys();
    if (keys.length <= MAX_CACHE_ENTRIES) return;
    const excess = keys.length - MAX_CACHE_ENTRIES;
    for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i]); // oldest first (insertion order)
    }
}

// Fetch event — network-first, falls back to cache when offline.
// Only same-origin static assets are ever written to the cache.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return; // don't try to cache POSTs etc.

    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isStaticAsset = isSameOrigin && STATIC_PATTERNS.some((p) => p.test(url.pathname));

    if (!isStaticAsset) {
        // CDN libs (bootstrap/fontawesome/fonts), gtag, Supabase, the
        // notify-worker API, and any exam/mock JSON: fetch live, never
        // cache. The browser's own HTTP cache already handles CDN files.
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        // Cache by pathname only (drop the query string). Pages
                        // like test.html?id=<quizId> are the same underlying
                        // file for every quiz — without this, each distinct
                        // quiz ID would create its own cache entry for
                        // identical content, filling the 60-entry cap with
                        // duplicates instead of genuinely distinct assets.
                        const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
                        cache.put(cacheKey, responseClone);
                        trimCache(cache);
                        checkStorageQuotaAndClear();
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
});

// ============================================================
// PUSH NOTIFICATIONS (unchanged)
// ============================================================
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Mock Matrix Hub', body: event.data ? event.data.text() : 'New update available' };
    }

    const title = data.title || 'Mock Matrix Hub';
    const options = {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: {
            url: data.url || '/',
            notificationId: data.notificationId || null
        },
        vibrate: [200, 100, 200]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ============================================================
// NOTIFICATION CLICK (unchanged)
// ============================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                const clientUrl = new URL(client.url);
                const targetOrigin = new URL(targetUrl, self.location.origin).origin;
                if (clientUrl.origin === targetOrigin && 'focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
