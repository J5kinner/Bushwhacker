"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import { addCalendarEvent, deleteCalendarEvent } from "./actions";

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

export function CalendarEvents({
  initialEvents,
}: {
  initialEvents: CalendarEvent[];
}) {
  const [optimistic, dispatch] = useOptimistic(initialEvents, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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
    const temp: CalendarEvent = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      title: trimmed,
      startDate,
      endDate: endDate || null,
      notes: notes.trim() || null,
      createdById: null,
      createdAt: new Date(),
    };
    setTitle("");
    setStartDate("");
    setEndDate("");
    setNotes("");
    run({ type: "add", event: temp }, () =>
      addCalendarEvent({
        title: trimmed,
        startDate,
        endDate: endDate || null,
        notes: notes || null,
      }),
    );
  }

  const inputClass =
    "rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15";

  return (
    <div>
      <details className="mb-4 rounded-lg border border-black/10 dark:border-white/15">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Add an event
        </summary>
        <form onSubmit={onAdd} className="space-y-2 px-3 pb-3">
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
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className={`w-full ${inputClass}`}
            aria-label="Notes"
          />
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
          {optimistic.map((event) => (
            <li key={event.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-base">{event.title}</p>
                <p className="text-xs text-zinc-500">
                  {formatRange(event.startDate, event.endDate)}
                  {event.notes ? ` · ${event.notes}` : ""}
                </p>
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
          ))}
        </ul>
      )}
    </div>
  );
}
