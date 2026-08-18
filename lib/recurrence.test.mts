import { test } from "node:test";
import assert from "node:assert/strict";
import { expandOccurrences, occursOnDay, type ExpandableEvent } from "./recurrence.ts";

let nextId = 1;

/** A fully-populated event row with sensible defaults, overridable per test. */
function makeEvent(overrides: Partial<ExpandableEvent> = {}): ExpandableEvent {
  const id = overrides.id ?? `event-${nextId++}`;
  return {
    id,
    householdId: "household-1",
    title: "Event",
    startDate: "2026-08-18",
    endDate: null,
    notes: null,
    createdById: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    startTime: null,
    endTime: null,
    location: null,
    url: null,
    colour: null,
    attendeeIds: null,
    pinned: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    repeatFreq: null,
    repeatInterval: null,
    repeatWeekdays: null,
    repeatUntil: null,
    seriesId: null,
    originalDate: null,
    ...overrides,
  };
}

test("identity pass-through: a non-recurring event inside the window is a single occurrence", () => {
  const event = makeEvent({ startDate: "2026-08-18" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-31");
  assert.deepEqual(
    result.map((o) => ({ date: o.date, endDate: o.endDate, isOverride: o.isOverride, key: o.key })),
    [{ date: "2026-08-18", endDate: null, isOverride: false, key: `${event.id}:2026-08-18` }],
  );
});

test("window exclusion: a non-recurring event outside the window yields nothing", () => {
  const event = makeEvent({ startDate: "2026-09-05" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-31");
  assert.equal(result.length, 0);
});

test("multi-day window overlap: an event spanning into the window is included at its own dates", () => {
  const event = makeEvent({ startDate: "2026-07-30", endDate: "2026-08-02" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-31");
  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-07-30");
  assert.equal(result[0].endDate, "2026-08-02");
});

test("multi-day window overlap: an event entirely before the window is excluded", () => {
  const event = makeEvent({ startDate: "2026-07-01", endDate: "2026-07-05" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-31");
  assert.equal(result.length, 0);
});

test("daily recurrence with interval 2 steps every other day", () => {
  const event = makeEvent({ startDate: "2026-08-01", repeatFreq: "daily", repeatInterval: 2 });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-07");
  assert.deepEqual(result.map((o) => o.date), ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07"]);
});

test("weekly recurrence with a weekday set spanning a week boundary", () => {
  // Start is Monday 2026-08-03; weekdays [Sun, Fri] means consecutive hits
  // land only two days apart across the week boundary (Fri 7 -> Sun 9).
  const event = makeEvent({ startDate: "2026-08-03", repeatFreq: "weekly", repeatWeekdays: [0, 5] });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-21");
  assert.deepEqual(result.map((o) => o.date), [
    "2026-08-07",
    "2026-08-09",
    "2026-08-14",
    "2026-08-16",
    "2026-08-21",
  ]);
});

test("weekly recurrence defaults to the start date's own weekday when no weekday set is given", () => {
  const event = makeEvent({ startDate: "2026-08-03", repeatFreq: "weekly" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-21");
  assert.deepEqual(result.map((o) => o.date), ["2026-08-03", "2026-08-10", "2026-08-17"]);
});

test("monthly recurrence on the 31st skips short months instead of clamping", () => {
  const event = makeEvent({ startDate: "2026-01-31", repeatFreq: "monthly" });
  const result = expandOccurrences([event], [], "2026-01-01", "2026-04-30");
  // Feb (28 days) and Apr (30 days) have no 31st and are skipped outright;
  // neither becomes the 28th/30th.
  assert.deepEqual(result.map((o) => o.date), ["2026-01-31", "2026-03-31"]);
});

test("yearly recurrence on 29 Feb only lands in leap years", () => {
  const event = makeEvent({ startDate: "2024-02-29", repeatFreq: "yearly" });
  const result = expandOccurrences([event], [], "2024-01-01", "2028-12-31");
  assert.deepEqual(result.map((o) => o.date), ["2024-02-29", "2028-02-29"]);
});

test("repeatUntil is an inclusive bound on expansion", () => {
  const event = makeEvent({ startDate: "2026-08-01", repeatFreq: "daily", repeatUntil: "2026-08-05" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-31");
  assert.deepEqual(result.map((o) => o.date), [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
  ]);
});

test("a master starting well before the window still yields correctly-aligned in-window occurrences", () => {
  // Interval-3 daily series starting 2020-01-01; the fast-forward maths must
  // preserve the original cycle alignment rather than resetting it at the
  // window start.
  const event = makeEvent({ startDate: "2020-01-01", repeatFreq: "daily", repeatInterval: 3 });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-10");
  assert.deepEqual(result.map((o) => o.date), ["2026-08-03", "2026-08-06", "2026-08-09"]);
});

test("an exdate suppresses only the master's occurrence on that date", () => {
  const event = makeEvent({ id: "e1", startDate: "2026-08-01", repeatFreq: "daily" });
  const result = expandOccurrences(
    [event],
    [{ eventId: "e1", date: "2026-08-02" }],
    "2026-08-01",
    "2026-08-03",
  );
  assert.deepEqual(result.map((o) => o.date), ["2026-08-01", "2026-08-03"]);
});

test("override placement: an override row renders at its own moved date, not the original", () => {
  const master = makeEvent({ id: "master-1", startDate: "2026-08-03", repeatFreq: "weekly" });
  const override = makeEvent({
    id: "override-1",
    startDate: "2026-08-12",
    seriesId: "master-1",
    originalDate: "2026-08-10",
  });
  const result = expandOccurrences(
    [master, override],
    [{ eventId: "master-1", date: "2026-08-10" }],
    "2026-08-01",
    "2026-08-21",
  );
  assert.deepEqual(
    result.map((o) => ({ id: o.event.id, date: o.date, isOverride: o.isOverride })),
    [
      { id: "master-1", date: "2026-08-03", isOverride: false },
      { id: "override-1", date: "2026-08-12", isOverride: true },
      { id: "master-1", date: "2026-08-17", isOverride: false },
    ],
  );
});

test("originalDate dedupe tolerance: the master's exdate and the override's own occurrence never double up", () => {
  // Same setup as above; asserted from a different angle — exactly one
  // occurrence exists for the suppressed date's neighbourhood, never zero
  // (over-suppressed) and never two (double-rendered).
  const master = makeEvent({ id: "master-2", startDate: "2026-08-03", repeatFreq: "weekly" });
  const override = makeEvent({
    id: "override-2",
    startDate: "2026-08-10",
    seriesId: "master-2",
    originalDate: "2026-08-10",
  });
  const result = expandOccurrences(
    [master, override],
    [{ eventId: "master-2", date: "2026-08-10" }],
    "2026-08-10",
    "2026-08-10",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].event.id, "override-2");
  assert.equal(result[0].isOverride, true);
});

test("expandOccurrences tolerates duplicate exdate rows for the same eventId and date", () => {
  const event = makeEvent({ id: "e2", startDate: "2026-08-05" });
  const result = expandOccurrences(
    [event],
    [
      { eventId: "e2", date: "2026-08-05" },
      { eventId: "e2", date: "2026-08-05" },
    ],
    "2026-08-01",
    "2026-08-31",
  );
  assert.equal(result.length, 0);
});

test("multi-day span is preserved on every occurrence of a recurring master", () => {
  const event = makeEvent({ startDate: "2026-08-03", endDate: "2026-08-05", repeatFreq: "weekly" });
  const result = expandOccurrences([event], [], "2026-08-01", "2026-08-17");
  assert.deepEqual(
    result.map((o) => [o.date, o.endDate]),
    [
      ["2026-08-03", "2026-08-05"],
      ["2026-08-10", "2026-08-12"],
      ["2026-08-17", "2026-08-19"],
    ],
  );
});

test("sort order: all-day occurrences come before timed ones on the same day, then by start time", () => {
  const timed = makeEvent({ id: "timed", startDate: "2026-08-18", startTime: "09:00:00", title: "B timed" });
  const allDay = makeEvent({ id: "allday", startDate: "2026-08-18", startTime: null, title: "A allday" });
  const later = makeEvent({ id: "later", startDate: "2026-08-18", startTime: "15:00:00", title: "C later" });
  const result = expandOccurrences([timed, allDay, later], [], "2026-08-01", "2026-08-31");
  assert.deepEqual(result.map((o) => o.event.id), ["allday", "timed", "later"]);
});

test("sort order: same date and start time break ties by title", () => {
  const b = makeEvent({ id: "b", startDate: "2026-08-18", startTime: "09:00:00", title: "Banana" });
  const a = makeEvent({ id: "a", startDate: "2026-08-18", startTime: "09:00:00", title: "Apple" });
  const result = expandOccurrences([b, a], [], "2026-08-01", "2026-08-31");
  assert.deepEqual(result.map((o) => o.event.id), ["a", "b"]);
});

test("key format is stable: `${event.id}:${date}` for identity and recurring occurrences alike", () => {
  const identity = makeEvent({ id: "abc-123", startDate: "2026-08-18" });
  assert.equal(
    expandOccurrences([identity], [], "2026-08-01", "2026-08-31")[0].key,
    "abc-123:2026-08-18",
  );

  const recurring = makeEvent({ id: "master-x", startDate: "2026-08-01", repeatFreq: "daily" });
  const result = expandOccurrences([recurring], [], "2026-08-01", "2026-08-03");
  assert.deepEqual(result.map((o) => o.key), [
    "master-x:2026-08-01",
    "master-x:2026-08-02",
    "master-x:2026-08-03",
  ]);
});

test("occursOnDay checks a day against the occurrence's span", () => {
  const occurrence = {
    event: makeEvent(),
    date: "2026-08-03",
    endDate: "2026-08-05",
    isOverride: false,
    key: "x",
  };
  assert.equal(occursOnDay(occurrence, "2026-08-01"), false);
  assert.equal(occursOnDay(occurrence, "2026-08-03"), true);
  assert.equal(occursOnDay(occurrence, "2026-08-04"), true);
  assert.equal(occursOnDay(occurrence, "2026-08-05"), true);
  assert.equal(occursOnDay(occurrence, "2026-08-06"), false);
});
