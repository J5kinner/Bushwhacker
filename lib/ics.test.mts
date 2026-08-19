import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarFeed } from "./ics.ts";
import type { CalendarEvent } from "@/db/schema";
import type { Exdate } from "./recurrence.ts";

let nextId = 1;

/** A fully-populated event row with sensible defaults, overridable per test. */
function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const id = overrides.id ?? `event-${nextId++}`;
  return {
    id,
    householdId: "household-1",
    title: "Event",
    startDate: "2026-08-18",
    endDate: null,
    notes: null,
    createdById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    location: null,
    url: null,
    colour: null,
    attendeeIds: null,
    pinned: false,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    repeatFreq: null,
    repeatInterval: 1,
    repeatWeekdays: null,
    repeatUntil: null,
    seriesId: null,
    originalDate: null,
    ...overrides,
  };
}

/** Lines of a feed built from a single event, split on the real CRLF separator. */
function feedLines(event: CalendarEvent, exdates: Exdate[] = []): string[] {
  return buildCalendarFeed([event], exdates).split("\r\n");
}

test("wraps events in a VCALENDAR header with the required properties", () => {
  const lines = feedLines(makeEvent());
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0"));
  assert.ok(lines.includes("PRODID:-//HomeSync//Calendar Feed//EN"));
  assert.ok(lines.includes("CALSCALE:GREGORIAN"));
  assert.ok(lines.includes("X-WR-CALNAME:HomeSync"));
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.equal(lines.at(-1), ""); // trailing CRLF after the final line
});

test("UID and DTSTAMP: UID from the row id, DTSTAMP from updatedAt in UTC (never Date.now())", () => {
  const lines = feedLines(makeEvent({ id: "abc-123", updatedAt: new Date("2026-08-18T09:15:30.500Z") }));
  assert.ok(lines.includes("UID:abc-123@homesync"));
  assert.ok(lines.includes("DTSTAMP:20260818T091530Z"));
});

test("all-day single-day event: DTEND is the start date plus one day (exclusive end)", () => {
  const lines = feedLines(makeEvent({ startDate: "2026-08-18", endDate: null, startTime: null }));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20260818"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20260819"));
});

test("multi-day all-day event: DTEND is the end date plus one day (exclusive end)", () => {
  const lines = feedLines(makeEvent({ startDate: "2026-08-18", endDate: "2026-08-20", startTime: null }));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20260818"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20260821"));
});

test("timed event with an end time: DTEND uses (endDate ?? startDate) + endTime, no Z/TZID", () => {
  const lines = feedLines(
    makeEvent({ startDate: "2026-08-18", startTime: "09:00:00", endTime: "10:30:00", endDate: null }),
  );
  assert.ok(lines.includes("DTSTART:20260818T090000"));
  assert.ok(lines.includes("DTEND:20260818T103000"));
});

test("timed event with no end time: DTEND is exactly one hour after the start", () => {
  const lines = feedLines(makeEvent({ startDate: "2026-08-18", startTime: "09:00:00", endTime: null }));
  assert.ok(lines.includes("DTSTART:20260818T090000"));
  assert.ok(lines.includes("DTEND:20260818T100000"));
});

test("timed event with no end time, starting near midnight: the +1 hour rolls into the next day", () => {
  const lines = feedLines(makeEvent({ startDate: "2026-08-18", startTime: "23:30:00", endTime: null }));
  assert.ok(lines.includes("DTSTART:20260818T233000"));
  assert.ok(lines.includes("DTEND:20260819T003000"));
});

test("cross-midnight timed event: an explicit endDate the day after startDate", () => {
  const lines = feedLines(
    makeEvent({ startDate: "2026-08-18", startTime: "22:00:00", endDate: "2026-08-19", endTime: "01:00:00" }),
  );
  assert.ok(lines.includes("DTSTART:20260818T220000"));
  assert.ok(lines.includes("DTEND:20260819T010000"));
});

test("escapes commas and semicolons in SUMMARY and LOCATION", () => {
  const lines = feedLines(
    makeEvent({ title: "Trip, part 1; final?", location: "123 Main St; Unit 4, Building A" }),
  );
  assert.ok(lines.includes("SUMMARY:Trip\\, part 1\\; final?"));
  assert.ok(lines.includes("LOCATION:123 Main St\\; Unit 4\\, Building A"));
});

test("escapes embedded newlines in DESCRIPTION as literal \\n", () => {
  const lines = feedLines(makeEvent({ notes: "Bring:\nsnacks, water\nsunscreen" }));
  assert.ok(lines.includes("DESCRIPTION:Bring:\\nsnacks\\, water\\nsunscreen"));
});

test("escapes backslashes before other escaping, so they are not doubled up further", () => {
  const lines = feedLines(makeEvent({ title: "Back\\slash test" }));
  assert.ok(lines.includes("SUMMARY:Back\\\\slash test"));
});

