"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Plus } from "lucide-react";
import type { Activity, CalendarEvent, EventComment } from "@/db/schema";
import { Switch } from "@/components/ui/switch";
import { EVENT_COLOURS } from "@/lib/event-colours";
import type { HouseholdMember } from "@/lib/queries";
import { expandOccurrences, type Exdate, type Occurrence } from "@/lib/recurrence";
import {
  addCalendarEvent,
  deleteCalendarEvent,
  deleteOccurrence,
  deleteSeries,
  editOccurrence,
  markActivitySeen,
  updateCalendarEvent,
  togglePinned,
} from "./actions";
import { ActivityFeed } from "./activity-feed";
import { EventSheet } from "./event-sheet";
import { VIEWS, ViewSwitcher, useSelectedView } from "./view-switcher";

/**
 * The optimistic state mirrors the raw rows the server holds (design
 * decision 3 of the shared-calendar plan): `expandOccurrences` runs over
 * `{ events, exdates }` the same way whether the rows come from a committed
 * server read or an in-flight optimistic update, so a still-saving edit or
 * delete renders through the exact same code path as a landed one.
 */
type OptimisticState = { events: CalendarEvent[]; exdates: Exdate[] };

type Action =
  | { type: "add"; event: CalendarEvent }
  | { type: "edit"; event: CalendarEvent }
  | { type: "delete"; id: string }
  | { type: "pin"; id: string; pinned: boolean }
  // "Delete this occurrence only" on a recurring master: suppress it without
  // touching the master row, mirroring the server's own exdate insert.
  | { type: "addExdate"; eventId: string; date: string }
  // "Edit this occurrence only": the master gains an exdate for the original
  // date AND a standalone override row appears at once, matching what
  // editOccurrence does server-side in a single action.
  | { type: "addOverride"; exdate: Exdate; event: CalendarEvent }
  // "Delete the whole series": the master goes, and so does every row this
  // series ever produced an override for, plus their own exdates (an
  // override could in principle carry its own, though today's UI never
  // creates one) — otherwise a stale override/exdate would linger in local
  // state until the next full reload.
  | { type: "deleteSeries"; eventId: string };

