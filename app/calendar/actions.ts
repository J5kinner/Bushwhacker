"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { activity, calendarEvents, eventComments, eventExdates, users } from "@/db/schema";
import { getHouseholdId, getCurrentUserId } from "@/lib/household";
import { CACHE_TAGS, getHouseholdMembers } from "@/lib/queries";
import { isEventColour } from "@/lib/event-colours";
import { sendPushToUsers } from "@/lib/push";

const MIN_REMINDER_MINUTES = -1440;
const MAX_REMINDER_MINUTES = 10080;

const MAX_COMMENT_LENGTH = 1000;

type ActivityVerb = "created" | "updated" | "deleted" | "commented";

/**
 * Records one row in the append-only activity feed (ADR 0008). Best-effort
 * by design: the calling mutation has already committed by the time this
 * runs, so a transient failure here must not fail the whole action and hand
 * the caller an error over a change that in fact succeeded — the trade-off
 * is a feed that can silently miss an entry on the rare write that itself
 * fails, which is strictly better than a false failure on a save that
 * worked.
 */
async function recordActivity(params: {
  householdId: string;
  actorId: string | null;
  verb: ActivityVerb;
  eventId: string;
  eventTitle: string;
}) {
  try {
    await getDb().insert(activity).values(params);
  } catch {
    // Best-effort — see the doc comment above.
  }
}

const ACTIVITY_VERB_PHRASE: Record<ActivityVerb, string> = {
  created: "added",
  updated: "updated",
  deleted: "removed",
  commented: "commented on",
};

/**
 * Best-effort partner push notification (PR 8; ADR 0009), fired alongside
 * `recordActivity` from every mutation that already writes one — the
 * shared-calendar plan calls this out as one of the reminders PR's two push
 * surfaces (the reminder sender route, app/api/reminders/run/route.ts, is
 * the other). Sent to every household member EXCEPT the actor, reusing
 * `getHouseholdMembers()` rather than a bespoke query — the household is
 * always small, and this already runs after the mutation has committed.
 *
 * `togglePinned` deliberately calls neither this nor `recordActivity` (see
 * its own doc comment) — a personal triage flag flipped in passing isn't
 * something the other member needs pinged about.
 */
async function notifyPartner(params: {
  actorId: string | null;
  verb: ActivityVerb;
  eventTitle: string;
  startDate?: string | null;
}) {
  try {
    const members = await getHouseholdMembers();
    const recipients = members.filter((m) => m.id !== params.actorId).map((m) => m.id);
    if (recipients.length === 0) return;

    const actorName = members.find((m) => m.id === params.actorId)?.name ?? "Someone";
    const month = (params.startDate ?? new Date().toISOString()).slice(0, 7);
    await sendPushToUsers(recipients, {
      title: `${actorName} ${ACTIVITY_VERB_PHRASE[params.verb]} "${params.eventTitle}"`,
      body: "",
      url: `/calendar?m=${month}`,
    });
  } catch {
    // Best-effort — see recordActivity's own doc comment above.
  }
}

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
  reminderMinutes?: number | null;
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
  reminderMinutes: number | null;
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

  // -1440..10080: minutes BEFORE the reminder anchor (db/schema.ts's own
  // comment on `reminderMinutes`), wide enough to cover every preset the
  // event sheet offers (from -540, the all-day "morning of", to 1440, the
  // timed "1 day before") plus headroom — mirrored by the DB-level CHECK
  // constraint (calendar_events_reminder_minutes_range) as a backstop for a
  // write that ever bypasses this validation.
  const reminderMinutes = input.reminderMinutes ?? null;
  if (
    reminderMinutes !== null &&
    (!Number.isInteger(reminderMinutes) ||
      reminderMinutes < MIN_REMINDER_MINUTES ||
      reminderMinutes > MAX_REMINDER_MINUTES)
  ) {
    return { ok: false, reason: "Invalid reminder offset." };
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
      reminderMinutes,
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

  const [inserted] = await getDb()
    .insert(calendarEvents)
    .values({ ...result.fields, householdId, createdById })
    .returning({ id: calendarEvents.id });
  updateTag(CACHE_TAGS.calendarEvents);

  if (inserted) {
    await recordActivity({
      householdId,
      actorId: createdById,
      verb: "created",
      eventId: inserted.id,
      eventTitle: result.fields.title,
    });
    updateTag(CACHE_TAGS.activity);
    await notifyPartner({
      actorId: createdById,
      verb: "created",
      eventTitle: result.fields.title,
      startDate: result.fields.startDate,
    });
  }

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
 *
 * Called against an override row (`seriesId` set), the repeat* fields in
 * `input` are always discarded: an override is standalone by construction
 * (it already overrides one occurrence of another series), so letting it
 * pick up its own `repeatFreq` would layer a second, unrelated recurrence on
 * top of the one it belongs to — a case `expandOccurrences` was never built
 * to represent. The sheet already never sends repeat fields for an override
 * edit, but this reads the row's own `seriesId` and enforces it server-side
 * too, in the same query that would otherwise be a second household-scoped
 * lookup.
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

  const [target] = await getDb()
    .select({ seriesId: calendarEvents.seriesId })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, householdId)))
    .limit(1);
  const fields = target?.seriesId
    ? { ...result.fields, repeatFreq: null, repeatInterval: 1, repeatWeekdays: null, repeatUntil: null }
    : result.fields;

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

  if (updated.length > 0) {
    const actorId = await getCurrentUserId();
    await recordActivity({
      householdId,
      actorId,
      verb: "updated",
      eventId: id,
      eventTitle: fields.title,
    });
    updateTag(CACHE_TAGS.activity);
    await notifyPartner({
      actorId,
      verb: "updated",
      eventTitle: fields.title,
      startDate: fields.startDate,
    });
  }

  return { conflict: updated.length === 0 };
}

