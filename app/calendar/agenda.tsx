"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, format, parseISO, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import type { Occurrence } from "@/lib/recurrence";
import type { HouseholdMember } from "@/lib/queries";
import { eventColourHex } from "@/lib/event-colours";
import { displayDomain } from "@/lib/links";
import type { CalendarViewProps } from "./view-switcher";

function formatRange(start: string, end: string | null) {
  const s = new Date(start).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (!end || end === start) return s;
  const e = new Date(end).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return `${s} – ${e}`;
}

/** A "HH:mm" (or "HH:mm:ss") wall-clock string as a device-local "9:00 am". */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return format(d, "h:mm a").toLowerCase();
}

/** "All day" for an untimed event, otherwise "9:00 am" or "9:00 am – 10:30 am". */
function formatEventTime(startTime: string | null, endTime: string | null) {
  if (!startTime) return "All day";
  const start = formatTime(startTime);
  return endTime ? `${start} – ${formatTime(endTime)}` : start;
}

/** Initials for the attendees, or null when the event is for both members. */
function attendeeInitials(
  attendeeIds: string[] | null,
  members: HouseholdMember[],
) {
  if (!attendeeIds || attendeeIds.length === 0) return null;
  const initials = attendeeIds
    .map((id) => members.find((m) => m.id === id)?.name?.[0]?.toUpperCase())
    .filter((initial): initial is string => Boolean(initial));
  return initials.length > 0 ? initials.join("") : null;
}

/** "Today" / "Tomorrow" / "Wed 20 Aug" for a day-group heading, device-local. */
function dayHeading(dateISO: string, todayISO: string, tomorrowISO: string): string {
  if (dateISO === todayISO) return "Today";
  if (dateISO === tomorrowISO) return "Tomorrow";
  return format(parseISO(dateISO), "EEE d MMM");
}

function OccurrenceRow({
  occurrence,
  members,
  onClick,
}: {
  occurrence: Occurrence;
  members: HouseholdMember[];
  onClick: (event: CalendarEvent) => void;
}) {
  const { event } = occurrence;
  const colourHex = eventColourHex(event.colour);
  const attendees = attendeeInitials(event.attendeeIds, members);
  const summary = [
    formatRange(occurrence.date, occurrence.endDate),
    formatEventTime(event.startTime, event.endTime),
    attendees,
    event.notes,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
          colourHex ? "" : "bg-zinc-400 dark:bg-zinc-600"
        }`}
        style={colourHex ? { backgroundColor: colourHex } : undefined}
        aria-hidden
      />
      {/*
        The row itself opens the edit sheet; the link stays independently
        tappable by stopping both its click and its keydown (Enter) from
        bubbling to this handler — otherwise Enter on the link would open the
        sheet instead of following it. Ported as-is from the pre-views list.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(event)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(event);
          }
        }}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <p className="text-base">{event.title}</p>
        <p className="text-xs text-zinc-500">{summary}</p>
        {event.location && (
          <p className="text-xs text-zinc-500">{event.location}</p>
        )}
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noopener"
            aria-label={`Open link for ${event.title}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden />
            {displayDomain(event.url)}
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * The day-grouped agenda: the only registered view in PR 2a.
 *
 * "Today" here is always the DEVICE clock, never the server's — the window
 * itself is computed server-side from UTC (see app/calendar/page.tsx), which
 * can already be tomorrow by an Australian morning, but which day something
 * is filed under, which day is "Today", and where the default list starts
 * are all things the person looking at the phone needs to match their own
 * clock, not Vercel's.
 */
export function Agenda({
  occurrences,
  members,
  windowFrom,
  anchorMonth,
  onOccurrenceClick,
}: CalendarViewProps) {
  const router = useRouter();
  // `showEarlier` has no effect while `anchorMonth` is set (see `listStart`
  // below) — it only matters for the default view. calendar-events.tsx keys
  // this component by `anchorMonth`, so navigating to/from the default view
  // remounts it and `showEarlier` starts fresh at `false` rather than staying
  // expanded from an earlier visit; that avoids resetting it here with an
  // effect, which would just re-render synchronously right after mount.
  const [showEarlier, setShowEarlier] = useState(false);

  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const tomorrow = format(addDays(now, 1), "yyyy-MM-dd");

  // No `?m=`: the default "live" view starts at today, with a Show-earlier
  // toggle for anything still in the window before it. A set `?m=` is a
  // specific month the user navigated to — it always starts at that month's
  // first day; the window is already bounded there, so there is nothing for
  // a Show-earlier toggle to reveal.
  const listStart = anchorMonth
    ? `${anchorMonth}-01`
    : showEarlier
      ? windowFrom
      : today;

  const visible = occurrences.filter((o) => o.date >= listStart);
  // Pinned events are drawn from the same visible set the day groups use
  // (not the full window) so the pinned section and "Show earlier" agree —
  // pinning something doesn't punch a hole through the window/list-start
  // filtering the rest of the agenda respects.
  const pinned = visible.filter((o) => o.event.pinned);

  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of visible) {
    const group = byDay.get(occurrence.date);
    if (group) group.push(occurrence);
    else byDay.set(occurrence.date, [occurrence]);
  }
  const dayGroups = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  const hasEarlier = !anchorMonth && occurrences.some((o) => o.date < today);

  // The nav row's label/targets track the requested `?m=` when set, else the
  // DEVICE's current month — not the server's default anchor, which is UTC
  // and can disagree with the device by a day.
  const displayedMonth = anchorMonth ?? today.slice(0, 7);
  const displayedMonthStart = parseISO(`${displayedMonth}-01`);

  function goToMonth(monthDate: Date) {
    router.push(`/calendar?m=${format(monthDate, "yyyy-MM")}`);
  }

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
          <span className="min-w-28 text-center text-sm font-medium">
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
            onClick={() => router.push("/calendar")}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs dark:border-white/15"
          >
            Today
          </button>
        )}
      </div>

      {occurrences.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-500">
          No events yet.
        </p>
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-1 text-xs font-medium uppercase text-zinc-500">
                Pinned
              </h2>
              <ul className="divide-y divide-black/5 dark:divide-white/10">
                {pinned.map((occurrence) => (
                  <OccurrenceRow
                    key={`pinned:${occurrence.key}`}
                    occurrence={occurrence}
                    members={members}
                    onClick={onOccurrenceClick}
                  />
                ))}
              </ul>
            </div>
          )}

          {hasEarlier && !showEarlier && (
            <button
              type="button"
              onClick={() => setShowEarlier(true)}
              className="mb-3 w-full rounded-lg border border-black/10 py-2 text-xs text-zinc-500 dark:border-white/15"
            >
              Show earlier
            </button>
          )}

          {dayGroups.length === 0 ? (
            <p className="mt-10 text-center text-sm text-zinc-500">
              No events in this window.
            </p>
          ) : (
            dayGroups.map(([date, dayOccurrences]) => (
              <div key={date} className="mb-4">
                <h2
                  className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${
                    date === today ? "text-foreground" : "text-zinc-500"
                  }`}
                >
                  {dayHeading(date, today, tomorrow)}
                  {date === today && (
                    <span
                      className="size-1.5 rounded-full bg-foreground"
                      aria-hidden
                    />
                  )}
                </h2>
                <ul className="divide-y divide-black/5 dark:divide-white/10">
                  {dayOccurrences.map((occurrence) => (
                    <OccurrenceRow
                      key={occurrence.key}
                      occurrence={occurrence}
                      members={members}
                      onClick={onOccurrenceClick}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
