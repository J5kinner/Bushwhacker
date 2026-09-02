import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFinancePeriod } from "./finance-period.ts";

const NOW = { year: 2026, month: 9 }; // September 2026

test("no ?fp= defaults to the caller's current month", () => {
  const result = resolveFinancePeriod(undefined, NOW);
  assert.equal(result.period, "2026-09");
  assert.equal(result.from, "2026-09-01");
  assert.equal(result.to, "2026-09-30");
});

test("a valid ?fp= becomes the active period", () => {
  const result = resolveFinancePeriod("2026-02", NOW);
  assert.equal(result.period, "2026-02");
  // 2026 is not a leap year.
  assert.equal(result.to, "2026-02-28");
});

test("prevPeriod/nextPeriod cross a year boundary correctly", () => {
  const result = resolveFinancePeriod("2026-01", NOW);
  assert.equal(result.prevPeriod, "2025-12");
  assert.equal(result.nextPeriod, "2026-02");
});

test("month 13 is rejected and falls back to the default period", () => {
  assert.equal(resolveFinancePeriod("2026-13", NOW).period, "2026-09");
});

test("a non-zero-padded month is rejected", () => {
  assert.equal(resolveFinancePeriod("2026-9", NOW).period, "2026-09");
});

test("junk input is rejected", () => {
  assert.equal(resolveFinancePeriod("not-a-period", NOW).period, "2026-09");
});
