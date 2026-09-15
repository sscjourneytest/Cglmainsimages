// fcm-init.js — include this on pages where you want notification
// opt-in to happen (e.g. right after the existing bell-icon click
// handler, or on first visit). Requires firebase-messaging-sw.js to
// be registered at the site root.
//
// Replaces the old NOTIFY_API_BASE push.js/VAPID subscription flow —
// this now talks to Firebase directly for the token, and only calls
// the Worker once, to subscribe that token to the shared topic.

const NOTIFY_API_BASE = "https://mmh-notify-worker.mockmatrixsupport.workers.dev";

const firebaseConfig = {
  apiKey: "AIzaSyCgAWKBUl_wx7mIk72kVuj1gDlW2S_tEF0",
  authDomain: "mmh-notifications.firebaseapp.com",
  projectId: "mmh-notifications",
  storageBucket: "mmh-notifications.firebasestorage.app",
  messagingSenderId: "727759392578",
  appId: "1:727759392578:web:9c95f613cc17348b7e02db",
};

const FCM_VAPID_KEY = "BMwvOpIo5KmuolDOcKdy2OAZ3ehiVS2LtmnbzLFdRxvnzXmZgqwmWCyjWx5tr9gPFBlzx_oiPz1oRHSC-fmOmJo";

let fcmApp = null;
let fcmMessaging = null;

function loadFirebaseSdk() {
  return new Promise((resolve) => {
    if (window.firebase && firebase.messaging) return resolve();
    const s1 = document.createElement("script");
    s1.src = "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js";
    s1.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js";
      s2.onload = resolve;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  });
}

async function initFcmAndSubscribe() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return;

  if (Notification.permission === "denied") {
    console.warn("[fcm] Notifications blocked in browser settings.");
    return;
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") return;

  await loadFirebaseSdk();

  if (!fcmApp) {
    fcmApp = firebase.initializeApp(firebaseConfig);
    fcmMessaging = firebase.messaging();
  }

  const swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  const token = await fcmMessaging.getToken({
    vapidKey: FCM_VAPID_KEY,
    serviceWorkerRegistration: swRegistration,
  });

  if (!token) {
    console.warn("[fcm] Could not get an FCM token.");
    return;
  }

  // Only re-subscribe if this is a new/changed token, to avoid hitting
  // the Worker on every single page load.
  const savedToken = localStorage.getItem("mmh_fcm_token");
  if (savedToken === token) return;

  const res = await fetch(`${NOTIFY_API_BASE}/api/fcm/subscribe-topic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (res.ok) {
    localStorage.setItem("mmh_fcm_token", token);
  } else {
    console.error("[fcm] Topic subscribe failed:", await res.text());
  }
}

// Handles a push arriving while a tab IS open and focused (background
// handler in the service worker covers the tab-not-focused case).
async function wireForegroundMessages() {
  if (!fcmMessaging) return;
  fcmMessaging.onMessage((payload) => {
    const title = payload.notification?.title || "Mock Matrix Hub";
    const body = payload.notification?.body || "";
    if (Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "/logo.png" });
      n.onclick = () => {
        window.focus();
        if (payload.data?.url) window.location.href = payload.data.url;
      };
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".notif-bell-wrap, a[href='/notifications.html']").forEach((el) => {
    el.addEventListener("click", async () => {
      await initFcmAndSubscribe();
      await wireForegroundMessages();
    });
  });

  maybeShowSubscribePrompt();
});

// ------------------------------------------------------------------
// Auto-shown "Get Mock Test Updates" prompt — appears once per browser
// session, a few seconds after page load, only if the user hasn't
// already granted/denied notification permission. Tapping "Allow"
// runs the exact same subscribe flow as tapping the bell icon.
// ------------------------------------------------------------------
function maybeShowSubscribePrompt() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return; // already granted or denied — don't ask again

  const SNOOZE_KEY = "mmh_subscribe_snooze_until";
  const snoozeUntil = parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10);
  if (Date.now() < snoozeUntil) return; // user dismissed it recently — respect the 24h cooldown

  setTimeout(() => {

    const style = document.createElement("style");
    style.textContent = `
      @keyframes mmh-notif-slide-up {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .mmh-subscribe-banner {
        position: fixed;
        bottom: 16px; left: 16px; right: 16px;
        max-width: 420px; margin: 0 auto;
        background: var(--white, #fff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 18px;
        padding: 16px;
        display: flex; align-items: center; gap: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        font-family: 'Inter', -apple-system, sans-serif;
        z-index: 99999;
        animation: mmh-notif-slide-up 0.35s ease-out;
      }
      .mmh-subscribe-icon {
        flex-shrink: 0; width: 44px; height: 44px; border-radius: 12px;
        background: linear-gradient(135deg, var(--primary, #2563eb), #1e3a8a);
        color: white; display: flex; align-items: center; justify-content: center;
        font-size: 20px;
      }
      .mmh-subscribe-text { flex: 1; min-width: 0; }
      .mmh-subscribe-title {
        font-weight: 800; font-size: 13.5px; margin: 0 0 2px;
        color: var(--text-dark, #0f172a);
      }
      .mmh-subscribe-sub {
        font-size: 11.5px; color: var(--text-grey, #64748b); margin: 0; line-height: 1.35;
      }
      .mmh-subscribe-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
      .mmh-subscribe-allow {
        background: var(--primary, #2563eb); color: white; border: none;
        font-weight: 700; font-size: 12px; padding: 8px 14px; border-radius: 9px; cursor: pointer;
      }
      .mmh-subscribe-later {
        background: none; border: none; color: var(--text-grey, #64748b);
        font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px;
      }
    `;
    document.head.appendChild(style);

    const banner = document.createElement("div");
    banner.className = "mmh-subscribe-banner";
    banner.innerHTML = `
      <div class="mmh-subscribe-icon"><i class="fas fa-bell"></i></div>
      <div class="mmh-subscribe-text">
        <p class="mmh-subscribe-title">Get Mock Test Updates</p>
        <p class="mmh-subscribe-sub">New mocks, results & important alerts — straight to your device.</p>
      </div>
      <div class="mmh-subscribe-actions">
        <button class="mmh-subscribe-allow" id="mmh-subscribe-allow">Allow</button>
        <button class="mmh-subscribe-later" id="mmh-subscribe-later">Not now</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById("mmh-subscribe-allow").addEventListener("click", async () => {
      banner.remove();
      localStorage.removeItem(SNOOZE_KEY);
      await initFcmAndSubscribe();
      await wireForegroundMessages();
    });

    document.getElementById("mmh-subscribe-later").addEventListener("click", () => {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
      banner.remove();
    });
  }, 3000);
}
