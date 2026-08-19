import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distanceBetween,
  bandForDistance,
  resolveProximity,
  formatDistance,
  BANDS,
} from "./proximity.ts";

const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };

/** One degree of latitude on a sphere of radius 6371 km, in metres. */
const DEGREE_M = (6_371_000 * Math.PI) / 180;

const fix = (
  latitude: number,
  longitude: number,
  accuracyM: number | null = 10,
  capturedAt = new Date("2026-08-10T12:00:00Z"),
) => ({ latitude, longitude, accuracyM, capturedAt });

test("distanceBetween is zero for the same point", () => {
  assert.equal(distanceBetween(MELBOURNE, MELBOURNE), 0);
});

test("distanceBetween measures a degree of latitude", () => {
  const north = { ...MELBOURNE, latitude: MELBOURNE.latitude + 1 };
  assert.ok(Math.abs(distanceBetween(MELBOURNE, north) - DEGREE_M) < 1);
});

test("distanceBetween narrows a degree of longitude by latitude", () => {
  // A degree of longitude shrinks by cos(latitude): full width at the equator,
  // half at 60 degrees.
  const equator = { latitude: 0, longitude: 0 };
  assert.ok(
    Math.abs(distanceBetween(equator, { latitude: 0, longitude: 1 }) - DEGREE_M) < 1,
  );

  const high = { latitude: 60, longitude: 0 };
  const highSpan = distanceBetween(high, { latitude: 60, longitude: 1 });
  assert.ok(Math.abs(highSpan - DEGREE_M / 2) < 200);
});

test("distanceBetween is symmetric", () => {
  const other = { latitude: -37.9, longitude: 145.1 };
  assert.equal(distanceBetween(MELBOURNE, other), distanceBetween(other, MELBOURNE));
});

test("distanceBetween survives antipodal points", () => {
  // Floating-point error can push the haversine term above 1 here; unclamped,
  // Math.asin would return NaN.
  const antipode = { latitude: 37.8136, longitude: -35.0369 };
  const d = distanceBetween(MELBOURNE, antipode);
  assert.ok(Number.isFinite(d));
  assert.ok(d > 19_000_000);
});

test("bandForDistance picks the band at and below each boundary", () => {
  assert.equal(bandForDistance(0).key, "together");
  assert.equal(bandForDistance(50).key, "together");
  assert.equal(bandForDistance(51).key, "hot");
  assert.equal(bandForDistance(250).key, "hot");
  assert.equal(bandForDistance(251).key, "warmer");
  assert.equal(bandForDistance(1_000).key, "warmer");
  assert.equal(bandForDistance(5_000).key, "warm");
  assert.equal(bandForDistance(25_000).key, "cool");
  assert.equal(bandForDistance(100_000).key, "cold");
  assert.equal(bandForDistance(100_001).key, "freezing");
  assert.equal(bandForDistance(9_000_000).key, "freezing");
});

test("bands run monotonically from cold to hot", () => {
  for (let i = 1; i < BANDS.length; i++) {
    assert.ok(
      BANDS[i].maxDistanceM > BANDS[i - 1].maxDistanceM,
      `band ${BANDS[i].key} must bound a wider distance than ${BANDS[i - 1].key}`,
    );
    assert.ok(
      BANDS[i].warmth < BANDS[i - 1].warmth,
      `band ${BANDS[i].key} must be cooler than ${BANDS[i - 1].key}`,
    );
  }
  assert.equal(BANDS[0].warmth, 1);
  assert.equal(BANDS[BANDS.length - 1].warmth, 0);
});

test("resolveProximity trusts two precise fixes", () => {
  const reading = resolveProximity(fix(-37.8136, 144.9631), fix(-37.8137, 144.9632));
  assert.equal(reading.doubt, null);
  assert.equal(reading.band.key, "together");
  assert.ok(reading.distanceM < 50);
});

test("resolveProximity trusts a precise fix however old it is", () => {
  // Age used to grey the meter out. It no longer does: a day-old pair of
  // precise fixes still resolves a believable band, captioned with its age.
  const old = new Date("2026-08-09T12:00:00Z");
  const reading = resolveProximity(
    fix(-37.8136, 144.9631, 10, old),
    fix(-37.8137, 144.9632, 10, old),
  );
  assert.equal(reading.doubt, null);
  assert.equal(reading.band.key, "together");
});

test("resolveProximity reports the older fix as the measurement time", () => {
  const older = new Date("2026-08-10T11:58:00Z");
  const newer = new Date("2026-08-10T12:00:00Z");
  assert.equal(
    resolveProximity(fix(0, 0, 10, newer), fix(0, 0, 10, older)).measuredAt.getTime(),
    older.getTime(),
  );
  assert.equal(
    resolveProximity(fix(0, 0, 10, older), fix(0, 0, 10, newer)).measuredAt.getTime(),
    older.getTime(),
  );
});

test("resolveProximity trusts 'together' at ordinary GPS accuracy", () => {
  // The case that matters most, and the one an error-versus-distance rule gets
  // wrong: two people standing next to each other measure a few metres apart,
  // which any accuracy figure exceeds. Weighed against the band's own 50 m
  // scale, a pair of 10 m fixes is plenty.
  const reading = resolveProximity(
    fix(-37.8136, 144.9631, 10),
    fix(-37.81361, 144.96311, 10),
  );
  assert.equal(reading.band.key, "together");
  assert.equal(reading.doubt, null);
});

test("resolveProximity distrusts an error wider than the whole band", () => {
  // Two wifi-grade fixes ~300 m apart, each accurate to 2 km. That lands in
  // "warmer", whose entire span is 1 km — the 4 km combined error swallows it.
  const reading = resolveProximity(
    fix(-37.8136, 144.9631, 2_000),
    fix(-37.8163, 144.9631, 2_000),
  );
  assert.equal(reading.band.key, "warmer");
  assert.equal(reading.doubt, "imprecise");
});

test("resolveProximity trusts a wide gap despite loose accuracy", () => {
  // The same loose fixes ~50 km apart. That is the "cold" band, spanning to
  // 100 km, so a 3 km combined error changes nothing.
  const reading = resolveProximity(
    fix(-37.8136, 144.9631, 1_500),
    fix(-37.3636, 144.9631, 1_500),
  );
  assert.equal(reading.band.key, "cold");
  assert.equal(reading.doubt, null);
});

test("resolveProximity treats a missing accuracy as no reported error", () => {
  const reading = resolveProximity(
    fix(-37.8136, 144.9631, null),
    fix(-37.8226, 144.9631, null),
  );
  assert.equal(reading.doubt, null);
});

test("formatDistance switches from metres to kilometres", () => {
  assert.equal(formatDistance(0), "0 m");
  assert.equal(formatDistance(49.6), "50 m");
  assert.equal(formatDistance(999), "999 m");
  assert.equal(formatDistance(1_000), "1.0 km");
  assert.equal(formatDistance(3_450), "3.5 km");
  assert.equal(formatDistance(9_949), "9.9 km");
  assert.equal(formatDistance(12_400), "12 km");
  assert.equal(formatDistance(111_195), "111 km");
});
