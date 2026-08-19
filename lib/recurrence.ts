import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  format,
  getDate,
  getDay,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarEvent } from "@/db/schema";

/**
 * Pure recurrence expansion for the shared calendar.
 *
 * This module is isomorphic: it runs unchanged in client components (from
 * `useOptimistic` state) and in server code, and it must NEVER be called
 * from inside an `unstable_cache`'d function. The read-time cache holds raw
 * rows only, keyed by `(householdId, windowStart, windowEnd)`; the window is
 * always an argument here, never derived from `Date.now()` inside this file,
 * or "today" would freeze into whichever cache entry first computed it (see
 * design decision 2 in the shared-calendar plan).
 *
 * All date maths below happens on calendar dates, not instants. Dates are
 * plain "YYYY-MM-DD" strings, compared lexicographically (which sorts
 * chronologically for a fixed-width ISO date) wherever a plain comparison
 * will do. Where date-fns arithmetic is needed (adding days/weeks/months),
 * `parseISO` on a bare "YYYY-MM-DD" string parses it as local midnight
 * (unlike `new Date(str)`, which treats it as UTC midnight) and every value
 * that touches a `Date` object round-trips through the same local-time
 * parse/format pair, so no timezone offset is ever introduced or needs to
 * cancel out.
 */

const ISO_FORMAT = "yyyy-MM-dd";

/**
 * Structural recurrence columns. PR 4 adds these to `calendar_events` and
 * `event_exdates`; declaring them here (rather than importing from the
 * schema) lets this pure library, its tests, and the views built against it
 * land before the schema does — the real columns will structurally satisfy
 * this type when they arrive.
 */
export type RecurrenceFields = {
  repeatFreq?: "daily" | "weekly" | "monthly" | "yearly" | null;
  repeatInterval?: number | null;
  repeatWeekdays?: number[] | null;
  repeatUntil?: string | null;
  seriesId?: string | null;
  originalDate?: string | null;
};

export type ExpandableEvent = CalendarEvent & RecurrenceFields;

/** One row of `event_exdates`: a date on which `eventId`'s occurrence is suppressed. */
export type Exdate = { eventId: string; date: string };

export type Occurrence = {
  event: ExpandableEvent;
  date: string;
  endDate: string | null;
  isOverride: boolean;
  key: string;
};

function toISO(date: Date): string {
  return format(date, ISO_FORMAT);
}

function minISO(a: string, b: string): string {
  return a < b ? a : b;
}

function maxISO(a: string, b: string): string {
  return a > b ? a : b;
}

/** Calendar days between a master's start and end, or 0 with no end date. */
function spanDays(event: ExpandableEvent): number {
  if (!event.endDate) return 0;
  return differenceInCalendarDays(parseISO(event.endDate), parseISO(event.startDate));
}

/** An occurrence's end date given its own start and the master's span, or null for a single day. */
function occurrenceEndDate(startISO: string, span: number): string | null {
  if (span <= 0) return null;
  return toISO(addDays(parseISO(startISO), span));
}

/** Whether [start, end ?? start] intersects the inclusive [windowStart, windowEnd] range. */
function overlapsWindow(
  startISO: string,
  endISO: string | null,
  windowStart: string,
  windowEnd: string,
): boolean {
  const effectiveEnd = endISO ?? startISO;
  return startISO <= windowEnd && effectiveEnd >= windowStart;
}

/** Daily occurrence start dates, stepped by `interval` days, from `startISO` through `until` inclusive. */
function dailyDates(startISO: string, interval: number, earliestNeeded: string, until: string): string[] {
  const start = parseISO(startISO);
  const diff = differenceInCalendarDays(parseISO(earliestNeeded), start);
  // Fast-forward past whole cycles that land before what's needed, stepping
  // back one extra cycle as a safety margin — a long-running daily/weekly
  // event should not require walking day-by-day from years ago to reach the
  // read window.
  const skip = diff > 0 ? Math.max(0, Math.floor(diff / interval) - 1) : 0;

  const dates: string[] = [];
  let cursor = addDays(start, skip * interval);
  let cursorISO = toISO(cursor);
  while (cursorISO <= until) {
    dates.push(cursorISO);
    cursor = addDays(cursor, interval);
    cursorISO = toISO(cursor);
  }
  return dates;
}

/**
 * Weekday numbers come straight off a DB column with no CHECK constraint, so
 * an out-of-range value (a bad write, or a future looser column) must not
 * silently shift a date onto the wrong day (7 -> the following Sunday via
 * plain `addDays`, -1 -> the prior Saturday) — filter to the valid 0-6 range
 * and fall back to the start date's own weekday if nothing valid remains.
 */
