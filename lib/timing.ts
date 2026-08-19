/**
 * Server-side timing for database reads.
 *
 * Speed Insights measures the browser, so it can say a route has a bad TTFB
 * but never that a particular Neon read is why. Vercel's answer to that is
 * OpenTelemetry via Drains, which is Pro-and-above; this is the free
 * equivalent. See ADR 0011.
 *
 * Only slow reads are logged, and never with their arguments — a household id
 * or date window is household data, and the operation name alone locates the
 * query.
 */

export type Timing = { name: string; ms: number };

/**
 * Override once there is field data to pick a better number. 200ms is roughly
 * where a read stops being invisible inside a mobile page load, and is well
 * clear of a warm Neon round trip from the same region.
 */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 200);

/**
 * Takes a PromiseLike rather than a Promise because a Drizzle query builder is
 * a thenable, and call sites pass one directly.
 */
export async function measure<T>(
  name: string,
  fn: () => PromiseLike<T>,
): Promise<{ result: T; timing: Timing }> {
  const started = performance.now();
  try {
    const result = await fn();
    return { result, timing: { name, ms: performance.now() - started } };
  } catch (error) {
    report({ name, ms: performance.now() - started }, error);
    throw error;
  }
}

/**
 * Returns `fn`'s result untouched, so a call site can be wrapped without
 * changing its shape or type.
 */
export async function timed<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
  const { result, timing } = await measure(name, fn);
  report(timing);
  return result;
}

/**
 * One JSON line per slow read, because Vercel's log viewer is grep rather than
 * a query engine. Failures are always reported, however fast they were.
 */
function report(timing: Timing, error?: unknown): void {
  if (timing.ms < SLOW_QUERY_MS && !error) return;

  console.warn(
    JSON.stringify({
      evt: "slow_query",
      name: timing.name,
      ms: Math.round(timing.ms),
      ...(error ? { failed: true } : {}),
    }),
  );
}

/**
 * Usable only where we build the Response ourselves. A server-rendered page
 * cannot set a response header from inside the render, so page reads rely on
 * the log path instead.
 */
export function serverTimingHeader(timings: Timing[]): string {
  return timings.map(({ name, ms }) => `${name};dur=${ms.toFixed(1)}`).join(", ");
}
