export const METRICS = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;
export type Metric = (typeof METRICS)[number];

export const RATINGS = ["good", "needs-improvement", "poor"] as const;
export type Rating = (typeof RATINGS)[number];

export const DEVICE_TYPES = ["mobile", "desktop"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface VitalReport {
  route: string;
  metric: Metric;
  value: number;
  rating: Rating;
  deviceType: DeviceType | null;
}

/**
 * CLS is a unitless ratio in the low single digits; every other metric is a
 * duration in milliseconds. A page kept open for hours can legitimately produce
 * a very large INP, so the ceiling is generous — it exists to reject nonsense,
 * not to cap real measurements.
 */
const MAX_VALUE: Record<Metric, number> = {
  CLS: 100,
  LCP: 3_600_000,
  INP: 3_600_000,
  FCP: 3_600_000,
  TTFB: 3_600_000,
};

/**
 * Rejects anything that is not a route path, which is what keeps household data
 * out of this table. Next.js hands us a pathname, but this is an unauthenticated
 * public endpoint, so the shape is enforced here rather than assumed.
 *
 * Query strings and fragments are refused outright rather than stripped: a
 * caller sending one is not sending what we asked for, and silently repairing
 * it would hide that.
 */
export function isCleanRoute(route: string): boolean {
  if (!route.startsWith("/") || route.length > 128) return false;
  if (route.includes("?") || route.includes("#")) return false;
  return /^\/[A-Za-z0-9\-._~/[\]]*$/.test(route);
}

/**
 * Parses an untrusted request body into a report, or returns null. Returning
 * null rather than throwing keeps the endpoint's "always 204" contract simple:
 * a malformed beacon is dropped, never retried.
 */
export function parseVitalReport(body: unknown): VitalReport | null {
  if (typeof body !== "object" || body === null) return null;
  const { route, metric, value, rating, deviceType } = body as Record<string, unknown>;

  if (typeof route !== "string" || !isCleanRoute(route)) return null;
  if (typeof metric !== "string" || !METRICS.includes(metric as Metric)) return null;
  if (typeof rating !== "string" || !RATINGS.includes(rating as Rating)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value > MAX_VALUE[metric as Metric]) return null;

  const device =
    typeof deviceType === "string" && DEVICE_TYPES.includes(deviceType as DeviceType)
      ? (deviceType as DeviceType)
      : null;

  return {
    route,
    metric: metric as Metric,
    value,
    rating: rating as Rating,
    deviceType: device,
  };
}
