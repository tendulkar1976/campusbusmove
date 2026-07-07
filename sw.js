// CampusMove Service Worker
// Handles persistent lock-screen notifications for live location trips

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Listen for messages from the app
self.addEventListener("message", (event) => {
  const { type, title, body, tag } = event.data || {};

  if (type === "SHOW_TRIP_NOTIFICATION") {
    self.registration.showNotification(title || "CampusMove Live Location", {
      body: body || "Location sharing in progress",
      icon: "/bus.svg",
      badge: "/bus.svg",
      tag: tag || "live-location",         // same tag = replaces itself, doesn't stack
      renotify: false,
      requireInteraction: true,            // keeps card visible until trip ends
      silent: true,                        // no sound, no vibration
      actions: [],
    });
  }

  if (type === "CLOSE_TRIP_NOTIFICATION") {
    self.registration.getNotifications({ tag: tag || "live-location" })
      .then((notifications) => {
        notifications.forEach((n) => n.close());
      });
  }
});

// If driver taps the notification, focus the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow("/");
      }
    })
  );
});