export function normaliseWeekdays(weekdays: number[] | null | undefined, start: Date): number[] {
  const valid = weekdays ? [...new Set(weekdays)].filter((w) => w >= 0 && w <= 6) : [];
  return valid.length ? valid.sort((a, b) => a - b) : [getDay(start)];
}

/**
 * Weekly occurrence start dates. `weekdays` are JS `getDay()` numbers
 * (0 = Sunday); an empty/absent/invalid set falls back to the start date's
 * own weekday. Weeks are anchored to the Sunday on/before the start date so a
 * weekday set spanning the week boundary (e.g. Sunday and Friday together)
 * still steps by whole `interval`-week cycles rather than drifting.
 */
function weeklyDates(
  startISO: string,
  interval: number,
  weekdays: number[] | null | undefined,
  earliestNeeded: string,
  until: string,
): string[] {
  const start = parseISO(startISO);
  const days = normaliseWeekdays(weekdays, start);
  const anchorWeekStart = startOfWeek(start, { weekStartsOn: 0 });

  const diffWeeks = differenceInCalendarWeeks(parseISO(earliestNeeded), anchorWeekStart, { weekStartsOn: 0 });
  const skipCycles = diffWeeks > 0 ? Math.max(0, Math.floor(diffWeeks / interval) - 1) : 0;

  const dates: string[] = [];
  let weekStart = addWeeks(anchorWeekStart, skipCycles * interval);
  while (toISO(weekStart) <= until) {
    for (const weekday of days) {
      const d = toISO(addDays(weekStart, weekday));
      // The anchor week can contain weekdays before the series actually
      // starts (e.g. start date is Wednesday, weekday set includes Monday);
      // those never happened, so they are dropped rather than emitted.
      if (d >= startISO && d <= until) dates.push(d);
    }
    weekStart = addWeeks(weekStart, interval);
  }
  return dates;
}

/**
 * Shared monthly/yearly stepper: walks `stepMonths` at a time from the start
 * date's month, placing the same day-of-month each cycle. date-fns'
 * `addMonths` clamps an overflowing day to the last day of the resulting
 * month (Jan 31 + 1 month -> Feb 28), which is the wrong semantics here — a
 * 31st must be SKIPPED in a short month, never shifted to the 30th — so the
 * day is only placed by hand once the target month is confirmed long enough.
 * Stepping yearly by exactly 12 months keeps the month fixed and only the
 * year moves, so this same day-fits-this-month check also implements
 * "29 Feb only in leap years" with no separate leap-year branch.
 */
function monthlyStepDates(
  startISO: string,
  stepMonths: number,
  earliestNeeded: string,
  until: string,
): string[] {
  const start = parseISO(startISO);
  const dayOfMonth = getDate(start);
  const anchor = startOfMonth(start);

  const diffMonths = differenceInCalendarMonths(startOfMonth(parseISO(earliestNeeded)), anchor);
  const skipCycles = diffMonths > 0 ? Math.max(0, Math.floor(diffMonths / stepMonths) - 1) : 0;

  const dates: string[] = [];
  let monthAnchor = addMonths(anchor, skipCycles * stepMonths);
  while (toISO(monthAnchor) <= until) {
    if (getDaysInMonth(monthAnchor) >= dayOfMonth) {
      const d = toISO(addDays(monthAnchor, dayOfMonth - 1));
      if (d >= startISO && d <= until) dates.push(d);
    }
    monthAnchor = addMonths(monthAnchor, stepMonths);
  }
  return dates;
}

/** Candidate occurrence start dates for a recurring master, already clipped to the window and `repeatUntil`. */
function expandMasterDates(event: ExpandableEvent, windowStart: string, windowEnd: string): string[] {
  const interval = Math.max(1, event.repeatInterval ?? 1);
  const until = event.repeatUntil ? minISO(event.repeatUntil, windowEnd) : windowEnd;
  if (event.startDate > until) return [];

  const span = spanDays(event);
  // A multi-day master can start before the window and still have its tail
  // land inside it, so generation must reach back far enough to catch that —
  // but never earlier than the master's own start, which bounds it below.
  // The padding itself is clamped to 0: a negative span (endDate before
  // startDate, which nothing in the schema forbids) must not flip this into
  // padding *forward*, which would fast-forward straight past a window that
  // starts right at the master's own start date.
  const earliestNeeded = maxISO(event.startDate, toISO(addDays(parseISO(windowStart), -Math.max(0, span))));

  const candidates =
    event.repeatFreq === "daily"
      ? dailyDates(event.startDate, interval, earliestNeeded, until)
      : event.repeatFreq === "weekly"
        ? weeklyDates(event.startDate, interval, event.repeatWeekdays, earliestNeeded, until)
        : event.repeatFreq === "monthly"
          ? monthlyStepDates(event.startDate, interval, earliestNeeded, until)
          : event.repeatFreq === "yearly"
            ? monthlyStepDates(event.startDate, interval * 12, earliestNeeded, until)
            : []; // unrecognised repeatFreq (no DB constraint guarantees the enum) -> no occurrences, never a silent guess

  return candidates.filter((d) => {
    if (d < event.startDate || d > until) return false;
    return overlapsWindow(d, occurrenceEndDate(d, span), windowStart, windowEnd);
  });
}

