# Location tracker — design

Date: 2026-08-10
Status: approved

## Problem

The household wants to see where the other person is — the "are they nearly home?" question — without either phone burning battery and without paying app-store fees.
The Chores tab is the least-used of the five and is the slot this feature takes.

The obvious implementation does not exist.
A Progressive Web App **cannot** track location in the background:

- `watchPosition` stops delivering the moment the page is frozen, which iOS does when the PWA is backgrounded or the screen locks.
- `navigator.geolocation` is not exposed in `ServiceWorkerGlobalScope`, so a service worker cannot read a fix no matter what wakes it.
- Web Push *does* wake the service worker, but from step 2 above the worker has nothing to read; `clients.openWindow()` is only permitted inside `notificationclick` (a human tap), and iOS revokes push permission from any app that receives a push without showing a notification.
- Periodic Background Sync is Android-only, has a 12-hour floor, and hits the same missing-API wall.

Which reduces to one rule:

> The request-triggers-GPS model requires the page to already be awake.
> If it is awake you did not need the request; if it is asleep nothing can wake it into reading GPS.

Background location requires the native `Always` location permission, which no web page on either platform can obtain.

## Approach

HomeSync stays a PWA.
The native permission is borrowed from **OwnTracks** — free, open source, and published on both the App Store and Google Play, which matters because this household is one iPhone and one Android.
OwnTracks uses significant-location-change and region monitoring rather than a continuous GPS hose, so it is battery-cheap by design.

The architecture in one line: **OwnTracks is a dumb sender, HomeSync is the gate and the UI.**

The sender is deliberately kept ignorant of whether sharing is enabled.
It always posts; HomeSync decides whether to store the fix.
This is what makes the toggle unbypassable, and it means switching sharing back on is instant with no phone-side fiddling.

Because the ingest contract is a plain authenticated `POST`, the sender is swappable — Traccar Client, an iOS Shortcuts automation, or a future native app — without changing the app.

### Rejected alternatives

| Option | Why not |
| --- | --- |
| Pivot to native (Capacitor/Expo) | Buys exactly one thing — background location — at US$99/year for iOS, or a 7-day re-signing ritual forever. Rewrites or rewraps four working features to fix one tab. |
| Audio-keepalive share session | A near-silent looping audio element does keep iOS JS running when backgrounded, but whether `watchPosition` keeps *delivering* is unverified. Also hijacks the audio session, drains battery, and one iOS point release closes it. |
| Web Push pull model | More new machinery than the rest of the feature combined (VAPID keys, subscription table, service-worker handlers), fragile on iOS, and still returns nothing unless a human taps. |
| Google Maps location sharing | Already does this for free across iPhone and Android with zero code. Rejected only because this household wants it inside HomeSync, as one app they own. |

## Design

### Data model

One new table, plus two columns on `users`.

