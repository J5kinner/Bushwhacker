"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { eventColourHex } from "@/lib/event-colours";
import {
  allDayOccurrencesForDay,
  MINUTES_PER_DAY,
  timedBlocksForDay,
} from "@/lib/time-grid";
import type { CalendarViewProps } from "./view-switcher";

const DAY_COUNT = 3;
// 1 minute == 1px, so a block's top/height as a percentage of MINUTES_PER_DAY
// (computed below) lands on the same pixel a plain `${minutes}px` would —
// kept as percentages anyway per the grid's own contract, since that's what
// stays correct if this constant (or the grid's own height) ever changes.
const HOUR_ROW_PX = 60;
const GRID_HEIGHT_PX = 24 * HOUR_ROW_PX;
// Scrolls the grid so the start of the working day is roughly at the top on
// first mount, rather than opening on a scrolled-to-the-very-top 00:00.
const INITIAL_SCROLL_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const DEFAULT_DOT_CLASS = "bg-zinc-400 dark:bg-zinc-600";

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** An hour number (0-23) as a device-local "9 am"/"12 pm" label. */
function formatHourLabel(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return format(d, "h a").toLowerCase();
}

/**
 * A "HH:mm" (or "HH:mm:ss", the shape Drizzle's Postgres `time` columns
 * actually come back as) wall-clock string as a device-local "9:00 am".
 * Duplicated from agenda.tsx/day-sheet.tsx rather than imported — those
 * files export no helpers, only components — but kept byte-for-byte the same
 * behaviour so a time reads identically everywhere in the calendar tab,
 * including the block sub-label below, which used to print the raw
 * 24-hour string instead of matching this file's own formatHourLabel.
 */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return format(d, "h:mm a").toLowerCase();
}

// Server-rendered HTML runs in UTC; the device viewing it may already be
// 10-11 hours ahead, so reading the device clock straight off `new Date()`
// during render would make this component's SSR output and its first
// client render — which React's hydration must match byte-for-byte —
// disagree on which 3 days are even shown when there's no `?m=` anchor.
// See the identical comment on `today` in month-grid.tsx, which this
// useSyncExternalStore pattern is copied from rather than reinvented: the
// server (and the client's first hydration pass) always see the `null`
// server snapshot, and only afterwards does React ask for the real device
// value and re-render if it differs.
function subscribeToNothing() {
  return () => {};
}
function getDeviceToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}
function getServerToday(): string | null {
  return null;
}

/**
 * Minutes since local midnight, for the current-time indicator line. There
 * is no per-minute timer to keep this ticking — the 15s LiveRefresh poll (and
 * any other re-render, e.g. paging days) re-reads the clock via this same
 * useSyncExternalStore snapshot, which is close enough for a line marking
 * "roughly now" on a shared household calendar.
 */
function getDeviceMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
function getServerMinutes(): number | null {
  return null;
}

/**
 * Rendered instead of the real grid for the one render where the visible
 * days are still unresolved (no `?m=` and the device date hasn't resolved
 * yet) — mirrors month-grid.tsx's MonthGridSkeleton so there's no layout
 * shift once the real grid swaps in: a matching, inert nav row plus an
 * empty box fixed at the same height as the real scroll area.
 */
function DayTimeGridSkeleton() {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" disabled aria-hidden className="rounded-full p-2 text-zinc-500">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-32 text-center text-sm font-medium">&nbsp;</span>
          <button type="button" disabled aria-hidden className="rounded-full p-2 text-zinc-500">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <div style={{ height: "70dvh" }} className="rounded-lg border border-black/5 dark:border-white/10" />
    </div>
  );
}

/**
 * The 3-day vertical hour grid: TimeTree premium's "vertical view". Always
 * shows exactly DAY_COUNT consecutive days starting at `anchorMonth`'s first
 * day when a month has been navigated to, else device-today.
 *
 * Day-to-day paging (the chevrons) is LOCAL, ephemeral state — it deliberately
 * never touches the `?m=` search param the month grid and agenda use for
 * navigation, because paging by 3 days is a much finer-grained motion than
 * either of those views' month-at-a-time navigation. calendar-events.tsx
 * remounts this component (via its `key={anchorMonth ?? "default"}`) whenever
 * `anchorMonth` changes, which is what resets `dayOffset` back to 0 on a real
 * navigation — no effect needed to do that by hand.
 */
