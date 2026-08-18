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

type NormalisedFields = {
  title: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  url: string | null;
  colour: string | null;
  attendeeIds: string[] | null;
  notes: string | null;
};

type NormaliseResult =
  | { ok: true; fields: NormalisedFields }
  | { ok: false; reason: string };

/**
 * Trim and validate the fields shared by add and update, returning either the
 * normalised row values or the reason the first broken rule failed. The
 * reason is surfaced to the caller rather than swallowed, because several of
 * these rules (the colour palette, the attendee subset, the cross-midnight
 * check) are server-only — the form does not always stop a bad value before
 * it submits, so a silent rejection would just make the optimistic row vanish
 * with no explanation.
 */
async function normaliseEventInput(
  input: CalendarEventInput,
): Promise<NormaliseResult> {
  const title = input.title.trim();
  const startDate = input.startDate;
  if (!title || !startDate) {
    return { ok: false, reason: "Title and start date are required." };
  }

  const endDate = input.endDate?.trim() || null;
  if (endDate && endDate < startDate) {
    return { ok: false, reason: "End date can't be before the start date." };
  }

  const startTime = input.startTime?.trim() || null;
  // A null startTime means all-day; an end time only means something alongside
  // a start time, so it is dropped rather than rejected here — the form's "All
  // day" toggle always clears both together anyway.
  const endTime = startTime ? input.endTime?.trim() || null : null;
  // Cross-midnight rule: endTime belongs to (endDate ?? startDate). Reject
  // when that effective end anchor is the same day as startDate and endTime
  // doesn't come after startTime — a strictly later endDate is always fine.
  if (endTime && startTime && endTime <= startTime && (!endDate || endDate === startDate)) {
    return { ok: false, reason: "End time must be after the start time." };
  }

  const url = input.url?.trim() || null;
  if (url && !isHttpUrl(url)) {
    return { ok: false, reason: "Link must be a valid http(s) URL." };
  }

  const colour = input.colour?.trim() || null;
  if (colour && !isEventColour(colour)) {
    return { ok: false, reason: "Unknown colour." };
  }

  const attendeeIds = input.attendeeIds?.length ? input.attendeeIds : null;
  if (attendeeIds) {
    const memberIds = new Set((await getHouseholdMembers()).map((m) => m.id));
    if (!attendeeIds.every((id) => memberIds.has(id))) {
      return { ok: false, reason: "Unknown attendee." };
    }
  }

  return {
    ok: true,
    fields: {
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
    },
  };
}

export async function addCalendarEvent(
  input: CalendarEventInput,
): Promise<{ error?: string }> {
  const householdId = await getHouseholdId();
  if (!householdId) return {};
  const result = await normaliseEventInput(input);
  if (!result.ok) return { error: result.reason };
  const createdById = await getCurrentUserId();

  await getDb()
    .insert(calendarEvents)
    .values({ ...result.fields, householdId, createdById });
  updateTag(CACHE_TAGS.calendarEvents);
  return {};
}

/**
 * Full-field update with a last-write-wins guard: the caller sends the
 * `updatedAt` it loaded the event with, and the WHERE clause only matches that
 * exact value. Zero rows updated means somebody else's edit landed first, so
 * this action returns a discriminated result rather than throwing —
 * `{ conflict: true }` lets the client show "This event was just changed —
 * reload" instead of silently overwriting a change it never saw, and `error`
 * carries a validation failure the same way `addCalendarEvent` does.
 */
export async function updateCalendarEvent(
  id: string,
  input: CalendarEventInput,
  expectedUpdatedAt: Date,
): Promise<{ conflict: boolean; error?: string }> {
  const householdId = await getHouseholdId();
  if (!householdId) return { conflict: false };
  const result = await normaliseEventInput(input);
  if (!result.ok) return { conflict: false, error: result.reason };

  const updated = await getDb()
    .update(calendarEvents)
    .set(result.fields)
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

/**
 * Toggles pinned and hands back the row's fresh `updatedAt`, the same way
 * `updateCalendarEvent` hands back a conflict flag: Drizzle's `$onUpdate`
 * bumps `updatedAt` on *every* update, this one included, so a caller sitting
 * on an older snapshot — the edit sheet, which loads the event once at open
 * time — needs the new value to refresh that snapshot with. Skipping this
 * would leave the sheet holding a now-stale `updatedAt`, so its next save
 * would always trip `updateCalendarEvent`'s last-write-wins guard even
 * though nobody else touched the row. Null means nothing matched (no
 * household, or the event isn't this household's).
 */
export async function togglePinned(
  id: string,
  pinned: boolean,
): Promise<{ updatedAt: Date } | null> {
  const householdId = await getHouseholdId();
  if (!householdId) return null;
  const [updated] = await getDb()
    .update(calendarEvents)
    .set({ pinned })
    .where(
      and(
        eq(calendarEvents.id, id),
        eq(calendarEvents.householdId, householdId),
      ),
    )
    .returning({ updatedAt: calendarEvents.updatedAt });
  updateTag(CACHE_TAGS.calendarEvents);
  return updated ? { updatedAt: updated.updatedAt } : null;
}
