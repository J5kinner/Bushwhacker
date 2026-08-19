import { occursOnDay, type Occurrence } from "./recurrence.ts";

/**
 * Pure positioning maths for the day view's vertical hour grid.
 *
 * Extracted the same way lib/month-lanes.ts is: the part a reviewer is most
 * likely to probe (overlap column packing, the cross-midnight clamp) ships
 * with unit tests (lib/time-grid.test.mts) rather than only living inside a
 * client component.
 */

/** Minutes in a calendar day — the denominator every top/height percentage in app/calendar/day-timegrid.tsx is expressed against. */
export const MINUTES_PER_DAY = 1440;

/** Duration assumed for a timed occurrence with no `endTime` (design decision 1 allows a timed event to omit it). */
const DEFAULT_DURATION_MINUTES = 60;

/** Floor on a block's rendered height so a short event (e.g. a 10-minute appointment) stays big enough to tap. */
export const MIN_BLOCK_HEIGHT_MINUTES = 30;

export interface TimedBlock {
  occurrence: Occurrence;
  /** Minutes after midnight the block starts — a percentage of MINUTES_PER_DAY is `top`. */
  topMinutes: number;
  /** Minutes the block spans — a percentage of MINUTES_PER_DAY is `height`. */
  heightMinutes: number;
  /** This block's 0-indexed side-by-side column within its overlap group. */
  column: number;
  /** Total columns its overlap group was split into (>= 1; 1 means it has the day column to itself). */
  columns: number;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The top/height (in minutes) of one occurrence's block on `day`, or null
 * when it doesn't belong in the hour grid for `day` at all: either it's
 * all-day (routed to allDayOccurrencesForDay instead), or `day` isn't its
 * own start date — an occurrence's identity is its start date, so a
 * multi-day timed occurrence is only ever positioned in the hour grid on
 * the day it starts (see the cross-midnight comment below for what happens
 * on the days after that).
 */
function blockExtent(
  occurrence: Occurrence,
  day: string,
): { topMinutes: number; heightMinutes: number } | null {
  const { event } = occurrence;
  if (!event.startTime || occurrence.date !== day) return null;

  const topMinutes = timeToMinutes(event.startTime);
  const spillsToLaterDay = occurrence.endDate !== null && occurrence.endDate !== occurrence.date;

  // Cross-midnight rule (plan decision 1): `endTime` belongs to
  // `endDate ?? startDate`. An occurrence whose end lands on a later date
  // therefore has no meaningful "end time" on ITS OWN start day, so it
  // simply clamps at 24:00 there; the day(s) it spans after that show as an
  // all-day bar in the strip (allDayOccurrencesForDay), not a continuation
  // of the hour grid across further day columns — the simplest honest
  // treatment of a shape the vertical view was never designed to depict as
  // a timed block.
  const endMinutes = spillsToLaterDay
    ? MINUTES_PER_DAY
    : event.endTime
      ? timeToMinutes(event.endTime)
      : topMinutes + DEFAULT_DURATION_MINUTES;

  // Clamped to the day a second time here (not just via the branch above) so
  // a same-day event with no explicit endTime whose default duration would
  // otherwise run past midnight (e.g. a 23:30 start) also stays within this
  // day's grid, rather than reporting a heightMinutes that overflows it.
  const heightMinutes = Math.max(
    Math.min(endMinutes, MINUTES_PER_DAY) - topMinutes,
    MIN_BLOCK_HEIGHT_MINUTES,
  );

  return { topMinutes, heightMinutes };
}

/**
 * Positioned timed blocks for one day column, with overlapping blocks split
 * into side-by-side columns.
 *
 * Blocks are sorted by start time, then walked once to merge any whose
 * intervals chain together (A overlaps B, B overlaps C) into a single
 * overlap group — transitively, so A and C land in the same group even if
 * their own two intervals don't touch. Each group is then split into
 * exactly as many side-by-side columns as it has members, in that same
 * sorted order: simpler than true interval-graph colouring (which would
 * compact A and C back into one column here, since they don't actually
 * overlap) at the cost of occasionally using a column more than the strict
 * minimum — a harmless empty gap rather than a visual collision, and much
 * easier to reason about and test than a compacting packer.
 */
export function timedBlocksForDay(occurrences: Occurrence[], day: string): TimedBlock[] {
  const extents = occurrences
    .map((occurrence) => {
      const extent = blockExtent(occurrence, day);
      return extent ? { occurrence, ...extent } : null;
    })
    .filter((e): e is { occurrence: Occurrence; topMinutes: number; heightMinutes: number } => e !== null);

  // Stable sort: start time, then title, then key — so two blocks starting
  // at the same minute still get a deterministic column order.
  extents.sort((a, b) => {
    if (a.topMinutes !== b.topMinutes) return a.topMinutes - b.topMinutes;
    if (a.occurrence.event.title !== b.occurrence.event.title) {
      return a.occurrence.event.title < b.occurrence.event.title ? -1 : 1;
    }
    return a.occurrence.key < b.occurrence.key ? -1 : a.occurrence.key > b.occurrence.key ? 1 : 0;
  });

  const blocks: TimedBlock[] = [];

  function flushGroup(start: number, end: number) {
    const columns = end - start;
    for (let i = start; i < end; i++) {
      const e = extents[i];
      blocks.push({
        occurrence: e.occurrence,
        topMinutes: e.topMinutes,
        heightMinutes: e.heightMinutes,
        column: i - start,
        columns,
      });
    }
  }

  let groupStart = 0;
  let groupEnd = -Infinity; // the running group's furthest-reaching bottom edge so far
  for (let i = 0; i < extents.length; i++) {
    const e = extents[i];
    if (e.topMinutes < groupEnd) {
      groupEnd = Math.max(groupEnd, e.topMinutes + e.heightMinutes);
    } else {
      if (i > groupStart) flushGroup(groupStart, i);
      groupStart = i;
      groupEnd = e.topMinutes + e.heightMinutes;
    }
  }
  if (extents.length > 0) flushGroup(groupStart, extents.length);

  return blocks;
}

/**
 * All-day occurrences for the strip under the day header: true all-day
 * occurrences, plus any timed occurrence's spillover days — every day of a
 * multi-day timed occurrence's span EXCEPT its own start date, which
 * belongs to the hour grid instead (see blockExtent's cross-midnight
 * comment).
 */
export function allDayOccurrencesForDay(occurrences: Occurrence[], day: string): Occurrence[] {
  return occurrences.filter((occurrence) => {
    if (!occursOnDay(occurrence, day)) return false;
    if (!occurrence.event.startTime) return true;
    return occurrence.date !== day;
  });
}
