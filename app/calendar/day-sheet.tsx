"use client";

import { useEffect, useRef } from "react";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
import type { HouseholdMember } from "@/lib/queries";
import type { Occurrence } from "@/lib/recurrence";
import { eventColourHex } from "@/lib/event-colours";

/**
 * A "HH:mm" (or "HH:mm:ss") wall-clock string as a device-local "9:00 am".
 * Duplicated from agenda.tsx rather than imported — that file exports no
 * helpers, only the component — but kept byte-for-byte the same behaviour so
 * a time reads identically in both views.
 */
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

/**
 * The bottom sheet opened by tapping a day cell in the month grid: a quick,
 * read-only list of that day's occurrences. Tapping a row hands off to the
 * same event sheet the agenda already opens (`onOccurrenceClick`, owned by
 * calendar-events.tsx) rather than duplicating an edit form here — this
 * sheet is a peek, not an editor.
 *
 * Modal mechanics (backdrop, scroll lock, initial focus, Escape-to-close,
 * safe-area padding) follow event-sheet.tsx's established pattern, copied
 * as behaviour rather than by importing that file. There is no on-screen
 * keyboard to dodge here (no text inputs), so this sheet skips the
 * keyboard-inset handling that one needs.
 */
export function DaySheet({
  date,
  occurrences,
  members,
  onOccurrenceClick,
  onClose,
}: {
  date: string;
  occurrences: Occurrence[];
  members: HouseholdMember[];
  onOccurrenceClick: (occurrence: Occurrence) => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A background page scrolling behind an open sheet reads as broken on a
  // phone, where the sheet already covers most of the viewport.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Focus the heading once on open, not a form field — same reasoning as
  // event-sheet.tsx: deliberately `[]` so a parent re-render (e.g. the 15s
  // LiveRefresh poll) never yanks focus back here mid-interaction.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Escape closes the sheet, matching the X/backdrop.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Every occurrence-open goes through this one wrapper so contract changes
  // touch a single line; it now forwards the full occurrence, which the
  // event sheet needs to offer this-occurrence-vs-whole-series editing.
  const openOccurrence = (occurrence: Occurrence) => onOccurrenceClick(occurrence);

  function handleRowClick(occurrence: Occurrence) {
    openOccurrence(occurrence);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop — tapping outside the sheet closes it, same as the X. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Events on ${format(parseISO(date), "EEEE d MMMM")}`}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col rounded-t-2xl bg-background shadow-xl"
        style={{ maxHeight: "70dvh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/15">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            {format(parseISO(date), "EEE d MMM")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 pt-2"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          {occurrences.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              Nothing on.
            </p>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {occurrences.map((occurrence) => {
                const { event } = occurrence;
                const colourHex = eventColourHex(event.colour);
                const attendees = attendeeInitials(event.attendeeIds, members);
                const summary = [
                  formatEventTime(event.startTime, event.endTime),
                  attendees,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <li key={occurrence.key}>
                    <button
                      type="button"
                      onClick={() => handleRowClick(occurrence)}
                      className="flex w-full items-start gap-3 py-3 text-left"
                    >
                      <span
                        className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                          colourHex ? "" : "bg-zinc-400 dark:bg-zinc-600"
                        }`}
                        style={colourHex ? { backgroundColor: colourHex } : undefined}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-base">{event.title}</p>
                        <p className="text-xs text-zinc-500">{summary}</p>
                        {event.location && (
                          <p className="text-xs text-zinc-500">{event.location}</p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
