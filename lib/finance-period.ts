/**
 * "YYYY-MM" period resolution for the Almanac's Finances section. Mirrors
 * lib/calendar-window.ts's shape and reasoning: `nowMonth` is passed in
 * rather than read from `Date.now()` here, so this stays pure and
 * unit-testable, and month arithmetic is plain integers — never a
 * `Date`/date-fns round-trip — so it carries no timezone assumption to
 * verify against the deploy target.
 */

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A calendar month, 1-12 (not JS `Date`'s 0-based convention). */
export interface FinanceMonth {
  year: number;
  month: number;
}

export interface FinancePeriodWindow {
  period: string;
  /** Inclusive "YYYY-MM-DD" bounds of the period. */
  from: string;
  to: string;
  prevPeriod: string;
  nextPeriod: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function periodKey({ year, month }: FinanceMonth): string {
  return `${year}-${pad2(month)}`;
}

function parsePeriodParam(value: string | undefined): FinanceMonth | null {
  const match = value ? PERIOD_RE.exec(value) : null;
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function addMonths({ year, month }: FinanceMonth, delta: number): FinanceMonth {
  const total = year * 12 + (month - 1) + delta;
  const normalisedMonth = ((total % 12) + 12) % 12;
  return { year: Math.floor(total / 12), month: normalisedMonth + 1 };
}

// The "day 0" trick: handing our 1-based month straight to `Date`'s (0-based)
// month argument names the NEXT calendar month, so day 0 of it is the last
// day of the one we want. Built from integer components only, so — like
// addMonths above — this is TZ-independent.
function daysInMonth({ year, month }: FinanceMonth): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Resolves the Finances section's `?fp=` search param into the active period
 * and its date range. An invalid/absent `fpParam` falls back to `nowMonth`.
 */
export function resolveFinancePeriod(
  fpParam: string | undefined,
  nowMonth: FinanceMonth,
): FinancePeriodWindow {
  const active = parsePeriodParam(fpParam) ?? nowMonth;
  return {
    period: periodKey(active),
    from: `${active.year}-${pad2(active.month)}-01`,
    to: `${active.year}-${pad2(active.month)}-${pad2(daysInMonth(active))}`,
    prevPeriod: periodKey(addMonths(active, -1)),
    nextPeriod: periodKey(addMonths(active, 1)),
  };
}
