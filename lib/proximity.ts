/**
 * How close the two household members are, for the warmth meter on the Location
 * page — the hotter/colder game, played with real coordinates.
 *
 * Pure and dependency-free (nothing from `@/db` may be imported here, since the
 * meter renders in a client component), so the band boundaries and the two
 * honesty rules below are unit-testable without a database, a phone, or a
 * browser.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** One member's stored position, as the meter needs it. */
export interface MemberFix extends Coordinates {
  /** Horizontal uncertainty in metres, or null when the sender omitted it. */
  accuracyM: number | null;
  capturedAt: Date;
}

export interface ProximityBand {
  key: string;
  emoji: string;
  word: string;
  blurb: string;
  /**
   * 0 for the coldest band, 1 for the warmest. Drives how far apart the two
   * figures sit on the track, so the visual and the wording can never disagree.
   */
  warmth: number;
  /** Upper bound of the band in metres; the last band is unbounded. */
  maxDistanceM: number;
}

/**
 * Coldest to warmest. Seven bands, not nine: a ladder needs to read
 * monotonically, and for a two-person household the extra rungs never fire.
 */
export const BANDS: readonly ProximityBand[] = [
  {
    key: "together",
    emoji: "💞",
    word: "Together",
    blurb: "You found each other",
    warmth: 1,
    maxDistanceM: 50,
  },
  {
    key: "hot",
    emoji: "🔥",
    word: "Hot",
    blurb: "Same building, near enough",
    warmth: 5 / 6,
    maxDistanceM: 250,
  },
  {
    key: "warmer",
    emoji: "☀️",
    word: "Warmer",
    blurb: "Just down the street",
    warmth: 4 / 6,
    maxDistanceM: 1_000,
  },
  {
    key: "warm",
    emoji: "🌤️",
    word: "Warm",
    blurb: "Same neighbourhood",
    warmth: 3 / 6,
    maxDistanceM: 5_000,
  },
  {
    key: "cool",
    emoji: "🌬️",
    word: "Cool",
    blurb: "Across town",
    warmth: 2 / 6,
    maxDistanceM: 25_000,
  },
  {
    key: "cold",
    emoji: "❄️",
    word: "Cold",
    blurb: "Other side of the city",
    warmth: 1 / 6,
    maxDistanceM: 100_000,
  },
  {
    key: "freezing",
    emoji: "🧊",
    word: "Freezing",
    blurb: "Different postcode entirely",
    warmth: 0,
    maxDistanceM: Number.POSITIVE_INFINITY,
  },
];

/**
 * A fix older than this stops counting as a live reading, and the meter says so
 * in its caption. It no longer withholds the reading itself: in practice a
 * phone reports far less often than this, so an age-based grey-out was on
 * permanently and signalled nothing.
 *
 * Fifteen minutes matches the interval an OwnTracks phone in significant-change
 * mode can comfortably beat while stationary.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** Why a reading is not trustworthy, or null when it is. */
export type Doubt = "imprecise";

export interface ProximityReading {
  distanceM: number;
  band: ProximityBand;
  /**
   * Null when the reading can be believed. Otherwise the reason it cannot, and
   * the meter greys out rather than asserting a temperature:
   *
   * - `imprecise` — the senders' combined error is wider than the whole band
   *   the distance landed in, so we cannot honestly place them in it. A
   *   wifi-derived fix is routinely accurate to a kilometre or two, which
   *   swallows the three warmest bands whole.
   *
   * Age is deliberately not a reason. It is reported as an "as of" caption
   * instead — see STALE_AFTER_MS.
   *
   * Note the error is weighed against the band's own scale, not against the raw
   * distance. Comparing it to the distance would make "together" unreachable:
   * two people genuinely standing next to each other measure a few metres
   * apart, which any accuracy figure exceeds.
   */
  doubt: Doubt | null;
  /** The older of the two fixes — what any "as of" wording should quote. */
  measuredAt: Date;
}

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres between two coordinates, by the haversine
 * formula. Accurate to well within a metre at household scale, which is far
 * inside the accuracy any phone reports.
 */
export function distanceBetween(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  // Clamped before the root: floating-point error can push h a hair above 1 for
  // antipodal points, and Math.asin would return NaN.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The band a distance falls into. Never null — the last band is unbounded. */
export function bandForDistance(distanceM: number): ProximityBand {
  return BANDS.find((band) => distanceM <= band.maxDistanceM) ?? BANDS[BANDS.length - 1];
}

/**
 * The proximity reading for two members' fixes, including whether it can be
 * believed.
 */
export function resolveProximity(a: MemberFix, b: MemberFix): ProximityReading {
  const distanceM = distanceBetween(a, b);
  const band = bandForDistance(distanceM);
  const measuredAt = a.capturedAt <= b.capturedAt ? a.capturedAt : b.capturedAt;

  const combinedErrorM = (a.accuracyM ?? 0) + (b.accuracyM ?? 0);
  const doubt: Doubt | null =
    combinedErrorM > band.maxDistanceM ? "imprecise" : null;

  return { distanceM, band, doubt, measuredAt };
}

/** A distance rounded for display: metres up close, kilometres beyond that. */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1_000) return `${Math.round(distanceM)} m`;
  const km = distanceM / 1_000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
