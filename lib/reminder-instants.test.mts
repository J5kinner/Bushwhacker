import { test } from "node:test";
import assert from "node:assert/strict";
import { dueReminders, reminderInstant } from "./reminder-instants.ts";
import type { ExpandableEvent } from "./recurrence.ts";

const SYDNEY = "Australia/Sydney";

let nextId = 1;

/** A fully-populated event row with sensible defaults, overridable per test — mirrors lib/recurrence.test.mts's own factory, plus `reminderMinutes`. */
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
    reminderMinutes: null,
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

// ---- reminderInstant ----

test("reminderInstant: timed event, basic minutes-before offset", () => {
  // 2026-08-18 is deep winter — Sydney is on AEST (UTC+10), no DST maths to
  // worry about here; that's the next test's job.
  const instant = reminderInstant(
    { date: "2026-08-18", event: { startTime: "14:30:00" } },
    30,
    SYDNEY,
  );
  assert.equal(instant.toISOString(), "2026-08-18T04:00:00.000Z");
});

test("reminderInstant: all-day event anchors to local midnight", () => {
  const instant = reminderInstant(
    { date: "2026-08-18", event: { startTime: null } },
    0,
    SYDNEY,
  );
  // Midnight AEST (UTC+10) on 2026-08-18 is 2026-08-17T14:00:00Z.
  assert.equal(instant.toISOString(), "2026-08-17T14:00:00.000Z");
});

test("reminderInstant: negative offset fires AFTER the anchor (all-day, 9am on the day)", () => {
  const instant = reminderInstant(
    { date: "2026-08-18", event: { startTime: null } },
    -540,
    SYDNEY,
  );
  // Midnight + 540 minutes (9 hours) = 9:00am AEST = 2026-08-17T23:00:00Z.
  assert.equal(instant.toISOString(), "2026-08-17T23:00:00.000Z");
});

test("reminderInstant: the AEDT daylight-saving transition (first Sunday of October 2026) uses the correct offset either side of it", () => {
  // Clocks in Australia/Sydney spring forward at 2am on 2026-10-04, so a
  // 9:00am wall-clock time that day is already in AEDT (UTC+11) — using the
  // pre-transition AEST (UTC+10) offset here would silently be an hour off.
  const postTransition = reminderInstant(
    { date: "2026-10-04", event: { startTime: "09:00:00" } },
    0,
    SYDNEY,
  );
  assert.equal(postTransition.toISOString(), "2026-10-03T22:00:00.000Z");

  // The day before, still AEST (UTC+10) — included for contrast, so this
  // test would fail if `fromZonedTime` (or a hand-rolled fixed offset) ever
  // applied the same offset on both sides of the transition.
  const preTransition = reminderInstant(
    { date: "2026-10-03", event: { startTime: "09:00:00" } },
    0,
    SYDNEY,
  );
  assert.equal(preTransition.toISOString(), "2026-10-02T23:00:00.000Z");
});

test("reminderInstant: a wall-clock time inside the spring-forward gap (02:30 on 2026-10-04, which never occurs locally) still resolves deterministically", () => {
  // Sydney's clocks jump from 2:00am straight to 3:00am on 2026-10-04, so
  // 2:30am that day is not a real local moment — but the native <input
  // type="time"> the event sheet uses has no way to forbid entering it, so
  // this locks in whatever date-fns-tz actually does with it (resolves
  // using the post-transition, AEDT/UTC+11 offset) rather than leaving it
  // to silently vary across a library upgrade.
  const instant = reminderInstant(
    { date: "2026-10-04", event: { startTime: "02:30:00" } },
    0,
    SYDNEY,
  );
  assert.equal(instant.toISOString(), "2026-10-03T15:30:00.000Z");
});

// ---- dueReminders ----

test("dueReminders: catch-up window includes the exact `now` boundary", () => {
  const now = new Date("2026-08-18T04:00:00.000Z"); // 2026-08-18T14:00 AEST
  const event = makeEvent({ startDate: "2026-08-18", startTime: "14:00:00", reminderMinutes: 0 });
  const result = dueReminders([event], [], SYDNEY, now);
  assert.deepEqual(result.map((r) => r.occurrenceDate), ["2026-08-18"]);
  assert.equal(result[0].instant.toISOString(), now.toISOString());
});

test("dueReminders: catch-up window includes the exact `now - 24h` boundary", () => {
  const now = new Date("2026-08-18T04:00:00.000Z");
  // reminderMinutes 1440 (24h before a 14:00 anchor) puts the instant exactly
  // 24 hours before `now`.
  const event = makeEvent({ startDate: "2026-08-18", startTime: "14:00:00", reminderMinutes: 1440 });
  const result = dueReminders([event], [], SYDNEY, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].instant.toISOString(), "2026-08-17T04:00:00.000Z");
});

test("dueReminders: excludes an instant one minute past the 24h catch-up boundary", () => {
  const now = new Date("2026-08-18T04:00:00.000Z");
  const event = makeEvent({ startDate: "2026-08-18", startTime: "14:00:00", reminderMinutes: 1441 });
  const result = dueReminders([event], [], SYDNEY, now);
  assert.equal(result.length, 0);
});

test("dueReminders: excludes a future instant that isn't due yet", () => {
  const now = new Date("2026-08-18T04:00:00.000Z");
  // reminderMinutes -1 puts the instant one minute AFTER `now`.
  const event = makeEvent({ startDate: "2026-08-18", startTime: "14:00:00", reminderMinutes: -1 });
  const result = dueReminders([event], [], SYDNEY, now);
  assert.equal(result.length, 0);
});

test("dueReminders: a recurring event yields one entry per due occurrence", () => {
  const now = new Date("2026-08-17T23:00:00.000Z"); // 2026-08-18T09:00 AEST
  const event = makeEvent({
    startDate: "2026-08-01",
    startTime: "09:00:00",
    repeatFreq: "daily",
    repeatInterval: 1,
    reminderMinutes: 0,
  });
  const result = dueReminders([event], [], SYDNEY, now);
  // 08-18's 9am anchor is `now` itself; 08-17's is exactly 24h earlier (the
  // catch-up boundary, inclusive); 08-19 onward hasn't happened yet.
  assert.deepEqual(
    result.map((r) => r.occurrenceDate).sort(),
    ["2026-08-17", "2026-08-18"],
  );
});

test("dueReminders: an exdated occurrence is excluded even though it would otherwise be due", () => {
  const now = new Date("2026-08-17T23:00:00.000Z");
  const event = makeEvent({ startDate: "2026-08-18", startTime: "09:00:00", reminderMinutes: 0 });
  const result = dueReminders([event], [{ eventId: event.id, date: "2026-08-18" }], SYDNEY, now);
  assert.equal(result.length, 0);
});

test("dueReminders: an event with no reminderMinutes set is ignored", () => {
  const now = new Date("2026-08-17T23:00:00.000Z");
  const event = makeEvent({ startDate: "2026-08-18", startTime: "09:00:00", reminderMinutes: null });
  const result = dueReminders([event], [], SYDNEY, now);
  assert.equal(result.length, 0);
});
