"use server";

import { and, eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { getHouseholdId, getCurrentUserId } from "@/lib/household";
import { CACHE_TAGS, getHouseholdMembers } from "@/lib/queries";
import { isEventColour } from "@/lib/event-colours";

// No seeded household means nowhere to store the event, so these writes fail
// closed rather than throwing a 500 at the user — the SetupNotice on the page
// says which step is missing. `createdById` stays nullable: an event still saves
// when the signed-in account has no member row yet.

export interface CalendarEventInput {
  title: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  url?: string | null;
  colour?: string | null;
  attendeeIds?: string[] | null;
  notes?: string | null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Trim and validate the fields shared by add and update, returning the
 * normalised row values or null on the first rule broken. Every rule mirrors a
 * guard the form already applies before it will submit, so a null here only
 * ever means the client was bypassed (a stale tab, a direct call) — never a
 * surprise for someone using the form normally.
 */
async function normaliseEventInput(input: CalendarEventInput) {
  const title = input.title.trim();
  const startDate = input.startDate;
  if (!title || !startDate) return null;

  const endDate = input.endDate?.trim() || null;
  if (endDate && endDate < startDate) return null;

  const startTime = input.startTime?.trim() || null;
  // A null startTime means all-day; an end time only means something alongside
  // a start time, so it is dropped rather than rejected here — the form's "All
  // day" toggle always clears both together anyway.
  const endTime = startTime ? input.endTime?.trim() || null : null;
  // Cross-midnight rule: endTime belongs to (endDate ?? startDate). Only reject
  // when there is no endDate, i.e. the times are claimed to be the same day.
  if (endTime && !endDate && startTime && endTime <= startTime) return null;

  const url = input.url?.trim() || null;
  if (url && !isHttpUrl(url)) return null;

  const colour = input.colour?.trim() || null;
  if (colour && !isEventColour(colour)) return null;

  const attendeeIds = input.attendeeIds?.length ? input.attendeeIds : null;
  if (attendeeIds) {
    const memberIds = new Set((await getHouseholdMembers()).map((m) => m.id));
    if (!attendeeIds.every((id) => memberIds.has(id))) return null;
  }

  return {
    title,
    startDate,
    endDate,
    startTime,
    endTime,
    location: input.location?.trim() || null,
    url,
    colour,
    attendeeIds,
    notes: input.notes?.trim() || null,
  };
}

export async function addCalendarEvent(input: CalendarEventInput) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const fields = await normaliseEventInput(input);
  if (!fields) return;
  const createdById = await getCurrentUserId();

  await getDb()
    .insert(calendarEvents)
    .values({ ...fields, householdId, createdById });
  updateTag(CACHE_TAGS.calendarEvents);
}

/**
 * Full-field update with a last-write-wins guard: the caller sends the
 * `updatedAt` it loaded the event with, and the WHERE clause only matches that
 * exact value. Zero rows updated means somebody else's edit landed first, so
 * this is the one action here that returns a value — `{ conflict: true }` lets
 * the client show "This event was just changed — reload" instead of silently
 * overwriting a change it never saw.
 */
export async function updateCalendarEvent(
  id: string,
  input: CalendarEventInput,
  expectedUpdatedAt: Date,
): Promise<{ conflict: boolean }> {
  const householdId = await getHouseholdId();
  if (!householdId) return { conflict: false };
  const fields = await normaliseEventInput(input);
  if (!fields) return { conflict: false };

  const updated = await getDb()
    .update(calendarEvents)
    .set(fields)
    .where(
      and(
        eq(calendarEvents.id, id),
        eq(calendarEvents.householdId, householdId),
        eq(calendarEvents.updatedAt, expectedUpdatedAt),
      ),
    )
    .returning({ id: calendarEvents.id });

  updateTag(CACHE_TAGS.calendarEvents);
  return { conflict: updated.length === 0 };
}

export async function deleteCalendarEvent(id: string) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  await getDb()
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, id),
        eq(calendarEvents.householdId, householdId),
      ),
    );
  updateTag(CACHE_TAGS.calendarEvents);
}

export async function togglePinned(id: string, pinned: boolean) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  await getDb()
    .update(calendarEvents)
    .set({ pinned })
    .where(
      and(
        eq(calendarEvents.id, id),
        eq(calendarEvents.householdId, householdId),
      ),
    );
  updateTag(CACHE_TAGS.calendarEvents);
}
