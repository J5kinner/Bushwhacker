import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timedBlocksForDay,
  allDayOccurrencesForDay,
  MIN_BLOCK_HEIGHT_MINUTES,
  MINUTES_PER_DAY,
} from "./time-grid.ts";
import type { ExpandableEvent, Occurrence } from "./recurrence.ts";

let nextId = 1;

/** A fully-populated event row with sensible defaults, overridable per test. */
function makeEvent(overrides: Partial<ExpandableEvent> = {}): ExpandableEvent {
  const id = overrides.id ?? `event-${nextId++}`;
  return {
    id,
    householdId: "household-1",
    title: "Event",
    startDate: "2026-08-19",
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

/** A timed occurrence starting `date` at `startTime`, optionally ending `endTime` the same day or `endDate` a later day. */
function makeOccurrence(
  key: string,
  date: string,
  startTime: string | null,
  endTime: string | null = null,
  endDate: string | null = null,
): Occurrence {
  return {
    event: makeEvent({ id: key, title: key, startDate: date, startTime, endTime, endDate }),
    date,
    endDate,
    isOverride: false,
    key,
  };
}

const DAY = "2026-08-19";

test("no-overlap positioning: two non-overlapping blocks each get the day column to themselves", () => {
  const a = makeOccurrence("a", DAY, "09:00", "10:00");
  const b = makeOccurrence("b", DAY, "14:00", "15:00");
  const blocks = timedBlocksForDay([a, b], DAY);

  const blockA = blocks.find((b2) => b2.occurrence.key === "a")!;
  const blockB = blocks.find((b2) => b2.occurrence.key === "b")!;
  assert.equal(blockA.topMinutes, 9 * 60);
  assert.equal(blockA.heightMinutes, 60);
  assert.equal(blockA.column, 0);
  assert.equal(blockA.columns, 1);
  assert.equal(blockB.topMinutes, 14 * 60);
  assert.equal(blockB.column, 0);
  assert.equal(blockB.columns, 1);
});

test("two overlapping blocks split into 2 columns", () => {
  const a = makeOccurrence("a", DAY, "09:00", "10:00");
  const b = makeOccurrence("b", DAY, "09:30", "10:30");
  const blocks = timedBlocksForDay([a, b], DAY);

  assert.equal(blocks.length, 2);
  for (const block of blocks) assert.equal(block.columns, 2);
  const columns = blocks.map((b2) => b2.column).sort();
  assert.deepEqual(columns, [0, 1]);
});

test("three transitively-overlapping blocks (A-B, B-C, not A-C) form one group of 3 columns", () => {
  // A: 09:00-10:00, B: 09:30-11:00, C: 10:30-11:30 — A and C never overlap
  // directly, but the chain through B still puts all three in one group.
  const a = makeOccurrence("a", DAY, "09:00", "10:00");
  const b = makeOccurrence("b", DAY, "09:30", "11:00");
  const c = makeOccurrence("c", DAY, "10:30", "11:30");
  const blocks = timedBlocksForDay([a, b, c], DAY);

  assert.equal(blocks.length, 3);
  for (const block of blocks) assert.equal(block.columns, 3);
  const columnA = blocks.find((b2) => b2.occurrence.key === "a")!.column;
  const columnB = blocks.find((b2) => b2.occurrence.key === "b")!.column;
  const columnC = blocks.find((b2) => b2.occurrence.key === "c")!.column;
  assert.deepEqual([columnA, columnB, columnC].sort(), [0, 1, 2]);
});

test("a null endTime defaults to a 60-minute block", () => {
  const a = makeOccurrence("a", DAY, "13:00", null);
  const [block] = timedBlocksForDay([a], DAY);
  assert.equal(block.topMinutes, 13 * 60);
  assert.equal(block.heightMinutes, 60);
});

test("a short event is floored to the minimum tappable height", () => {
  const a = makeOccurrence("a", DAY, "13:00", "13:10");
  const [block] = timedBlocksForDay([a], DAY);
  assert.equal(block.heightMinutes, MIN_BLOCK_HEIGHT_MINUTES);
});

test("a multi-day timed occurrence clamps at 24:00 (1440) on its own start day", () => {
  const a = makeOccurrence("a", DAY, "22:00", null, "2026-08-20");
  const [block] = timedBlocksForDay([a], DAY);
  assert.equal(block.topMinutes, 22 * 60);
  assert.equal(block.topMinutes + block.heightMinutes, MINUTES_PER_DAY);
});

test("a midnight-start block positions at topMinutes 0", () => {
  const a = makeOccurrence("a", DAY, "00:00", "01:00");
  const [block] = timedBlocksForDay([a], DAY);
  assert.equal(block.topMinutes, 0);
  assert.equal(block.heightMinutes, 60);
});

test("a 23:30-start block with no endTime clamps its default duration at midnight, not past it", () => {
  const a = makeOccurrence("a", DAY, "23:30", null);
  const [block] = timedBlocksForDay([a], DAY);
  assert.equal(block.topMinutes, 23 * 60 + 30);
  // Without the midnight clamp this would be 60 (the default duration);
  // clamped, only the 30 minutes until midnight are left, which also
  // happens to be exactly the tappable-height floor.
  assert.equal(block.heightMinutes, 30);
  assert.equal(block.topMinutes + block.heightMinutes, MINUTES_PER_DAY);
});

test("an all-day occurrence appears in the strip, never the hour grid", () => {
  const allDay = makeOccurrence("all-day", DAY, null);
  assert.equal(timedBlocksForDay([allDay], DAY).length, 0);
  assert.equal(allDayOccurrencesForDay([allDay], DAY).length, 1);
});

test("a multi-day timed occurrence: hour grid on its start day, strip on its later days", () => {
  const start = DAY;
  const end = "2026-08-20";
  const spanning = makeOccurrence("spanning", start, "22:00", null, end);

  // Start day: positioned in the hour grid, absent from the strip.
  assert.equal(timedBlocksForDay([spanning], start).length, 1);
  assert.equal(allDayOccurrencesForDay([spanning], start).length, 0);

  // Later day: absent from the hour grid, present in the strip.
  assert.equal(timedBlocksForDay([spanning], end).length, 0);
  assert.equal(allDayOccurrencesForDay([spanning], end).length, 1);
});

test("a multi-day all-day occurrence appears in the strip on every day of its span", () => {
  const spanning = makeOccurrence("trip", DAY, null, null, "2026-08-21");
  for (const day of ["2026-08-19", "2026-08-20", "2026-08-21"]) {
    assert.equal(allDayOccurrencesForDay([spanning], day).length, 1);
    assert.equal(timedBlocksForDay([spanning], day).length, 0);
  }
});

test("an occurrence on a different day entirely is invisible to both helpers", () => {
  const other = makeOccurrence("other", "2026-08-01", "09:00", "10:00");
  assert.equal(timedBlocksForDay([other], DAY).length, 0);
  assert.equal(allDayOccurrencesForDay([other], DAY).length, 0);
});
