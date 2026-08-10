# Location Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Chores tab with a Location tab showing both household members' latest position on a map, fed by the free OwnTracks app so background updates work without a native build.

**Architecture:** OwnTracks on each phone POSTs a location fix to an HTTP-Basic-authenticated `POST /api/location`. A pure parser in `lib/owntracks.ts` normalises the payload; the route upserts one row per user in `user_locations`. A per-user `locationSharing` flag on `users` gates storage server-side, so the sender stays dumb and the toggle cannot be bypassed. The page reads both rows uncached and renders them — as a text list in PR 1, as a Leaflet map in PR 2.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Drizzle ORM + Neon Postgres, Tailwind v4, Lucide icons, Leaflet 1.9 + OpenStreetMap tiles (PR 2 only). Unit tests via Node's built-in runner (`node --test`) with native TypeScript type-stripping.

**Spec:** [docs/superpowers/specs/2026-08-10-location-tracker-design.md](../specs/2026-08-10-location-tracker-design.md)

## Global Constraints

- Australian spelling in all user-facing text, comments, and docs (organise, colour, behaviour, prioritise).
- Mobile-first Tailwind; every control stays thumb-reachable and nothing scrolls horizontally on a phone.
- Database mutations go through Server Actions. The one exception is `POST /api/location`, which is a Route Handler because the caller is an external app that cannot invoke a Server Action.
- Conventional Commits (`<type>(<scope>): <summary>`). Attribute to the human author only — **no `Co-Authored-By` trailer** for AI.
- Keep each full Markdown sentence on its own line.
- Never commit secrets. Location tokens are generated at runtime and stored in the database, never in the repository or in an env var.
- `/chores` stays routable and the `chores` table is untouched. Only the nav entry moves.
- Location reads are deliberately **not** wrapped in `unstable_cache`, unlike every other read in `lib/queries.ts`. Comment the reason at the call site.
- Two PRs: Tasks 1–7 are PR 1, Task 8 is PR 2. Do not add the Leaflet dependency before Task 8.

---

### Task 1: OwnTracks payload parser + unit tests

The fiddliest logic in the feature, isolated as a pure function so it is testable without a database or a phone.

**Files:**
- Create: `lib/owntracks.ts`
- Create: `lib/owntracks.test.mts`

**Interfaces:**
- Produces:
  - `export interface LocationFix { latitude: number; longitude: number; accuracyM: number | null; batteryPct: number | null; capturedAt: Date }`
  - `export function parseOwnTracksLocation(body: unknown): LocationFix | null`

- [ ] **Step 1: Write the failing tests**

Create `lib/owntracks.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnTracksLocation } from "./owntracks.ts";

// A real OwnTracks location publish, trimmed to the fields we use.
const location = {
  _type: "location",
  lat: -37.8136,
  lon: 144.9631,
  tst: 1754784000,
  acc: 12,
  batt: 68,
  tid: "JS",
};

test("parses a location publish", () => {
  assert.deepEqual(parseOwnTracksLocation(location), {
    latitude: -37.8136,
    longitude: 144.9631,
    accuracyM: 12,
    batteryPct: 68,
    capturedAt: new Date(1754784000 * 1000),
  });
});

test("ignores publishes that are not locations", () => {
  for (const type of ["transition", "waypoints", "lwt", "cmd"]) {
    assert.equal(parseOwnTracksLocation({ ...location, _type: type }), null);
  }
});

test("accepts a fix with no accuracy or battery", () => {
  const { acc, batt, ...withoutOptional } = location;
  assert.deepEqual(parseOwnTracksLocation(withoutOptional), {
    latitude: -37.8136,
    longitude: 144.9631,
    accuracyM: null,
    batteryPct: null,
    capturedAt: new Date(1754784000 * 1000),
  });
});

test("rejects a payload missing coordinates or timestamp", () => {
  assert.equal(parseOwnTracksLocation({ _type: "location", lat: -37.8 }), null);
  assert.equal(parseOwnTracksLocation({ _type: "location", lon: 144.9 }), null);
  assert.equal(
    parseOwnTracksLocation({ _type: "location", lat: -37.8, lon: 144.9 }),
    null,
  );
});

test("rejects coordinates outside their valid range", () => {
  assert.equal(parseOwnTracksLocation({ ...location, lat: 91 }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lat: -91 }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lon: 181 }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lon: -181 }), null);
});

test("rejects non-finite coordinates", () => {
  assert.equal(parseOwnTracksLocation({ ...location, lat: NaN }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lon: Infinity }), null);
});

test("clamps accuracy and battery into their column ranges", () => {
  // accuracy_m and battery_pct are smallint; a nonsense reading must not throw
  // at the database. Accuracy caps at smallint max, battery at 0-100.
  const wide = parseOwnTracksLocation({ ...location, acc: 99_999, batt: 150 });
  assert.equal(wide?.accuracyM, 32_767);
  assert.equal(wide?.batteryPct, 100);

  const negative = parseOwnTracksLocation({ ...location, acc: -5, batt: -5 });
  assert.equal(negative?.accuracyM, 0);
  assert.equal(negative?.batteryPct, 0);
});

test("rejects a non-object body", () => {
  for (const body of [null, undefined, "location", 42, []]) {
    assert.equal(parseOwnTracksLocation(body), null);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module './owntracks.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/owntracks.ts`:

