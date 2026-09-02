import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  smallint,
  integer,
  date,
  time,
  timestamp,
  check,
  unique,
  index,
  uniqueIndex,
  jsonb,
  doublePrecision,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * The sharing boundary. A HomeSync deployment has exactly one household with
 * two members, but scoping shared data by household keeps "shared" explicit and
 * queries simple.
 */
export const households = pgTable("households", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /**
   * IANA timezone (PR 8; ADR 0009). The reminder sender runs on Vercel's UTC
   * clock and has to convert a wall-clock reminder anchor (an event's
   * `startTime`, or local midnight for an all-day event) into a UTC instant
   * to know when to fire — a fixed numeric offset cannot do that safely,
   * because Sydney's UTC offset itself changes at the October daylight-saving
   * transition. `date-fns-tz`'s `fromZonedTime` (lib/reminder-instants.ts)
   * needs exactly this string to resolve the correct offset for any given date.
   */
  timezone: text("timezone").notNull().default("Australia/Sydney"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

  /** Whether this member sees the app in its dark colour scheme. */
  darkMode: boolean("dark_mode").notNull().default(false),

  /**
   * The last time this member viewed the activity feed, stamped as the max
   * `created_at` of the rows they actually saw rendered — never `now()` (see
   * markActivitySeen, app/calendar/actions.ts) — so a row that arrives
   * between the client's fetch and the tap that marks it seen stays unseen.
   * Null means the feed has never been opened.
   */
  activitySeenAt: timestamp("activity_seen_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shoppingItems = pgTable("shopping_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  name: text("name").notNull(),
  // Nullable: uncategorised items are grouped under "Other" in the UI.
  category: text("category"),
  // The product link for this item, if one was pasted. Always http(s); null when none.
  url: text("url"),
  checked: boolean("checked").notNull().default(false),
  addedById: uuid("added_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * The shopping-list categories a household can pick from, managed in Settings.
 *
 * Categories are household data (not a hardcoded list) so members can add and
 * remove their own. `shopping_items.category` remains free text that stores the
 * category *name*; these rows drive the dropdown and heading order. Removing a
 * category nulls the label on its items (they fall under "Other").
 */
export const shoppingCategories = pgTable(
  "shopping_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    // Walk order for the shop; smaller sorts first. New categories go last.
    position: smallint("position").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("shopping_categories_household_name").on(t.householdId, t.name)],
);

/**
 * Recipes saved from recipetineats.com. `ingredients` keeps the raw ingredient
 * strings from the page's structured data, so "add to list" can recreate the
 * shopping items at any time. The URL is stored canonicalised (no query/hash)
 * and is unique per household, so re-importing a recipe refreshes the saved
 * copy instead of duplicating it.
 */
export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    title: text("title").notNull(),
    url: text("url").notNull(),
    ingredients: jsonb("ingredients").$type<string[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("recipes_household_url").on(t.householdId, t.url)],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    title: text("title").notNull(),
    // endDate is nullable; a single-day event has startDate only, a trip has both.
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),

    /**
     * Time model: dates stay canonical; times are optional wall-clock add-ons.
     * A null `startTime` means an all-day event — deliberately no separate
     * boolean column, so "all-day" can never drift out of sync with the times.
     * `endTime` belongs to `endDate ?? startDate` (a same-day timed event has
     * no `endDate` at all). The household is single-timezone, so every event
     * renders in device-local time with no stored zone.
     */
    startTime: time("start_time"),
    endTime: time("end_time"),
    location: text("location"),
    url: text("url"),
    // A named lib/event-colours.ts palette value; null uses the default dot colour.
    colour: text("colour"),
    // Household user ids this event applies to; null means both members.
    attendeeIds: jsonb("attendee_ids").$type<string[]>(),
    // Pinned events surface first in the agenda (a later PR); unpinned by default.
    pinned: boolean("pinned").notNull().default(false),
    /**
     * Reminders (PR 8; ADR 0009). Minutes BEFORE this event's reminder
     * anchor: a timed event's anchor is its own `startTime`; an all-day
     * event's anchor is local midnight (00:00) of `startDate`. A NEGATIVE
     * value therefore fires AFTER the anchor — this is how an all-day
     * "9:00 am on the day" reminder is expressed with no separate anchor
     * column: -540 minutes before midnight is 540 minutes (9 hours) after
     * it, i.e. 9:00 am. Null means no reminder is set. See
     * lib/reminder-instants.ts for the wall-clock -> UTC-instant maths.
     */
    reminderMinutes: smallint("reminder_minutes"),
    // Bumped on every edit; updateCalendarEvent's last-write-wins guard compares
    // the caller's loaded value against this column in its WHERE clause.
    updatedAt: timestamp("updated_at", { precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),

    /**
     * Recurrence (PR 4, M2; see ADR 0007 and lib/recurrence.ts, which this
     * schema structurally satisfies via `ExpandableEvent`). `repeatFreq` null
     * means a plain, non-recurring row — every other repeat* column is then
     * meaningless and normalised to null by the server actions
     * (`repeatInterval` keeps its not-null default of 1 regardless, since a
     * column can't be conditionally nullable). `seriesId`/`originalDate`
     * together mark a standalone override row: `seriesId` points at the
     * master it replaces one occurrence of, `originalDate` is the date on the
     * master it replaces. A plain event and a recurrence master both leave
     * both of those null.
     */
    repeatFreq: text("repeat_freq", {
      enum: ["daily", "weekly", "monthly", "yearly"],
    }),
    repeatInterval: smallint("repeat_interval").notNull().default(1),
    repeatWeekdays: jsonb("repeat_weekdays").$type<number[]>(),
    repeatUntil: date("repeat_until"),
    // Self-FK, deliberately `onDelete: "cascade"` — every other FK in this
    // schema defaults to "no action" — so deleting a master takes its
    // override rows with it in the same statement; an override left behind
    // with a dangling seriesId would be a permanently un-editable ghost
    // event, which is worse than losing it outright. The explicit
    // `AnyPgColumn` return type on the callback sidesteps Drizzle's
    // circular-inference error for a same-table self-reference (this column
    // needs `calendarEvents.id`, but `calendarEvents` isn't done being
    // inferred yet at the point this line runs).
    seriesId: uuid("series_id").references((): AnyPgColumn => calendarEvents.id, {
      onDelete: "cascade",
    }),
    originalDate: date("original_date"),
  },
  (t) => [
    index("calendar_events_household_start_idx").on(t.householdId, t.startDate),
    // Partial — only override rows carry a seriesId — so two concurrent
    // "edit this occurrence" calls for the same master/date collide on this
    // index instead of both inserting: editOccurrence's onConflictDoUpdate
    // targets exactly (seriesId, originalDate) under this same predicate, so
    // the second edit replaces the first override rather than duplicating
    // the occurrence.
    uniqueIndex("calendar_events_series_original_uq")
      .on(t.seriesId, t.originalDate)
      .where(sql`${t.seriesId} is not null`),
    // No DB CHECK constrains repeatFreq's *enum* beyond this — Drizzle's
    // `{ enum: [...] }` is TypeScript-only — so a stray "biweekly" from a
    // future/buggy caller is rejected at the column level, not just by the
    // server action's own validation (which lib/recurrence.ts's own tests
    // already assume can't be trusted: an unrecognised value there expands
    // to nothing, deliberately fail-closed).
    check(
      "calendar_events_repeat_freq_valid",
      sql`${t.repeatFreq} is null or ${t.repeatFreq} in ('daily', 'weekly', 'monthly', 'yearly')`,
    ),
    // Mirrors the action layer's own 1..99 clamp (app/calendar/actions.ts) —
    // same reasoning as the chores table's range checks above: the DB is the
    // backstop for a write that ever bypasses the Server Action.
    check("calendar_events_repeat_interval_range", sql`${t.repeatInterval} between 1 and 99`),
    // Mirrors normaliseEventInput's own -1440..1440 clamp (app/calendar/actions.ts)
    // — same backstop reasoning as the two checks above. That range is
    // itself capped at what lib/reminder-instants.ts's dueReminders can ever
    // deliver (its expansion window only reaches about a day either side of
    // "now"), not a wider "plausible" range.
    check(
      "calendar_events_reminder_minutes_range",
      sql`${t.reminderMinutes} is null or ${t.reminderMinutes} between -1440 and 1440`,
    ),
  ],
);

/**
 * Suppressed occurrences of a recurring master: one row per (event, date)
 * pair that should be hidden from expansion. Relational rather than a jsonb
 * array on the master, so a concurrent "delete this occurrence" is a plain
 * `INSERT ... ON CONFLICT DO NOTHING` instead of a read-modify-write race
 * that could silently drop somebody else's delete of a different date on the
 * same event (design decision 3 of the shared-calendar plan; ADR 0007).
 */
export const eventExdates = pgTable(
  "event_exdates",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.date] })],
);

