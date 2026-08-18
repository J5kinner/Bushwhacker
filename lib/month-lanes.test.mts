import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeekLanes, MAX_LANES } from "./month-lanes.ts";
import type { ExpandableEvent, Occurrence } from "./recurrence.ts";

let nextId = 1;

/** A fully-populated event row with sensible defaults, overridable per test. */
function makeEvent(overrides: Partial<ExpandableEvent> = {}): ExpandableEvent {
  const id = overrides.id ?? `event-${nextId++}`;
  return {
    id,
    householdId: "household-1",
    title: "Event",
    startDate: "2026-08-17",
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

/** A minimal Occurrence: `date`/`endDate`/`key` are all computeWeekLanes reads. */
function makeOccurrence(key: string, date: string, endDate: string | null = null): Occurrence {
  return {
    event: makeEvent({ id: key, title: key, startDate: date, endDate }),
    date,
    endDate,
    isOverride: false,
    key,
  };
}

// Monday 2026-08-17 through Sunday 2026-08-23 — columns 0 (Mon) .. 6 (Sun).
const WEEK = [
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
];

function orderOf(occurrences: Occurrence[]): Map<string, number> {
  return new Map(occurrences.map((o, i) => [o.key, i]));
}

test("two bars overlapping by one day get distinct lanes", () => {
  // Wed-Fri and Fri-Sat share Friday, so they must not stack in the same lane.
  const a = makeOccurrence("a", "2026-08-19", "2026-08-21");
  const b = makeOccurrence("b", "2026-08-21", "2026-08-22");
  const occurrences = [a, b];
  const { items, overflow } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  const laneA = items.find((i) => i.occurrence.key === "a")!.lane;
  const laneB = items.find((i) => i.occurrence.key === "b")!.lane;
  assert.notEqual(laneA, laneB);
  assert.deepEqual(overflow, [0, 0, 0, 0, 0, 0, 0]);
});

test("two bars touching at a boundary share a lane", () => {
  // Wed-Thu ends on column 3; Fri-Sat starts on column 4 — no shared day, so
  // the second bar reuses the first bar's lane instead of claiming a new one.
  const a = makeOccurrence("a", "2026-08-19", "2026-08-20");
  const b = makeOccurrence("b", "2026-08-21", "2026-08-22");
  const occurrences = [a, b];
  const { items } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  const laneA = items.find((i) => i.occurrence.key === "a")!.lane;
  const laneB = items.find((i) => i.occurrence.key === "b")!.lane;
  assert.equal(laneA, laneB);
});

test("a bar clamped on both sides of a week gets no rounding", () => {
  // Starts well before this week and ends well after it, so both edges are
  // continuations, not real starts/ends within this week.
  const spanning = makeOccurrence("spanning", "2026-08-10", "2026-08-30");
  const occurrences = [spanning];
  const { items } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  const item = items[0];
  assert.equal(item.startCol, 0);
  assert.equal(item.endCol, 6);
  assert.equal(item.roundedLeft, false);
  assert.equal(item.roundedRight, false);
});

test("a bar ending exactly on the week's last day is rounded right", () => {
  // Starts before the week (continuation, not left-rounded) but its real end
  // date lands exactly on the week's Sunday, so the right edge IS a real end.
  const bar = makeOccurrence("bar", "2026-08-14", "2026-08-23");
  const occurrences = [bar];
  const { items } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  const item = items[0];
  assert.equal(item.endCol, 6);
  assert.equal(item.roundedLeft, false);
  assert.equal(item.roundedRight, true);
});

test("a 4th overlapping item overflows, counted only on the days it touches", () => {
  // Four bars all covering Thu-Fri (columns 3-4): only MAX_LANES (3) get a
  // lane, the 4th folds into `overflow` on exactly the two days it spans.
  const occurrences = [
    makeOccurrence("a", "2026-08-20", "2026-08-21"),
    makeOccurrence("b", "2026-08-20", "2026-08-21"),
    makeOccurrence("c", "2026-08-20", "2026-08-21"),
    makeOccurrence("d", "2026-08-20", "2026-08-21"),
  ];
  const { items, overflow } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  assert.equal(items.length, MAX_LANES);
  assert.deepEqual(overflow, [0, 0, 0, 1, 1, 0, 0]);
});

test("an all-day occurrence lands in an earlier lane than a timed one on the same day", () => {
  // computeWeekLanes trusts `orderIndex` for this — the caller (expandOccurrences)
  // already sorts all-day before timed for a shared date, so the all-day
  // occurrence's lower index here must win the earlier lane.
  const allDay = makeOccurrence("all-day", "2026-08-22");
  const timed = makeOccurrence("timed", "2026-08-22");
  const occurrences = [allDay, timed]; // all-day sorted first, as expandOccurrences would
  const { items } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  const laneAllDay = items.find((i) => i.occurrence.key === "all-day")!.lane;
  const laneTimed = items.find((i) => i.occurrence.key === "timed")!.lane;
  assert.ok(laneAllDay < laneTimed);
});

test("multi-day bars claim lanes ahead of single-day pills even when the pill sorts first", () => {
  const pill = makeOccurrence("pill", "2026-08-19");
  const bar = makeOccurrence("bar", "2026-08-19", "2026-08-20");
  // orderIndex says the pill comes first, but bars still win the top lane.
  const occurrences = [pill, bar];
  const { items } = computeWeekLanes(WEEK, occurrences, orderOf(occurrences));

  const laneBar = items.find((i) => i.occurrence.key === "bar")!.lane;
  const lanePill = items.find((i) => i.occurrence.key === "pill")!.lane;
  assert.equal(laneBar, 0);
  assert.ok(lanePill > laneBar);
});
