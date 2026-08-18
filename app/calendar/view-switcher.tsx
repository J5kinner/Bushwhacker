"use client";

import { useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import type { Occurrence } from "@/lib/recurrence";
import type { HouseholdMember } from "@/lib/queries";
import { Agenda } from "./agenda";
import { MonthGrid } from "./month-grid";

/**
 * The props every registered view is rendered with. Deliberately the same
 * shape for every view (a view is free to ignore whatever it doesn't need —
 * e.g. a future Day view may not use `anchorMonth`), so adding an entry to
 * VIEWS below is the only thing a new view has to do to plug in; nothing in
 * calendar-events.tsx (which builds this object) has to change per-view.
 *
 * `onOccurrenceClick` takes the whole tapped `Occurrence` (event + date), not
 * just its event, so the sheet it opens (calendar-events.tsx) knows *which*
 * occurrence of a recurring master was tapped — required for the this-vs-
 * series choice PR 4 adds. A non-recurring row's occurrence carries its own
 * event's own date, so this is a strict superset of the old event-only
 * contract, not a behaviour change for anything that isn't recurring.
 */
export interface CalendarViewProps {
  occurrences: Occurrence[];
  members: HouseholdMember[];
  windowFrom: string;
  windowTo: string;
  anchorMonth: string | null;
  onOccurrenceClick: (occurrence: Occurrence) => void;
}

export interface CalendarViewDefinition {
  id: string;
  label: string;
  component: ComponentType<CalendarViewProps>;
}

/**
 * The view-switcher seam. Every registered view renders against the same
 * `CalendarViewProps`, built once in calendar-events.tsx from the optimistic
 * event state (`expandOccurrences` over `{ optimistic, exdates }`). "Month"
 * (PR 2b) and "Agenda" exist so far — PR 5 registers "Day" — each a pure
 * addition to this array plus its own component file; neither this file's
 * plumbing nor calendar-events.tsx's data flow changes when a view is added.
 *
 * Month is listed first: it's TimeTree's primary view, so it's also this
 * array's `[0]` — both `DEFAULT_VIEW_ID` below and calendar-events.tsx's own
 * `VIEWS[0]` fallback read straight off array position, so a first-time
 * visitor (and any unknown/cleared localStorage value) now lands on Month
 * with no separate default to keep in sync here.
 */
export const VIEWS: CalendarViewDefinition[] = [
  { id: "month", label: "Month", component: MonthGrid },
  { id: "agenda", label: "Agenda", component: Agenda },
];

const DEFAULT_VIEW_ID = VIEWS[0].id;
const STORAGE_KEY = "homesync-calendar-view";

function isKnownViewId(id: string): boolean {
  return VIEWS.some((view) => view.id === id);
}

// localStorage is an external store from React's point of view, so it's read
// through useSyncExternalStore rather than "read it in an effect and
// setState" — the latter renders the default once, then immediately renders
// again with the stored value, which is exactly the cascading-render pattern
// React (and this repo's lint config) flags. useSyncExternalStore instead
// lets React reconcile the external value in the same commit, and its
// `getServerSnapshot` argument is what keeps SSR safe: the server (and the
// client's first hydration pass) always sees the default, matching output
// exactly, only diverging once useSyncExternalStore itself decides it's safe.
//
// The native "storage" event fires only in OTHER tabs when localStorage
// changes, never in the tab that made the write, so this tiny listener set
// is this tab's own notification path for its own `select()` calls.
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/** The stored view id, or the default for an absent/unknown/since-removed one. */
function getSnapshot(): string {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && isKnownViewId(stored) ? stored : DEFAULT_VIEW_ID;
}

function getServerSnapshot(): string {
  return DEFAULT_VIEW_ID;
}

/** The selected view id, persisted in localStorage across visits. */
export function useSelectedView(): [string, (id: string) => void] {
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function select(id: string) {
    window.localStorage.setItem(STORAGE_KEY, id);
    for (const listener of listeners) listener();
  }

  return [selected, select];
}

/**
 * The segmented control that switches between registered views. It only
 * selects — the chosen view's own content is rendered by whoever holds this
 * component's `selected` state (calendar-events.tsx), never by this file.
 */
export function ViewSwitcher({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Calendar view"
      className="mb-3 inline-flex gap-0.5 rounded-lg border border-black/10 p-0.5 dark:border-white/15"
    >
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={selected === view.id}
          onClick={() => onSelect(view.id)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            selected === view.id
              ? "bg-foreground text-background"
              : "text-zinc-500"
          }`}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