function sortByStartDate(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function reduce(state: OptimisticState, action: Action): OptimisticState {
  switch (action.type) {
    case "add":
      return { ...state, events: sortByStartDate([...state.events, action.event]) };
    case "edit":
      return {
        ...state,
        events: sortByStartDate(
          state.events.map((e) => (e.id === action.event.id ? action.event : e)),
        ),
      };
    case "delete":
      return { ...state, events: state.events.filter((e) => e.id !== action.id) };
    case "pin":
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id ? { ...e, pinned: action.pinned } : e,
        ),
      };
    case "addExdate":
      return { ...state, exdates: [...state.exdates, { eventId: action.eventId, date: action.date }] };
    case "addOverride":
      return {
        events: sortByStartDate([...state.events, action.event]),
        exdates: [...state.exdates, action.exdate],
      };
    case "deleteSeries": {
      const removedIds = new Set(
        state.events
          .filter((e) => e.id === action.eventId || e.seriesId === action.eventId)
          .map((e) => e.id),
      );
      return {
        events: state.events.filter((e) => !removedIds.has(e.id)),
        exdates: state.exdates.filter((x) => !removedIds.has(x.eventId)),
      };
    }
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

type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly";

// getDay() order (0 = Sunday); duplicated in event-sheet.tsx alongside the
// rest of the repeat control, same reason as inputClass/chipClass above.
const WEEKDAY_LABELS: { day: number; short: string; label: string }[] = [
  { day: 0, short: "S", label: "Sunday" },
  { day: 1, short: "M", label: "Monday" },
  { day: 2, short: "T", label: "Tuesday" },
  { day: 3, short: "W", label: "Wednesday" },
  { day: 4, short: "T", label: "Thursday" },
  { day: 5, short: "F", label: "Friday" },
  { day: 6, short: "S", label: "Saturday" },
];

const REPEAT_UNIT_LABEL: Record<RepeatFreq, string> = {
  daily: "day(s)",
  weekly: "week(s)",
  monthly: "month(s)",
  yearly: "year(s)",
};

export function CalendarEvents({
  initialEvents,
  exdates,
  windowFrom,
  windowTo,
  anchorMonth,
  members,
  comments,
  activity,
  unseenCount,
  currentUserId,
}: {
  initialEvents: CalendarEvent[];
  exdates: Exdate[];
  windowFrom: string;
  windowTo: string;
  anchorMonth: string | null;
  members: HouseholdMember[];
  /** Every comment on this household's events, oldest first — filtered down to one event's slice before it reaches EventSheet. */
  comments: EventComment[];
  /** The household's latest activity rows, newest first (getActivity, lib/queries.ts). */
  activity: Activity[];
  /** Computed server-side (page.tsx) from the cached activity rows plus the current user's uncached activity_seen_at. */
  unseenCount: number;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [optimistic, dispatch] = useOptimistic<OptimisticState, Action>(
    { events: initialEvents, exdates },
    reduce,
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The occurrence whose sheet is open, snapshotted at tap time — the sheet's
  // form and its last-write-wins `expectedUpdatedAt` both come from this
  // snapshot, not from `optimistic`, so a background change to the row while
  // the sheet is open can't silently rewrite fields the user is mid-edit on.
  // Carrying the whole `Occurrence` (not just its event) is what lets the
  // sheet know *which* date of a recurring master was actually tapped.
  const [editingOccurrence, setEditingOccurrence] = useState<Occurrence | null>(null);

  // The activity feed sheet's open state, and an optimistic overlay on the
  // server-computed unseen count: `unseenCount` is `props`, the household-
  // shared cache plus this user's own uncached seen_at (page.tsx) — opening
  // the feed clears the badge immediately (openActivityFeed below) without
  // waiting for markActivitySeen's round trip and the next server read that
  // follows it, the same "dispatch, then await the Server Action" shape as
  // every other optimistic update on this page, just for a plain number
  // instead of the events reducer.
  const [activityFeedOpen, setActivityFeedOpen] = useState(false);
  const [optimisticUnseenCount, setOptimisticUnseenCount] = useOptimistic(
    unseenCount,
    (_state: number, next: number) => next,
  );

  // Expansion happens here, not in a view: every view renders Occurrence[],
  // never raw CalendarEvent rows, so recurrence (PR 4) lights up for all of
  // them at once with zero changes to this line or to any view. Both halves
  // of the optimistic state feed expansion, so a still-saving exdate/override
  // renders identically to a committed one.
  const occurrences = useMemo(
    () => expandOccurrences(optimistic.events, optimistic.exdates, windowFrom, windowTo),
    [optimistic, windowFrom, windowTo],
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
  const [repeatFreq, setRepeatFreq] = useState<RepeatFreq | null>(null);
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[] | null>(null);
  const [repeatUntil, setRepeatUntil] = useState("");

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
  function openEventSheet(occurrence: Occurrence) {
    setError(null);
    setEditingOccurrence(occurrence);
  }

  function closeEventSheet() {
    setError(null);
    setEditingOccurrence(null);
  }

  /**
   * Opens the activity feed and marks it seen up to the newest row it's
   * about to show — `activity` is already newest-first (getActivity,
   * lib/queries.ts), so its first row's `createdAt` is that max. The
   * optimistic badge-clear and the `markActivitySeen` call both happen
   * inside one `startTransition`, the same shape `run` uses above: the
   * badge clears at once, and the eventual server read (once the action's
   * `updateTag(activity)` lands) reconciles `unseenCount` for real.
   */
  function openActivityFeed() {
    setActivityFeedOpen(true);
    const latest = activity[0]?.createdAt;
    if (!latest) return;
    startTransition(async () => {
      setOptimisticUnseenCount(0);
      await markActivitySeen(latest);
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
      repeatFreq,
      repeatInterval,
      repeatWeekdays,
      repeatUntil: repeatUntil || null,
    };
    const temp: CalendarEvent = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      pinned: false,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      seriesId: null,
      originalDate: null,
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
    setRepeatFreq(null);
    setRepeatInterval(1);
    setRepeatWeekdays(null);
    setRepeatUntil("");
    run({ type: "add", event: temp }, () => addCalendarEvent(fields));

    // An add outside the loaded window would otherwise vanish with no
    // feedback — expandOccurrences filters it straight back out — so jump
    // the window to wherever it will actually show up.
    if (startDate < windowFrom || startDate > windowTo) {
      router.push(`/calendar?m=${startDate.slice(0, 7)}`);
    }
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

          {/*
            Repeat control: kept collapsed/simple per the mobile-first rule —
            a single select, plus an interval stepper, weekday chips and an
            optional end date only once a frequency is actually chosen.
            Duplicated (not imported) in event-sheet.tsx's extension region,
            same reason as inputClass/chipClass above — the two client
            components would otherwise form an import cycle.
          */}
          <div>
            <p className="mb-1.5 text-xs text-zinc-500">Repeat</p>
            <select
              value={repeatFreq ?? "none"}
              onChange={(e) =>
                setRepeatFreq(
                  e.target.value === "none" ? null : (e.target.value as RepeatFreq),
                )
              }
              className={`w-full ${inputClass}`}
              aria-label="Repeat"
            >
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>

            {repeatFreq && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-zinc-500">Every</span>
                  <button
                    type="button"
                    onClick={() => setRepeatInterval((n) => Math.max(1, n - 1))}
                    aria-label="Decrease interval"
                    className="rounded-full border border-black/10 px-2 py-0.5 dark:border-white/15"
                  >
                    –
                  </button>
                  <span className="w-6 text-center tabular-nums">{repeatInterval}</span>
                  <button
                    type="button"
                    onClick={() => setRepeatInterval((n) => Math.min(99, n + 1))}
                    aria-label="Increase interval"
                    className="rounded-full border border-black/10 px-2 py-0.5 dark:border-white/15"
                  >
                    +
                  </button>
                  <span className="text-xs text-zinc-500">{REPEAT_UNIT_LABEL[repeatFreq]}</span>
                </div>

                {repeatFreq === "weekly" && (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map(({ day, short, label }) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() =>
                          setRepeatWeekdays((days) => {
                            const set = new Set(days ?? []);
                            if (set.has(day)) set.delete(day);
                            else set.add(day);
                            return set.size ? [...set].sort((a, b) => a - b) : null;
                          })
                        }
                        className={chipClass((repeatWeekdays ?? []).includes(day))}
                        aria-label={label}
                        aria-pressed={(repeatWeekdays ?? []).includes(day)}
                      >
                        {short}
                      </button>
                    ))}
                  </div>
                )}

                {(repeatFreq === "monthly" || repeatFreq === "yearly") && (
                  // ADR 0007: a day that doesn't exist in every cycle (the
                  // 31st; 29 Feb) is skipped outright rather than shifted —
                  // a real surprise worth calling out here rather than
                  // leaving someone to notice the gap on their own.
                  <p className="text-xs text-zinc-500">
                    {repeatFreq === "monthly"
                      ? "A month without this day (e.g. the 31st) is skipped, not shifted."
                      : "A date that only exists in some years (29 Feb) fires only in those years."}
                  </p>
                )}

                <label className="block text-xs text-zinc-500">
                  Until (optional)
                  <input
                    type="date"
                    value={repeatUntil}
                    onChange={(e) => setRepeatUntil(e.target.value)}
                    min={startDate || undefined}
                    className={`mt-1 w-full ${inputClass}`}
                    aria-label="Repeat until"
                  />
                </label>
              </div>
            )}
          </div>

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

      {/*
        `items-start`, not `items-center`, and no margin of the row's own:
        ViewSwitcher (view-switcher.tsx, off limits to edit for this PR)
        carries its own `mb-3`, which sets the gap below this whole row —
        top-aligning both children instead of centering them keeps the bell
        button level with the switcher's top edge rather than a Flexbox
        vertical-centre pass shifting the switcher up by half of a margin
        the button doesn't have.
      */}
      <div className="flex items-start justify-between gap-2">
        <ViewSwitcher selected={selectedViewId} onSelect={setSelectedViewId} />
        <button
          type="button"
          onClick={openActivityFeed}
          aria-label={
            optimisticUnseenCount > 0
              ? `Activity, ${optimisticUnseenCount} unseen`
              : "Activity"
          }
          className="relative rounded-full p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Bell className="size-5" aria-hidden />
          {optimisticUnseenCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-medium text-white"
            >
              {optimisticUnseenCount}
            </span>
          )}
        </button>
      </div>

      <SelectedView
        key={anchorMonth ?? "default"}
        occurrences={occurrences}
        members={members}
        windowFrom={windowFrom}
        windowTo={windowTo}
        anchorMonth={anchorMonth}
        onOccurrenceClick={openEventSheet}
      />

      {editingOccurrence && (
        <EventSheet
          occurrence={editingOccurrence}
          members={members}
          comments={comments.filter((c) => c.eventId === editingOccurrence.event.id)}
          currentUserId={currentUserId}
          error={error}
          onClose={closeEventSheet}
          onSave={(optimisticEvent, input, expectedUpdatedAt) => {
            // Whole-row edit: a plain event's ordinary save, an override
            // row's own save, or a recurring master's "whole series" save
            // (recurrence fields included) — in every case there is exactly
            // one row to update, and expandOccurrences derives every
            // occurrence from it at read time.
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
          onSaveOccurrence={(optimisticOverride, input) => {
            // "This event only" on a recurring master: the master gains an
            // exdate for the tapped date and a standalone override row
            // appears at once, mirroring editOccurrence's own two inserts.
            const masterId = editingOccurrence.event.id;
            const date = editingOccurrence.date;
            run(
              {
                type: "addOverride",
                exdate: { eventId: masterId, date },
                event: optimisticOverride,
              },
              async () => {
                const result = await editOccurrence(masterId, date, input);
                if (result.error) return { error: result.error };
                closeEventSheet();
                return {};
              },
            );
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
                setEditingOccurrence((prev) =>
                  prev && prev.event.id === id
                    ? { ...prev, event: { ...prev.event, pinned, updatedAt: result.updatedAt } }
                    : prev,
                );
              }
            });
          }}
          onDelete={(id) => {
            // Whole-row delete: a plain/override row's ordinary delete, or a
            // recurring master's "whole series" delete. The server-side
            // operation is the same statement either way (deleteSeries is
            // deleteCalendarEvent under the FK cascade), but the optimistic
            // reducer action differs so a master's stray override rows and
            // exdates are cleaned out of local state immediately rather than
            // waiting for the next full reload.
            closeEventSheet();
            const isMaster = Boolean(editingOccurrence.event.repeatFreq);
            if (isMaster) {
              run({ type: "deleteSeries", eventId: id }, () => deleteSeries(id));
            } else {
              run({ type: "delete", id }, () => deleteCalendarEvent(id));
            }
          }}
          onDeleteOccurrence={(date) => {
            // "This event only" delete on a recurring master: suppress just
            // this date with an exdate, leaving the master and every other
            // occurrence untouched.
            closeEventSheet();
            const masterId = editingOccurrence.event.id;
            run(
              { type: "addExdate", eventId: masterId, date },
              () => deleteOccurrence(masterId, date),
            );
          }}
        />
      )}

      {activityFeedOpen && (
        <ActivityFeed
          rows={activity}
          members={members}
          onClose={() => setActivityFeedOpen(false)}
        />
      )}
    </div>
  );
}