/**
 * A comment thread on one calendar event (PR 7's "event comments" — text
 * only, deliberately not "chat": push notifications, not typing indicators
 * or read receipts, provide the immediacy). Cascades with its event, unlike
 * `activity` below — a comment has no meaning once the thing it comments on
 * is gone, whereas the activity feed's whole point is to survive the event.
 */
export const eventComments = pgTable("event_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => calendarEvents.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Append-only feed of who did what to which event (ADR 0008). Every
 * mutating calendar Server Action (app/calendar/actions.ts) writes one row
 * here in addition to its usual work, so "who created/edited/deleted/
 * commented on this, and when" survives independently of the event's own
 * current — or since-deleted — state.
 *
 * `eventId` is deliberately a plain uuid with NO foreign key: a deleted
 * event (or a cascade-deleted recurrence override) must not take its own
 * history down with it, which an `onDelete: "cascade"` FK would do, and
 * `onDelete: "set null"` would erase which event a row was ever about either
 * way. `eventTitle` is a snapshot taken at write time for the identical
 * reason — the feed still needs a name to show for an event that no longer
 * has a row to read one from.
 */
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    actorId: uuid("actor_id").references(() => users.id),
    verb: text("verb", {
      enum: ["created", "updated", "deleted", "commented"],
    }).notNull(),
    eventId: uuid("event_id"),
    eventTitle: text("event_title").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // The feed read is always "this household's latest rows, newest first"
    // (getActivity, lib/queries.ts) — this composite index serves that
    // access path directly instead of a full-table scan plus sort.
    index("activity_household_created_idx").on(t.householdId, t.createdAt),
    // Same reasoning as calendar_events_repeat_freq_valid above: Drizzle's
    // `{ enum: [...] }` is TypeScript-only, so this is the DB-level backstop
    // for a write that ever bypasses the server actions' own validation.
    check(
      "activity_verb_valid",
      sql`${t.verb} in ('created', 'updated', 'deleted', 'commented')`,
    ),
  ],
);