export function DayTimeGrid({ occurrences, anchorMonth, onOccurrenceClick }: CalendarViewProps) {
  const router = useRouter();
  const [dayOffset, setDayOffset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // See the comments above subscribeToNothing/getDeviceToday: `today` is
  // null for exactly the render that must match the server's HTML, then
  // resolves to the real device date right after.
  const today = useSyncExternalStore(subscribeToNothing, getDeviceToday, getServerToday);
  const currentMinutes = useSyncExternalStore(subscribeToNothing, getDeviceMinutes, getServerMinutes);

  const baseDay = anchorMonth ? `${anchorMonth}-01` : today;

  // One-time imperative scroll, not a state update, so it's exempt from this
  // repo's react-hooks/set-state-in-effect rule (see event-sheet.tsx's
  // identical reasoning for its own mount-only focus effect). Declared before
  // the skeleton's early return below so every render calls the same hooks in
  // the same order (react-hooks/rules-of-hooks).
  //
  // Depends on `baseDay`, not `[]`: `baseDay` is null while the skeleton
  // above is showing (no `?m=` and `today` not resolved yet — see the
  // comment on `today`), so `scrollRef` isn't attached to anything on that
  // render. If this ran only once on mount it could fire against that
  // unattached ref and never get another chance once the real grid swaps in.
  // Keying off `baseDay` re-fires exactly once more when it flips from null
  // to a real date — the same render the scrollable div first exists — and
  // never again after that: within one mount, `baseDay` only takes one
  // non-null value (a real day-to-day re-anchor remounts this component via
  // the parent's key, per the class comment above), so paging with the
  // chevrons never re-triggers this and yanks the user's scroll position.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = INITIAL_SCROLL_HOUR * HOUR_ROW_PX;
  }, [baseDay]);

  // Only reachable with no `?m=` (anchorMonth null) before `today` resolves —
  // i.e. the server render and the client's first render, which therefore
  // agree on rendering this instead of guessing which days to show.
  if (baseDay === null) {
    return <DayTimeGridSkeleton />;
  }

  const startDay = addDays(parseISO(baseDay), dayOffset);
  const days = Array.from({ length: DAY_COUNT }, (_, i) => format(addDays(startDay, i), "yyyy-MM-dd"));

  // The full occurrences prop can span the whole read window (up to ~14
  // months, hundreds of rows once recurrence lands), but this view only
  // ever shows DAY_COUNT days — filtering once here, rather than rescanning
  // the full list inside every day column's own lib/time-grid.ts call, keeps
  // this view's cost tied to 3 days, not the whole window.
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];
  const visibleOccurrences = occurrences.filter(
    (o) => o.date <= rangeEnd && (o.endDate ?? o.date) >= rangeStart,
  );

  const showTodayButton = anchorMonth !== null || dayOffset !== 0;

  function goToToday() {
    if (anchorMonth !== null) {
      // Matches month-grid.tsx/agenda.tsx's own Today button: clear the `?m=`
      // anchor and let the page default back to the device-today window.
      // That remounts this component (see the class comment above), which
      // also resets `dayOffset` back to 0 for free.
      router.replace("/calendar");
    } else {
      setDayOffset(0);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDayOffset((o) => o - DAY_COUNT)}
            aria-label="Previous 3 days"
            className="rounded-full p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-32 text-center text-sm font-medium">
            {format(parseISO(days[0]), "d MMM")} – {format(parseISO(days[days.length - 1]), "d MMM yyyy")}
          </span>
          <button
            type="button"
            onClick={() => setDayOffset((o) => o + DAY_COUNT)}
            aria-label="Next 3 days"
            className="rounded-full p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        {showTodayButton && (
          <button
            type="button"
            onClick={goToToday}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs dark:border-white/15"
          >
            Today
          </button>
        )}
      </div>

      <div className="rounded-lg border border-black/5 dark:border-white/10">
        {/* Header row: weekday + date per day column, today highlighted. */}
        <div className="grid" style={{ gridTemplateColumns: `2.5rem repeat(${DAY_COUNT}, 1fr)` }}>
          <div />
          {days.map((day) => (
            <div key={day} className="flex flex-col items-center border-l border-black/5 py-1.5 dark:border-white/10">
              <span className="text-[10px] font-medium text-zinc-500">{format(parseISO(day), "EEE")}</span>
              <span
                className={`mt-0.5 flex size-6 items-center justify-center rounded-full text-xs ${
                  day === today ? "bg-foreground text-background" : ""
                }`}
              >
                {format(parseISO(day), "d")}
              </span>
            </div>
          ))}
        </div>

        {/* All-day strip: all-day occurrences plus multi-day/cross-midnight spillovers, per lib/time-grid.ts. */}
        <div
          className="grid border-t border-black/5 dark:border-white/10"
          style={{ gridTemplateColumns: `2.5rem repeat(${DAY_COUNT}, 1fr)` }}
        >
          <div />
          {days.map((day) => (
            <div key={day} className="min-w-0 space-y-0.5 border-l border-black/5 p-0.5 dark:border-white/10">
              {allDayOccurrencesForDay(visibleOccurrences, day).map((occurrence) => {
                const colourHex = eventColourHex(occurrence.event.colour);
                return (
                  <button
                    key={occurrence.key}
                    type="button"
                    onClick={() => onOccurrenceClick(occurrence)}
                    style={colourHex ? { backgroundColor: hexToRgba(colourHex, 0.35) } : undefined}
                    className={`block w-full truncate rounded px-1 py-0.5 text-left text-[9px] leading-tight ${
                      colourHex ? "" : "bg-zinc-200 dark:bg-zinc-700/70"
                    }`}
                  >
                    {occurrence.event.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Hour grid: fixed-height scroll area, 24 hour rows, DAY_COUNT day columns. */}
        <div ref={scrollRef} className="overflow-y-auto border-t border-black/5 dark:border-white/10" style={{ height: "70dvh" }}>
          <div className="relative grid" style={{ gridTemplateColumns: `2.5rem repeat(${DAY_COUNT}, 1fr)`, height: GRID_HEIGHT_PX }}>
            <div className="relative">
              {HOURS.map((hour) => (
                <span
                  key={hour}
                  className="absolute right-1 -translate-y-1/2 text-[10px] text-zinc-500"
                  style={{ top: hour * HOUR_ROW_PX }}
                >
                  {formatHourLabel(hour)}
                </span>
              ))}
            </div>

            {days.map((day) => {
              const blocks = timedBlocksForDay(visibleOccurrences, day);
              return (
                <div key={day} className="relative border-l border-black/5 dark:border-white/10">
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-black/5 dark:border-white/10"
                      style={{ top: hour * HOUR_ROW_PX }}
                    />
                  ))}

                  {day === today && currentMinutes !== null && (
                    <div
                      aria-hidden
                      className="absolute inset-x-0 z-10 h-px bg-red-500"
                      style={{ top: `${(currentMinutes / MINUTES_PER_DAY) * 100}%` }}
                    >
                      <span className="-mt-[3px] block size-1.5 rounded-full bg-red-500" />
                    </div>
                  )}

                  {blocks.map((block) => {
                    const colourHex = eventColourHex(block.occurrence.event.colour);
                    const style: CSSProperties = {
                      top: `${(block.topMinutes / MINUTES_PER_DAY) * 100}%`,
                      height: `${(block.heightMinutes / MINUTES_PER_DAY) * 100}%`,
                      left: `${(block.column / block.columns) * 100}%`,
                      width: `calc(${100 / block.columns}% - 2px)`,
                      backgroundColor: colourHex ? hexToRgba(colourHex, 0.35) : undefined,
                    };
                    return (
                      <button
                        key={block.occurrence.key}
                        type="button"
                        onClick={() => onOccurrenceClick(block.occurrence)}
                        style={style}
                        className={`absolute overflow-hidden rounded px-1 py-0.5 text-left text-[9px] leading-tight ${
                          colourHex ? "" : DEFAULT_DOT_CLASS
                        }`}
                      >
                        <span className="block truncate font-medium">{block.occurrence.event.title}</span>
                        {/* Only shown once the block is tall enough to fit a second line without crowding the title. */}
                        {block.heightMinutes >= 45 && block.occurrence.event.startTime && (
                          <span className="block truncate opacity-80">{formatTime(block.occurrence.event.startTime)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
