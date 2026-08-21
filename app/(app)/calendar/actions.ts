"use server";

import { eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { getHouseholdId, getCurrentUserId } from "@/lib/household";
import { CACHE_TAGS } from "@/lib/queries";

// No seeded household means nowhere to store the event, so these writes fail
// closed rather than throwing a 500 at the user — the SetupNotice on the page
// says which step is missing. `createdById` stays nullable: an event still saves
// when the signed-in account has no member row yet.

export async function addCalendarEvent(input: {
  title: string;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
}) {
  const title = input.title.trim();
  if (!title || !input.startDate) return;
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const createdById = await getCurrentUserId();

  await getDb().insert(calendarEvents).values({
    householdId,
    title,
    startDate: input.startDate,
    endDate: input.endDate?.trim() || null,
    notes: input.notes?.trim() || null,
    createdById,
  });
  updateTag(CACHE_TAGS.calendarEvents);
}

export async function deleteCalendarEvent(id: string) {
  if (!(await getHouseholdId())) return;
  await getDb().delete(calendarEvents).where(eq(calendarEvents.id, id));
  updateTag(CACHE_TAGS.calendarEvents);
}
