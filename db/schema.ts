import { sql } from "drizzle-orm";
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

export const calendarEvents = pgTable("calendar_events", {
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

export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type ShoppingCategory = typeof shoppingCategories.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type Chore = typeof chores.$inferSelect;
export type User = typeof users.$inferSelect;
