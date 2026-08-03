"use server";

import { eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { requireHouseholdId, getCurrentUserId } from "@/lib/household";
import { CACHE_TAGS } from "@/lib/queries";

export async function addCalendarEvent(input: {
  title: string;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
}) {
  const title = input.title.trim();
  if (!title || !input.startDate) return;
  const householdId = await requireHouseholdId();
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
  await requireHouseholdId();
  await getDb().delete(calendarEvents).where(eq(calendarEvents.id, id));
  updateTag(CACHE_TAGS.calendarEvents);
}
