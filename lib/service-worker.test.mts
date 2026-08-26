import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/**
 * Behavioural tests for public/sw.js.
 *
 * The worker is loaded and executed as-is into a stubbed worker global, rather
 * than having its logic restated here — a test that reimplements the thing it
 * checks would pass whatever the real file did. The stubs are only for the APIs
 * a worker gets for free: `self`, `caches`, and `fetch`.
 *
 * These exist because the service worker is the one file in this app that
 * cannot be exercised from a normal page and, if wrong, breaks an installed
 * PWA on a phone rather than in a tab. The HTML-fallback case in particular has
 * already caused one bug — the `/_vercel/` skip in the worker is a workaround
 * for it — so it is pinned here.
 */

const SW_SOURCE = readFileSync("public/sw.js", "utf8");
const ORIGIN = "http://localhost:3000";

/** A Response whose clone() is safe to call repeatedly, unlike a consumed body. */
function body(text: string, status = 200): Response {
  const r = new Response(text, { status });
  Object.defineProperty(r, "clone", { value: () => body(text, status) });
  return r;
}

const OFFLINE = () => {
  throw new TypeError("Failed to fetch");
};

function loadWorker(options: {
  cached?: Record<string, Response>;
  network?: (path: string) => Response;
}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const store = new Map(Object.entries(options.cached ?? {}));
  const calls = { fetches: [] as string[], puts: [] as string[] };
  const keyOf = (r: unknown) =>
    typeof r === "string" ? r : new URL((r as Request).url).pathname;

  const cache = {
    addAll: async () => {},
    keys: async () => [...store.keys()],
    put: async (req: unknown, res: Response) => {
      calls.puts.push(keyOf(req));
      store.set(keyOf(req), res);
    },
  };
  const caches = {
    open: async () => cache,
    keys: async () => ["homesync-v3"],
    delete: async () => true,
    match: async (req: unknown) => store.get(keyOf(req)),
  };
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [] },
    location: { origin: ORIGIN },
    registration: { showNotification: async () => {} },
  };
  const fetchStub = async (req: unknown) => {
    calls.fetches.push(keyOf(req));
    return (options.network ?? (() => body("NET")))(keyOf(req));
  };

  const context = vm.createContext({ self, caches, fetch: fetchStub, URL, Response, console });
  vm.runInContext(SW_SOURCE, context);
  return { listeners, calls };
}

/** Fires the worker's fetch handler. `handled: false` means it declined the request. */
async function request(
  listeners: Record<string, (event: unknown) => void>,
  opts: { path: string; mode?: string; method?: string; origin?: string },
): Promise<{ handled: boolean; response?: Response; error?: unknown }> {
  let responded: Promise<Response> | null = null;
  const event = {
    request: {
      method: opts.method ?? "GET",
      url: (opts.origin ?? ORIGIN) + opts.path,
      mode: opts.mode ?? "cors",
    },
    respondWith: (p: Promise<Response>) => {
      responded = p;
    },
  };
  listeners.fetch(event);
  if (responded === null) return { handled: false };
  try {
    return { handled: true, response: await responded };
  } catch (error) {
    return { handled: true, error };
  }
}

/** cache.put is fire-and-forget inside the worker, so let its microtasks drain. */
const settle = () => new Promise((r) => setImmediate(r));

test("immutable assets are served from cache without touching the network", async () => {
  const { listeners, calls } = loadWorker({
    cached: { "/_next/static/chunks/a.js": body("CACHED") },
    network: () => body("FROM-NETWORK"),
  });
  const r = await request(listeners, { path: "/_next/static/chunks/a.js" });
  assert.equal(await r.response!.text(), "CACHED");
  assert.deepEqual(calls.fetches, [], "a cache hit must not hit the network");
});

test("an uncached immutable asset is fetched and then stored", async () => {
  const { listeners, calls } = loadWorker({ network: () => body("FROM-NETWORK") });
  const r = await request(listeners, { path: "/_next/static/chunks/b.js" });
  await settle();
  assert.equal(await r.response!.text(), "FROM-NETWORK");
  assert.ok(calls.puts.includes("/_next/static/chunks/b.js"));
});

test("an offline navigation serves that page's own cached document", async () => {
  const { listeners } = loadWorker({
    cached: { "/calendar": body("CALENDAR-DOC"), "/shopping": body("SHOPPING-DOC") },
    network: OFFLINE,
  });
  const r = await request(listeners, { path: "/calendar", mode: "navigate" });
  assert.equal(await r.response!.text(), "CALENDAR-DOC");
});

test("an offline navigation to a never-visited page falls back to /shopping", async () => {
  const { listeners } = loadWorker({
    cached: { "/shopping": body("SHOPPING-DOC") },
    network: OFFLINE,
  });
  const r = await request(listeners, { path: "/recipes", mode: "navigate" });
  assert.equal(await r.response!.text(), "SHOPPING-DOC");
});

test("an offline non-navigation miss rejects rather than returning the HTML fallback", async () => {
  // The regression this file exists for: answering a script or RSC request with
  // the /shopping document fails more confusingly than the network error it
  // replaces, because the caller gets markup where it expected code.
  const { listeners } = loadWorker({
    cached: { "/shopping": body("<!doctype html>SHOPPING-DOC") },
    network: OFFLINE,
  });
  for (const path of ["/some/chunk.js", "/calendar"]) {
    const r = await request(listeners, { path });
    assert.equal(r.response, undefined, `${path} must not receive a document`);
    assert.ok(r.error, `${path} should reject`);
  }
});

test("an error response is never written to the cache", async () => {
  const { listeners, calls } = loadWorker({ network: () => body("boom", 500) });
  await request(listeners, { path: "/shopping", mode: "navigate" });
  await settle();
  assert.deepEqual(calls.puts, [], "a cached 500 would outlive the outage that caused it");
});

test("requests the worker has no business handling are passed straight through", async () => {
  for (const opts of [
    { path: "/api/location", method: "POST" },
    { path: "/tile.png", origin: "https://tile.openstreetmap.org" },
    { path: "/_vercel/speed-insights/script.js" },
  ]) {
    const { listeners } = loadWorker({});
    const r = await request(listeners, opts);
    assert.equal(r.handled, false, `${opts.path} should be left alone`);
  }
});
