import { addDays, format, parseISO } from "date-fns";
import type { CalendarEvent } from "@/db/schema";
import type { Exdate } from "@/lib/recurrence";

/**
 * Pure ICS (RFC 5545) generator for the outbound calendar-subscription feed
 * (plan PR 10). Takes the exact raw rows the app stores — `calendar_events`
 * masters, plain events and override rows, plus `event_exdates` — and
 * renders one VCALENDAR text blob a native phone calendar can subscribe to.
 *
 * Hand-rolled rather than a dependency: the surface this app needs (a fixed
 * small RRULE vocabulary, no timezones, no attendees) is small enough that a
 * library would buy little beyond what this file and its tests already
 * prove — see the shared-calendar plan's PR 10 scope, which forbids adding
 * one to package.json for exactly this reason.
 *
 * Every timestamp is a "floating" local time — no trailing Z, no TZID — per
 * ADR 0006: the household runs on one device timezone, so there is nothing
 * to declare, and a floating time is read by the subscribing calendar app in
 * ITS OWN local zone, which is exactly right for a household that never
 * travels mid-event. DTSTAMP is the one exception RFC 5545 carves out: it
 * MUST always be UTC regardless of DTSTART's form, so it alone carries a Z.
 */

const ISO_DATE = "yyyy-MM-dd";
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

type RepeatFreq = NonNullable<CalendarEvent["repeatFreq"]>;

const FREQ_CODES: Record<RepeatFreq, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parsed HH:MM[:SS] pieces of a Postgres `time` column's string value. */
function parseTime(value: string): { h: number; m: number; s: number } {
  const [h, m, s] = value.split(":").map(Number);
  return { h, m: m || 0, s: s || 0 };
}

/** "YYYY-MM-DD" -> "YYYYMMDD". */
function dateStamp(iso: string): string {
  return iso.replaceAll("-", "");
}

/** A date plus a parsed time -> floating local "YYYYMMDDTHHMMSS". */
function formatFloatingDateTime(iso: string, time: { h: number; m: number; s: number }): string {
  return `${dateStamp(iso)}T${pad(time.h)}${pad(time.m)}${pad(time.s)}`;
}

/** "YYYY-MM-DD" + "HH:MM[:SS]" -> floating local "YYYYMMDDTHHMMSS". */
function dateTimeStamp(iso: string, timeValue: string): string {
  return formatFloatingDateTime(iso, parseTime(timeValue));
}

/**
 * `iso` plus `days` calendar days, as "YYYY-MM-DD". Calendar-date maths
 * only — mirrors lib/recurrence.ts's own comment: `parseISO` on a bare date
 * string parses local midnight, and `addDays`/`format` never touch a time
 * component, so no timezone offset is introduced or needs to cancel out.
 */
function addDaysIso(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), ISO_DATE);
}

/**
 * `time` plus exactly one floating hour, rolling into the next calendar day
 * at 24:00 with plain integer arithmetic rather than a real `Date` — a
 * floating time has no zone to hand to `Date`, and routing it through the
 * host's real, DST-observing local zone could land on the wrong wall-clock
 * hour across a change nobody involved is actually crossing.
 */
function addFloatingHour(
  iso: string,
  time: { h: number; m: number; s: number },
): { iso: string; time: { h: number; m: number; s: number } } {
  const h = time.h + 1;
  return h >= 24 ? { iso: addDaysIso(iso, 1), time: { ...time, h: h - 24 } } : { iso, time: { ...time, h } };
}

/** RFC 5545 3.3.11 text escaping. Backslash MUST be escaped first, or the
 * backslashes this function adds for `;`/`,`/`\n` would themselves get
 * doubled by a backslash pass that ran after them. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const MAX_OCTETS = 75;

/**
 * Folds one logical property line to RFC 5545 3.1's 75-octet physical-line
 * limit. A continuation line opens with a single space, which itself counts
 * against that line's own 75-octet budget, so each continuation carries at
 * most 74 octets of content. Splits land on UTF-8 character boundaries —
 * never mid-sequence — by backing off while the next byte is a UTF-8
 * continuation byte (top bits `10`).
 */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_OCTETS) return line;

  const decoder = new TextDecoder();
  const segments: string[] = [];
  let start = 0;
  let budget = MAX_OCTETS;
  while (start < bytes.length) {
    let end = Math.min(start + budget, bytes.length);
    while (end > start + 1 && (bytes[end] & 0xc0) === 0x80) end--;
    segments.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    budget = MAX_OCTETS - 1; // a continuation line loses one octet to its leading space
  }
  return segments.join("\r\n ");
}

function textLine(name: string, value: string, params: Record<string, string> = {}): string {
  const paramStr = Object.entries(params)
    .map(([k, v]) => `;${k}=${v}`)
    .join("");
  return `${name}${paramStr}:${value}`;
}

/** RFC 5545 requires DTSTAMP in UTC regardless of DTSTART's form; sourced
 * from the row's own `createdAt`, never `Date.now()`, so this stays pure. */
