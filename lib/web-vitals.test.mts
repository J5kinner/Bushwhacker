import { test } from "node:test";
import assert from "node:assert/strict";
import { isCleanRoute, parseVitalReport } from "./web-vitals.ts";

const valid = {
  route: "/shopping",
  metric: "LCP",
  value: 1234.5,
  rating: "good",
  deviceType: "mobile",
};

test("a well-formed report parses", () => {
  assert.deepEqual(parseVitalReport(valid), {
    route: "/shopping",
    metric: "LCP",
    value: 1234.5,
    rating: "good",
    deviceType: "mobile",
  });
});

test("an unknown device type degrades to null rather than rejecting", () => {
  const report = parseVitalReport({ ...valid, deviceType: "toaster" });
  assert.equal(report?.deviceType, null);
});

test("routes carrying household data are refused", () => {
  // The whole point of the route check: a query string or fragment can carry a
  // search term or an id, and this endpoint is public.
  assert.equal(isCleanRoute("/shopping?q=nappies"), false);
  assert.equal(isCleanRoute("/recipes#chicken-pie"), false);
  assert.equal(isCleanRoute("/calendar?date=2026-08-19"), false);
  assert.equal(parseVitalReport({ ...valid, route: "/shopping?q=nappies" }), null);
});

test("route shapes that are legitimate are accepted", () => {
  assert.equal(isCleanRoute("/"), true);
  assert.equal(isCleanRoute("/shopping"), true);
  assert.equal(isCleanRoute("/calendar/[id]"), true);
  assert.equal(isCleanRoute("/api/calendar.ics"), true);
});

test("a route must be a path, and a bounded one", () => {
  assert.equal(isCleanRoute("shopping"), false);
  assert.equal(isCleanRoute("https://evil.example/x"), false);
  assert.equal(isCleanRoute(`/${"a".repeat(200)}`), false);
  assert.equal(isCleanRoute("/shopping<script>"), false);
});

test("unknown metrics and ratings are refused", () => {
  assert.equal(parseVitalReport({ ...valid, metric: "FID" }), null);
  assert.equal(parseVitalReport({ ...valid, rating: "excellent" }), null);
});

test("values that are not finite non-negative numbers are refused", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1234", null]) {
    assert.equal(parseVitalReport({ ...valid, value }), null, `accepted ${String(value)}`);
  }
});

test("an absurd duration is refused but a long real one is kept", () => {
  assert.equal(parseVitalReport({ ...valid, metric: "INP", value: 3_600_001 }), null);
  // A page left open for an hour can genuinely produce an INP this large.
  assert.ok(parseVitalReport({ ...valid, metric: "INP", value: 3_000_000 }));
});

test("CLS is bounded far tighter than the duration metrics", () => {
  assert.ok(parseVitalReport({ ...valid, metric: "CLS", value: 0.05 }));
  assert.equal(parseVitalReport({ ...valid, metric: "CLS", value: 101 }), null);
});

test("junk bodies are refused rather than thrown on", () => {
  for (const body of [null, undefined, "string", 42, [], {}]) {
    assert.equal(parseVitalReport(body), null, `accepted ${JSON.stringify(body)}`);
  }
});
