"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import { Switch } from "@/components/ui/switch";
import { EVENT_COLOURS } from "@/lib/event-colours";
import type { HouseholdMember } from "@/lib/queries";
import { expandOccurrences, type Exdate } from "@/lib/recurrence";
import {
  addCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  togglePinned,
} from "./actions";
import { EventSheet } from "./event-sheet";
import { VIEWS, ViewSwitcher, useSelectedView } from "./view-switcher";

type Action =
  | { type: "add"; event: CalendarEvent }
  | { type: "edit"; event: CalendarEvent }
  | { type: "delete"; id: string }
  | { type: "pin"; id: string; pinned: boolean };

function reduce(events: CalendarEvent[], action: Action): CalendarEvent[] {
  switch (action.type) {
    case "add":
      return [...events, action.event].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      );
    case "edit":
      return events
        .map((e) => (e.id === action.event.id ? action.event : e))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    case "delete":
      return events.filter((e) => e.id !== action.id);
    case "pin":
      return events.map((e) =>
        e.id === action.id ? { ...e, pinned: action.pinned } : e,
      );
  }
}

// Duplicated (not exported) in event-sheet.tsx, which mirrors this add
// form's styling for its own edit form — keep both in sync by eye.
const inputClass =
  "rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15";

function chipClass(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-sm ${
    active
      ? "border-foreground bg-foreground text-background"
      : "border-black/10 dark:border-white/15"
  }`;
}

export function CalendarEvents({
  initialEvents,
  exdates,
  windowFrom,
  windowTo,
  anchorMonth,
  members,
}: {
  initialEvents: CalendarEvent[];
  exdates: Exdate[];
  windowFrom: string;
  windowTo: string;
  anchorMonth: string | null;
  members: HouseholdMember[];
}) {
  const [optimistic, dispatch] = useOptimistic(initialEvents, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The event whose sheet is open, snapshotted at tap time — the sheet's form
  // and its last-write-wins `expectedUpdatedAt` both come from this snapshot,
  // not from `optimistic`, so a background change to the row while the sheet
  // is open can't silently rewrite fields the user is mid-edit on.
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Expansion happens here, not in a view: every view renders Occurrence[],
  // never raw CalendarEvent rows, so recurrence (PR 4) lights up for all of
  // them at once with zero changes to this line or to any view. Identity
  // expansion today — expandOccurrences passes non-recurring rows through
  // as single occurrences equal to their own event.
  const occurrences = useMemo(
    () => expandOccurrences(optimistic, exdates, windowFrom, windowTo),
    [optimistic, exdates, windowFrom, windowTo],
  );
  const [selectedViewId, setSelectedViewId] = useSelectedView();
  const SelectedView =
    VIEWS.find((view) => view.id === selectedViewId)?.component ??
    VIEWS[0].component;

  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [colour, setColour] = useState<string | null>(null);
  const [attendeeIds, setAttendeeIds] = useState<string[] | null>(null);
  const [notes, setNotes] = useState("");

  function run(
    action: Action,
    effect: () => Promise<{ error?: string } | void>,
  ) {
    setError(null);
    startTransition(async () => {
      dispatch(action);
      try {
        const result = await effect();
        if (result?.error) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  // The shared `error` banner would otherwise leak across contexts — an
  // add-form error still showing when the sheet opens, or a sheet error
  // still showing under the list after it closes — so both open and close
  // clear it explicitly rather than relying on the next `run()` call to.
  function openEventSheet(event: CalendarEvent) {
    setError(null);
    setEditingEvent(event);
  }

  function closeEventSheet() {
    setError(null);
    setEditingEvent(null);
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !startDate) return;

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
    const temp: CalendarEvent = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      pinned: false,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...fields,
    };

    setTitle("");
    setStartDate("");
    setEndDate("");
    setAllDay(true);
    setStartTime("");
    setEndTime("");
    setLocation("");
    setUrl("");
    setColour(null);
    setAttendeeIds(null);
    setNotes("");
    run({ type: "add", event: temp }, () => addCalendarEvent(fields));
  }

  return (
    <div>
      <details className="mb-4 rounded-lg border border-black/10 dark:border-white/15">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Add an event
        </summary>
        <form onSubmit={onAdd} className="space-y-3 px-3 pb-3">
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

          <button
            type="submit"
            className="flex items-center gap-1 rounded-lg bg-foreground px-3 py-2 text-sm text-background"
          >
            <Plus className="size-4" aria-hidden /> Add event
          </button>
        </form>
      </details>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <ViewSwitcher selected={selectedViewId} onSelect={setSelectedViewId} />

      <SelectedView
        key={anchorMonth ?? "default"}
        occurrences={occurrences}
        members={members}
        windowFrom={windowFrom}
        windowTo={windowTo}
        anchorMonth={anchorMonth}
        onOccurrenceClick={openEventSheet}
      />

      {editingEvent && (
        <EventSheet
          event={editingEvent}
          members={members}
          error={error}
          onClose={closeEventSheet}
          onSave={(optimisticEvent, input, expectedUpdatedAt) => {
            run({ type: "edit", event: optimisticEvent }, async () => {
              const result = await updateCalendarEvent(
                optimisticEvent.id,
                input,
                expectedUpdatedAt,
              );
              if (result.conflict) {
                return { error: "This event was just changed — reload." };
              }
              if (result.error) return { error: result.error };
              closeEventSheet();
              return {};
            });
          }}
          onTogglePinned={(id, pinned) => {
            run({ type: "pin", id, pinned }, async () => {
              // togglePinned's own update also bumps updated_at (Drizzle's
              // $onUpdate fires on every update to the row, not just this
              // one's `pinned` column), so the sheet's snapshot needs the
              // fresh value or its next Save would send a now-stale
              // expectedUpdatedAt and always trip the last-write-wins guard.
              const result = await togglePinned(id, pinned);
              if (result) {
                setEditingEvent((prev) =>
                  prev && prev.id === id
                    ? { ...prev, pinned, updatedAt: result.updatedAt }
                    : prev,
                );
              }
            });
          }}
          onDelete={(id) => {
            closeEventSheet();
            run({ type: "delete", id }, () => deleteCalendarEvent(id));
          }}
        />
      )}
    </div>
  );
}
