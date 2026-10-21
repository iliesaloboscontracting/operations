// Operations service worker (21 Oct 2026): shows phone notifications for
// site requests and opens the right page when one is tapped. Nothing is
// cached - the app always loads fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    m = { title: "Operations", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(m.title || "Operations", {
      body: m.body || "",
      icon: "/logo.png",
      tag: m.tag,
      renotify: !!m.tag && !m.silent,
      silent: !!m.silent,
      requireInteraction: !!m.sticky,
      vibrate: m.silent ? undefined : m.sticky ? [300, 100, 300, 100, 300] : [200, 100, 200],
      data: { url: m.url || "/requests" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/requests", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "navigate" in w) return w.navigate(url).then((c) => (c || w).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