test("DESCRIPTION combines notes and url when both are present, and is omitted when neither is", () => {
  const both = feedLines(makeEvent({ notes: "Bring snacks", url: "https://example.com/event" }));
  assert.ok(both.includes("DESCRIPTION:Bring snacks\\nhttps://example.com/event"));

  const notesOnly = feedLines(makeEvent({ notes: "Bring snacks", url: null }));
  assert.ok(notesOnly.includes("DESCRIPTION:Bring snacks"));

  const urlOnly = feedLines(makeEvent({ notes: null, url: "https://example.com/event" }));
  assert.ok(urlOnly.includes("DESCRIPTION:https://example.com/event"));

  const neither = feedLines(makeEvent({ notes: null, url: null }));
  assert.ok(!neither.some((l) => l.startsWith("DESCRIPTION")));
});

test("folds a SUMMARY longer than 75 octets, continuation lines starting with a space", () => {
  const title = "A".repeat(100);
  const ics = buildCalendarFeed([makeEvent({ title })], []);
  // "SUMMARY:" is 8 octets; the first physical line carries 75 - 8 = 67 As.
  // The continuation line's budget is 75 - 1 (leading space) = 74 octets,
  // comfortably holding the remaining 33 As in one more line.
  const expected = `SUMMARY:${"A".repeat(67)}\r\n ${"A".repeat(33)}`;
  assert.ok(ics.includes(expected), "expected the folded SUMMARY line to appear exactly as computed");
});

test("folds a multi-byte SUMMARY without splitting a UTF-8 character, and round-trips cleanly", () => {
  // U+1F389 PARTY POPPER is a 4-byte UTF-8 sequence. 66 leading "A"s put
  // "SUMMARY:" + the As at exactly 74 octets (8 + 66), so a naive 75-octet
  // byte cut lands on the emoji's *second* byte (a continuation byte) —
  // exactly the case foldLine's boundary back-off exists for.
  const emoji = "\u{1F389}";
  const title = "A".repeat(66) + emoji + "A".repeat(30);
  const ics = buildCalendarFeed([makeEvent({ title })], []);
  const lines = ics.split("\r\n");

  const summaryIndex = lines.findIndex((l) => l.startsWith("SUMMARY:"));
  assert.notEqual(summaryIndex, -1);
  // Confirms folding actually happened (not a vacuous pass) and lands
  // exactly where computed: the emoji starts the continuation line, whole.
  assert.equal(lines[summaryIndex], `SUMMARY:${"A".repeat(66)}`);
  assert.equal(lines[summaryIndex + 1], ` ${emoji}${"A".repeat(30)}`);

  // Unfolding (stripping "\r\n " between continuations) must reconstruct
  // the exact original value — a split multi-byte sequence would decode to
  // U+FFFD replacement characters instead of the real emoji and fail this.
  let unfolded = lines[summaryIndex];
  let i = summaryIndex + 1;
  while (i < lines.length && lines[i].startsWith(" ")) {
    unfolded += lines[i].slice(1);
    i++;
  }
  assert.equal(unfolded, `SUMMARY:${title}`);
});

test("weekly RRULE includes BYDAY (SU..SA from JS getDay numbers), INTERVAL when > 1, and WKST=SU", () => {
  const lines = feedLines(makeEvent({ repeatFreq: "weekly", repeatInterval: 2, repeatWeekdays: [5, 1, 3] }));
  assert.ok(lines.includes("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=SU"));
});

test("weekly RRULE with interval 1 omits INTERVAL but still carries WKST=SU", () => {
  const lines = feedLines(makeEvent({ repeatFreq: "weekly", repeatInterval: 1, repeatWeekdays: [0] }));
  assert.ok(lines.includes("RRULE:FREQ=WEEKLY;BYDAY=SU;WKST=SU"));
});

test("WKST=SU prevents a biweekly BYDAY=SU,SA series from drifting against an RFC-faithful client", () => {
  // RFC 5545 3.3.10 defaults an omitted WKST to MONDAY, but this app's own
  // week anchoring (lib/recurrence.ts's weeklyDates) is Sunday-based. Left
  // to that default, a strict RFC client expanding this exact rule at
  // INTERVAL=2 would slide the Sunday leg of the pair a week later every
  // other cycle relative to this engine's own dates — reproduced with
  // rrule.js: without WKST=SU the two engines' occurrence lists diverge
  // after the first cycle; with it, they match exactly. The start date
  // (2026-08-19) is a Wednesday, i.e. mid-week, per the reviewer's probe.
  const lines = feedLines(
    makeEvent({ startDate: "2026-08-19", repeatFreq: "weekly", repeatInterval: 2, repeatWeekdays: [0, 6] }),
  );
  assert.ok(lines.includes("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA;WKST=SU"));
});

test("BYDAY drops an out-of-range weekday instead of emitting undefined (malformed BYDAY=MO,)", () => {
  // repeat_weekdays has no CHECK constraint, so a stray 7 (one past Saturday)
  // must be filtered out by normaliseWeekdays before mapping to a code,
  // rather than indexing WEEKDAY_CODES out of bounds.
  const lines = feedLines(makeEvent({ repeatFreq: "weekly", repeatWeekdays: [7, 1] }));
  assert.ok(lines.includes("RRULE:FREQ=WEEKLY;BYDAY=MO;WKST=SU"));
});

