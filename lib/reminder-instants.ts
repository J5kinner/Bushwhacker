import { addDays, format, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { expandOccurrences, type Exdate, type ExpandableEvent } from "./recurrence.ts";

/**
 * Pure reminder maths for the shared calendar (PR 8; ADR 0009): converts a
 * wall-clock reminder anchor into a concrete UTC instant, and expands the
 * household's events into the occurrences whose reminder is due right now.
 *
 * Like lib/recurrence.ts, this module is pure and takes `now` as a parameter
 * rather than reading `Date.now()` internally, so it is fully unit-testable
 * (including the October daylight-saving transition) and so the sender route
 * (app/api/reminders/run/route.ts) is the only place that ever touches the
 * real clock.
 */

const ISO_FORMAT = "yyyy-MM-dd";
const MINUTE_MS = 60_000;
const CATCH_UP_MS = 24 * 60 * 60_000;

/**
 * "YYYY-MM-DD" for `instant` as read in `timezone` — via the native `Intl`
 * API, not `date-fns-tz`, because this only needs the calendar DATE (never a
 * wall-clock time), and `Intl.DateTimeFormat` resolves that correctly
 * regardless of the runtime's own timezone (Vercel's UTC included) with no
 * extra `Date` round-trip. `en-CA` is the one built-in locale whose short
 * date format is already the ISO "YYYY-MM-DD" order.
 */
function localDateISO(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The UTC instant a reminder fires for one occurrence.
 *
 * The wall-clock anchor is the occurrence's own `startTime` for a timed
 * event, or local midnight (00:00) for an all-day one (see db/schema.ts's
 * `reminderMinutes` comment); `reminderMinutes` is then subtracted from that
 * anchor, so a NEGATIVE value (the all-day "morning of"/"day before" presets
 * in the event sheet) fires AFTER the anchor.
 *
 * `fromZonedTime` (date-fns-tz) is what actually resolves `timezone`'s real
 * UTC offset for this specific calendar date — never a fixed numeric offset,
 * which would silently be wrong by an hour either side of the household's
 * October daylight-saving transition.
 */
export function reminderInstant(
  occurrence: { date: string; event: Pick<ExpandableEvent, "startTime"> },
  reminderMinutes: number,
  timezone: string,
): Date {
  const anchorTime = occurrence.event.startTime ?? "00:00:00";
  const anchor = fromZonedTime(`${occurrence.date}T${anchorTime}`, timezone);
  return new Date(anchor.getTime() - reminderMinutes * MINUTE_MS);
}

export interface DueReminder {
  event: ExpandableEvent;
  occurrenceDate: string;
  instant: Date;
}

/**
 * Every occurrence whose reminder instant has arrived by `now` and within
 * the trailing 24-hour catch-up window: `instant <= now && instant >= now -
 * 24h`. The lower bound means a sender outage (the external 5-minute pinger
 * missing a beat) still fires reminders it missed instead of skipping them
 * silently forever; the upper bound stops a reminder from ever firing days
 * late once the outage is longer than that.
 *
 * Expands occurrences over a window from yesterday through tomorrow+1 in the
 * HOUSEHOLD's own calendar day (not the server's UTC one, which can already
 * be a different day from an Australian morning) — wide enough to catch
 * every occurrence whose reminder could land in the 24h catch-up window
 * given the offsets this app's own reminder picker ever produces, while
 * staying cheap enough to expand on every 5-minute tick. Only events with
 * `reminderMinutes` set are considered; `exdates` suppress an occurrence the
 * same way they do everywhere else `expandOccurrences` runs.
 */
export function dueReminders(
  events: ExpandableEvent[],
  exdates: Exdate[],
  timezone: string,
  now: Date,
): DueReminder[] {
  const today = localDateISO(now, timezone);
  const windowStart = format(addDays(parseISO(today), -1), ISO_FORMAT);
  const windowEnd = format(addDays(parseISO(today), 2), ISO_FORMAT);

  const occurrences = expandOccurrences(events, exdates, windowStart, windowEnd);
  const due: DueReminder[] = [];

  for (const occurrence of occurrences) {
    const reminderMinutes = occurrence.event.reminderMinutes;
    if (reminderMinutes === null || reminderMinutes === undefined) continue;

    const instant = reminderInstant(occurrence, reminderMinutes, timezone);
    const diffMs = now.getTime() - instant.getTime();
    if (diffMs >= 0 && diffMs <= CATCH_UP_MS) {
      due.push({ event: occurrence.event, occurrenceDate: occurrence.date, instant });
    }
  }

  return due;
}
