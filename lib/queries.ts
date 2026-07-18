import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  shoppingItems,
  shoppingCategories,
  calendarEvents,
  chores,
} from "@/db/schema";
import { DEFAULT_SHOPPING_CATEGORIES } from "./shopping-categories";
import { getHouseholdId } from "./household";

/** All shopping items for the household, oldest first. Empty if no DB/household. */
export async function getShoppingItems() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return getDb()
    .select()
    .from(shoppingItems)
    .where(eq(shoppingItems.householdId, householdId))
    .orderBy(asc(shoppingItems.createdAt));
}

/**
 * The household's shopping categories, in walk order. Empty if no DB/household.
 *
 * The first time a household has none, this seeds the defaults so the dropdown
 * and Settings list start populated and fully editable. `onConflictDoNothing`
 * makes a concurrent double-seed harmless (the unique household+name constraint
 * would otherwise throw).
 */
export async function getShoppingCategories() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  const db = getDb();
  const order = [
    asc(shoppingCategories.position),
    asc(shoppingCategories.name),
  ] as const;

  const existing = await db
    .select()
    .from(shoppingCategories)
    .where(eq(shoppingCategories.householdId, householdId))
    .orderBy(...order);
  if (existing.length > 0) return existing;

  await db
    .insert(shoppingCategories)
    .values(
      DEFAULT_SHOPPING_CATEGORIES.map((name, i) => ({
        householdId,
        name,
        position: i,
      })),
    )
    .onConflictDoNothing();
  return db
    .select()
    .from(shoppingCategories)
    .where(eq(shoppingCategories.householdId, householdId))
    .orderBy(...order);
}

/** Upcoming calendar events, earliest start first. */
export async function getCalendarEvents() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return getDb()
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.householdId, householdId))
    .orderBy(asc(calendarEvents.startDate));
}

/** All chores for the household, soonest due first. */
export async function getChores() {
  const householdId = await getHouseholdId();
  if (!householdId) return [];
  return getDb()
    .select()
    .from(chores)
    .where(eq(chores.householdId, householdId))
    .orderBy(asc(chores.nextDueAt));
}
