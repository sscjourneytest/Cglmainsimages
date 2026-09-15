// firebase-messaging-sw.js — must be served from the SITE ROOT
// (e.g. https://mockmatrixhub.in/firebase-messaging-sw.js), not a
// subfolder, so its scope covers the whole site.

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCgAWKBUl_wx7mIk72kVuj1gDlW2S_tEF0",
  authDomain: "mmh-notifications.firebaseapp.com",
  projectId: "mmh-notifications",
  storageBucket: "mmh-notifications.firebasestorage.app",
  messagingSenderId: "727759392578",
  appId: "1:727759392578:web:9c95f613cc17348b7e02db",
});

const messaging = firebase.messaging();

// Handles a push arriving while the site is NOT in an open/focused tab.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Mock Matrix Hub";
  const options = {
    body: payload.notification?.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    data: { url: payload.data?.url || "/" },
  };
  self.registration.showNotification(title, options);
});

// Tapping the notification opens (or focuses) the site at the target URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
