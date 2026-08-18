import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  smallint,
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

export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type ShoppingCategory = typeof shoppingCategories.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type EventExdate = typeof eventExdates.$inferSelect;
export type Chore = typeof chores.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserLocation = typeof userLocations.$inferSelect;
