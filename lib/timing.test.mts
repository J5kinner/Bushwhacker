import { test } from "node:test";
import assert from "node:assert/strict";
import { measure, serverTimingHeader, timed } from "./timing.ts";

async function captureWarnings(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => void lines.push(line);
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

test("measure returns the result untouched", async () => {
  const { result } = await measure("read", async () => ({ rows: [1, 2] }));
  assert.deepEqual(result, { rows: [1, 2] });
});

test("measure accepts a thenable, not just a real promise", async () => {
  const thenable = {
    then: (resolve: (value: string) => void) => resolve("rows"),
  };
  const { result } = await measure("read", () => thenable);
  assert.equal(result, "rows");
});

test("measure reports a non-negative duration", async () => {
  const { timing } = await measure("read", async () => null);
  assert.equal(timing.name, "read");
  assert.ok(timing.ms >= 0, `expected a non-negative duration, got ${timing.ms}`);
});

test("a fast read logs nothing", async () => {
  const lines = await captureWarnings(() => timed("fast", async () => "ok"));
  assert.deepEqual(lines, []);
});

test("a slow read logs one structured line", async () => {
  const lines = await captureWarnings(() =>
    timed("slow", () => new Promise((resolve) => setTimeout(() => resolve("ok"), 250))),
  );

  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.evt, "slow_query");
  assert.equal(logged.name, "slow");
  assert.ok(logged.ms >= 200, `expected a slow duration, got ${logged.ms}`);
  assert.equal(logged.failed, undefined);
});

test("the logged line carries no query arguments", async () => {
  const lines = await captureWarnings(() =>
    timed("shopping-items", () =>
      new Promise((resolve) => setTimeout(() => resolve("ok"), 250)),
    ),
  );

  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ["evt", "ms", "name"]);
});

test("a failure is logged and re-thrown, however fast it was", async () => {
  const boom = new Error("connection reset");
  const lines = await captureWarnings(async () => {
    await assert.rejects(
      () => timed("failing", async () => Promise.reject(boom)),
      (error) => error === boom,
    );
  });

  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.failed, true);
  assert.equal(logged.name, "failing");
});

test("serverTimingHeader formats entries for the header", () => {
  const header = serverTimingHeader([
    { name: "feed-read", ms: 12.34 },
    { name: "feed-build", ms: 1 },
  ]);
  assert.equal(header, "feed-read;dur=12.3, feed-build;dur=1.0");
});

test("serverTimingHeader is empty for no timings", () => {
  assert.equal(serverTimingHeader([]), "");
});