/**
 * A device's Web Push subscription (PR 8; ADR 0009). One row per
 * browser/device a member has tapped "Enable notifications" on — a member
 * can have more than one (phone plus desktop), which is why this is keyed by
 * its own `id` rather than `user_id`. `endpoint` is unique because it IS the
 * push service's own identity for that device: upserting by endpoint
 * (app/settings/actions.ts's `savePushSubscription`) is what makes
 * re-subscribing — a fresh permission grant on the same device after iOS has
 * silently revoked the old subscription — replace the stale row instead of
 * duplicating it. `keys` holds the p256dh/auth pair `web-push` needs to
 * encrypt a payload for this specific endpoint.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * The idempotency arbiter for the reminder sender route (PR 8; ADR 0009):
 * one row per occurrence a reminder has actually been sent for. The sender
 * INSERTs this row FIRST (`onConflictDoNothing`) and only pushes when that
 * insert lands a genuinely new row — two overlapping or retried 5-minute
 * pinger ticks racing the same due occurrence both attempt the identical
 * insert, so only one of them ever sends, and a tick that runs late (an
 * outage) still recognises an occurrence it already sent for. Cascades with
 * its event: a deleted event has no future reminders left to guard, and its
 * past send history serves no purpose once the event itself is gone. Keyed
 * per OCCURRENCE (`event_id`, `occurrence_date`), not per event, because a
 * recurring event reminds once per occurrence, not once ever.
 */
export const reminderLog = pgTable(
  "reminder_log",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    occurrenceDate: date("occurrence_date").notNull(),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.occurrenceDate] })],
);

/**
 * A file or photo attached to a calendar event (PR 9; ADR 0010) — TimeTree
 * premium's attachments feature. The blob itself lives in Vercel Blob, not
 * this table; this row is metadata pointing at it. `url` is the public,
 * permanent fetch URL handed straight to an `<a>`/`<img>`; `pathname` is the
 * store's own key, needed only to `del()` the blob later (deleteAttachment,
 * deleteCalendarEvent — app/calendar/actions.ts), since Vercel Blob's delete
 * API takes the pathname/URL, not this row's id. Cascades with its event —
 * an attachment has no meaning once the event it's attached to is gone,
 * same reasoning as `event_comments` above; the FK cascade only removes the
 * *row*, so the actions that delete an event also best-effort `del()` the
 * underlying blob so it doesn't orphan in the store forever.
 */