test("BYDAY drops a negative weekday and dedupes a repeat (malformed BYDAY=,WE,WE)", () => {
  const lines = feedLines(makeEvent({ repeatFreq: "weekly", repeatWeekdays: [-1, 3, 3] }));
  assert.ok(lines.includes("RRULE:FREQ=WEEKLY;BYDAY=WE;WKST=SU"));
});

test("monthly RRULE has no BYDAY and omits INTERVAL when 1", () => {
  const lines = feedLines(makeEvent({ repeatFreq: "monthly", repeatInterval: 1 }));
  assert.ok(lines.includes("RRULE:FREQ=MONTHLY"));
});

test("yearly RRULE uses the stored interval directly (years, not months)", () => {
  const lines = feedLines(makeEvent({ repeatFreq: "yearly", repeatInterval: 3 }));
  assert.ok(lines.includes("RRULE:FREQ=YEARLY;INTERVAL=3"));
});

test("UNTIL on an all-day master is a bare DATE matching repeatUntil", () => {
  const lines = feedLines(
    makeEvent({ startTime: null, repeatFreq: "daily", repeatInterval: 1, repeatUntil: "2026-12-31" }),
  );
  assert.ok(lines.includes("RRULE:FREQ=DAILY;UNTIL=20261231"));
});

test("UNTIL on a timed master is a floating local date-time at the master's start time", () => {
  const lines = feedLines(
    makeEvent({
      startTime: "09:00:00",
      repeatFreq: "daily",
      repeatInterval: 1,
      repeatUntil: "2026-12-31",
    }),
  );
  assert.ok(lines.includes("RRULE:FREQ=DAILY;UNTIL=20261231T090000"));
});

test("an open-ended master (repeatUntil null) has no UNTIL", () => {
  const lines = feedLines(makeEvent({ repeatFreq: "daily", repeatUntil: null }));
  assert.ok(!lines.some((l) => l.startsWith("RRULE:") && l.includes("UNTIL")));
});

test("EXDATE on an all-day master matches DTSTART's VALUE=DATE type", () => {
  const master = makeEvent({ id: "master-1", startTime: null, repeatFreq: "daily" });
  const lines = feedLines(master, [{ eventId: "master-1", date: "2026-08-20" }]);
  assert.ok(lines.includes("EXDATE;VALUE=DATE:20260820"));
});

test("EXDATE on a timed master carries the master's own start time, floating", () => {
  const master = makeEvent({ id: "master-2", startTime: "09:00:00", repeatFreq: "daily" });
  const lines = feedLines(master, [{ eventId: "master-2", date: "2026-08-21" }]);
  assert.ok(lines.includes("EXDATE:20260821T090000"));
});

test("exdates belonging to a different event are not emitted on this master", () => {
  const master = makeEvent({ id: "master-3", startTime: null, repeatFreq: "daily" });
  const lines = feedLines(master, [{ eventId: "someone-else", date: "2026-08-20" }]);
  assert.ok(!lines.some((l) => l.startsWith("EXDATE")));
});

test("an override row (seriesId set) renders as an ordinary standalone VEVENT with no RRULE", () => {
  const override = makeEvent({
    id: "override-1",
    title: "Moved dinner",
    startDate: "2026-08-21",
    startTime: "19:00:00",
    seriesId: "master-1",
    originalDate: "2026-08-20",
    repeatFreq: null,
  });
  const lines = feedLines(override);
  assert.ok(lines.includes("UID:override-1@homesync"));
  assert.ok(lines.includes("DTSTART:20260821T190000"));
  assert.ok(!lines.some((l) => l.startsWith("RRULE")));
  assert.ok(!lines.some((l) => l.startsWith("EXDATE")));
});

test("plain (non-recurring) events have no RRULE or EXDATE", () => {
  const lines = feedLines(makeEvent());
  assert.ok(!lines.some((l) => l.startsWith("RRULE")));
  assert.ok(!lines.some((l) => l.startsWith("EXDATE")));
});

test("uses CRLF line endings throughout, including folded continuations", () => {
  const ics = buildCalendarFeed([makeEvent({ title: "A".repeat(100) })], []);
  assert.ok(ics.includes("\r\n"));
  // Every "\n" in the output must be preceded by "\r" — a bare LF would mean
  // a line ending (or a fold) slipped through unescaped/unfolded.
  assert.ok(!/[^\r]\n/.test(ics));
});

test("multiple events each get their own VEVENT block, in the order given", () => {
  const a = makeEvent({ id: "a", title: "First" });
  const b = makeEvent({ id: "b", title: "Second" });
  const lines = buildCalendarFeed([a, b], []).split("\r\n");
  const uidIndexes = lines.reduce<number[]>((acc, l, i) => (l.startsWith("UID:") ? [...acc, i] : acc), []);
  assert.deepEqual(
    uidIndexes.map((i) => lines[i]),
    ["UID:a@homesync", "UID:b@homesync"],
  );
});