```ts
/**
 * The latest known position of each household member — one row per user,
 * upserted. No history is kept: a trail of where your partner has been is a
 * different and far more invasive feature than "where are they now", and not
 * storing it means there is nothing to leak.
 */
export const userLocations = pgTable("user_locations", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  // Horizontal uncertainty in metres, as reported by the sender.
  accuracyM: smallint("accuracy_m"),
  // Sender battery percentage. Distinguishes "stopped sharing" from "phone died".
  batteryPct: smallint("battery_pct"),
  // When the fix was taken on the device, not when we received it — a queued
  // OwnTracks ping can arrive minutes after the moment it describes.
  capturedAt: timestamp("captured_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

On `users`:

- `locationSharing` — `boolean not null default false`. Opt-in; the map is empty until each member turns it on.
- `locationToken` — `text unique`, null until generated. The shared secret OwnTracks authenticates with.

`userId` is the primary key, which enforces one-row-per-user at the schema level and makes the write a plain upsert with no read-modify-write race.

### Ingest endpoint

`POST /api/location`, authenticated with **HTTP Basic**.
OwnTracks has native username/password fields, so the token travels in a header rather than a URL where Vercel would log it.
The username is ignored; the token is the password and is unique, so it identifies the user on its own.

Three behaviours carry the design:

1. **Only `_type: "location"` is stored.** OwnTracks also emits `transition`, `waypoints` and `lwt`. Those are acknowledged and discarded.
2. **Always reply `200` with a JSON `[]` body.** OwnTracks expects an array of commands in return and will retry against anything else.
3. **Sharing off means accept and discard, never `403`.** A rejection would make OwnTracks retry and alarm the user. Silent discard keeps the sender dumb and the gate authoritative.

Bad credentials are the one real failure: `401`, so a mistyped token is diagnosable rather than silently dropping fixes forever.

A stored fix only ever moves forward in time.
A ping whose `capturedAt` is not newer than the stored row is discarded, because delivery order is not guaranteed and a late-arriving old fix must not drag the pin backwards.

Payload parsing lives in `lib/owntracks.ts` as a pure function with unit tests, matching the existing `lib/links.ts` / `lib/links.test.mts` convention.
The fiddliest part of the feature is then tested without touching a database.

### Deliberately not cached

Every other read in `lib/queries.ts` is wrapped in `unstable_cache` under a tag that Server Actions bust after each mutation.
Location reads are the one exception and query Neon directly.

Two reasons.
The writer is an external HTTP client rather than a Server Action, so the usual "mutate then bust the tag" pairing does not apply; and location is the most freshness-sensitive data in the app, where a cache that fails to invalidate shows a confidently wrong pin instead of a slightly old shopping list.
The cost is negligible: two rows, queried only while somebody has the map open, at the existing 15-second `LiveRefresh` cadence.

This is an intentional deviation from the file's convention, not an oversight, and is commented as such in the code.

### Page

`app/location/page.tsx` — server component, `force-dynamic`, rendering `SetupNotice` on setup issues exactly as the other feature pages do.

- **Map:** Leaflet 1.9 with OpenStreetMap raster tiles. Free, no API key, roughly 42 KB, and two users sits comfortably inside OSM's tile usage policy. Plain Leaflet inside a `useEffect` rather than `react-leaflet` — one dependency instead of two. Attribution is required and is rendered.
- **Detail rows beneath the map:** name, relative age ("8 minutes ago"), accuracy, battery.
- **Sharing toggle lives on this page**, not in Settings. It is the primary control, so it belongs on the screen being looked at.
- **Opportunistic self-fix on mount:** `getCurrentPosition` with `enableHighAccuracy: false`, which uses wifi and cell triangulation rather than GPS and is dramatically cheaper. Scoped to this page only — an app-wide hook would prompt for location permission when opening the shopping list.

The opportunistic fix is also the fallback that makes the feature work at all before OwnTracks is installed.

### Settings

A one-time setup section showing the signed-in member their endpoint URL, their token, a regenerate action, and the OwnTracks field values with copy buttons.
Typing a token by hand on a phone is miserable, so the copy buttons are load-bearing rather than polish.

### Navigation

Chores becomes Location in `components/bottom-nav.tsx`, using the `MapPin` icon and `/location`.
`public/sw.js` swaps `/chores` for `/location` in its shell cache list.

`/chores` stays routable and the `chores` table is untouched.
Nothing is deleted, ADR 0003 stays valid, and folding chores into the calendar remains available as separate future work.

## Decisions

1. **No location history.** Latest position only, for privacy and for YAGNI.
2. **Sharing defaults to off** for both members. The feature looks empty until each opts in, which is the correct default for a location tracker.
3. **Battery percentage is stored.** It is free in the OwnTracks payload and one nullable column, and it is what tells you whether a stale pin means "stopped sharing" or "phone died".

## Edge cases

- **A fix arrives while sharing is off.** Accepted with `200`, discarded, nothing stored. Turning sharing on shows the next fix, not the withheld one.
- **A queued ping arrives late.** `capturedAt` comes from the device, so the age label stays honest even when delivery lagged. An older `capturedAt` than the stored row is ignored rather than moving the pin backwards.
- **A member has never shared.** No `user_locations` row; the page shows them as not sharing rather than as a missing pin.
- **Only one member is sharing.** The map centres on the single available pin instead of fitting bounds across two.
- **Token not yet generated.** Settings shows the generate action rather than an endpoint that cannot work.
- **Browser denies the geolocation prompt.** The opportunistic fix fails silently; OwnTracks data (if any) still renders. Denial is not an error state worth a banner.
- **Accuracy is very poor.** The value is displayed rather than hidden, so a 2 km cell-tower fix reads as approximate instead of masquerading as precise.

## Delivery

Two pull requests, split by RCLI ([ADR 0002](../../decisions/0002-reviewer-cognitive-load-index.md)) so each is verifiable on its own.

1. **Everything except the map.** Schema and migration, ingest endpoint, parser and its tests, the sharing gate, Settings setup, the navigation swap, and the Location page rendering positions as a text list. A complete working feature, confirmable against a real OwnTracks ping, with no new dependencies.
2. **The map.** Replace the list with Leaflet, keeping the detail rows beneath it. Adds the only new dependency and is purely presentational, so a reviewer can judge it without re-reading any server logic.

## Verification

- `pnpm run lint`, `pnpm run build` and `pnpm test` all pass, with output shown.
- `pnpm drizzle-kit generate` produces a reviewed migration.
- A real OwnTracks ping from a phone lands in the database and appears on the map.
- Sharing toggled off stops the pin updating while OwnTracks keeps sending.
- Checked on the Vercel preview URL from a phone, both members visible.

## Deferred

- Reverse geocoding to place names ("Fitzroy" rather than a pin) — Nominatim is free but rate-limited to 1 request per second and needs caching plus attribution.
- Location history and trails.
- Geofence notifications ("arrived home").
- Web Push, including the tap-to-share pull model.
- Folding chores into the calendar tab.
