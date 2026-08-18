"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eventColourHex } from "@/lib/event-colours";
import { occursOnDay, type Occurrence } from "@/lib/recurrence";
import type { CalendarViewProps } from "./view-switcher";
import { DaySheet } from "./day-sheet";

/** Visible pill/bar lanes per day cell before the rest collapse into "+n". */
const MAX_LANES = 3;
// Applied when an occurrence carries no lib/event-colours.ts value, mirroring
// the agenda's own default-dot styling so the two views read the same way.
const DEFAULT_DOT_CLASS = "bg-zinc-400 dark:bg-zinc-600";
const DEFAULT_BAR_CLASS = "bg-zinc-300 dark:bg-zinc-700/70";

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface LaneItem {
  occurrence: Occurrence;
  lane: number;
  startCol: number;
  endCol: number;
  isBar: boolean;
  roundedLeft: boolean;
  roundedRight: boolean;
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
 */
function computeWeekLanes(
  week: string[],
  occurrences: Occurrence[],
  orderIndex: Map<string, number>,
): { items: LaneItem[]; overflow: number[] } {
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

function WeekRow({
  week,
  displayedMonth,
  todayISO,
  occurrences,
  orderIndex,
  onDayClick,
}: {
  week: string[];
  displayedMonth: string;
  todayISO: string;
  occurrences: Occurrence[];
  orderIndex: Map<string, number>;
  onDayClick: (day: string) => void;
}) {
  const { items, overflow } = computeWeekLanes(week, occurrences, orderIndex);

  return (
    <div
      className="grid grid-cols-7"
      style={{
        // Row 1 holds the day number; MAX_LANES rows hold pills/bars; the
        // final row holds the "+n" overflow line. Every day-cell button
        // below spans the full stack (`gridRow: "1 / -1"`) so the whole
        // visual cell — number, pills, overflow line together — is one tap
        // target, while the pills/bars painted over it are purely visual
        // (`pointer-events-none`) and never intercept that tap.
        gridTemplateRows: `1.3rem repeat(${MAX_LANES}, 0.85rem) 0.7rem`,
      }}
    >
      {week.map((day, col) => {
        const dimmed = day.slice(0, 7) !== displayedMonth;
        const isToday = day === todayISO;
        return (
          <button
            key={day}
            type="button"
            onClick={() => onDayClick(day)}
            aria-label={format(parseISO(day), "EEEE d MMMM")}
            style={{ gridColumn: col + 1, gridRow: "1 / -1" }}
            className={`flex flex-col items-center border-b border-r border-black/5 pt-0.5 dark:border-white/10 ${
              dimmed ? "text-zinc-300 dark:text-zinc-700" : ""
            }`}
          >
            <span
              className={`flex size-5 items-center justify-center rounded-full text-[11px] ${
                isToday ? "bg-foreground text-background" : ""
              }`}
            >
              {format(parseISO(day), "d")}
            </span>
          </button>
        );
      })}

      {items.map(({ occurrence, lane, startCol, endCol, isBar, roundedLeft, roundedRight }) => {
        const colourHex = eventColourHex(occurrence.event.colour);
        const style: CSSProperties = {
          gridColumn: `${startCol + 1} / ${endCol + 2}`,
          gridRow: lane + 2,
        };

        // Multi-day/all-day occurrences render as a tinted, spanning bar;
        // single-day ones as a small colour dot plus title, matching the
        // agenda's own dot styling — two visual languages, used
        // consistently, rather than one style stretched to cover both.
        if (isBar) {
          if (colourHex) style.backgroundColor = hexToRgba(colourHex, 0.35);
          return (
            <div
              key={occurrence.key}
              aria-hidden
              style={style}
              className={`pointer-events-none mx-px flex items-center overflow-hidden px-1 text-[9px] leading-none ${
                colourHex ? "" : DEFAULT_BAR_CLASS
              } ${roundedLeft ? "rounded-l" : ""} ${roundedRight ? "rounded-r" : ""}`}
            >
              <span className="truncate">{occurrence.event.title}</span>
            </div>
          );
        }

        return (
          <div
            key={occurrence.key}
            aria-hidden
            style={style}
            className="pointer-events-none mx-0.5 flex items-center gap-0.5 overflow-hidden px-0.5 text-[9px] leading-none"
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${colourHex ? "" : DEFAULT_DOT_CLASS}`}
              style={colourHex ? { backgroundColor: colourHex } : undefined}
            />
            <span className="truncate">{occurrence.event.title}</span>
          </div>
        );
      })}

      {overflow.map((count, col) =>
        count > 0 ? (
          <div
            key={`overflow-${week[col]}`}
            aria-hidden
            style={{ gridColumn: col + 1, gridRow: MAX_LANES + 2 }}
            className="pointer-events-none text-center text-[8px] text-zinc-500"
          >
            +{count}
          </div>
        ) : null,
      )}
    </div>
  );
}

/**
 * The month grid: TimeTree's primary view, and the first entry in the view
 * switcher. Its own month-nav row mirrors the agenda's chevrons/"Today", but
 * the label here is a bare month name rather than "From <month>" — this view
 * is bounded to exactly one month, not a continuous forward list.
 */
export function MonthGrid({
  occurrences,
  members,
  anchorMonth,
  onOccurrenceClick,
}: CalendarViewProps) {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // The device clock, not the server's: the read window itself is computed
  // server-side from UTC (app/calendar/page.tsx), which can already be
  // tomorrow — or a different month entirely — by an Australian morning.
  // Which month shows by default and which cell is "today" both need to
  // match the phone in the user's hand, not Vercel's clock, same reasoning
  // as the agenda's device-local "today"/"tomorrow".
  const now = new Date();
  const todayISO = format(now, "yyyy-MM-dd");
  const displayedMonth = anchorMonth ?? todayISO.slice(0, 7);
  const displayedMonthStart = parseISO(`${displayedMonth}-01`);

  const gridStart = startOfWeek(startOfMonth(displayedMonthStart), {
    weekStartsOn: 1,
  });
  const gridEnd = endOfWeek(endOfMonth(displayedMonthStart), {
    weekStartsOn: 1,
  });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd }).map((d) =>
    format(d, "yyyy-MM-dd"),
  );
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // The same date/all-day/title order `expandOccurrences` already produced,
  // kept as a lookup so `computeWeekLanes` can use it as a tiebreaker
  // without re-sorting per week.
  const orderIndex = new Map(occurrences.map((o, i) => [o.key, i]));

  function goToMonth(monthDate: Date) {
    router.replace(`/calendar?m=${format(monthDate, "yyyy-MM")}`);
  }

  const dayOccurrences = selectedDay
    ? occurrences.filter((o) => occursOnDay(o, selectedDay))
    : [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToMonth(subMonths(displayedMonthStart, 1))}
            aria-label="Previous month"
            className="rounded-full p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-32 text-center text-sm font-medium">
            {format(displayedMonthStart, "MMMM yyyy")}
          </span>
          <button
            type="button"
            onClick={() => goToMonth(addMonths(displayedMonthStart, 1))}
            aria-label="Next month"
            className="rounded-full p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        {anchorMonth && (
          <button
            type="button"
            onClick={() => router.replace("/calendar")}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs dark:border-white/15"
          >
            Today
          </button>
        )}
      </div>

      <div className="border-l border-t border-black/5 dark:border-white/10">
        <div className="grid grid-cols-7 text-center text-[10px] font-medium text-zinc-500">
          {weeks[0].map((day) => (
            <div
              key={day}
              className="border-b border-r border-black/5 py-1 dark:border-white/10"
            >
              {format(parseISO(day), "EEEEE")}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <WeekRow
            key={week[0]}
            week={week}
            displayedMonth={displayedMonth}
            todayISO={todayISO}
            occurrences={occurrences}
            orderIndex={orderIndex}
            onDayClick={setSelectedDay}
          />
        ))}
      </div>

      {selectedDay && (
        <DaySheet
          date={selectedDay}
          occurrences={dayOccurrences}
          members={members}
          onOccurrenceClick={onOccurrenceClick}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}
