"use client";

import { useEffect, useRef, useState } from "react";
import { Pin, PinOff, Trash2, X } from "lucide-react";
import type { CalendarEvent } from "@/db/schema";
import { Switch } from "@/components/ui/switch";
import { EVENT_COLOURS } from "@/lib/event-colours";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import type { HouseholdMember } from "@/lib/queries";
import type { Occurrence } from "@/lib/recurrence";
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

type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly";

// getDay() order (0 = Sunday); duplicated from calendar-events.tsx's add
// form alongside the rest of the repeat control, same import-cycle reason.
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

/**
 * The bottom sheet opened by tapping an occurrence in the agenda list: a full
 * edit form for every event-model-v2 field plus recurrence, pre-filled from
 * the occurrence the sheet was opened for, plus the pin toggle and the
 * delete confirm.
 *
 * `occurrence` is a snapshot taken at open time (not a live view of
 * `optimistic`), so `occurrence.event` also carries the `updatedAt` the
 * last-write-wins guard checks against — see the comment on
 * `editingOccurrence` in calendar-events.tsx. Date fields are pre-filled from
 * `occurrence.date`/`occurrence.endDate`, not `event.startDate`/`endDate`:
 * for a plain event or an override row the two are always identical
 * (`expandOccurrences` passes both through as identity occurrences), but for
 * an actual generated occurrence of a recurring master `event.startDate` is
 * the master's own series-start date, not the date that was tapped — showing
 * that instead would open, say, the third Tuesday of a weekly series and
 * silently pre-fill the very first Tuesday's date.
 *
 * This sheet is a long-lived seam: later PRs (comments — PR 7; a reminder
 * picker — PR 8; attachments — PR 9) each mount one more labelled section
 * here. PR 4 (this one) is the first to use the extension region, for the
 * Repeat section. The extension region below the core fields is where new
 * sections go, so they never need to restructure this form.
 */
