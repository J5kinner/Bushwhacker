// HomeSync service worker.
//
// Two strategies, because two kinds of request want opposite things:
//
// - Build output under /_next/static/ is content-hashed, so its URL changes
//   whenever its bytes do. A cache hit can therefore never be stale, and going
//   to the network to confirm that is pure latency. Served cache-first.
// - Everything else is household data, where being current matters more than
//   being instant. Served network-first, falling back to the cache only when
//   the network fails.
const CACHE = "homesync-v3";

// Precached so an offline launch has documents to fall back to. All six tabs,
// not the four this list drifted to.
const SHELL = [
  "/shopping",
  "/recipes",
  "/calendar",
  "/location",
  "/settings",
  "/chores",
];

// The last-resort document for an offline navigation to a page never visited.
const OFFLINE_FALLBACK = "/shopping";

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

/** Store a response, best-effort. Never cache an error: a cached 500 outlives the outage that caused it. */
function remember(request, response) {
  if (!response.ok) return;
  const copy = response.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

/** Immutable assets: the cache is authoritative, the network is the cold path. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  remember(request, response);
  return response;
}

/**
 * Everything else: current if possible, cached if not.
 *
 * The HTML fallback is offered ONLY to navigations. It used to be offered to
 * any unmatched request, which meant a failed script or RSC fetch was answered
 * with the /shopping document — markup where the caller expected JavaScript or
 * a flight payload, which fails more confusingly than the network error it
 * replaced. A non-navigation miss now rejects, exactly as it would with no
 * service worker installed at all.
 */
async function networkFirst(request, isNavigation) {
  try {
    const response = await fetch(request);
    remember(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isNavigation) {
      const fallback = await caches.match(OFFLINE_FALLBACK);
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Cross-origin (map tiles, Google's sign-in) is somebody else's cache to manage.
  if (url.origin !== self.location.origin) return;

  // Telemetry has no business in a household device's offline cache. The
  // Speed Insights beacon is a POST and already skipped above; this covers its
  // loader script, a same-origin GET, and any future /_vercel/* route.
  if (url.pathname.startsWith("/_vercel/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request, request.mode === "navigate"));
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
