import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Session } from "next-auth";
import { getDb } from "@/db";
import type { Activity, CalendarEvent, EventComment } from "@/db/schema";
import {
  shoppingItems,
  shoppingCategories,
  calendarEvents,
  eventExdates,
  eventComments,
  activity,
  chores,
  recipes,
  users,
  userLocations,
} from "@/db/schema";
import type { Exdate } from "@/lib/recurrence";
import { DEFAULT_SHOPPING_CATEGORIES } from "./shopping-categories";
import { getHouseholdId, getCurrentUserId } from "./household";
import { isDbConfigured } from "@/db";

/**
 * Read queries are cached server-side under a tag per domain, so navigations
 * are answered from the cache instead of Neon. Server Actions revalidate the
 * matching tag after each mutation, so the cache is never stale — see
 * CACHE_TAGS for the tag each mutation must bust.
 */
export const CACHE_TAGS = {
  shoppingItems: "shopping-items",
  shoppingCategories: "shopping-categories",
  calendarEvents: "calendar-events",
  chores: "chores",
  recipes: "recipes",
  // Nothing in-app mutates a user row today, so nothing busts this tag yet —
  // it exists for correctness if that ever changes, not because it is needed now.
  users: "users",
  eventComments: "event-comments",
  activity: "activity",
} as const;

const fetchShoppingItems = unstable_cache(
  (householdId: string) =>
    getDb()
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, householdId))
      .orderBy(asc(shoppingItems.createdAt)),
  ["shopping-items"],
  { tags: [CACHE_TAGS.shoppingItems] },
);

/** All shopping items for the household, oldest first. Empty if no DB/household. */
export async function getShoppingItems() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchShoppingItems(householdId);
}

const categoryOrder = [
  asc(shoppingCategories.position),
  asc(shoppingCategories.name),
] as const;

function selectCategories(householdId: string) {
  return getDb()
    .select()
    .from(shoppingCategories)
    .where(eq(shoppingCategories.householdId, householdId))
    .orderBy(...categoryOrder);
}

const fetchShoppingCategories = unstable_cache(
  (householdId: string) => selectCategories(householdId),
  ["shopping-categories"],
  { tags: [CACHE_TAGS.shoppingCategories] },
);

/**
 * The household's shopping categories, in walk order. Empty if no DB/household.
 *
 * The first time a household has none, this seeds the defaults so the dropdown
 * and Settings list start populated and fully editable. `onConflictDoNothing`
 * makes a concurrent double-seed harmless (the unique household+name constraint
 * would otherwise throw). Seeding happens outside the cached read — tags can't
 * be revalidated during render, so the write must not be cached; the empty
 * cached result self-heals on the next category mutation.
 */
export async function getShoppingCategories() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];

  const existing = await fetchShoppingCategories(householdId);
  if (existing.length > 0) return existing;

  await getDb()
    .insert(shoppingCategories)
    .values(
      DEFAULT_SHOPPING_CATEGORIES.map((name, i) => ({
        householdId,
        name,
        position: i,
      })),
    )
    .onConflictDoNothing();
  return selectCategories(householdId);
}

const fetchRecipes = unstable_cache(
  (householdId: string) =>
    getDb()
      .select()
      .from(recipes)
      .where(eq(recipes.householdId, householdId))
      .orderBy(desc(recipes.createdAt)),
  ["recipes"],
  { tags: [CACHE_TAGS.recipes] },
);

/** Saved recipes for the household, newest first. Empty if no DB/household. */
export async function getRecipes() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchRecipes(householdId);
}

async function selectCalendarWindow(
  householdId: string,
  from: string,
  to: string,
): Promise<{ events: CalendarEvent[]; exdates: Exdate[] }> {
  const db = getDb();

  const [events, exdates] = await Promise.all([
    db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.householdId, householdId),
          or(
            // A plain event (or override row) overlaps the window at its own
            // dates. A trip's endDate can be null (single-day event); its
            // effective end for overlap purposes is then its own startDate.
            and(
              lte(calendarEvents.startDate, to),
              gte(sql`coalesce(${calendarEvents.endDate}, ${calendarEvents.startDate})`, from),
            ),
            // A recurrence master can have started long before `from` and
            // still generate occurrences inside the window (a weekly event
            // from years ago, say) — its own span is irrelevant here, only
            // whether it's still repeating by the time the window opens.
            and(
              isNotNull(calendarEvents.repeatFreq),
              lte(calendarEvents.startDate, to),
              or(isNull(calendarEvents.repeatUntil), gte(calendarEvents.repeatUntil, from)),
            ),
          ),
        ),
      )
      .orderBy(asc(calendarEvents.startDate)),
    // Exdates for this household's events, joined back to calendar_events
    // because event_exdates carries no household_id of its own — the join is
    // the household scope. Mapped to the lib's `Exdate` shape ({ eventId,
    // date }) so this file stays the only place that knows the DB column is
    // called event_id.
    db
      .select({ eventId: eventExdates.eventId, date: eventExdates.date })
      .from(eventExdates)
      .innerJoin(calendarEvents, eq(eventExdates.eventId, calendarEvents.id))
      .where(eq(calendarEvents.householdId, householdId)),
  ]);

  return { events, exdates };
}