export async function deleteCalendarEvent(id: string) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  // `returning` the title before it's gone, rather than a separate SELECT
  // first — one statement either way, and it doubles as the "did this
  // household actually own that id" check the activity write below needs.
  const [deleted] = await getDb()
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, id),
        eq(calendarEvents.householdId, householdId),
      ),
    )
    .returning({ title: calendarEvents.title });
  updateTag(CACHE_TAGS.calendarEvents);

  if (deleted) {
    const actorId = await getCurrentUserId();
    await recordActivity({
      householdId,
      actorId,
      verb: "deleted",
      eventId: id,
      eventTitle: deleted.title,
    });
    updateTag(CACHE_TAGS.activity);
    await notifyPartner({ actorId, verb: "deleted", eventTitle: deleted.title });
  }
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
 *
 * Deliberately writes NO activity row (unlike every other mutation in this
 * file) — the cache-tag matrix (design decision 6) calls this out
 * explicitly: a pin/unpin is a personal triage flag flipped often and in
 * passing, and logging every toggle would swamp the feed with noise nobody
 * asked to see "who pinned/unpinned this" for.
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

/**
 * The recurring master a household owns, or null if it doesn't — wrong
 * household, unknown id, or (deliberately) a plain event/override with no
 * `repeatFreq`. Occurrence-level actions (delete/edit-this-occurrence) only
 * make sense against an actual master; without this check, a caller could
 * point `deleteOccurrence`/`editOccurrence` at a plain event's own id or at
 * an override row and either suppress it outright (no exdate applies to a
 * non-recurring row) or spawn an override-of-an-override, neither of which
 * `expandOccurrences` is built to represent.
 *
 * Selects `title` alongside `id` so `deleteOccurrence`/`editOccurrence` can
 * snapshot it straight into their own activity row without a second lookup.
 */
async function findOwnedMaster(householdId: string, eventId: string) {
  const [master] = await getDb()
    .select({ id: calendarEvents.id, title: calendarEvents.title })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.householdId, householdId),
        isNotNull(calendarEvents.repeatFreq),
      ),
    )
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
 *
 * `calendar-events` is busted unconditionally (a second tap is still a
 * legitimate re-render of an unchanged state, same as every other action
 * here), but the activity write is gated on `inserted.length > 0`: without
 * that gate, a double-tap (or a retried request) on an already-suppressed
 * occurrence would insert nothing yet still log a phantom "updated" row and
 * bust the activity tag for a no-op, unlike every sibling action in this
 * file, which only logs when its own write actually changed something.
 */
