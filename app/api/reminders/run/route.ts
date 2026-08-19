import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, eventExdates, households, reminderLog, users } from "@/db/schema";
import { dueReminders } from "@/lib/reminder-instants";
import { sendPushToUsers } from "@/lib/push";

/**
 * Reminder sender (PR 8; ADR 0009), invoked every 5 minutes by an external
 * pinger (e.g. cron-job.org) sending `Authorization: Bearer <CRON_SECRET>` —
 * NEVER by a `crons` entry in vercel.json. The deployment is on Vercel
 * Hobby, where Hobby crons only fire once a day with hour-level imprecision,
 * and a sub-daily crons entry there fails the ENTIRE deployment (plan design
 * decision 7) — this route exists to be pollable from outside instead.
 *
 * This route must NEVER declare `runtime = "edge"`: `web-push` needs Node's
 * crypto/https built-ins, which the edge runtime doesn't provide. Leaving
 * the runtime unset (as below) defaults to Node, which is exactly what this
 * needs.
 */
export const dynamic = "force-dynamic";

/**
 * SHA-256 digest of a string. Hashing both sides before comparing means a
 * length mismatch between the raw provided/expected secrets can never
 * short-circuit the comparison before it reaches `timingSafeEqual` — mirrors
 * app/api/calendar.ics's own `hash`/`tokenMatches` pair exactly (duplicated
 * rather than shared, matching that route's own precedent of not extracting
 * this into a shared helper for a single other caller).
 */
function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(hash(provided), hash(expected));
}

/** "10 minutes" / "1 hour" / "1 day" — the lead-time phrase for a timed reminder's push text. */
function formatLeadTime(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * GET /api/reminders/run
 *
 * `Authorization: Bearer <CRON_SECRET>` is this route's whole
 * authentication, same reasoning as app/api/calendar.ics's `?token=`: a
 * missing secret, a missing header, or a mismatched one all answer 404
 * rather than 401, so an unauthenticated prober can't even confirm this
 * path exists.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!expected || !provided || !tokenMatches(provided, expected)) {
    return new Response("Not found.", { status: 404 });
  }

  const db = getDb();

  // Direct reads, no unstable_cache — a 5-minutely tick has no navigation
  // hit rate to protect, and this route's own freshness must never be tied
  // to an unrelated page's cache-tag timing (same reasoning as
  // app/api/calendar.ics's own direct reads).
  const [household] = await db.select().from(households).limit(1);
  if (!household) {
    return Response.json({ due: 0, sent: 0 });
  }

  const [events, exdates, members] = await Promise.all([
    // Only events with a reminder actually set — the sender has nothing to
    // do with the rest of the household's events.
    db
      .select()
      .from(calendarEvents)
      .where(
        and(eq(calendarEvents.householdId, household.id), isNotNull(calendarEvents.reminderMinutes)),
      ),
    // event_exdates carries no household_id of its own, so the join back to
    // calendar_events is the household scope (same pattern as
    // lib/queries.ts's selectCalendarWindow).
    db
      .select({ eventId: eventExdates.eventId, date: eventExdates.date })
      .from(eventExdates)
      .innerJoin(calendarEvents, eq(eventExdates.eventId, calendarEvents.id))
      .where(eq(calendarEvents.householdId, household.id)),
    db.select({ id: users.id }).from(users).where(eq(users.householdId, household.id)),
  ]);

  const due = dueReminders(events, exdates, household.timezone, new Date());
  const memberIds = members.map((m) => m.id);

  let sent = 0;
  for (const reminder of due) {
    // Insert-before-send: only the tick whose insert actually lands a NEW
    // row gets to push (onConflictDoNothing + returning, the same
    // idempotency pattern deleteOccurrence uses for event_exdates in
    // app/calendar/actions.ts) — makes overlapping or retried 5-minute ticks
    // for the same occurrence race-free instead of double-notifying, and
    // makes a late catch-up tick recognise an occurrence it already sent.
    const inserted = await db
      .insert(reminderLog)
      .values({ eventId: reminder.event.id, occurrenceDate: reminder.occurrenceDate })
      .onConflictDoNothing()
      .returning({ eventId: reminderLog.eventId });
    if (inserted.length === 0) continue;

    const allDay = !reminder.event.startTime;
    const minutes = reminder.event.reminderMinutes ?? 0;
    const title = allDay
      ? `${reminder.event.title} today`
      : minutes <= 0
        ? `${reminder.event.title} is starting`
        : `${reminder.event.title} in ${formatLeadTime(minutes)}`;

    // Household-wide delivery: every member gets the push, not just the
    // event's own attendee subset — a shared calendar's reminders are a
    // shared concern (plan design decision, PR 8 scope).
    await sendPushToUsers(memberIds, {
      title,
      body: reminder.event.location ?? "",
      url: `/calendar?m=${reminder.occurrenceDate.slice(0, 7)}`,
    });
    sent += 1;
  }

  return Response.json({ due: due.length, sent });
}