/**
 * Raw event rows overlapping the inclusive `[from, to]` "YYYY-MM-DD" window,
 * plus their exdates — the caller runs `expandOccurrences` (lib/recurrence.ts)
 * over the result to get concrete Occurrence[]. Both queries live inside this
 * one `unstable_cache` call (same key, same tag) so a mutation's single
 * `updateTag(CACHE_TAGS.calendarEvents)` busts events and exdates together —
 * there is no way for one to go stale while the other refreshes.
 *
 * CRITICAL: `from`/`to` are always the caller's window bounds (see
 * app/calendar/page.tsx) — never derive them from `Date.now()`/"today" in
 * here. This function's whole job is to be a pure cache key -> rows mapping;
 * if "today" were computed inside it instead, the first request to populate a
 * given window's cache entry would freeze that day into the cached result
 * until the tag is next busted, silently going stale for every other viewer
 * on every later day.
 */
export async function getCalendarWindow(
  from: string,
  to: string,
): Promise<{ events: CalendarEvent[]; exdates: Exdate[] }> {
  const householdId = await getHouseholdId();
  if (!householdId) return { events: [], exdates: [] };

  return unstable_cache(
    () => selectCalendarWindow(householdId, from, to),
    ["calendar-window", householdId, from, to],
    { tags: [CACHE_TAGS.calendarEvents] },
  )();
}

const fetchEventComments = unstable_cache(
  (householdId: string) =>
    getDb()
      .select({
        id: eventComments.id,
        eventId: eventComments.eventId,
        authorId: eventComments.authorId,
        body: eventComments.body,
        createdAt: eventComments.createdAt,
      })
      .from(eventComments)
      // event_comments carries no household_id of its own, so the join back
      // to calendar_events is the household scope — same pattern as the
      // exdates join in selectCalendarWindow above.
      .innerJoin(calendarEvents, eq(eventComments.eventId, calendarEvents.id))
      .where(eq(calendarEvents.householdId, householdId))
      .orderBy(asc(eventComments.createdAt)),
  ["event-comments"],
  { tags: [CACHE_TAGS.eventComments] },
);

/**
 * Every comment on this household's events, oldest first. Comments flow
 * through server-rendered props rather than a one-shot client fetch (design
 * decision 5 of the shared-calendar plan), so the 15s LiveRefresh poll keeps
 * an open thread current the same way every other cached read does.
 * Filtering down to one event's slice happens client-side
 * (app/calendar/calendar-events.tsx) — the household's whole comment history
 * is a small, single cached read, not worth a query per event.
 */
export async function getEventComments(): Promise<EventComment[]> {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchEventComments(householdId);
}

const fetchActivity = unstable_cache(
  (householdId: string) =>
    getDb()
      .select()
      .from(activity)
      .where(eq(activity.householdId, householdId))
      .orderBy(desc(activity.createdAt))
      .limit(50),
  ["activity"],
  { tags: [CACHE_TAGS.activity] },
);

/** The household's latest ~50 activity rows, newest first. */
export async function getActivity(): Promise<Activity[]> {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchActivity(householdId);
}

/**
 * The signed-in member's own `activity_seen_at`, read directly rather than
 * through `unstable_cache`. `getActivity` above is cached per household and
 * shared by both members, so baking either partner's seen state into it
 * would leak one partner's read state into the other's badge (design
 * decision 5 of the shared-calendar plan) — this small, uncached row lookup
 * is the deliberate exception. The caller (app/calendar/page.tsx) combines
 * this with the cached activity rows to compute the unread count itself.
 */
export async function getCurrentUserActivitySeenAt(): Promise<Date | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const [row] = await getDb()
    .select({ activitySeenAt: users.activitySeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.activitySeenAt ?? null;
}

const fetchChores = unstable_cache(
  (householdId: string) =>
    getDb()
      .select()
      .from(chores)
      .where(eq(chores.householdId, householdId))
      .orderBy(asc(chores.nextDueAt)),
  ["chores"],
  { tags: [CACHE_TAGS.chores] },
);

/** All chores for the household, soonest due first. */
export async function getChores() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchChores(householdId);
}

export interface HouseholdMember {
  id: string;
  name: string;
}

const fetchHouseholdMembers = unstable_cache(
  (householdId: string) =>
    getDb()
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.householdId, householdId))
      .orderBy(asc(users.name)),
  ["household-members"],
  { tags: [CACHE_TAGS.users] },
);

/** The household's members (id + name), for attendee pickers. Empty if no DB/household. */
export async function getHouseholdMembers(): Promise<HouseholdMember[]> {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchHouseholdMembers(householdId);
}

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

/**
 * The signed-in member's dark-mode preference. Defaults to false if unset/signed out.
 * Accepts an already-resolved session, so callers that already called `auth()`
 * (e.g. the root layout) don't trigger a second session lookup.
 */
export async function getCurrentUserDarkMode(
  session?: Session | null,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const userId = await getCurrentUserId(session);
  if (!userId) return false;

  const [member] = await getDb()
    .select({ darkMode: users.darkMode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return member?.darkMode ?? false;
}