/** Stable sort: date, then all-day before timed (null `startTime` first), then start time, then title. */
function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;

  const aTime = a.event.startTime;
  const bTime = b.event.startTime;
  if (aTime === null && bTime !== null) return -1;
  if (aTime !== null && bTime === null) return 1;
  if (aTime !== null && bTime !== null && aTime !== bTime) return aTime < bTime ? -1 : 1;

  if (a.event.title !== b.event.title) return a.event.title < b.event.title ? -1 : 1;
  return 0;
}

/**
 * Expand a set of raw event rows (masters, plain events, and override rows
 * all mixed together, exactly as read from the database) into concrete
 * occurrences overlapping the inclusive `[windowStart, windowEnd]` range of
 * "YYYY-MM-DD" dates.
 *
 * - A non-recurring row (`repeatFreq` null/absent) passes through as a
 *   single identity occurrence when its span overlaps the window. This
 *   covers both ordinary events and override rows — an override is just an
 *   ordinary row at its own (possibly moved) date, flagged `isOverride` by
 *   carrying both `seriesId` and `originalDate`.
 * - A recurring master expands per its frequency/interval/weekday set,
 *   bounded by `repeatUntil` (inclusive) and the window.
 * - `exdates` suppress a specific `(eventId, date)` pair regardless of
 *   whether that occurrence came from series expansion or identity
 *   pass-through. The edit-occurrence action inserts an exdate for the
 *   master at the original date in the same operation that inserts the
 *   override row, so in the steady state exactly one of "the master's
 *   generated occurrence" or "the override's own occurrence" is ever
 *   suppressed for a given date — never both, and never neither. Because
 *   the exdate is keyed to the master's id and the override is a different
 *   row with a different id, the override is untouched by its own master's
 *   exdate; a final dedupe-by-key below is just cheap insurance against a
 *   caller ever supplying a duplicate that would otherwise double-emit.
 */
export function expandOccurrences(
  events: ExpandableEvent[],
  exdates: Exdate[],
  windowStart: string,
  windowEnd: string,
): Occurrence[] {
  const suppressed = new Set(exdates.map((x) => `${x.eventId}:${x.date}`));
  const byKey = new Map<string, Occurrence>();

  for (const event of events) {
    const isOverride = Boolean(event.seriesId && event.originalDate);

    if (!event.repeatFreq) {
      // Route through the same span-to-endDate normalisation as the
      // recurring branch (below) so a row with endDate < startDate — nothing
      // in the schema forbids it — clamps to null here too, instead of
      // producing an occurrence that overlapsWindow() and occursOnDay() then
      // disagree about.
      const endDate = occurrenceEndDate(event.startDate, spanDays(event));
      if (!overlapsWindow(event.startDate, endDate, windowStart, windowEnd)) continue;
      const key = `${event.id}:${event.startDate}`;
      if (suppressed.has(key)) continue;
      byKey.set(key, {
        event,
        date: event.startDate,
        endDate,
        isOverride,
        key,
      });
      continue;
    }

    const span = spanDays(event);
    for (const date of expandMasterDates(event, windowStart, windowEnd)) {
      const key = `${event.id}:${date}`;
      if (suppressed.has(key)) continue;
      byKey.set(key, {
        event,
        date,
        endDate: occurrenceEndDate(date, span),
        isOverride,
        key,
      });
    }
  }

  return Array.from(byKey.values()).sort(compareOccurrences);
}

/** Whether an occurrence's span (its date through `endDate ?? date`) includes the given "YYYY-MM-DD" day. */
export function occursOnDay(occurrence: Occurrence, day: string): boolean {
  return occurrence.date <= day && (occurrence.endDate ?? occurrence.date) >= day;
}