```ts
/**
 * Parsing for OwnTracks HTTP-mode publishes.
 *
 * OwnTracks (owntracks.org) is a free app on both stores that reports position
 * in the background using the native location permission a web page can never
 * hold. It POSTs JSON to a URL we choose. Only `_type: "location"` carries a
 * fix; the app also publishes `transition`, `waypoints` and `lwt` messages,
 * which we acknowledge and drop.
 *
 * Pure and dependency-free so the whole surface is unit-testable without a
 * database or a phone.
 */

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Horizontal uncertainty in metres, or null when the sender omitted it. */
  accuracyM: number | null;
  /** Sender battery percentage, or null when the sender omitted it. */
  batteryPct: number | null;
  /** When the fix was taken on the device, not when it reached us. */
  capturedAt: Date;
}

/** Largest value a Postgres smallint holds; accuracy is stored in one. */
const SMALLINT_MAX = 32_767;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number within [min, max], or null for anything else. */
function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * An optional integer reading, clamped into range rather than rejected: a
 * nonsense accuracy or battery value should not cost us an otherwise good fix,
 * and must not overflow its smallint column.
 */
function clampedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * A location fix from an OwnTracks publish, or null when the payload is not a
 * usable location — the wrong `_type`, missing coordinates, or values out of
 * range. Callers treat null as "acknowledge and ignore", never as an error.
 */
export function parseOwnTracksLocation(body: unknown): LocationFix | null {
  if (!isRecord(body)) return null;
  if (body._type !== "location") return null;

  const latitude = boundedNumber(body.lat, -90, 90);
  const longitude = boundedNumber(body.lon, -180, 180);
  // `tst` is a Unix timestamp in seconds. Guard the upper bound loosely so a
  // millisecond timestamp sent by mistake is rejected rather than landing in
  // the year 57000 and pinning the age label to "in 55,000 years".
  const seconds = boundedNumber(body.tst, 0, 4_000_000_000);
  if (latitude === null || longitude === null || seconds === null) return null;

  return {
    latitude,
    longitude,
    accuracyM: clampedInt(body.acc, 0, SMALLINT_MAX),
    batteryPct: clampedInt(body.batt, 0, 100),
    capturedAt: new Date(seconds * 1000),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: PASS, all 8 tests in `lib/owntracks.test.mts`.

- [ ] **Step 5: Commit**

```bash
git add lib/owntracks.ts lib/owntracks.test.mts
git commit -m "feat(location): add OwnTracks payload parser"
```

---

### Task 2: Schema and migration

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/NNNN_<generated_name>.sql` (produced by drizzle-kit, do not hand-write)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `userLocations` table export.
  - `users.locationSharing` (`boolean`, not null, default `false`) and `users.locationToken` (`text`, unique, nullable).
  - `export type UserLocation = typeof userLocations.$inferSelect;`

- [ ] **Step 1: Add `doublePrecision` to the pg-core import**

In `db/schema.ts`, the import block at lines 2–13 lists column helpers. Add `doublePrecision` to it:

