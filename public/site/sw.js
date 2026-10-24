// Lobos Site service worker (24 Oct 2026): phone alerts on a supervisor's
// link (e.g. "4 still signed in, finishes in 20 min"). Lives under /site/ so
// it works on the photos address. The page tells it its own address (the
// private link) so a tapped alert opens that supervisor's page - the server
// never keeps the link itself. Nothing is cached for offline use.
const HOME = "/__lobos_home";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  const home = e.data && e.data.home;
  if (typeof home === "string" && /^\/site\/[A-Za-z0-9_-]{20,64}$/.test(home)) {
    e.waitUntil(caches.open("lobos-site").then((c) => c.put(HOME, new Response(home))));
  }
});

self.addEventListener("push", (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    m = { title: "Lobos", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(m.title || "Lobos", {
      body: m.body || "",
      icon: "/site/icons/site-192.png",
      tag: m.tag,
      renotify: !!m.tag && !m.silent,
      silent: !!m.silent,
      requireInteraction: !!m.sticky,
      vibrate: m.silent ? undefined : [200, 100, 200],
      data: { go: m.url || "" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const saved = await caches.open("lobos-site").then((c) => c.match(HOME)).then((r) => (r ? r.text() : null)).catch(() => null);
      // url from the server is just "?go=signin" etc. - added to this phone's own link.
      const target = new URL((saved || "/site/") + (e.notification.data?.go || ""), self.location.origin).href;
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).pathname.startsWith("/site/") && "navigate" in w) return w.navigate(target).then((c) => (c || w).focus());
      }
      return self.clients.openWindow(target);
    })(),
  );
});
