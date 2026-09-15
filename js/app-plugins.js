/* ── MMH app glue: push notifications + save/share (native app only) ──────
   Browser: completely inert (first line returns). Inside the Android app:
   · home page shows the "Allow Mock Matrix Hub to send notifications" prompt
   · granted → FCM register → token subscribed to topic mmh_all via
     /api/subscribe-topic (same design as the old RSM app)
   · notification tap → opens the notification's path
   · window.mmhSaveOrShare(name, blobOrDataUrl, mime):
       images → gallery directly · other files → Download/MockMatrixHub if
       storage permission granted · otherwise system share sheet (which
       itself offers Save to Files / Drive)
   ──────────────────────────────────────────────────────────────────────── */
(function () {
    function isNative() {
        try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; }
    }
    function P(name) {
        try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null; } catch (e) { return null; }
    }
    if (!isNative()) return;

    /* toast */
    function toast(msg) {
        var t = document.getElementById('mmhPluginToast');
        if (!t) {
            t = document.createElement('div'); t.id = 'mmhPluginToast';
            t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:rgba(17,24,39,.92);color:#fff;padding:10px 16px;border-radius:12px;font:600 13px/1.3 system-ui,sans-serif;z-index:4000;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:86vw;text-align:center;display:none';
            document.body.appendChild(t);
        }
        t.textContent = msg; t.style.display = 'block';
        clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 2600);
    }
    window.mmhToast = toast;

    /* ── push ── */
    var Push = P('PushNotifications');
    var ASKED = 'mmh_notif_asked', SUB = 'mmh_notif_subscribed';

    /* Subscribe a token to topic mmh_all via the worker. The "subscribed"
       flag is stored ONLY on success — a failed attempt must never be
       remembered, so the next page load retries (old RSM behaviour). */
    var _retryTimer = null;
    function subscribeToken(token) {
        return fetch('https://mmh-notify-worker.mockmatrixsupport.workers.dev/api/subscribe-topic', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
        }).then(function (r) {
            if (r.ok) {
                try { localStorage.setItem(SUB, token); localStorage.removeItem('mmh_push_last_err'); } catch (e) {}
            } else {
                try { localStorage.setItem('mmh_push_last_err', 'subscribe http ' + r.status + ' @' + new Date().toISOString()); } catch (e) {}
                /* one automatic retry after 15s (covers a brief network blip) */
                if (!_retryTimer) _retryTimer = setTimeout(function () { _retryTimer = null; subscribeToken(token); }, 15000);
            }
        });
    }

    if (Push) {
        Push.addListener('registration', function (t) {
            if (t && t.value) subscribeToken(t.value).catch(function () {});
        });
        Push.addListener('registrationError', function (e) {
            try {
                console.warn('push registration error', e);
                localStorage.setItem('mmh_push_last_err', 'registrationError ' + JSON.stringify(e) + ' @' + new Date().toISOString());
            } catch (_) {}
        });
        /* Foreground delivery proof: while the app is OPEN, Android gives
           the message to this listener INSTEAD of the tray. Show a toast so
           delivery is visible, and record it for diagnosis. */
        Push.addListener('pushNotificationReceived', function (n) {
            try {
                var d = (n && n.data) || {};
                var title = (n && n.title) ? n.title : (d.title || 'Notification');
                localStorage.setItem('mmh_push_last_recv', title + ' @' + new Date().toISOString());
                toast('\uD83D\uDCE9 Received: ' + title);
            } catch (e) {}
        });
        Push.addListener('pushNotificationActionPerformed', function (a) {
            try {
                var p = a && a.notification && a.notification.data && a.notification.data.path;
                if (p) window.location.href = p;
            } catch (e) {}
        });
        /* Old-app-proven boot: on EVERY page load, if the OS permission is
           granted → register again. The 'registration' event then retries
           the topic subscribe until the worker accepts it. This makes a
           single failed subscribe attempt (e.g. worker redeploying at that
           exact moment) self-healing instead of permanent. */
        var boot = function () {
            if (!Push) return;
            try {
                Push.checkPermissions().then(function (res) {
                    var state = res && res.receive;
                    if (state === 'granted') { Push.register(); return; }
                    if (state === 'denied') return;   /* user must re-enable in phone settings */
                    showPrompt();                      /* never asked before → soft card once */
                }).catch(function () {});
            } catch (e) {}
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    }

    function enablePush() {
        if (!Push) return Promise.resolve(false);
        return Push.requestPermissions().then(function (r) {
            if (r && r.receive === 'granted') { Push.register(); return true; }
            return false;
        }).catch(function () { return false; });
    }

    function isHome() { var p = window.location.pathname; return p === '/' || p === '/index.html' || p === ''; }

    function showPrompt() {
        if (!Push || !isHome()) return;
        if (promptVisible()) return;
        try { if (localStorage.getItem(ASKED)) return; } catch (e) { return; }
        var wrap = document.createElement('div');
        wrap.id = 'mmhNotifPrompt';
        wrap.style.cssText = 'position:fixed;left:12px;right:12px;bottom:86px;z-index:3500;background:var(--surface,#fff);border:1px solid var(--border,#e5eaf3);border-radius:16px;box-shadow:0 16px 44px rgba(5,10,25,.28);padding:14px 14px 12px;display:flex;gap:12px;align-items:flex-start';
        wrap.innerHTML =
            '<img src="/logo.png" alt="" style="width:38px;height:38px;border-radius:10px;flex:none">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font:800 14px/1.3 system-ui,sans-serif;color:var(--text,#0b1220)">Allow Mock Matrix Hub to send notifications?</div>' +
              '<div style="font:500 12px/1.45 system-ui,sans-serif;color:var(--muted,#5b6b85);margin-top:3px">Instant alerts for new mocks, series &amp; results. Change anytime in phone settings.</div>' +
              '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">' +
                '<button id="mmhNotifNo" style="border:1px solid var(--border,#e5eaf3);background:transparent;color:var(--muted,#5b6b85);font:700 12.5px system-ui,sans-serif;padding:8px 14px;border-radius:10px">Not now</button>' +
                '<button id="mmhNotifYes" style="border:none;background:linear-gradient(135deg,#3d5afe,#7c4dff);color:#fff;font:800 12.5px system-ui,sans-serif;padding:8px 16px;border-radius:10px">Allow</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(wrap);
        document.getElementById('mmhNotifNo').onclick = function () {
            try { localStorage.setItem(ASKED, '1'); } catch (e) {}
            wrap.remove();
        };
        document.getElementById('mmhNotifYes').onclick = function () {
            try { localStorage.setItem(ASKED, '1'); } catch (e) {}
            wrap.remove();
            enablePush().then(function (ok) {
                toast(ok ? 'Notifications enabled ✓' : 'Permission denied — enable later in phone settings');
            });
        };
    }
    /* Prompt is now triggered from boot() above (permission state driven).
       Guard against double-injection if some page includes us twice. */
    function promptVisible() { return !!document.getElementById('mmhNotifPrompt'); }

    /* ── save / share files ── */
    function dataUrlToBase64(d) { return String(d).split(',')[1]; }
    function blobToBase64(blob) {
        return new Promise(function (res, rej) {
            var r = new FileReader();
            r.onload = function () { res(String(r.result).split(',')[1]); };
            r.onerror = rej; r.readAsDataURL(blob);
        });
    }
    function cacheUri(FS, filename, b64) {
        return FS.writeFile({ path: filename, data: b64, directory: 'CACHE', recursive: true })
            .then(function () { return FS.getUri({ path: filename, directory: 'CACHE' }); })
            .then(function (u) { return u.uri; });
    }
    async function mmhSaveOrShare(filename, payload, mime) {
        var b64 = typeof payload === 'string' ? dataUrlToBase64(payload) : await blobToBase64(payload);
        var FS = P('Filesystem'), Media = P('Media'), Share = P('Share');
        /* 1) images → gallery directly (no runtime permission needed) */
        if (Media && Media.savePhoto && mime && mime.indexOf('image/') === 0 && FS) {
            try {
                var uri0 = await cacheUri(FS, filename, b64);
                await Media.savePhoto({ path: uri0, albumIdentifier: 'Mock Matrix Hub' });
                toast('Saved to gallery ✓'); return;
            } catch (e) { /* fall through */ }
        }
        /* 2) other files → public Downloads when storage permission granted */
        if (FS) {
            try {
                var perm = await FS.requestPermissions();
                if (perm && (perm.publicStorage === 'granted' || perm.publicStorage === 'limited')) {
                    await FS.writeFile({ path: 'Download/MockMatrixHub/' + filename, data: b64, directory: 'EXTERNAL', recursive: true });
                    toast('Saved to Download/MockMatrixHub ✓'); return;
                }
            } catch (e) { /* fall through */ }
        }
        /* 3) share sheet (offers Save to Files / Drive / apps) */
        if (Share && FS) {
            try {
                var uri = await cacheUri(FS, filename, b64);
                await Share.share({ title: 'Mock Matrix Hub', text: filename, files: [uri], dialogTitle: 'Save or share' });
                return;
            } catch (e) { /* fall through */ }
        }
        toast('Could not save on this device');
    }
    window.mmhSaveOrShare = mmhSaveOrShare;

    window.mmhShare = async function (opts) {
        var Share = P('Share');
        if (Share) { try { await Share.share(opts); return; } catch (e) { return; } }
        if (navigator.share) { try { await navigator.share(opts); } catch (e) {} }
    };
})();
