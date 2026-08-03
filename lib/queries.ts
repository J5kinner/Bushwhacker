import { unstable_cache } from "next/cache";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  shoppingItems,
  shoppingCategories,
  calendarEvents,
  chores,
  recipes,
} from "@/db/schema";
import { DEFAULT_SHOPPING_CATEGORIES } from "./shopping-categories";
import { getHouseholdId } from "./household";

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

const fetchCalendarEvents = unstable_cache(
  (householdId: string) =>
    getDb()
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.householdId, householdId))
      .orderBy(asc(calendarEvents.startDate)),
  ["calendar-events"],
  { tags: [CACHE_TAGS.calendarEvents] },
);

/** Upcoming calendar events, earliest start first. */
export async function getCalendarEvents() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return fetchCalendarEvents(householdId);
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
