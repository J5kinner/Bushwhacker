"use client";

import { useEffect, useRef, useState } from "react";
import { Pin, PinOff, Trash2, X } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import { Switch } from "@/components/ui/switch";
import { EVENT_COLOURS } from "@/lib/event-colours";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import type { HouseholdMember } from "@/lib/queries";
import type { CalendarEventInput } from "./actions";

// Duplicated from calendar-events.tsx rather than imported, so the two client
// components don't form an import cycle (that file renders this one). Keep
// these in sync with the add form's styling by eye — see the note there.
const inputClass =
  "rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15";

function chipClass(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-sm ${
    active
      ? "border-foreground bg-foreground text-background"
      : "border-black/10 dark:border-white/15"
  }`;
}

/**
 * The bottom sheet opened by tapping a row in the agenda list: a full edit
 * form for every event-model-v2 field, pre-filled from the event the sheet
 * was opened for, plus the pin toggle and the delete confirm.
 *
 * `event` is a snapshot taken at open time (not a live view of `optimistic`),
 * so it also carries the `updatedAt` the last-write-wins guard checks against
 * — see the comment on `editingEvent` in calendar-events.tsx.
 *
 * This sheet is a long-lived seam: later PRs (repeat options — PR 4;
 * comments — PR 7; a reminder picker — PR 8; attachments — PR 9) each mount
 * one more labelled section here. The extension region below the core fields
 * is where those sections go, so they never need to restructure this form.
 */
export function EventSheet({
  event,
  members,
  error,
  onClose,
  onSave,
  onTogglePinned,
  onDelete,
}: {
  event: CalendarEvent;
  members: HouseholdMember[];
  error: string | null;
  onClose: () => void;
  onSave: (
    optimisticEvent: CalendarEvent,
    input: CalendarEventInput,
    expectedUpdatedAt: Date,
  ) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const keyboardInset = useKeyboardInset();

  const [title, setTitle] = useState(event.title);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate ?? "");
  const [allDay, setAllDay] = useState(!event.startTime);
  const [startTime, setStartTime] = useState(event.startTime ?? "");
  const [endTime, setEndTime] = useState(event.endTime ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [url, setUrl] = useState(event.url ?? "");
  const [colour, setColour] = useState<string | null>(event.colour);
  const [attendeeIds, setAttendeeIds] = useState<string[] | null>(
    event.attendeeIds,
  );
  const [notes, setNotes] = useState(event.notes ?? "");
  const [pinned, setPinned] = useState(event.pinned);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  // aria-modal="true" promises focus stays inside the dialog while it's
  // open; move it in once on open (the heading, not a form field, so
  // opening the sheet doesn't pop the on-screen keyboard). Deliberately
  // `[]` rather than depending on anything from props/state — this must
  // run exactly once, not every time the 15s LiveRefresh poll (or a pin
  // toggle refreshing the parent's snapshot) re-renders the parent and
  // hands this component a new `onClose` reference, or focus would keep
  // jumping back to the heading out from under whatever the user is typing.
  // A full focus trap (Tab wrapping around the sheet instead of escaping to
  // the page behind it) is deferred — later PRs copying this modal pattern
  // (repeat options, comments, reminders, attachments) should add one then
  // rather than each reinventing it here.
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

  useEffect(() => {
    return () => {
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    };
  }, []);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !startDate) return;

    // A plain literal (not typed as CalendarEventInput) so every field is
    // concretely present rather than optional — spreading it over `event`
    // below then yields a proper, fully-typed CalendarEvent for the
    // optimistic reducer, with no `| undefined` creeping in from the
    // interface's optional markers.
    const fields = {
      title: trimmed,
      startDate,
      endDate: endDate || null,
      startTime: allDay ? null : startTime || null,
      endTime: allDay ? null : endTime || null,
      location: location.trim() || null,
      url: url.trim() || null,
      colour,
      attendeeIds,
      notes: notes.trim() || null,
    };
    // `pinned` comes from state, not the `event` snapshot: a pin toggle
    // earlier in this sheet session already moved it ahead of the snapshot,
    // and spreading the stale snapshot's value here would visually revert
    // the pin the moment this optimistic row lands.
    const optimisticEvent: CalendarEvent = {
      ...event,
      ...fields,
      pinned,
      updatedAt: new Date(),
    };
    onSave(optimisticEvent, fields, event.updatedAt);
  }

  // Two-tap delete: the first tap arms a confirm state that disarms itself
  // after a beat, so a stray thumb can't delete the event in one go — same
  // pattern as the shopping list's "Clear bought" confirm.
  function handleDeleteTap() {
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmDeleteTimer.current = setTimeout(
        () => setConfirmingDelete(false),
        4000,
      );
      return;
    }
    setConfirmingDelete(false);
    onDelete(event.id);
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
        aria-label="Edit event"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col rounded-t-2xl bg-background shadow-xl"
        style={{
          // Pinned above the on-screen keyboard rather than resting at the
          // viewport's true bottom edge, the same technique the shopping bar
          // uses — dvh alone doesn't reliably shrink for the keyboard on iOS.
          bottom: keyboardInset,
          maxHeight: `min(88dvh, calc(100dvh - ${keyboardInset}px - 1rem))`,
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/15">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            Edit event
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

        <form
          onSubmit={handleSave}
          className="flex-1 space-y-3 overflow-y-auto px-4 pt-3"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          {/* ---- Main form region: every event-model-v2 field. ---- */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Anniversary dinner"
            className={`w-full ${inputClass}`}
            aria-label="Event title"
          />
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-zinc-500">
              Start
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`mt-1 w-full ${inputClass}`}
                aria-label="Start date"
              />
            </label>
            <label className="flex-1 text-xs text-zinc-500">
              End (optional)
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`mt-1 w-full ${inputClass}`}
                aria-label="End date"
              />
            </label>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">All day</span>
            <Switch
              checked={allDay}
              onCheckedChange={setAllDay}
              aria-label="All day"
            />
          </div>
          {!allDay && (
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-zinc-500">
                Start time
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={`mt-1 w-full ${inputClass}`}
                  aria-label="Start time"
                  required
                />
              </label>
              <label className="flex-1 text-xs text-zinc-500">
                End time (optional)
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={`mt-1 w-full ${inputClass}`}
                  aria-label="End time"
                />
              </label>
            </div>
          )}

          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className={`w-full ${inputClass}`}
            aria-label="Location"
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link (optional)"
            className={`w-full ${inputClass}`}
            aria-label="Event link"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className={`w-full ${inputClass}`}
            aria-label="Notes"
          />

          <div>
            <p className="mb-1.5 text-xs text-zinc-500">Colour</p>
            <div className="flex flex-wrap gap-2">
              {EVENT_COLOURS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColour(colour === c.name ? null : c.name)}
                  className={`size-8 shrink-0 rounded-full border-2 ${
                    colour === c.name
                      ? "border-foreground"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  aria-label={c.name}
                  aria-pressed={colour === c.name}
                />
              ))}
            </div>
          </div>

          {members.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-zinc-500">Who</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAttendeeIds(null)}
                  className={chipClass(attendeeIds === null)}
                >
                  Both
                </button>
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setAttendeeIds([m.id])}
                    className={chipClass(
                      attendeeIds !== null &&
                        attendeeIds.length === 1 &&
                        attendeeIds[0] === m.id,
                    )}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/*
            ---- Extension region ----
            Future sections (repeat options — PR 4; comments — PR 7; a
            reminder picker — PR 8; attachments — PR 9) mount here, each as
            its own labelled block, below the core fields and above pin/
            delete. Adding one is a pure insertion — nothing above or below
            this comment needs to move.
          */}

          <div className="flex items-center justify-between border-t border-black/10 pt-3 dark:border-white/15">
            <span className="flex items-center gap-1.5 text-sm">
              {pinned ? (
                <Pin className="size-4" aria-hidden />
              ) : (
                <PinOff className="size-4" aria-hidden />
              )}
              Pinned
            </span>
            <Switch
              checked={pinned}
              onCheckedChange={(next) => {
                setPinned(next);
                onTogglePinned(event.id, next);
              }}
              aria-label="Pinned"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleDeleteTap}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                confirmingDelete
                  ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400"
                  : "border-black/10 text-zinc-500 dark:border-white/15"
              }`}
            >
              <Trash2 className="size-4" aria-hidden />
              {confirmingDelete ? "Tap again to confirm" : "Delete"}
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-foreground px-3 py-2 text-sm text-background"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