export async function deleteOccurrence(eventId: string, date: string): Promise<void> {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const master = await findOwnedMaster(householdId, eventId);
  if (!master) return;

  const inserted = await getDb()
    .insert(eventExdates)
    .values({ eventId, date })
    .onConflictDoNothing()
    .returning({ eventId: eventExdates.eventId });
  updateTag(CACHE_TAGS.calendarEvents);

  if (inserted.length === 0) return;

  // Mapped to "updated", not a dedicated occurrence-level verb: from the
  // feed's point of view an occurrence isn't an independent thing, it's one
  // date of the series, so suppressing it reads as a change to the series
  // (the cache-tag matrix, design decision 6) — logged against the master's
  // own id/title, not a synthetic id for the suppressed date.
  const actorId = await getCurrentUserId();
  await recordActivity({
    householdId,
    actorId,
    verb: "updated",
    eventId: master.id,
    eventTitle: master.title,
  });
  updateTag(CACHE_TAGS.activity);
  await notifyPartner({ actorId, verb: "updated", eventTitle: master.title, startDate: date });
}

/**
 * Edits one occurrence of a recurring master ("this event only" save)
 * without touching the master: it adds an exdate for the original date AND
 * upserts a standalone override row — a plain, non-recurring event carrying
 * `seriesId` (the master) and `originalDate` (the date it replaces). All
 * repeat* fields on the override are forced null regardless of what `input`
 * carries, because an override is never itself a series — the master keeps
 * its own recurrence untouched, and the sheet hides/ignores the repeat
 * controls in this mode anyway.
 *
 * The override write is an upsert (`onConflictDoUpdate` against the partial
 * unique index on `(seriesId, originalDate)`, db/schema.ts), not a plain
 * insert: two concurrent "edit this occurrence" calls for the same
 * master/date would otherwise both insert, producing two override rows (and
 * `expandOccurrences` would render the occurrence twice) instead of the
 * second edit replacing the first, which is what a household of two tapping
 * the same event at once would expect.
 *
 * No transaction wraps the exdate insert and the override upsert: the
 * neon-http driver Drizzle is configured with here has no session/
 * transaction support at all — `getDb().transaction()` throws "No
 * transactions support in neon-http driver" unconditionally — so these are
 * two sequential, best-effort-atomic writes rather than one atomic unit. The
 * exdate goes first deliberately, and the catch block below recovers if the
 * second write then fails: a stray exdate with no override would otherwise
 * hide the occurrence outright with nothing to show for it, whereas a stray
 * override with no exdate would leave the master generating a duplicate
 * occurrence on that date — the harder failure to notice and undo. Catching
 * the override write's failure and deleting the exdate it depended on
 * collapses back to "nothing happened" instead of either broken state.
 */
export async function editOccurrence(
  eventId: string,
  date: string,
  input: CalendarEventInput,
): Promise<{ error?: string }> {
  const householdId = await getHouseholdId();
  if (!householdId) return {};
  const master = await findOwnedMaster(householdId, eventId);
  if (!master) return {};

  const result = await normaliseEventInput(input);
  if (!result.ok) return { error: result.reason };
  const createdById = await getCurrentUserId();

  const overrideFields = {
    ...result.fields,
    repeatFreq: null,
    repeatInterval: 1,
    repeatWeekdays: null,
    repeatUntil: null,
  };

  await getDb().insert(eventExdates).values({ eventId, date }).onConflictDoNothing();

  try {
    await getDb()
      .insert(calendarEvents)
      .values({
        ...overrideFields,
        householdId,
        createdById,
        seriesId: eventId,
        originalDate: date,
      })
      .onConflictDoUpdate({
        target: [calendarEvents.seriesId, calendarEvents.originalDate],
        targetWhere: sql`${calendarEvents.seriesId} is not null`,
        // Only the editable fields — householdId/seriesId/originalDate say
        // WHICH override this is, not what it says, and stay put when a
        // second concurrent edit replaces the first.
        set: { ...overrideFields, updatedAt: new Date() },
      });
  } catch {
    // Best-effort cleanup: the exdate above already committed as its own
    // statement (this driver has no transactions to roll back), so a failed
    // override write would otherwise leave the occurrence suppressed with no
    // override in its place — worse than before this call ran. If this
    // delete itself fails there's nothing further to do; a retry is safe
    // either way (onConflictDoNothing on the exdate, onConflictDoUpdate on
    // the override).
    await getDb()
      .delete(eventExdates)
      .where(and(eq(eventExdates.eventId, eventId), eq(eventExdates.date, date)))
      .catch(() => {});
    updateTag(CACHE_TAGS.calendarEvents);
    return { error: "Could not save your changes — please try again." };
  }

  updateTag(CACHE_TAGS.calendarEvents);

  // Mapped to "updated" against the master's own id/title, same reasoning
  // as deleteOccurrence above — a series is the unit the feed talks about,
  // and the newly-saved title (not the master's, which this write never
  // touches) is what actually changed.
  await recordActivity({
    householdId,
    actorId: createdById,
    verb: "updated",
    eventId: master.id,
    eventTitle: result.fields.title,
  });
  updateTag(CACHE_TAGS.activity);
  await notifyPartner({
    actorId: createdById,
    verb: "updated",
    eventTitle: result.fields.title,
    startDate: result.fields.startDate,
  });

  return {};
}

