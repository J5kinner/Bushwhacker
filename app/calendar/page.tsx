import { addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { getCalendarWindow, getHouseholdMembers } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { CalendarEvents } from "./calendar-events";

export const dynamic = "force-dynamic";

const MONTH_PARAM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * `?m=` -> the requested anchor month, or null for an absent/invalid value
 * (an invalid value is silently ignored rather than erroring — a stale/
 * malformed bookmark just falls back to the default window below).
 *
 * The anchor is built from `Date.UTC` on the parsed year/month rather than by
 * letting date-fns' `parseISO`/`new Date(string)` interpret the string, so it
 * lands on the 1st at UTC midnight regardless of how those parsers would
 * otherwise treat a bare "YYYY-MM" — matching `currentUtcMonthStart` below,
 * which is built the same way, so the two are always on the same footing.
 */
function parseAnchorMonth(value: string | undefined): { anchor: Date; anchorMonth: string } | null {
  const match = value ? MONTH_PARAM_RE.exec(value) : null;
  if (!match) return null;
  const [anchorMonth, year, month] = match;
  return { anchor: new Date(Date.UTC(Number(year), Number(month) - 1, 1)), anchorMonth };
}

function currentUtcMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const requested = parseAnchorMonth(m);
  // No `?m=` (or an invalid one) defaults to the current UTC month — the
  // agenda's own "today" is device-local (see agenda.tsx), so this default is
  // only ever a window boundary, never shown to the user as "today".
  const anchor = requested?.anchor ?? currentUtcMonthStart();
  const anchorMonth = requested?.anchorMonth ?? null;

  // Month-aligned window: -1/+13 months around the anchor. Aligning to month
  // boundaries keeps the cache key stable while browsing within a month, and
  // the generous bounds mean client-side day logic (agenda.tsx) owns "does
  // this occurrence actually belong on screen" — the server clock is UTC,
  // which is already tomorrow by an Australian morning.
  const windowFrom = format(startOfMonth(subMonths(anchor, 1)), "yyyy-MM-dd");
  const windowTo = format(endOfMonth(addMonths(anchor, 13)), "yyyy-MM-dd");

  const [{ events, exdates }, members, setupIssue] = await Promise.all([
    getCalendarWindow(windowFrom, windowTo),
    getHouseholdMembers(),
    getSetupIssue(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Calendar</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <CalendarEvents
        initialEvents={events}
        exdates={exdates}
        windowFrom={windowFrom}
        windowTo={windowTo}
        anchorMonth={anchorMonth}
        members={members}
      />
    </div>
  );
}