export const eventAttachments = pgTable("event_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => calendarEvents.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  /**
   * The Blob store's own key for this object. Unique because the upload
   * route's `addRandomSuffix: true` makes it unique per upload attempt
   * regardless of filename collisions — which is exactly what makes it the
   * idempotency key for `onUploadCompleted`'s insert
   * (app/api/attachments/upload/route.ts): Vercel retries that webhook (up
   * to 5 times) on anything but a 200 response, and this column's own
   * uniqueness is what lets `onConflictDoNothing` recognise a retry of an
   * already-processed callback instead of inserting a duplicate row.
   */
  pathname: text("pathname").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploadedById: uuid("uploaded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Recurring household chores, each carrying a Chore Cognitive Load Index.
 * Raw CLI inputs are stored (not just the derived score/band) so the weights in
 * lib/chore-load.ts can be re-tuned without re-surveying the household.
 */
export const chores = pgTable(
  "chores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    // Who owns the *thinking* for this chore.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),

    // Daminger stage ratings, 0-3 each.
    anticipate: smallint("anticipate").notNull().default(0),
    identify: smallint("identify").notNull().default(0),
    decide: smallint("decide").notNull().default(0),
    monitor: smallint("monitor").notNull().default(0),

    // Amplifiers.
    invisible: boolean("invisible").notNull().default(false),
    fragmentation: smallint("fragmentation").notNull().default(0), // 0-2

    // Derived, cached; recomputed on every write from the raw inputs above.
    cliScore: smallint("cli_score").notNull().default(0), // 0-100
    cliBand: text("cli_band", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("low"),

    // Recurrence + "who did it last / when it's next due".
    intervalDays: smallint("interval_days"), // every N days; null = one-off
    lastCompletedAt: timestamp("last_completed_at"),
    lastCompletedById: uuid("last_completed_by_id").references(() => users.id),
    nextDueAt: timestamp("next_due_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("chores_anticipate_range", sql`${t.anticipate} between 0 and 3`),
    check("chores_identify_range", sql`${t.identify} between 0 and 3`),
    check("chores_decide_range", sql`${t.decide} between 0 and 3`),
    check("chores_monitor_range", sql`${t.monitor} between 0 and 3`),
    check("chores_fragmentation_range", sql`${t.fragmentation} between 0 and 2`),
    check("chores_cli_score_range", sql`${t.cliScore} between 0 and 100`),
  ],
);

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

/**
 * Our own record of Core Web Vitals, kept because Vercel's is not durable:
 * Speed Insights retains 7 days on Hobby, has no read API, and Drains are
 * Pro-and-above. This table is the long-term trend line. See ADR 0011.
 *
 * Not scoped to a household or a user. The rows describe how the app performed
 * on a device, not what anybody did with it, and joining them to a member would
 * turn a performance log into a browsing history for no analytical gain.
 */
export const webVitals = pgTable(
  "web_vitals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Resolved route such as "/shopping", never a raw URL with query or ids. */
    route: text("route").notNull(),
    /** LCP, CLS, INP, FCP or TTFB. */
    metric: text("metric").notNull(),
    /** Milliseconds, except CLS which is a unitless ratio. */
    value: doublePrecision("value").notNull(),
    rating: text("rating").notNull(),
    /** Coarse form factor only, so the number can be read per device class. */
    deviceType: text("device_type"),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "web_vitals_metric_known",
      sql`${table.metric} in ('LCP', 'CLS', 'INP', 'FCP', 'TTFB')`,
    ),
    check(
      "web_vitals_rating_known",
      sql`${table.rating} in ('good', 'needs-improvement', 'poor')`,
    ),
    check("web_vitals_value_finite", sql`${table.value} >= 0`),
    index("web_vitals_report_idx").on(table.recordedAt, table.route, table.metric),
  ],
);

/**
 * A bank account whose monthly statement CSV is imported into the Almanac's
 * Finances section. `kind` is closed to the three accounts this household
 * actually has (ADR 0012) — open it up if that ever changes.
 */
export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["home_loan", "savings", "credit_card"],
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("finance_accounts_household_name").on(t.householdId, t.name)],
);

