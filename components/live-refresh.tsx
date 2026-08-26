"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * How long to leave the current tab alone before re-checking the server.
 *
 * This used to be 15 seconds, which cost far more than it looked. Each tick is
 * a full dynamic re-render of the current route — a function invocation and its
 * queries — and `router.refresh()` additionally bumps a *global* segment-cache
 * version, so every prefetched route is discarded and every visible nav link
 * re-prefetched. At four ticks a minute that ran to roughly two dozen requests
 * per minute for as long as the app was open, on a phone, to catch a household
 * of two who change something a handful of times a day.
 *
 * A minute keeps the case that actually matters — one of us at the shops while
 * the other adds to the list at home — well inside the useful window, at a
 * quarter of the traffic. The visibility listener below is what covers the
 * common case anyway, and it is immediate.
 */
const POLL_MS = 60_000;

/**
 * Keeps the current tab in sync with the other household member's changes.
 *
 * Re-fetches the route's server data when the PWA comes back into view — the
 * pick-up-your-phone moment, and the one that catches nearly everything — and
 * on a slow poll behind that for a screen left open on one tab.
 *
 * The delay is re-armed after every refresh rather than run on a fixed
 * interval, so returning to the app does not get a second refresh moments later
 * from a tick that was already in flight. Battery-friendly by construction: the
 * browser suspends timers when the app is backgrounded or the screen is locked,
 * and the visibility guard skips any stray tick that fires while hidden.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const arm = () => {
      timer = setTimeout(() => {
        refreshIfVisible();
        arm();
      }, POLL_MS);
    };

    // Refresh on return to the app, then push the next poll a full interval out
    // from that refresh rather than letting an already-pending one fire behind
    // it. Ignores the hidden half of the event: there is nothing to re-render
    // for a tab nobody is looking at.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      clearTimeout(timer);
      arm();
    };

    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
