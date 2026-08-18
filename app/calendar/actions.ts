"use server";

import { and, eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { calendarEvents, eventExdates } from "@/db/schema";
import { getHouseholdId, getCurrentUserId } from "@/lib/household";
import { CACHE_TAGS, getHouseholdMembers } from "@/lib/queries";
import { isEventColour } from "@/lib/event-colours";

const REPEAT_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
type RepeatFreq = (typeof REPEAT_FREQUENCIES)[number];

function isRepeatFreq(value: unknown): value is RepeatFreq {
  return REPEAT_FREQUENCIES.includes(value as RepeatFreq);
}

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
  repeatFreq?: RepeatFreq | null;
  repeatInterval?: number | null;
  repeatWeekdays?: number[] | null;
  repeatUntil?: string | null;
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
  repeatFreq: RepeatFreq | null;
  repeatInterval: number;
  repeatWeekdays: number[] | null;
  repeatUntil: string | null;
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

  const repeatFreq = input.repeatFreq ?? null;
  if (repeatFreq !== null && !isRepeatFreq(repeatFreq)) {
    return { ok: false, reason: "Unknown repeat frequency." };
  }

  // The interval is clamped rather than rejected even when repeatFreq is
  // null — it's meaningless then, but the column keeps a not-null default of
  // 1, so a harmless-but-valid value is simpler than threading an extra
  // "ignored" case through every caller.
  const repeatInterval = Math.min(
    99,
    Math.max(1, Math.trunc(input.repeatInterval ?? 1) || 1),
  );

  // A weekday set only means anything for a weekly series — a stale set left
  // over from switching the frequency dropdown in the form must not linger on
  // a daily/monthly/yearly (or non-repeating) save.
  let repeatWeekdays: number[] | null = null;
  if (repeatFreq === "weekly" && input.repeatWeekdays?.length) {
    const days = [...new Set(input.repeatWeekdays)];
    if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return { ok: false, reason: "Invalid weekday." };
    }
    repeatWeekdays = days.sort((a, b) => a - b);
  }

  // Not repeating at all -> no end date to hold onto either, regardless of
  // what the caller sent (the sheet hides the "until" control once repeat is
  // set to "none", but a stale value from switching it off shouldn't persist).
  const repeatUntil = repeatFreq ? input.repeatUntil?.trim() || null : null;
  if (repeatUntil && repeatUntil < startDate) {
    return { ok: false, reason: "Repeat until can't be before the start date." };
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
      repeatFreq,
      repeatInterval,
      repeatWeekdays,
      repeatUntil,
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
 *
 * Called against a recurring master, this edits the *whole series* in one
 * write: `expandOccurrences` (lib/recurrence.ts) derives every
 * non-overridden occurrence from the master's own repeat* columns at read
 * time, so there is no per-occurrence row for a series edit to touch —
 * changing the master's fields (including its repeat* columns) is the entire
 * operation. Editing a single occurrence instead goes through
 * `editOccurrence`, which never calls this function.
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

/** The master row a household owns, or null if it doesn't (wrong household or unknown id). */
async function findOwnedMaster(householdId: string, eventId: string) {
  const [master] = await getDb()
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.householdId, householdId)))
    .limit(1);
  return master ?? null;
}

/**
 * Suppresses one occurrence of a recurring master ("this event only" delete)
 * without touching the master row itself — it inserts an exdate rather than
 * deleting anything. `event_exdates` has no household_id of its own, so the
 * master is looked up first to scope the write to this household rather than
 * trusting the caller's `eventId`. `onConflictDoNothing` makes two concurrent
 * taps on the same occurrence's delete button race-free: both attempts insert
 * the identical (eventId, date) row, so the second is a no-op rather than a
 * lost-update race on some other column (design decision 3 of the
 * shared-calendar plan).
 */
export async function deleteOccurrence(eventId: string, date: string): Promise<void> {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  if (!(await findOwnedMaster(householdId, eventId))) return;

  await getDb().insert(eventExdates).values({ eventId, date }).onConflictDoNothing();
  updateTag(CACHE_TAGS.calendarEvents);
}

/**
 * Edits one occurrence of a recurring master ("this event only" save)
 * without touching the master: it adds an exdate for the original date AND
 * inserts a standalone override row — a plain, non-recurring event carrying
 * `seriesId` (the master) and `originalDate` (the date it replaces). All
 * repeat* fields on the override are forced null regardless of what `input`
 * carries, because an override is never itself a series — the master keeps
 * its own recurrence untouched, and the sheet hides/ignores the repeat
 * controls in this mode anyway.
 *
 * No transaction wraps the two inserts: the neon-http driver Drizzle is
 * configured with here has no session/transaction support at all —
 * `getDb().transaction()` throws "No transactions support in neon-http
 * driver" unconditionally — so this is two sequential, best-effort-atomic
 * writes rather than one atomic unit. The exdate goes first deliberately.
 * If a crash or dropped connection lands the exdate but not the override,
 * the occurrence just goes missing from the agenda — annoying, but visible
 * and fixable by reopening the master and editing that date again. If the
 * order were reversed and only the override landed, the master would carry
 * on generating its own occurrence on that date too, so the event would
 * silently DOUBLE — a worse and much less obvious failure to notice or undo.
 */
export async function editOccurrence(
  eventId: string,
  date: string,
  input: CalendarEventInput,
): Promise<{ error?: string }> {
  const householdId = await getHouseholdId();
  if (!householdId) return {};
  if (!(await findOwnedMaster(householdId, eventId))) return {};

  const result = await normaliseEventInput(input);
  if (!result.ok) return { error: result.reason };
  const createdById = await getCurrentUserId();

  await getDb().insert(eventExdates).values({ eventId, date }).onConflictDoNothing();

  await getDb()
    .insert(calendarEvents)
    .values({
      ...result.fields,
      repeatFreq: null,
      repeatInterval: 1,
      repeatWeekdays: null,
      repeatUntil: null,
      householdId,
      createdById,
      seriesId: eventId,
      originalDate: date,
    });

  updateTag(CACHE_TAGS.calendarEvents);
  return {};
}

/**
 * Deletes a recurring master outright ("whole series" delete). A series is
 * exactly its master row — the FK cascades on `event_exdates.event_id` and
 * `calendar_events.series_id` (both `onDelete: "cascade"`, see db/schema.ts)
 * take every override row and every exdate down with it in the same
 * statement, so deleting the series is just deleting the master.
 */
export async function deleteSeries(eventId: string): Promise<void> {
  await deleteCalendarEvent(eventId);
}
