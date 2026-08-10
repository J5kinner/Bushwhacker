/**
 * Parsing for OwnTracks HTTP-mode publishes.
 *
 * OwnTracks (owntracks.org) is a free app on both stores that reports position
 * in the background using the native location permission a web page can never
 * hold. It POSTs JSON to a URL we choose. Only `_type: "location"` carries a
 * fix; the app also publishes `transition`, `waypoints` and `lwt` messages,
 * which we acknowledge and drop.
 *
 * Pure and dependency-free so the whole surface is unit-testable without a
 * database or a phone.
 */

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Horizontal uncertainty in metres, or null when the sender omitted it. */
  accuracyM: number | null;
  /** Sender battery percentage, or null when the sender omitted it. */
  batteryPct: number | null;
  /** When the fix was taken on the device, not when it reached us. */
  capturedAt: Date;
}

/** Largest value a Postgres smallint holds; accuracy is stored in one. */
const SMALLINT_MAX = 32_767;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number within [min, max], or null for anything else. */
function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * An optional integer reading, clamped into range rather than rejected: a
 * nonsense accuracy or battery value should not cost us an otherwise good fix,
 * and must not overflow its smallint column.
 */
function clampedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * A location fix from an OwnTracks publish, or null when the payload is not a
 * usable location — the wrong `_type`, missing coordinates, or values out of
 * range. Callers treat null as "acknowledge and ignore", never as an error.
 */
export function parseOwnTracksLocation(body: unknown): LocationFix | null {
  if (!isRecord(body)) return null;
  if (body._type !== "location") return null;

  const latitude = boundedNumber(body.lat, -90, 90);
  const longitude = boundedNumber(body.lon, -180, 180);
  // `tst` is a Unix timestamp in seconds. Guard the upper bound loosely so a
  // millisecond timestamp sent by mistake is rejected rather than landing in
  // the year 57000 and pinning the age label to "in 55,000 years".
  const seconds = boundedNumber(body.tst, 0, 4_000_000_000);
  if (latitude === null || longitude === null || seconds === null) return null;

  return {
    latitude,
    longitude,
    accuracyM: clampedInt(body.acc, 0, SMALLINT_MAX),
    batteryPct: clampedInt(body.batt, 0, 100),
    capturedAt: new Date(seconds * 1000),
  };
}