```ts
import {
  pgTable,
  uuid,
  text,
  boolean,
  smallint,
  date,
  timestamp,
  check,
  unique,
  jsonb,
  doublePrecision,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add the two columns to `users`**

Replace the `users` table definition with this. The two new columns go after `name`:

```ts
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),

  /**
   * Whether this member's position may be stored and shown. Opt-in, and
   * enforced server-side on ingest rather than on the phone: the sender is a
   * third-party app that always publishes, so the gate has to live here to be
   * meaningful. Flipping it off takes effect on the very next publish with no
   * phone-side change.
   */
  locationSharing: boolean("location_sharing").notNull().default(false),
  /**
   * The shared secret OwnTracks authenticates with, as the HTTP Basic password.
   * Null until the member generates one in Settings. Unique, so it identifies
   * the member on its own.
   */
  locationToken: text("location_token").unique(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

- [ ] **Step 3: Add the `user_locations` table**

Append after the `chores` table definition, before the `export type` block:

```ts
/**
 * The latest known position of each household member — one row per user,
 * upserted. No history is kept: a trail of where your partner has been is a
 * different and far more invasive feature than "where are they now", and not
 * storing it means there is nothing to leak.
 *
 * `user_id` is the primary key, which makes one-row-per-user a schema
 * guarantee and the write a plain upsert with no read-modify-write race.
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
  // publish can arrive minutes after the moment it describes.
  capturedAt: timestamp("captured_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 4: Add the row type export**

In the `export type` block at the end of the file, add:

```ts
export type UserLocation = typeof userLocations.$inferSelect;
```

- [ ] **Step 5: Generate and read the migration**

```bash
pnpm drizzle-kit generate
```

Open the newly generated file in `db/migrations/` (it will be `0004_*.sql`). Confirm it contains a `CREATE TABLE "user_locations"`, two `ALTER TABLE "users" ADD COLUMN` statements, and a unique constraint on `users.location_token`. Confirm it contains **no** `DROP` statement — nothing is being removed in this feature.

This check is the gate, not a formality: `vercel.json` runs `pnpm db:migrate` as part of the build ([ADR 0004](../../decisions/0004-database-migrations-on-deploy.md)), so whatever this file says will be applied automatically on the next deploy.

- [ ] **Step 6: Apply the migration locally**

```bash
pnpm db:migrate
```

Expected: applies cleanly, reading `DATABASE_URL` from `.env.local` via `drizzle.config.ts`. Every statement is additive — a new table plus two nullable-or-defaulted columns — so it is safe to run against the shared Neon database. If it fails, stop and report rather than editing the generated SQL by hand.

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat(location): add user_locations table and sharing columns"
```

---

### Task 3: Location queries

**Files:**
- Modify: `lib/queries.ts`

**Interfaces:**
- Consumes: `userLocations`, `users` from `db/schema`; `getHouseholdId` from `lib/household`.
- Produces:
  - `export interface MemberLocation { userId: string; name: string; sharing: boolean; latitude: number | null; longitude: number | null; accuracyM: number | null; batteryPct: number | null; capturedAt: Date | null }`
  - `export function getMemberLocations(): Promise<MemberLocation[]>`

- [ ] **Step 1: Extend the imports**

In `lib/queries.ts`, add `users` and `userLocations` to the existing `@/db/schema` import:

```ts
import {
  shoppingItems,
  shoppingCategories,
  calendarEvents,
  chores,
  recipes,
  users,
  userLocations,
} from "@/db/schema";
```

- [ ] **Step 2: Append the query**

Add at the end of `lib/queries.ts`:

```ts
/**
 * A household member and their latest position, if any. The position fields are
 * null both for a member who has never shared and for one who has sharing
 * turned off, which the page distinguishes using `sharing`.
 */
export interface MemberLocation {
  userId: string;
  name: string;
  sharing: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  batteryPct: number | null;
  capturedAt: Date | null;
}

/**
 * Every household member with their latest known position, name order.
 *
 * Deliberately NOT wrapped in unstable_cache, unlike every other read in this
 * file. Two reasons: the writer is an external HTTP client rather than a Server
 * Action, so the "mutate then bust the tag" pairing the others rely on does not
 * apply; and a stale cache here shows a confidently wrong pin, which is a worse
 * failure than a slightly old shopping list. The cost is two rows queried only
 * while somebody has the map open.
 */
export async function getMemberLocations(): Promise<MemberLocation[]> {
  const householdId = await getHouseholdId();
  if (!householdId) return [];

  return getDb()
    .select({
      userId: users.id,
      name: users.name,
      sharing: users.locationSharing,
      latitude: userLocations.latitude,
      longitude: userLocations.longitude,
      accuracyM: userLocations.accuracyM,
      batteryPct: userLocations.batteryPct,
      capturedAt: userLocations.capturedAt,
    })
    .from(users)
    .leftJoin(userLocations, eq(userLocations.userId, users.id))
    .where(eq(users.householdId, householdId))
    .orderBy(asc(users.name));
}
```

- [ ] **Step 3: Verify it type-checks**

```bash
pnpm run build
```

Expected: build succeeds. A `leftJoin` makes every `userLocations` column nullable in the result type, which is what `MemberLocation` declares.

- [ ] **Step 4: Commit**

```bash
git add lib/queries.ts
git commit -m "feat(location): add member location query"
```

---

### Task 4: Ingest route handler

**Files:**
- Create: `app/api/location/route.ts`

**Interfaces:**
- Consumes: `parseOwnTracksLocation`, `LocationFix` from `lib/owntracks`; `userLocations`, `users` from `db/schema`; `getDb`, `isDbConfigured` from `@/db`.
- Produces: `POST /api/location`, HTTP Basic authenticated. Always `200` with a JSON `[]` body except `401` on bad credentials and `503` when no database is configured.

- [ ] **Step 1: Write the route handler**

Create `app/api/location/route.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/db";
import { users, userLocations } from "@/db/schema";
import { parseOwnTracksLocation } from "@/lib/owntracks";

/**
 * Location ingest for OwnTracks (owntracks.org), the free app that holds the
 * native background-location permission no web page can obtain.
 *
 * A Route Handler rather than a Server Action because the caller is a
 * third-party app. Authenticated with HTTP Basic, which OwnTracks supports
 * natively — the token travels in a header rather than a URL, where Vercel's
 * request logs would capture it.
 *
 * OwnTracks expects a JSON array of commands in reply and retries against
 * anything else, so almost every outcome is `200 []`:
 *
 * - wrong `_type`, or an unusable payload → accepted and ignored
 * - sharing turned off                    → accepted and DISCARDED, never 403,
 *   because a rejection would make the app retry and alarm its user. This is
 *   what makes the toggle authoritative while the sender stays dumb.
 * - an older fix than the stored one      → accepted and ignored, so a
 *   late-arriving publish cannot drag the pin backwards
 *
 * Bad credentials are the one real failure and answer 401, so a mistyped token
 * is diagnosable instead of silently dropping fixes forever.
 */

/**
 * OwnTracks reads commands from the response body; an empty array means "none".
 *
 * Built fresh on every call, deliberately. A Response body is a single-use
 * stream, so one shared module-scope instance serves an empty body from the
 * second request onwards — which is precisely the malformed reply this endpoint
 * exists to avoid, and would provoke the retry storm the docstring above warns
 * about.
 */
function ack() {
  return Response.json([]);
}

/** The password from an HTTP Basic header, or null when absent or malformed. */
function basicAuthPassword(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    // The username is ignored: the token is unique, so it identifies the member
    // on its own. An empty password is not a token.
    if (separator === -1) return null;
    return decoded.slice(separator + 1) || null;
  } catch {
    // Not valid base64.
    return null;
  }
}

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return Response.json({ error: "No database configured." }, { status: 503 });
  }

  const token = basicAuthPassword(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  const [member] = await getDb()
    .select({
      id: users.id,
      householdId: users.householdId,
      sharing: users.locationSharing,
    })
    .from(users)
    .where(eq(users.locationToken, token))
    .limit(1);

  if (!member) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  // Authenticated but not sharing: acknowledge and drop.
  if (!member.sharing) return ack();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ack();
  }

  const fix = parseOwnTracksLocation(body);
  if (!fix) return ack();

  await getDb()
    .insert(userLocations)
    .values({
      userId: member.id,
      householdId: member.householdId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
      batteryPct: fix.batteryPct,
      capturedAt: fix.capturedAt,
    })
    .onConflictDoUpdate({
      target: userLocations.userId,
      set: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM,
        batteryPct: fix.batteryPct,
        capturedAt: fix.capturedAt,
        updatedAt: new Date(),
      },
      // Monotonic in device time: publishes can arrive out of order, and an old
      // fix must not overwrite a newer one.
      setWhere: sql`${userLocations.capturedAt} < ${fix.capturedAt}`,
    });

  return ack();
}
```

- [ ] **Step 2: Verify it builds**

```bash
pnpm run build
```

Expected: build succeeds. If `setWhere` is not available on this Drizzle version, replace the `.onConflictDoUpdate({...})` call with an equivalent raw statement and keep the same monotonicity condition:

```ts
await getDb().execute(sql`
  insert into user_locations
    (user_id, household_id, latitude, longitude, accuracy_m, battery_pct, captured_at)
  values (${member.id}, ${member.householdId}, ${fix.latitude}, ${fix.longitude},
          ${fix.accuracyM}, ${fix.batteryPct}, ${fix.capturedAt})
  on conflict (user_id) do update set
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_m = excluded.accuracy_m,
    battery_pct = excluded.battery_pct,
    captured_at = excluded.captured_at,
    updated_at = now()
  where user_locations.captured_at < excluded.captured_at
`);
```

- [ ] **Step 3: Exercise every branch with curl**

Start the dev server in one terminal:

```bash
pnpm run dev
```

No credentials — expect `401`:

```bash
curl -i -X POST http://localhost:3000/api/location -H 'Content-Type: application/json' -d '{"_type":"location","lat":-37.8136,"lon":144.9631,"tst":1754784000}'
```

Wrong token — expect `401`:

```bash
curl -i -X POST http://localhost:3000/api/location -u 'anything:not-a-real-token' -H 'Content-Type: application/json' -d '{"_type":"location","lat":-37.8136,"lon":144.9631,"tst":1754784000}'
```

The remaining branches need a real token, which Task 6 generates. Return here after Task 6 and confirm: a valid token with sharing **off** returns `200 []` and stores nothing; with sharing **on** it stores a row; and re-posting an **older** `tst` leaves the stored row unchanged.

- [ ] **Step 4: Commit**

```bash
git add app/api/location/route.ts
git commit -m "feat(location): add OwnTracks ingest endpoint"
```

---

### Task 5: Server actions for sharing and tokens

**Files:**
- Create: `app/location/actions.ts`

**Interfaces:**
- Consumes: `getCurrentUserId` from `lib/household`; `users`, `userLocations` from `db/schema`.
- Produces:
  - `export async function setLocationSharing(sharing: boolean): Promise<void>`
  - `export async function regenerateLocationToken(): Promise<string | null>`
  - `export async function recordMyLocation(input: { latitude: number; longitude: number; accuracyM: number | null }): Promise<void>`

- [ ] **Step 1: Write the actions**

Create `app/location/actions.ts`:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users, userLocations } from "@/db/schema";
import { getCurrentUserId, getHouseholdId } from "@/lib/household";

