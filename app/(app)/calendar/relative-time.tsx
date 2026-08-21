"use client";

import { useSyncExternalStore } from "react";
import { format } from "date-fns";

/**
 * Shared "how long ago" helper for the comment thread (event-sheet.tsx) and
 * the activity feed (activity-feed.tsx) — both need a device-local relative
 * timestamp ("2h ago"), and both need it hydration-safe for the same reason
 * month-grid.tsx's/agenda.tsx's "today" is: server-rendered HTML runs on
 * Vercel's UTC clock, so reading the device's real instant during the first
 * render would make that render disagree with the client's own first
 * (hydration) render, which React requires to match byte-for-byte.
 *
 * Modelled as a useSyncExternalStore "store" rather than a plain
 * useState+useEffect pair, on purpose: this repo's lint config
 * (react-hooks/set-state-in-effect) flags calling setState synchronously
 * inside an effect as a cascading-render anti-pattern. useSyncExternalStore
 * gets the identical "server and the client's first render agree; only
 * diverge once, safely, right after" result without an effect at all — the
 * server (and the client's first hydration pass) always see
 * `getServerNow`'s null, and only afterwards does React ask `getDeviceNow`
 * for the real instant and re-render if it differs. There is nothing to
 * subscribe to (no event fires when a second ticks over), so `subscribe` is
 * a no-op; a re-render from any other cause (e.g. the 15s LiveRefresh poll)
 * naturally re-reads the clock anyway.
 */
function subscribeToNothing() {
  return () => {};
}
function getDeviceNow(): number {
  return Date.now();
}
function getServerNow(): null {
  return null;
}

/** The device's current instant, or null before the client has mounted. */
export function useDeviceNow(): Date | null {
  const ms = useSyncExternalStore(subscribeToNothing, getDeviceNow, getServerNow);
  return ms === null ? null : new Date(ms);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * "Just now" / "5m ago" / "3h ago" / "2d ago" against `now`, falling back to
 * an absolute short date ("14 Aug") once a week has passed — so a thread or
 * feed that lives for months doesn't render an ever-growing "214d ago".
 *
 * For the one render before `useDeviceNow` resolves (`now` is null), this
 * returns an empty string rather than an absolute date — `date-fns`'
 * `format` reads the `Date` object's LOCAL getters, which are the server's
 * UTC clock during SSR (and the client's first, hydration-matching render)
 * but the device's real zone once `now` resolves. For a comment/activity
 * row whose UTC and Sydney calendar days differ (any time from midnight to
 * ~11am AEST/10am AEDT), formatting during the null phase would render a
 * different day server-side than the client's own later local-time format
 * would — a genuine hydration text mismatch, not just a "diverges once,
 * safely" resolution like `useDeviceNow`'s own null→real transition. An
 * empty placeholder side-steps that entirely: it is identical output
 * regardless of which zone computed it, and the real text appears on the
 * very next client render once `now` resolves. Once `now` IS non-null this
 * function only ever runs client-side (the server always hands back a null
 * `now`), so the absolute-date fallback below is safe exactly as written.
 */
export function formatRelativeTime(date: Date, now: Date | null): string {
  if (now === null) return "";
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < MINUTE_MS) return "Just now";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  if (diffMs < WEEK_MS) return `${Math.floor(diffMs / DAY_MS)}d ago`;
  return format(date, "d MMM");
}
