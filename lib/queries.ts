import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shoppingItems, calendarEvents, chores } from "@/db/schema";
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
