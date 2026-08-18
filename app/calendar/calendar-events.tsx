"use client";

import { useOptimistic, useState, useTransition } from "react";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import { Switch } from "@/components/ui/switch";
import { EVENT_COLOURS, eventColourHex } from "@/lib/event-colours";
import { addCalendarEvent, deleteCalendarEvent } from "./actions";

type Member = { id: string; name: string };

type Action =
  | { type: "add"; event: CalendarEvent }
  | { type: "delete"; id: string };

function reduce(events: CalendarEvent[], action: Action): CalendarEvent[] {
  switch (action.type) {
    case "add":
      return [...events, action.event].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      );
    case "delete":
      return events.filter((e) => e.id !== action.id);
  }
}

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
function attendeeInitials(attendeeIds: string[] | null, members: Member[]) {
  if (!attendeeIds || attendeeIds.length === 0) return null;
  const initials = attendeeIds
    .map((id) => members.find((m) => m.id === id)?.name?.[0]?.toUpperCase())
    .filter((initial): initial is string => Boolean(initial));
  return initials.length > 0 ? initials.join("") : null;
}

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
  members,
}: {
  initialEvents: CalendarEvent[];
  members: Member[];
}) {
  const [optimistic, dispatch] = useOptimistic(initialEvents, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  function run(action: Action, effect: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      dispatch(action);
      try {
        await effect();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
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

      {optimistic.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-500">
          No events yet.
        </p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {optimistic.map((event) => {
            const colourHex = eventColourHex(event.colour);
            const attendees = attendeeInitials(event.attendeeIds, members);
            const summary = [
              formatRange(event.startDate, event.endDate),
              formatEventTime(event.startTime, event.endTime),
              attendees,
              event.notes,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={event.id} className="flex items-start gap-3 py-3">
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
                <button
                  onClick={() =>
                    run({ type: "delete", id: event.id }, () =>
                      deleteCalendarEvent(event.id),
                    )
                  }
                  className="text-zinc-400 hover:text-red-500"
                  aria-label={`Delete ${event.title}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
