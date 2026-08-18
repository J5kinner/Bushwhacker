const MONTH_PARAM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A calendar month, 1-12 (not JS `Date`'s 0-based convention). */
export interface CalendarMonth {
  year: number;
  month: number;
}

export interface CalendarWindow {
  anchorMonth: string | null;
  windowFrom: string;
  windowTo: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function monthKey({ year, month }: CalendarMonth): string {
  return `${year}-${pad2(month)}`;
}

/**
 * Adds `delta` months to a (year, 1-12 month) pair with plain integer
 * arithmetic — no `Date` round-trip. Routing a UTC-constructed instant
 * through date-fns' local-time `addMonths`/`endOfMonth` would only produce
 * the right answer because Vercel happens to run with `TZ=UTC`; this has no
 * such dependency to verify against the deploy target.
 */
function addMonths({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const total = year * 12 + (month - 1) + delta;
  const normalisedMonth = ((total % 12) + 12) % 12;
  return { year: Math.floor(total / 12), month: normalisedMonth + 1 };
}

/**
 * The number of days in a (year, 1-12 month), via the "day 0" trick: handing
 * our 1-based month straight to `Date`'s (0-based) month argument names the
 * NEXT calendar month, so day 0 of it is the last day of the one we want.
 * Built from integer components only (never a parsed string or a UTC
 * instant), so — like `addMonths` above — this is TZ-independent: the local
 * calendar day of a `Date` constructed from its own numeric y/m/d fields
 * always matches those fields, on any clock.
 */
function daysInMonth({ year, month }: CalendarMonth): number {
  return new Date(year, month, 0).getDate();
}

/** "YYYY-MM" -> a validated (year, month) pair, or null if malformed/absent. */
function parseMonthParam(value: string | undefined): CalendarMonth | null {
  const match = value ? MONTH_PARAM_RE.exec(value) : null;
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Resolves the calendar page's `?m=` search param into the agenda's anchor
 * month and read window (see app/calendar/page.tsx, which is the only
 * caller). An invalid/absent `mParam` is silently ignored rather than
 * erroring — a stale or malformed bookmark just falls back to the default.
 *
 * `nowUtcMonth` is the caller's current UTC (year, month) rather than
 * something read from `Date.now()` in here, so this function stays pure and
 * unit-testable — the same reason `lib/queries.ts`'s `getCalendarWindow`
 * never computes "today" inside the cached function it wraps.
 *
 * The window is month-aligned (first day of anchor-1 month through the last
 * day of anchor+13 months) so `getCalendarWindow`'s cache key stays stable
 * while browsing within a month; the generous +/-bounds leave "does this
 * occurrence actually belong on screen" to client-side day logic
 * (app/calendar/agenda.tsx), which uses the device clock rather than this
 * server-side UTC one.
 */
export function resolveCalendarWindow(
  mParam: string | undefined,
  nowUtcMonth: CalendarMonth,
): CalendarWindow {
  const requested = parseMonthParam(mParam);
  const anchor = requested ?? nowUtcMonth;
  const anchorMonth = requested ? monthKey(requested) : null;

  const from = addMonths(anchor, -1);
  const to = addMonths(anchor, 13);

  return {
    anchorMonth,
    windowFrom: `${from.year}-${pad2(from.month)}-01`,
    windowTo: `${to.year}-${pad2(to.month)}-${pad2(daysInMonth(to))}`,
  };
}
