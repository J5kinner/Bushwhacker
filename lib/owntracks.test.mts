import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnTracksLocation } from "./owntracks.ts";

// A real OwnTracks location publish, trimmed to the fields we use.
const location = {
  _type: "location",
  lat: -37.8136,
  lon: 144.9631,
  tst: 1754784000,
  acc: 12,
  batt: 68,
  tid: "JS",
};

test("parses a location publish", () => {
  assert.deepEqual(parseOwnTracksLocation(location), {
    latitude: -37.8136,
    longitude: 144.9631,
    accuracyM: 12,
    batteryPct: 68,
    capturedAt: new Date(1754784000 * 1000),
  });
});

test("ignores publishes that are not locations", () => {
  for (const type of ["transition", "waypoints", "lwt", "cmd"]) {
    assert.equal(parseOwnTracksLocation({ ...location, _type: type }), null);
  }
});

test("accepts a fix with no accuracy or battery", () => {
  const { acc, batt, ...withoutOptional } = location;
  assert.deepEqual(parseOwnTracksLocation(withoutOptional), {
    latitude: -37.8136,
    longitude: 144.9631,
    accuracyM: null,
    batteryPct: null,
    capturedAt: new Date(1754784000 * 1000),
  });
});

test("rejects a payload missing coordinates or timestamp", () => {
  assert.equal(parseOwnTracksLocation({ _type: "location", lat: -37.8 }), null);
  assert.equal(parseOwnTracksLocation({ _type: "location", lon: 144.9 }), null);
  assert.equal(
    parseOwnTracksLocation({ _type: "location", lat: -37.8, lon: 144.9 }),
    null,
  );
});

test("rejects coordinates outside their valid range", () => {
  assert.equal(parseOwnTracksLocation({ ...location, lat: 91 }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lat: -91 }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lon: 181 }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lon: -181 }), null);
});

test("rejects non-finite coordinates", () => {
  assert.equal(parseOwnTracksLocation({ ...location, lat: NaN }), null);
  assert.equal(parseOwnTracksLocation({ ...location, lon: Infinity }), null);
});

test("clamps accuracy and battery into their column ranges", () => {
  // accuracy_m and battery_pct are smallint; a nonsense reading must not throw
  // at the database. Accuracy caps at smallint max, battery at 0-100.
  const wide = parseOwnTracksLocation({ ...location, acc: 99_999, batt: 150 });
  assert.equal(wide?.accuracyM, 32_767);
  assert.equal(wide?.batteryPct, 100);

  const negative = parseOwnTracksLocation({ ...location, acc: -5, batt: -5 });
  assert.equal(negative?.accuracyM, 0);
  assert.equal(negative?.batteryPct, 0);
});

test("rejects a non-object body", () => {
  for (const body of [null, undefined, "location", 42, []]) {
    assert.equal(parseOwnTracksLocation(body), null);
  }
});
