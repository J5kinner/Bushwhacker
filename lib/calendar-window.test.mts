import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCalendarWindow } from "./calendar-window.ts";

const NOW = { year: 2026, month: 8 }; // August 2026

test("no ?m= defaults the anchor to the caller's current UTC month", () => {
  const result = resolveCalendarWindow(undefined, NOW);
  assert.deepEqual(result, {
    anchorMonth: null,
    windowFrom: "2026-07-01",
    windowTo: "2027-09-30",
  });
});

test("a valid ?m= becomes the anchor month", () => {
  const result = resolveCalendarWindow("2026-03", NOW);
  assert.equal(result.anchorMonth, "2026-03");
  assert.equal(result.windowFrom, "2026-02-01");
});

test("month 13 is rejected and falls back to the default anchor", () => {
  const result = resolveCalendarWindow("2026-13", NOW);
  assert.equal(result.anchorMonth, null);
});

test("a non-zero-padded month is rejected", () => {
  const result = resolveCalendarWindow("2026-1", NOW);
  assert.equal(result.anchorMonth, null);
});

test("month 00 is rejected", () => {
  const result = resolveCalendarWindow("2026-00", NOW);
  assert.equal(result.anchorMonth, null);
});

test("junk input is rejected", () => {
  const result = resolveCalendarWindow("not-a-month", NOW);
  assert.equal(result.anchorMonth, null);
});

test("an empty string is rejected", () => {
  const result = resolveCalendarWindow("", NOW);
  assert.equal(result.anchorMonth, null);
});

test("year-boundary maths: January's anchor-1 month is the prior December", () => {
  const result = resolveCalendarWindow("2026-01", NOW);
  assert.equal(result.windowFrom, "2025-12-01");
});

test("anchor+13 rolls over into the following year", () => {
  // August 2026 + 13 months = September 2027.
  const result = resolveCalendarWindow(undefined, NOW);
  assert.equal(result.windowTo, "2027-09-30");
});

test("anchor+13 rolls over the year boundary from a December anchor", () => {
  // December 2026 + 13 months = January 2028.
  const result = resolveCalendarWindow("2026-12", NOW);
  assert.equal(result.windowTo, "2028-01-31");
});

test("windowTo lands on the last day of a 31-day month", () => {
  // July 2026 + 13 months = August 2027 (31 days).
  const result = resolveCalendarWindow("2026-07", NOW);
  assert.equal(result.windowTo, "2027-08-31");
});

test("windowTo lands on the last day of a 30-day month", () => {
  // May 2026 + 13 months = June 2027 (30 days).
  const result = resolveCalendarWindow("2026-05", NOW);
  assert.equal(result.windowTo, "2027-06-30");
});

test("windowTo lands on 29 Feb in a leap year", () => {
  // January 2027 + 13 months = February 2028, a leap year.
  const result = resolveCalendarWindow("2027-01", NOW);
  assert.equal(result.windowTo, "2028-02-29");
});

test("windowTo lands on 28 Feb in a non-leap year", () => {
  // January 2026 + 13 months = February 2027 (not a leap year).
  const result = resolveCalendarWindow("2026-01", NOW);
  assert.equal(result.windowTo, "2027-02-28");
});