// Every action here needs a seeded household member, so each fails closed by
// returning early rather than throwing a 500 at the user — the SetupNotice on
// the page says which setup step is missing.

/**
 * Turn location sharing on or off for the signed-in member.
 *
 * Turning it off does not delete the last stored position: the pin simply stops
 * advancing and its age label keeps growing, which reads honestly as "this is
 * where they were when they stopped sharing".
 */
export async function setLocationSharing(sharing: boolean) {
  const userId = await getCurrentUserId();
  if (!userId) return;

  await getDb()
    .update(users)
    .set({ locationSharing: sharing })
    .where(eq(users.id, userId));

  revalidatePath("/location");
  revalidatePath("/settings");
}

/**
 * Issue a fresh OwnTracks token for the signed-in member, returning it so
 * Settings can display it. Regenerating invalidates the previous token, so the
 * phone must be updated before it can publish again.
 */
export async function regenerateLocationToken(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  // 32 hex characters from the CSPRNG. Long enough that the endpoint cannot be
  // guessed, short enough to retype off a screen if the copy button fails on an
  // older phone. Imported from node:crypto rather than the global, which is not
  // guaranteed on every Node version Next supports.
  const token = randomUUID().replaceAll("-", "");

  await getDb()
    .update(users)
    .set({ locationToken: token })
    .where(eq(users.id, userId));

  revalidatePath("/settings");
  return token;
}

