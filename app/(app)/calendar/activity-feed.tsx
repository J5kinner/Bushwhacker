"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Activity } from "@/db/schema";
import type { HouseholdMember } from "@/lib/queries";
import { formatRelativeTime, useDeviceNow } from "./relative-time";

// "Sam <verb> 'Dentist'" — every verb reads as a past-tense action on the
// event's title, so the sentence never needs its own subject/object copy per
// row. "commented" is the one exception ("commented on", not "commented
// 'Dentist'"), kept in this same map rather than a special case in the
// render below.
const VERB_LABEL: Record<Activity["verb"], string> = {
  created: "added",
  updated: "changed",
  deleted: "removed",
  commented: "commented on",
};

function actorName(actorId: string | null, members: HouseholdMember[]): string {
  return members.find((m) => m.id === actorId)?.name ?? "Someone";
}

/**
 * The bottom sheet opened by tapping the activity bell (calendar-events.tsx):
 * a read-only, newest-first list of who created/edited/deleted/commented on
 * which event, and when (ADR 0008). Modal mechanics (backdrop, scroll lock,
 * initial focus, Escape-to-close, safe-area padding) copy day-sheet.tsx's
 * established pattern as behaviour, not by importing that file — same reason
 * as its own doc comment gives for copying event-sheet.tsx.
 *
 * Marking the feed "seen" is the caller's job, not this component's: it
 * happens once, at the moment the sheet opens, before `rows` can change
 * under it — see the `onOpen`-style call site in calendar-events.tsx, which
 * also owns the optimistic badge-clear this sheet's own re-renders don't
 * need to know about.
 */
export function ActivityFeed({
  rows,
  members,
  onClose,
}: {
  rows: Activity[];
  members: HouseholdMember[];
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = useDeviceNow();

  // A background page scrolling behind an open sheet reads as broken on a
  // phone, where the sheet already covers most of the viewport.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Focus the heading once on open, not a list item — same reasoning as
  // event-sheet.tsx/day-sheet.tsx: deliberately `[]` so a parent re-render
  // (e.g. the 15s LiveRefresh poll) never yanks focus back here mid-read.
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
        aria-label="Activity"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col rounded-t-2xl bg-background shadow-xl"
        style={{ maxHeight: "70dvh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/15">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            Activity
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
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              No activity yet.
            </p>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {rows.map((row) => (
                <li key={row.id} className="py-3">
                  <p className="text-sm">
                    <span className="font-medium">
                      {actorName(row.actorId, members)}
                    </span>{" "}
                    {VERB_LABEL[row.verb]} &lsquo;{row.eventTitle}&rsquo;
                  </p>
                  <p className="text-xs text-zinc-500">
                    {formatRelativeTime(row.createdAt, now)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