export function EventSheet({
  occurrence,
  members,
  error,
  onClose,
  onSave,
  onSaveOccurrence,
  onTogglePinned,
  onDelete,
  onDeleteOccurrence,
}: {
  occurrence: Occurrence;
  members: HouseholdMember[];
  error: string | null;
  onClose: () => void;
  /** Whole-row save: a plain event, an override row, or a master's "whole series" save. */
  onSave: (
    optimisticEvent: CalendarEvent,
    input: CalendarEventInput,
    expectedUpdatedAt: Date,
  ) => void;
  /** "This event only" save on a recurring master — never called for a plain event or an override. */
  onSaveOccurrence: (
    optimisticOverride: CalendarEvent,
    input: CalendarEventInput,
  ) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  /** Whole-row delete: a plain event, an override row, or a master's "whole series" delete. */
  onDelete: (id: string) => void;
  /** "This event only" delete on a recurring master — never called for a plain event or an override. */
  onDeleteOccurrence: (date: string) => void;
}) {
  const keyboardInset = useKeyboardInset();
  const event = occurrence.event;
  // A recurring master (repeatFreq set, not itself an override) is the only
  // case with a this-vs-series choice to make; an override row already
  // carries `isOverride: true` from expandOccurrences and edits/deletes
  // directly, same as a plain event.
  const isMaster = Boolean(event.repeatFreq);

  const [title, setTitle] = useState(event.title);
  const [startDate, setStartDate] = useState(occurrence.date);
  const [endDate, setEndDate] = useState(occurrence.endDate ?? "");
  // Only flipped by the date inputs' own onChange (below), never by
  // anything else that happens to touch startDate/endDate state — see
  // handleSave, which uses this to tell a deliberate whole-series
  // reschedule apart from the form simply having been pre-filled from the
  // tapped occurrence's date.
  const [dateTouched, setDateTouched] = useState(false);
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
  const [repeatFreq, setRepeatFreq] = useState<RepeatFreq | null>(event.repeatFreq);
  const [repeatInterval, setRepeatInterval] = useState(event.repeatInterval || 1);
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[] | null>(
    event.repeatWeekdays,
  );
  const [repeatUntil, setRepeatUntil] = useState(event.repeatUntil ?? "");
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
  // (comments, reminders, attachments) should add one then rather than each
  // reinventing it here.
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

  // A plain literal (not typed as CalendarEventInput) so every field is
  // concretely present rather than optional — spreading it over `event`
  // below then yields a proper, fully-typed CalendarEvent for the
  // optimistic reducer, with no `| undefined` creeping in from the
  // interface's optional markers. Shared by both save paths below.
  function collectFields(): CalendarEventInput | null {
    const trimmed = title.trim();
    if (!trimmed || !startDate) return null;
    return {
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
  }

  /**
   * Whole-row save: a plain event or an override row's ordinary save, or a
   * recurring master's "All events in the series" choice (recurrence fields
   * included). `pinned` comes from state, not the `event` snapshot: a pin
   * toggle earlier in this sheet session already moved it ahead of the
   * snapshot, and spreading the stale snapshot's value here would visually
   * revert the pin the moment this optimistic row lands.
   *
   * BLOCKER fix: the date fields are pre-filled from the tapped OCCURRENCE's
   * date, not the master's own series-start date (see the class doc
   * comment) — necessary so "this only" opens showing the right day, but
   * dangerous for "whole series", which writes straight to the master row
   * that `expandOccurrences` generates every occurrence from. Opening
   * occurrence #5 of a weekly series, editing only the title, and saving
   * "whole series" would otherwise silently move the master's startDate to
   * occurrence #5's date — occurrences 1-4 are before that date and vanish
   * from expansion forever, with nothing in the UI suggesting a reschedule
   * happened. `dateTouched` (set only by the date inputs' own onChange)
   * tells an accidental carry-over apart from someone deliberately typing a
   * new date to reschedule the whole series, which stays fully possible.
   */
  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const fields = collectFields();
    if (!fields) return;
    const resolvedFields =
      isMaster && !dateTouched
        ? { ...fields, startDate: event.startDate, endDate: event.endDate }
        : fields;
    const optimisticEvent: CalendarEvent = {
      ...event,
      ...resolvedFields,
      // CalendarEventInput allows `repeatInterval: null` for callers that
      // don't care; the schema column is not-null, so the optimistic row
      // (typed against the real CalendarEvent) needs the same 1 fallback
      // the server's normaliser applies.
      repeatInterval: resolvedFields.repeatInterval ?? 1,
      pinned,
      updatedAt: new Date(),
    };
    onSave(optimisticEvent, resolvedFields, event.updatedAt);
  }

  /**
   * "This event only" save on a recurring master: builds a standalone
   * override row instead of touching the master. Repeat fields are forced
   * null regardless of what the (shared, master-prefilled) repeat controls
   * currently show — an override is never itself a series, and
   * `editOccurrence` enforces the same thing server-side, so this is
   * belt-and-braces rather than the only guard.
   */
  function handleSaveOccurrenceOnly() {
    const fields = collectFields();
    if (!fields) return;
    const overrideInput: CalendarEventInput = {
      ...fields,
      repeatFreq: null,
      repeatInterval: 1,
      repeatWeekdays: null,
      repeatUntil: null,
    };
    const optimisticOverride: CalendarEvent = {
      ...event,
      ...overrideInput,
      repeatInterval: 1,
      id: crypto.randomUUID(),
      pinned,
      seriesId: event.id,
      originalDate: occurrence.date,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    onSaveOccurrence(optimisticOverride, overrideInput);
  }

  // Two-tap delete: the first tap arms a confirm state that disarms itself
  // after a beat, so a stray thumb can't delete the event in one go — same
  // pattern as the shopping list's "Clear bought" confirm. For a recurring
  // master, arming swaps in the This-only/Whole-series choice (below) rather
  // than a second tap on this same button, so this function's own confirmed
  // branch is only ever reached for a plain event or an override row.
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

  /** The armed This-only/Whole-series delete choice, master events only. */
  function handleDeleteConfirmed(scope: "occurrence" | "series") {
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    setConfirmingDelete(false);
    if (scope === "occurrence") onDeleteOccurrence(occurrence.date);
    else onDelete(event.id);
  }

  // Whichever startDate handleSave will actually send: the master's own
  // (untouched master) or the form's own (a touched master, an override, or
  // a plain event) — see handleSave's BLOCKER comment. The "Until" field
  // validates against exactly that date server-side, so its min must match
  // or a valid-looking value here could still fail to save.
  const repeatUntilMin = isMaster && !dateTouched ? event.startDate : startDate;

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
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDateTouched(true);
                }}
                className={`mt-1 w-full ${inputClass}`}
                aria-label="Start date"
              />
            </label>
            <label className="flex-1 text-xs text-zinc-500">
              End (optional)
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDateTouched(true);
                }}
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
            Future sections (comments — PR 7; a reminder picker — PR 8;
            attachments — PR 9) mount here too, each as its own labelled
            block, below the core fields and above pin/delete. Adding one is
            a pure insertion — nothing above or below this comment needs to
            move.
          */}

          {/*
            Repeat section. Hidden entirely for an override row: an override
            is a standalone, non-recurring event by construction (the schema
            and editOccurrence both force its repeat* columns to null), and
            letting it start its own independent series would be a second,
            unrelated recurrence layered on top of the one it already
            belongs to — not a case the plan or ADR 0007 covers, so it's kept
            out rather than guessed at.
          */}
          {!occurrence.isOverride && (
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
                    // 31st; 29 Feb) is skipped outright rather than shifted.
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
                      min={repeatUntilMin || undefined}
                      className={`mt-1 w-full ${inputClass}`}
                      aria-label="Repeat until"
                    />
                  </label>
                </div>
              )}

              {isMaster && (
                <p className="mt-2 text-xs text-zinc-500">
                  Changes here only take effect with &quot;All events in the series&quot; below.
                </p>
              )}
            </div>
          )}

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
            {/*
              A recurring master swaps the delete slot's single confirm
              button for the This-only/Whole-series choice once armed,
              keeping the same two-tap safety (tap Delete to arm, tap a
              choice to act) rather than adding a third tap.
            */}
            {confirmingDelete && isMaster ? (
              <div className="flex flex-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleDeleteConfirmed("occurrence")}
                  className="flex-1 rounded-lg border border-red-500 bg-red-500/10 px-2 py-2 text-xs text-red-600 dark:text-red-400"
                >
                  This only
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteConfirmed("series")}
                  className="flex-1 rounded-lg border border-red-500 bg-red-500/10 px-2 py-2 text-xs text-red-600 dark:text-red-400"
                >
                  Whole series
                </button>
              </div>
            ) : (
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
            )}

            {/*
              A recurring master asks This-only/Whole-series at save time
              too, inline as two buttons rather than a separate confirm step
              — unlike delete, saving isn't destructive, so there's no need
              for the extra arm-then-choose tap.
            */}
            {isMaster ? (
              <div className="flex flex-1 gap-1.5">
                <button
                  type="button"
                  onClick={handleSaveOccurrenceOnly}
                  className="flex-1 rounded-lg border border-black/10 px-2 py-2 text-xs dark:border-white/15"
                >
                  This only
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-foreground px-2 py-2 text-xs text-background"
                >
                  Whole series
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className="flex-1 rounded-lg bg-foreground px-3 py-2 text-sm text-background"
              >
                Save
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