/**
 * Store a fix the browser produced for the signed-in member.
 *
 * This is the fallback path that makes the feature work before OwnTracks is set
 * up, and keeps your own pin current while you are looking at the map. It runs
 * only in the foreground — a web page cannot read location in the background,
 * which is the whole reason OwnTracks exists in this design.
 *
 * Respects the same sharing gate as the ingest endpoint, and the same
 * monotonicity rule, so the two writers cannot fight.
 */
export async function recordMyLocation(input: {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}) {
  const userId = await getCurrentUserId();
  const householdId = await getHouseholdId();
  if (!userId || !householdId) return;

  const [member] = await getDb()
    .select({ sharing: users.locationSharing })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!member?.sharing) return;

  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return;
  }

  const accuracyM =
    input.accuracyM === null || !Number.isFinite(input.accuracyM)
      ? null
      : Math.min(32_767, Math.max(0, Math.round(input.accuracyM)));

  const capturedAt = new Date();

  await getDb()
    .insert(userLocations)
    .values({
      userId,
      householdId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM,
      // The browser does not report battery, so leave the last known value be
      // rather than overwriting it with null.
      capturedAt,
    })
    .onConflictDoUpdate({
      target: userLocations.userId,
      set: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM,
        capturedAt,
        updatedAt: new Date(),
      },
      setWhere: sql`${userLocations.capturedAt} < ${capturedAt}`,
    });

  revalidatePath("/location");
}
```

- [ ] **Step 2: Verify it builds**

```bash
pnpm run build
```

Expected: build succeeds. If `setWhere` was unavailable in Task 4, apply the same raw-SQL substitution here.

- [ ] **Step 3: Commit**

```bash
git add app/location/actions.ts
git commit -m "feat(location): add sharing, token and self-fix actions"
```

---

### Task 6: Settings setup panel

Needed before the remaining branches of Task 4 can be exercised, because this is where a token comes from.

**Files:**
- Create: `app/settings/location-setup.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `components/db-notice.tsx`

**Interfaces:**
- Consumes: `regenerateLocationToken` from `app/location/actions`.
- Produces: `export function LocationSetup({ initialToken, endpoint }: { initialToken: string | null; endpoint: string })`

- [ ] **Step 1: Write the client component**