function toUtcStamp(createdAt: Date): string {
  return createdAt.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildRrule(
  repeatFreq: RepeatFreq,
  repeatInterval: number,
  repeatWeekdays: number[] | null,
  repeatUntil: string | null,
  startTime: string | null,
): string {
  const parts = [`FREQ=${FREQ_CODES[repeatFreq]}`];
  if (repeatInterval > 1) parts.push(`INTERVAL=${repeatInterval}`);

  if (repeatFreq === "weekly" && repeatWeekdays?.length) {
    const days = [...repeatWeekdays].sort((a, b) => a - b).map((d) => WEEKDAY_CODES[d]);
    parts.push(`BYDAY=${days.join(",")}`);
  }

  if (repeatUntil) {
    // UNTIL must share DTSTART's value type (RFC 5545 3.3.10), and because
    // DTSTART here is always a floating local time, never UTC, UNTIL must be
    // floating too — no trailing Z. Using `repeatUntil` itself, rather than
    // computing the true final occurrence (which lib/recurrence.ts's
    // monthly/yearly short-month skip can land earlier than this date), is
    // always >= the last real occurrence — same start time, same or earlier
    // date — so it bounds the series correctly without duplicating that
    // skip logic here. A calendar app trims to the same real occurrences
    // either way; UNTIL only needs to not cut any of them off early.
    parts.push(`UNTIL=${startTime === null ? dateStamp(repeatUntil) : dateTimeStamp(repeatUntil, startTime)}`);
  }

  return parts.join(";");
}

/** UID + DTSTAMP + DTSTART/DTEND + SUMMARY/LOCATION/DESCRIPTION [+ RRULE/EXDATE] for one row. */
function buildVevent(event: CalendarEvent, exdatesForEvent: Exdate[]): string[] {
  const lines: string[] = [
    "BEGIN:VEVENT",
    textLine("UID", `${event.id}@homesync`),
    textLine("DTSTAMP", toUtcStamp(event.createdAt)),
  ];

  const { startTime } = event;
  if (startTime === null) {
    // All-day: DTEND is exclusive per RFC 5545 (the classic all-day shift
    // bug is treating it as inclusive) — a single-day event's exclusive end
    // is startDate + 1 day, and a multi-day event's is endDate + 1 day, so
    // both are just "whichever date is later, plus one day".
    const effectiveEnd = event.endDate ?? event.startDate;
    lines.push(textLine("DTSTART", dateStamp(event.startDate), { VALUE: "DATE" }));
    lines.push(textLine("DTEND", dateStamp(addDaysIso(effectiveEnd, 1)), { VALUE: "DATE" }));
  } else {
    lines.push(textLine("DTSTART", dateTimeStamp(event.startDate, startTime)));
    if (event.endTime) {
      // endTime belongs to (endDate ?? startDate) per ADR 0006's
      // cross-midnight rule — this is the same anchor the server actions
      // validate against, just read back out rather than enforced here.
      const effectiveEndDate = event.endDate ?? event.startDate;
      lines.push(textLine("DTEND", dateTimeStamp(effectiveEndDate, event.endTime)));
    } else {
      // No end time at all: a flat one-hour block from the start, per the
      // PR 10 spec — deliberately ignores endDate in this branch (an event
      // with a start time but no end time is a point-in-time reminder, not
      // a multi-day span).
      const rolled = addFloatingHour(event.startDate, parseTime(startTime));
      lines.push(textLine("DTEND", formatFloatingDateTime(rolled.iso, rolled.time)));
    }
  }

  lines.push(textLine("SUMMARY", escapeText(event.title)));
  if (event.location) lines.push(textLine("LOCATION", escapeText(event.location)));

  const descriptionParts = [event.notes, event.url].filter((v): v is string => Boolean(v));
  if (descriptionParts.length) {
    lines.push(textLine("DESCRIPTION", escapeText(descriptionParts.join("\n"))));
  }

  // `repeatFreq` null covers BOTH plain events and override rows (`seriesId`
  // set): an override is a standalone occurrence that the app's own
  // editOccurrence action (app/calendar/actions.ts) already exdated out of
  // its master in the same operation that created it, so it needs no
  // RRULE/EXDATE of its own here — it renders as an ordinary one-off VEVENT
  // under its own id, exactly like a plain non-recurring event.
  if (event.repeatFreq) {
    lines.push(
      textLine(
        "RRULE",
        buildRrule(event.repeatFreq, event.repeatInterval, event.repeatWeekdays, event.repeatUntil, startTime),
      ),
    );
    for (const exdate of exdatesForEvent) {
      lines.push(
        startTime === null
          ? textLine("EXDATE", dateStamp(exdate.date), { VALUE: "DATE" })
          : textLine("EXDATE", dateTimeStamp(exdate.date, startTime)),
      );
    }
  }

  lines.push("END:VEVENT");
  return lines;
}

/**
 * Renders `events` (and their `exdates`) as a complete VCALENDAR text blob,
 * CRLF-terminated throughout per RFC 5545. `events` is the household's whole
 * set of rows — masters, plain events, and overrides mixed together exactly
 * as read from the database — not a windowed slice: a subscribed native
 * calendar wants history too, and a recurring master stays a single VEVENT
 * with an RRULE regardless of how far it has run, so there is no
 * window-driven blow-up to bound here the way the app's own read window
 * bounds `expandOccurrences`.
 */
export function buildCalendarFeed(events: CalendarEvent[], exdates: Exdate[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HomeSync//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:HomeSync",
  ];

  for (const event of events) {
    const exdatesForEvent = exdates.filter((x) => x.eventId === event.id);
    lines.push(...buildVevent(event, exdatesForEvent));
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
