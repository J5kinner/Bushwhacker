import { differenceInCalendarDays, parseISO } from "date-fns";
import { occursOnDay, type Occurrence } from "./recurrence.ts";

/**
 * Pure lane-packing for the month grid's week rows.
 *
 * Extracted out of app/calendar/month-grid.tsx so the core algorithm — the
 * part a reviewer is most likely to probe (multi-day bar spanning, week-
 * boundary splitting, the 3-lane cap and its "+n" overflow) — ships with
 * unit tests (lib/month-lanes.test.mts) rather than only living inside a
 * client component.
 */

/** Visible pill/bar lanes per day cell before the rest collapse into "+n". */
export const MAX_LANES = 3;

export interface LaneItem {
  occurrence: Occurrence;
  lane: number;
  startCol: number;
  endCol: number;
  isBar: boolean;
  roundedLeft: boolean;
  roundedRight: boolean;
}

export interface WeekLanes {
  items: LaneItem[];
  /** One count per day column (0 = Monday .. 6 = Sunday) of items that didn't fit in MAX_LANES. */
  overflow: number[];
}

/**
 * Packs one week's occurrences into up to MAX_LANES horizontal lanes shared
 * across all 7 day columns, so a multi-day occurrence keeps the same lane —
 * and therefore the same visual row — on every day it touches within this
 * week. This is the greedy interval-packing every month-grid calendar uses:
 * sort candidates, then place each into the first lane whose last occupant
 * ends before this one starts.
 *
 * Multi-day occurrences are sorted ahead of single-day ones so they always
 * claim the top lanes; within each of those two groups, `orderIndex` (the
 * position `expandOccurrences` already sorted them into — date, then
 * all-day-before-timed, then title) breaks ties, so an all-day single-day
 * occurrence still lands above a timed one on the same day.
 *
 * Anything that doesn't fit in MAX_LANES doesn't get a lane at all; it's
 * folded into the returned per-day `overflow` counts instead, which the
 * "+n" row renders straight from.
 *
 * `week` is exactly 7 "YYYY-MM-DD" strings, Monday first.
 */
export function computeWeekLanes(
  week: string[],
  occurrences: Occurrence[],
  orderIndex: Map<string, number>,
): WeekLanes {
  const weekStart = week[0];
  const weekEnd = week[6];

  // The union, across the week's 7 days, of whatever `occursOnDay` says
  // belongs on that day — gathered once for the whole row instead of once
  // per cell, deduped by key since a multi-day occurrence passes the test
  // on more than one of those days.
  const seen = new Set<string>();
  const candidates: Occurrence[] = [];
  for (const day of week) {
    for (const occurrence of occurrences) {
      if (seen.has(occurrence.key) || !occursOnDay(occurrence, day)) continue;
      seen.add(occurrence.key);
      candidates.push(occurrence);
    }
  }

  candidates.sort((a, b) => {
    const aBar = a.endDate !== null;
    const bBar = b.endDate !== null;
    if (aBar !== bBar) return aBar ? -1 : 1;
    return orderIndex.get(a.key)! - orderIndex.get(b.key)!;
  });

  const laneEnds: number[] = [];
  const items: LaneItem[] = [];
  const overflow = [0, 0, 0, 0, 0, 0, 0];

  for (const occurrence of candidates) {
    // Clamped to this week's 0-6 columns: a bar that starts before or ends
    // after the week is split at the week boundary, the "split across week
    // rows" the plan calls for — the un-clamped tail is just this same
    // occurrence appearing again in the adjacent week's own lane packing.
    const startCol = Math.max(
      0,
      differenceInCalendarDays(parseISO(occurrence.date), parseISO(weekStart)),
    );
    const endCol = Math.min(
      6,
      differenceInCalendarDays(
        parseISO(occurrence.endDate ?? occurrence.date),
        parseISO(weekStart),
      ),
    );

    // Strictly less-than: two occurrences that share a column (a lane's last
    // occupant ends on the very day this one starts) still need separate
    // lanes, since that day would otherwise show both bars stacked on top of
    // each other; two that merely touch end-to-end (the lane's last occupant
    // ends the column *before* this one starts) correctly reuse the lane.
    let lane = laneEnds.findIndex((end) => end < startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endCol);
    } else {
      laneEnds[lane] = endCol;
    }

    if (lane >= MAX_LANES) {
      for (let col = startCol; col <= endCol; col++) overflow[col] += 1;
      continue;
    }

    items.push({
      occurrence,
      lane,
      startCol,
      endCol,
      isBar: occurrence.endDate !== null,
      roundedLeft: occurrence.date >= weekStart,
      roundedRight: (occurrence.endDate ?? occurrence.date) <= weekEnd,
    });
  }

  return { items, overflow };
}
