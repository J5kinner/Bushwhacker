"use client";

import { useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
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
import { computeWeekLanes, MAX_LANES, type LaneItem } from "@/lib/month-lanes";
import { occursOnDay, type Occurrence } from "@/lib/recurrence";
import type { CalendarViewProps } from "./view-switcher";
import { DaySheet } from "./day-sheet";

// Applied when an occurrence carries no lib/event-colours.ts value, mirroring
// the agenda's own default-dot styling so the two views read the same way.
const DEFAULT_DOT_CLASS = "bg-zinc-400 dark:bg-zinc-600";
const DEFAULT_BAR_CLASS = "bg-zinc-300 dark:bg-zinc-700/70";

// Monday-first, matching the grid itself — used only by the pre-mount
// skeleton, which has no real dates to derive labels from yet.
const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

// Server-rendered HTML runs in UTC; the device viewing it may already be
// 10-11 hours ahead (an Australian morning is still "yesterday" in UTC), so
// reading "today" straight off `new Date()` during render would make this
// component's SSR output and its first client render — which React's
// hydration must match byte-for-byte — disagree, not just on which cell is
// highlighted but on the grid's whole structure whenever that disagreement
// straddles a month boundary.
//
// Modelled as a useSyncExternalStore "store" (the same technique
// view-switcher.tsx uses for localStorage) rather than a plain
// useState+useEffect pair, on purpose: this repo's lint config
// (react-hooks/set-state-in-effect) flags calling setState synchronously
// inside an effect as a cascading-render anti-pattern. useSyncExternalStore
// gets the identical "server and the client's first render agree; only
// diverge once, safely, right after" result without an effect at all — the
// server (and the client's first hydration pass) always see
// `getServerToday`'s null, and only afterwards does React ask
// `getDeviceToday` for the real value and re-render if it differs. There is
// nothing to subscribe to (no event fires when the calendar day ticks over),
// so `subscribe` is a no-op; a re-render from any other cause (e.g. the
// LiveRefresh poll) naturally re-reads the clock anyway.
function subscribeToNothing() {
  return () => {};
}
function getDeviceToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}
function getServerToday(): string | null {
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Rendered instead of the real grid for the one render where `today` is
 * still unresolved (see the comment on `today` in MonthGrid) and there's no
 * `?m=` to fall back on. Fixed at 6 week rows — the maximum any month grid
 * needs — so swapping it for the real grid once `today` resolves never
 * shifts the page around it. The nav row above it is a matching, inert
 * placeholder for the same reason.
 */
function MonthGridSkeleton() {
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
      <div className="border-l border-t border-black/5 dark:border-white/10">
        <div className="grid grid-cols-7 text-center text-[10px] font-medium text-zinc-500">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="border-b border-r border-black/5 py-1 dark:border-white/10"
            >
              {label}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div
            key={week}
            className="grid grid-cols-7"
            style={{ gridTemplateRows: `1.3rem repeat(${MAX_LANES}, 0.85rem) 0.7rem` }}
          >
            {Array.from({ length: 7 }, (_, col) => (
              <div
                key={col}
                style={{ gridColumn: col + 1, gridRow: "1 / -1" }}
                className="border-b border-r border-black/5 dark:border-white/10"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  week,
  displayedMonth,
  today,
  occurrences,
  orderIndex,
  onDayClick,
}: {
  week: string[];
  displayedMonth: string;
  today: string | null;
  occurrences: Occurrence[];
  orderIndex: Map<string, number>;
  onDayClick: (day: string) => void;
}) {
  const { items, overflow } = computeWeekLanes(week, occurrences, orderIndex);

  // Per-day accessible event counts, appended to each day button's
  // aria-label: every visible lane item touching that column, plus whatever
  // `overflow` already folded in for it — the same two sources the pills/
  // bars and the "+n" row are drawn from, so the label always agrees with
  // what's on screen (or hidden behind "+n") for that day. Pills/bars
  // themselves are aria-hidden (they're purely visual, painted over a
  // day-cell button that already owns the tap target), so without this the
  // day cells would be silent to screen readers beyond a bare date.
  const dayCounts = week.map(
    (_, col) =>
      overflow[col] +
      items.filter((item) => item.startCol <= col && item.endCol >= col).length,
  );

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
        const isToday = today !== null && day === today;
        const count = dayCounts[col];
        const countLabel = count > 0 ? `, ${count} event${count === 1 ? "" : "s"}` : "";
        return (
          <button
            key={day}
            type="button"
            onClick={() => onDayClick(day)}
            aria-label={`${format(parseISO(day), "EEEE d MMMM")}${countLabel}`}
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

      {items.map(({ occurrence, lane, startCol, endCol, isBar, roundedLeft, roundedRight }: LaneItem) => {
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

  // See the comment above `subscribeToNothing` for why this reads the
  // device clock through useSyncExternalStore rather than a state+effect
  // pair: `today` is null for exactly the render that must match the
  // server's HTML, then resolves to the real device date right after.
  const today = useSyncExternalStore(subscribeToNothing, getDeviceToday, getServerToday);

  const displayedMonth = anchorMonth ?? today?.slice(0, 7) ?? null;

  // Only reachable with no `?m=` (anchorMonth null) before the effect above
  // resolves `today` — i.e. the server render and the client's first render,
  // which therefore agree on rendering this instead of guessing a month.
  if (displayedMonth === null) {
    return <MonthGridSkeleton />;
  }

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

  // The full occurrences prop can span the whole ~14-month read window
  // (hundreds of rows once recurrence lands), but this grid only ever shows
  // the days between gridStart and gridEnd — filtering once here, rather
  // than re-scanning the full list inside every week's own lane packing (and
  // again for whichever day the sheet opens), keeps this view's cost tied to
  // one month, not the whole window.
  const gridStartISO = days[0];
  const gridEndISO = days[days.length - 1];
  const visibleOccurrences = occurrences.filter(
    (o) => o.date <= gridEndISO && (o.endDate ?? o.date) >= gridStartISO,
  );

  // The same date/all-day/title order `expandOccurrences` already produced,
  // kept as a lookup so `computeWeekLanes` can use it as a tiebreaker
  // without re-sorting per week. Filtering above preserves that relative
  // order, so indices taken from the filtered list still agree with it.
  const orderIndex = new Map(visibleOccurrences.map((o, i) => [o.key, i]));

  function goToMonth(monthDate: Date) {
    router.replace(`/calendar?m=${format(monthDate, "yyyy-MM")}`);
  }

  const dayOccurrences = selectedDay
    ? visibleOccurrences.filter((o) => occursOnDay(o, selectedDay))
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
            today={today}
            occurrences={visibleOccurrences}
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
