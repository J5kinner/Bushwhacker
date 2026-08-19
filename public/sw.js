// Minimal HomeSync service worker: network-first with a cache fallback so the
// installed PWA keeps working briefly offline. Intentionally simple — a fuller
// caching strategy is a later enhancement.
const CACHE = "homesync-v2";
const SHELL = ["/shopping", "/location", "/calendar", "/settings"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Leave Vercel's telemetry alone. The Speed Insights vitals beacon is a POST
  // and already skips the check above, but its loader script is a same-origin
  // GET (/_vercel/speed-insights/script.js), so without this it would be stored
  // in the offline cache. Two reasons not to: telemetry has no business in a
  // household device's cache, and the offline fallback below answers an
  // unmatched request with the /shopping HTML document, which as a reply to a
  // script request is a console parse error for no benefit.
  // Matched by prefix, so it also covers any future /_vercel/* telemetry route.
  if (new URL(request.url).pathname.startsWith("/_vercel/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((cached) => cached || caches.match("/shopping")),
      ),
  );
});

// Push notifications (PR 8, calendar reminders + partner-activity pushes;
// see ADR 0009). ALWAYS shows a visible notification, even for a payload
// that fails to parse — a push event with no visible notification gets this
// subscription revoked by Safari after roughly three in a row, so there is
// no such thing as a push worth silently swallowing.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "HomeSync";
  const body = data.body || "";
  const url = data.url || "/calendar";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      // Deliberately no `actions` buttons: iOS ignores them outright, so
      // they would only ever appear (and do anything) on other platforms —
      // not worth the inconsistency for a two-person household's shared set
      // of phones.
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/calendar";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const client = clientList[0];
      if (!client) return self.clients.openWindow(url);
      // Navigate the existing window to the notification's own deep link,
      // rather than just focusing whatever it already had open — an app
      // already open on /calendar at a different month would otherwise
      // never land on the month the reminder is actually about. `navigate`
      // can reject for an uncontrolled client (one opened before this
      // service worker took control of it), so a failed navigate still
      // opens a fresh window rather than the click doing nothing.
      return client
        .navigate(url)
        .then((navigated) => (navigated || client).focus())
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
