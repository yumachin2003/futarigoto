// Firebase Messaging Service Worker
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "INIT_FIREBASE_CONFIG") {
    if (!firebase.apps.length) {
      firebase.initializeApp(event.data.config);
      const messaging = firebase.messaging();

      messaging.onBackgroundMessage((payload) => {
        const title = payload.notification?.title || payload.data?.title || "ふたりごと";
        const options = {
          body: payload.notification?.body || payload.data?.body || "",
          icon: "/apple-touch-icon.png",
          badge: "/apple-touch-icon.png",
          data: payload.data || {},
        };
        self.registration.showNotification(title, options);
      });
    }
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});