/**
 * One CSV upload. `sha256` skips re-processing the exact same file a second
 * time; `dedupeHash` on individual transactions (below) handles the more
 * common case of two different exports whose statement periods overlap.
 */
export const financeImports = pgTable(
  "finance_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Denormalised from accountId, matching calendarEvents/chores rather than
    // eventComments/eventExdates: the finance views' main query is "this
    // household's rows this month" and shouldn't need a join through accounts
    // to get there.
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financeAccounts.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    rowCount: smallint("row_count").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
  },
  (t) => [unique("finance_imports_account_sha256").on(t.accountId, t.sha256)],
);

/**
 * One ledger row per statement line. `amountCents` is signed (a credit is
 * positive, a debit negative) so a plain SUM gives net cashflow with no CASE
 * expression at query time. `balanceCents` is the bank's own running balance,
 * stored as read rather than recomputed — and, since these CSVs carry no bank
 * transaction id, it doubles as the tie-breaker inside `dedupeHash` for two
 * genuinely separate transactions that happen to share a date, amount and
 * description (e.g. two identical purchases on the same day): they leave the
 * balance at two different values, whereas re-importing the same line leaves
 * it unchanged. `category`/`subcategory` are the bank's own, taken verbatim —
 * the statement already categorises every row, so there is no separate rules
 * table or model-categorisation step (ADR 0012).
 */
export const financeTransactions = pgTable(
  "finance_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financeAccounts.id, { onDelete: "cascade" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => financeImports.id, { onDelete: "cascade" }),
    postedDate: date("posted_date").notNull(),
    descriptionRaw: text("description_raw").notNull(),
    amountCents: integer("amount_cents").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    category: text("category"),
    subcategory: text("subcategory"),
    dedupeHash: text("dedupe_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("finance_transactions_account_dedupe").on(t.accountId, t.dedupeHash),
    index("finance_transactions_account_date_idx").on(t.accountId, t.postedDate),
  ],
);

/**
 * One local-model narrative per household per month (ADR 0012): written by
 * scripts/finance-narrate.mjs running on the household's own machine against
 * LM Studio, never by the deployed app — Vercel cannot reach a model running
 * on a home PC. `metricsJson` is the exact computed rollup the model was
 * shown, so a summary stays auditable against its own input even as the
 * ledger keeps changing underneath it. `promptVersion` is stored alongside so
 * a later prompt change reads as a prompt change, not a shift in spending.
 * Multiple rows per period are allowed — e.g. re-running a month against a
 * newer model or prompt.
 */
export const financeAnalyses = pgTable(
  "finance_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    // "YYYY-MM" — this names a whole month, not a calendar day.
    period: text("period").notNull(),
    modelName: text("model_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    summaryMd: text("summary_md").notNull(),
    metricsJson: jsonb("metrics_json").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("finance_analyses_household_period_idx").on(t.householdId, t.period)],
);

/**
 * A savings/spending target. `categoryFilter` matches a bank `category`
 * verbatim when set; null means the goal tracks the whole ledger (e.g. a
 * home-loan payoff goal that isn't about any one category).
 */
export const financeGoals = pgTable("finance_goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  targetDate: date("target_date"),
  categoryFilter: text("category_filter"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type ShoppingCategory = typeof shoppingCategories.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type EventExdate = typeof eventExdates.$inferSelect;
export type EventComment = typeof eventComments.$inferSelect;
export type EventAttachment = typeof eventAttachments.$inferSelect;
export type Activity = typeof activity.$inferSelect;
// Named "Row", not "PushSubscription" — the DOM lib already owns that name
// for the browser's own Web Push API type, and this file is imported from
// client components that also talk to that API (app/settings/notifications.tsx).
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type Chore = typeof chores.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserLocation = typeof userLocations.$inferSelect;
export type WebVital = typeof webVitals.$inferSelect;
export type FinanceAccount = typeof financeAccounts.$inferSelect;
export type FinanceImport = typeof financeImports.$inferSelect;
export type FinanceTransaction = typeof financeTransactions.$inferSelect;
export type FinanceAnalysis = typeof financeAnalyses.$inferSelect;
export type FinanceGoal = typeof financeGoals.$inferSelect;