Create `app/settings/location-setup.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { regenerateLocationToken } from "@/app/location/actions";

/** A label, a value, and a copy button — one OwnTracks field to transcribe. */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (older iOS, insecure context). The
      // value is on screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="wrap-break-word font-mono text-sm">{value}</p>
      </div>
      <button
        onClick={copy}
        className="mt-4 flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="size-4 text-emerald-500" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

/**
 * One-time OwnTracks setup for the signed-in member.
 *
 * Shows the values to transcribe into the app's HTTP-mode settings. The copy
 * buttons are load-bearing rather than polish — typing a 32-character token by
 * hand on a phone is miserable.
 */
export function LocationSetup({
  initialToken,
  endpoint,
}: {
  initialToken: string | null;
  endpoint: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function regenerate() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await regenerateLocationToken();
        if (next) setToken(next);
        else setError("Could not issue a token — check the household setup above.");
      } catch {
        setError("Could not issue a token. Try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A phone cannot report its position while HomeSync is in the background,
        so the free{" "}
        <a
          href="https://owntracks.org"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          OwnTracks
        </a>{" "}
        app does it instead. Install it, choose <strong>HTTP</strong> mode, and
        enter these values.
      </p>

      {token ? (
        <div className="divide-y divide-black/5 rounded-lg border border-black/10 px-3 py-1 dark:divide-white/10 dark:border-white/15">
          <CopyRow label="URL" value={endpoint} />
          <CopyRow label="User ID" value="homesync" />
          <CopyRow label="Password" value={token} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          No token yet. Generate one to set up your phone.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        onClick={regenerate}
        disabled={pending}
        className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15"
      >
        <KeyRound className="size-4" aria-hidden />
        {token ? "Regenerate token" : "Generate token"}
      </button>

      {token && (
        <p className="text-xs text-zinc-500">
          Regenerating stops the old token working, so update your phone after
          you do it. Set OwnTracks to <strong>significant changes</strong> mode
          to keep battery use low.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it from the Settings page**

In `app/settings/page.tsx`, add to the imports:

```tsx
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUserId } from "@/lib/household";
import { LocationSetup } from "./location-setup";
```

Replace the body of `SettingsPage` up to and including the existing `Promise.all` with:

```tsx
export default async function SettingsPage() {
  const [session, categories, setupIssue, userId, headerList] = await Promise.all([
    auth(),
    getShoppingCategories(),
    getSetupIssue(),
    getCurrentUserId(),
    headers(),
  ]);

  // Read the deployment's own host so the endpoint shown is the one this phone
  // is actually talking to — localhost in development, the preview URL on a
  // preview, production in production. Hard-coding it would hand someone the
  // wrong URL on two of those three.
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const endpoint = `${protocol}://${host}/api/location`;

  let locationToken: string | null = null;
  if (userId && isDbConfigured()) {
    const [member] = await getDb()
      .select({ token: users.locationToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    locationToken = member?.token ?? null;
  }
```

Then add a new section immediately before the existing `About` section:

```tsx
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Location sharing
        </h2>
        <LocationSetup initialToken={locationToken} endpoint={endpoint} />
      </section>
```

- [ ] **Step 3: Update the About copy, which names chores**

Still in `app/settings/page.tsx`, the `About` section describes the app as having a chore list. Replace its two paragraphs with:

```tsx
        <p>
          HomeSync is for a two-person household — two accounts, one shared
          shopping list, calendar, and map.
        </p>
        <p>
          Location sharing is off until you turn it on, and only ever stores
          your latest position — never a history of where you have been.
        </p>
```

- [ ] **Step 4: Fix the stale chores reference in the setup notice**

In `components/db-notice.tsx`, the `not-a-member` message says "so chores cannot be added or ticked off", which no longer describes a tab in the nav. Replace that message with:

```tsx
  "not-a-member": {
    Icon: UserX,
    message: (
      <>
        You are signed in, but this account is not a household member yet, so
        nothing you save will be attributed to you. Add the address you signed
        in with to <code>SEED_MEMBERS</code> and re-run{" "}
        <code>scripts/seed.mjs</code>.
      </>
    ),
  },
```

- [ ] **Step 5: Verify in the browser**

```bash
pnpm run dev
```

Open `http://localhost:3000/settings`. Confirm the Location sharing section appears, that "Generate token" produces a 32-character token, that the URL row reads `http://localhost:3000/api/location`, and that a copy button flips to a tick.

- [ ] **Step 6: Finish the deferred Task 4 verification**

With the token from Step 5, complete the branches that needed it. Sharing is off by default, so this first call must store nothing and return `200 []`:

```bash
curl -i -X POST http://localhost:3000/api/location -u "homesync:PASTE_TOKEN" -H 'Content-Type: application/json' -d '{"_type":"location","lat":-37.8136,"lon":144.9631,"tst":1754784000,"acc":12,"batt":68}'
```

Confirm no row was written:

```bash
pnpm drizzle-kit studio
```

Leave the remaining two checks (sharing on, and the older-timestamp case) until Task 7 provides the toggle.

- [ ] **Step 7: Commit**

```bash
git add app/settings/location-setup.tsx app/settings/page.tsx components/db-notice.tsx
git commit -m "feat(location): add OwnTracks setup panel to settings"
```

---

### Task 7: Location page, sharing toggle, and navigation swap

Completes PR 1 — a working feature with positions as a text list.

**Files:**
- Create: `app/location/page.tsx`
- Create: `app/location/location-view.tsx`
- Create: `app/location/loading.tsx`
- Modify: `components/bottom-nav.tsx`
- Modify: `public/sw.js`

**Interfaces:**
- Consumes: `getMemberLocations`, `MemberLocation` from `lib/queries`; `setLocationSharing`, `recordMyLocation` from `app/location/actions`; `getSetupIssue`, `getCurrentUserId` from `lib/household`.
- Produces: `export function LocationView({ members, currentUserId }: { members: MemberLocation[]; currentUserId: string | null })`

- [ ] **Step 1: Write the loading skeleton**

Create `app/location/loading.tsx`, matching the shape of the other feature loading files:

```tsx
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-32 animate-pulse rounded bg-black/5 dark:bg-white/10" />
      <div className="h-64 animate-pulse rounded-lg bg-black/5 dark:bg-white/10" />
    </div>
  );
}
```

- [ ] **Step 2: Write the client view**

Create `app/location/location-view.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { MapPin, BatteryLow, Crosshair } from "lucide-react";
import type { MemberLocation } from "@/lib/queries";
import { setLocationSharing, recordMyLocation } from "./actions";

/** A coarse relative age: exact seconds are noise for "are they nearly home?". */
function relativeAge(capturedAt: Date): string {
  const minutes = Math.floor((Date.now() - capturedAt.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** One member's row: name, freshness, and how precise the fix was. */
function MemberRow({ member }: { member: MemberLocation }) {
  if (!member.sharing) {
    return (
      <li className="py-3">
        <p className="text-base">{member.name}</p>
        <p className="text-sm text-zinc-500">Not sharing location</p>
      </li>
    );
  }

  if (member.capturedAt === null) {
    return (
      <li className="py-3">
        <p className="text-base">{member.name}</p>
        <p className="text-sm text-zinc-500">Sharing on, no position yet</p>
      </li>
    );
  }

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 wrap-break-word text-base">{member.name}</p>
        <p className="shrink-0 text-sm text-zinc-500">
          {relativeAge(member.capturedAt)}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" aria-hidden />
          {member.latitude?.toFixed(5)}, {member.longitude?.toFixed(5)}
        </span>
        {member.accuracyM !== null && (
          <span className="inline-flex items-center gap-1">
            <Crosshair className="size-3.5" aria-hidden />
            ±{member.accuracyM} m
          </span>
        )}
        {member.batteryPct !== null && member.batteryPct <= 20 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <BatteryLow className="size-3.5" aria-hidden />
            {member.batteryPct}%
          </span>
        )}
      </div>
    </li>
  );
}

export function LocationView({
  members,
  currentUserId,
}: {
  members: MemberLocation[];
  currentUserId: string | null;
}) {
  const me = members.find((m) => m.userId === currentUserId) ?? null;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
    Post one fresh fix for yourself while you are looking at the map.

    Scoped to this page on purpose: an app-wide hook would prompt for location
    permission when you open the shopping list. This is also the only path that
    works before OwnTracks is installed — and it stops the moment the page is
    backgrounded, which is precisely the limitation OwnTracks exists to cover.
  */
  useEffect(() => {
    if (!me?.sharing) return;
    if (!("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void recordMyLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy ?? null,
        });
      },
      () => {
        // Denied, unavailable, or timed out. Not worth a banner: OwnTracks data
        // still renders, and the browser already told the user what it asked.
      },
      // Wifi and cell triangulation rather than GPS — far cheaper on battery,
      // and plenty for "roughly where is my partner". A minute-old cached fix
      // is accepted rather than forcing a new one.
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }, [me?.sharing]);

  function toggle() {
    if (!me) return;
    const next = !me.sharing;
    setError(null);
    startTransition(async () => {
      try {
        await setLocationSharing(next);
      } catch {
        setError("Could not change sharing. Try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {me && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 dark:border-white/15">
          <div className="min-w-0">
            <p className="text-base">Share my location</p>
            <p className="text-sm text-zinc-500">
              {me.sharing ? "On" : "Off — nothing is stored"}
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={pending}
            role="switch"
            aria-checked={me.sharing}
            aria-label="Share my location"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              me.sharing ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-1 size-5 rounded-full bg-white transition-all ${
                me.sharing ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-zinc-500">No household members yet.</p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {members.map((member) => (
            <MemberRow key={member.userId} member={member} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the page**

Create `app/location/page.tsx`:

```tsx
import { getMemberLocations } from "@/lib/queries";
import { getSetupIssue, getCurrentUserId } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { LocationView } from "./location-view";

export const dynamic = "force-dynamic";

export default async function LocationPage() {
  const [members, setupIssue, currentUserId] = await Promise.all([
    getMemberLocations(),
    getSetupIssue(),
    getCurrentUserId(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Location</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <LocationView members={members} currentUserId={currentUserId} />
    </div>
  );
}
```

- [ ] **Step 4: Swap the nav tab**

In `components/bottom-nav.tsx`, change the icon import — replace `ListChecks` with `MapPin`:

```tsx
import {
  ShoppingCart,
  BookOpen,
  CalendarDays,
  MapPin,
  Settings,
} from "lucide-react";
```

And replace the Chores entry in `TABS`:

```tsx
  { href: "/location", label: "Location", Icon: MapPin },
```

- [ ] **Step 5: Update the service worker shell**

In `public/sw.js`, replace `/chores` with `/location` in the `SHELL` array:

```js
const SHELL = ["/shopping", "/location", "/calendar", "/settings"];
```

Bump the cache name in the same file so returning phones drop the old shell rather than serving a cached Chores tab:

```js
const CACHE = "homesync-v2";
```

- [ ] **Step 6: Verify the whole feature end to end**

```bash
pnpm run lint && pnpm test && pnpm run build
```

Expected: all three pass. Then `pnpm run dev` and confirm in the browser:

- The bottom nav shows Location where Chores was, and `/chores` still loads if visited directly.
- `/location` lists both members as "Not sharing location".
- Toggling your own switch on prompts for location permission and, once allowed, your row gains coordinates and "just now".
- Toggling off flips the row back to "Not sharing location".

Now finish the last two Task 4 branches. With sharing **on**, this stores a row:

```bash
curl -i -X POST http://localhost:3000/api/location -u "homesync:PASTE_TOKEN" -H 'Content-Type: application/json' -d '{"_type":"location","lat":-37.8136,"lon":144.9631,"tst":1754784000,"acc":12,"batt":68}'
```

Re-post with an **older** `tst` and confirm the stored row does not move:

```bash
curl -i -X POST http://localhost:3000/api/location -u "homesync:PASTE_TOKEN" -H 'Content-Type: application/json' -d '{"_type":"location","lat":0,"lon":0,"tst":1000000000,"acc":9999,"batt":1}'
```

Expected: both return `200 []`; the second leaves latitude at `-37.8136`. Verify with `pnpm drizzle-kit studio`.

- [ ] **Step 7: Commit and open PR 1**

```bash
git add app/location public/sw.js components/bottom-nav.tsx
git commit -m "feat(location): add location tab with sharing toggle"
```

Push the branch and open the pull request using the `pr-description` skill. Confirm the change on the Vercel preview URL from a phone before merging.

---

### Task 8: Leaflet map (PR 2)

Purely presentational. The list from Task 7 stays as the detail rows beneath the map.

**Files:**
- Create: `app/location/location-map.tsx`
- Modify: `app/location/location-view.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MemberLocation` from `lib/queries`.
- Produces: `export function LocationMap({ members }: { members: MemberLocation[] })`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add leaflet && pnpm add -D @types/leaflet
```

- [ ] **Step 2: Write the map component**

Create `app/location/location-map.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
// Static, not dynamic. Only Leaflet's JS touches `window` at import time; its
// stylesheet is a plain CSS import that Next extracts at build time, and
// `await import()` on a stylesheet is not reliably handled.
import "leaflet/dist/leaflet.css";
import type { MemberLocation } from "@/lib/queries";

/** Members with a position worth drawing. */
function plottable(members: MemberLocation[]) {
  return members.filter(
    (m) => m.sharing && m.latitude !== null && m.longitude !== null,
  );
}

// One colour per member, by position in the (name-ordered) list, so each person
// keeps the same pin colour between renders.
const PIN_COLOURS = ["#10b981", "#6366f1"] as const;

/**
 * Both members on an OpenStreetMap base layer.
 *
 * Plain Leaflet rather than react-leaflet: one map, one dependency instead of
 * two. Leaflet's JS is imported dynamically inside the effect because it
 * touches `window` at module scope, which would break the server render.
 *
 * Markers are `divIcon`s rather than Leaflet's default marker. The default one
 * resolves its PNGs relative to the stylesheet, which bundlers rewrite — the
 * well-known result is invisible or broken-image pins. A CSS dot has no assets
 * to lose, and colour-coding two people reads better than two identical pins.
 *
 * OSM's tile usage policy allows light use like this and requires the
 * attribution rendered below.
 */
export function LocationMap({ members }: { members: MemberLocation[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  // Read inside the effect so `members` itself need not be a dependency — a new
  // array identity on every poll would redraw the markers each render.
  const membersRef = useRef(members);
  membersRef.current = members;

  // A primitive dependency, so the effect re-runs only when a position actually
  // changes.
  const signature = plottable(members)
    .map((m) => `${m.userId}:${m.latitude},${m.longitude}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;

    async function draw() {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          // A two-person map is read, not explored. Dragging still works.
          zoomControl: false,
          attributionControl: false,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;

      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      const current = plottable(membersRef.current);
      if (current.length === 0) {
        // Nothing to show: a wide view beats an empty grey square.
        map.setView([-37.8136, 144.9631], 9);
        return;
      }

      current.forEach((member, i) => {
        const colour = PIN_COLOURS[i % PIN_COLOURS.length];
        const marker = L.marker([member.latitude!, member.longitude!], {
          icon: L.divIcon({
            className: "", // Suppress Leaflet's default divIcon chrome.
            html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${colour};box-shadow:0 0 0 3px rgba(255,255,255,0.9),0 1px 3px rgba(0,0,0,0.4)"></span>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        })
          .addTo(map)
          .bindTooltip(member.name, { permanent: true, direction: "top" });
        markersRef.current.push(marker);
      });

      if (current.length === 1) {
        map.setView([current[0].latitude!, current[0].longitude!], 14);
      } else {
        map.fitBounds(
          current.map((m) => [m.latitude!, m.longitude!] as [number, number]),
          { padding: [40, 40], maxZoom: 15 },
        );
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [signature]);

  // Tear the map down only on unmount; the effect above reuses it otherwise.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return (
    <div>
      {/*
        Hidden from assistive technology on purpose: a pane of tiles conveys
        nothing without sight, and the detail rows below carry the same
        information as text. Labelling this as an image would promise a
        description that a tile grid cannot give.
      */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-64 w-full overflow-hidden rounded-lg border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5"
      />
      <p className="mt-1 text-right text-xs text-zinc-500">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Render the map above the list**

In `app/location/location-view.tsx`, add the import:

```tsx
import { LocationMap } from "./location-map";
```

Then insert the map immediately before the `{members.length === 0 ? (` block:

```tsx
      <LocationMap members={members} />
```

- [ ] **Step 4: Verify**

```bash
pnpm run lint && pnpm test && pnpm run build
```

Expected: all pass. Then `pnpm run dev`, open `/location`, and confirm:

- The map renders with OSM tiles and the attribution line beneath it.
- Your own marker appears with your name as a permanent tooltip once sharing is on.
- With only one member sharing, the map centres on that pin at street zoom rather than fitting empty bounds.
- Nothing scrolls horizontally at a 320 px viewport width.

- [ ] **Step 5: Commit and open PR 2**

```bash
git add app/location/location-map.tsx app/location/location-view.tsx package.json pnpm-lock.yaml
git commit -m "feat(location): show members on a Leaflet map"
```

Push and open the pull request with the `pr-description` skill. Check the preview URL on a phone — tile loading and marker legibility on a small screen are the whole point of this PR.

---

## Post-implementation

- [ ] Set up OwnTracks on both phones using the values from Settings: HTTP mode, **significant changes** reporting, and the location permission set to **Always** (otherwise the app is no better than the PWA).
- [ ] Confirm a real background fix lands: turn sharing on, put the phone in a pocket, walk a few hundred metres, and check the pin moved without opening HomeSync.
- [ ] If OwnTracks proves awkward on either platform, Traccar Client is the fallback sender — it needs only a new parser alongside `parseOwnTracksLocation`, since the endpoint, gate and schema are sender-agnostic.
