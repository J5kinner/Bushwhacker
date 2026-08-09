// Minimal HomeSync service worker: network-first with a cache fallback so the
// installed PWA keeps working briefly offline. Intentionally simple — a fuller
// caching strategy is a later enhancement.
const CACHE = "homesync-v1";
const SHELL = ["/shopping", "/calendar", "/chores", "/settings"];

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