/**
 * Deletes a recurring master outright ("whole series" delete). A series is
 * exactly its master row — the FK cascades on `event_exdates.event_id` and
 * `calendar_events.series_id` (both `onDelete: "cascade"`, see db/schema.ts)
 * take every override row and every exdate down with it in the same
 * statement, so deleting the series is just deleting the master.
 *
 * Delegating straight to `deleteCalendarEvent` also means "deleted" activity
 * is logged exactly once, against the master — the cascaded override rows
 * (if the series ever had any) get no activity rows of their own, matching
 * the cache-tag matrix's single `deleteCalendarEvent`/`deleteSeries →
 * "deleted"` mapping rather than one row per override.
 */
export async function deleteSeries(eventId: string): Promise<void> {
  await deleteCalendarEvent(eventId);
}

/**
 * Adds a comment to an event's thread (PR 7's "event comments" — text only,
 * deliberately not "chat"). The event is re-checked against this household
 * before anything is written, the same defence-in-depth every other action
 * here applies to its own `id` argument: a stale or foreign id must not
 * create an orphaned comment/activity pair for an event the caller can't
 * even see.
 */
export async function addComment(
  eventId: string,
  body: string,
): Promise<{ error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: "Comment can't be empty." };
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return { error: `Comments are capped at ${MAX_COMMENT_LENGTH} characters.` };
  }

  const householdId = await getHouseholdId();
  if (!householdId) return {};

  const [event] = await getDb()
    .select({ id: calendarEvents.id, title: calendarEvents.title, startDate: calendarEvents.startDate })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.householdId, householdId)))
    .limit(1);
  if (!event) return { error: "This event no longer exists." };

  const authorId = await getCurrentUserId();
  await getDb().insert(eventComments).values({ eventId, authorId, body: trimmed });
  updateTag(CACHE_TAGS.eventComments);

  await recordActivity({
    householdId,
    actorId: authorId,
    verb: "commented",
    eventId,
    eventTitle: event.title,
  });
  updateTag(CACHE_TAGS.activity);
  await notifyPartner({
    actorId: authorId,
    verb: "commented",
    eventTitle: event.title,
    startDate: event.startDate,
  });

  return {};
}

/**
 * Marks the activity feed "seen" up to `latestCreatedAt` — the max
 * `created_at` of the rows the client actually rendered when it opened the
 * feed, deliberately NOT `now()`: a row that lands between the client's
 * fetch and the tap that calls this must stay unseen, which stamping the
 * current instant would wrongly clear (design decision 5 of the
 * shared-calendar plan). Busts the activity tag so every reader's next
 * render recomputes the badge against the new `activity_seen_at` — cheap,
 * since `getCurrentUserActivitySeenAt` (lib/queries.ts) was never cached in
 * the first place.
 *
 * Best-effort, same trade-off as `recordActivity` above: the client has
 * already optimistically cleared its own badge by the time this runs
 * (calendar-events.tsx), so a transient failure here just means the badge
 * reappears on the next server read instead of staying cleared — annoying,
 * never wrong, and not worth surfacing as a visible error over what the
 * user experiences as merely opening a read-only feed.
 */
export async function markActivitySeen(latestCreatedAt: Date): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  try {
    await getDb().update(users).set({ activitySeenAt: latestCreatedAt }).where(eq(users.id, userId));
    updateTag(CACHE_TAGS.activity);
  } catch {
    // Best-effort — see the doc comment above.
  }
}
