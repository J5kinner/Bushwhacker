"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 15_000;

/**
 * Keeps the current tab in sync with the other household member's changes.
 *
 * Re-fetches the route's server data when the PWA comes back into view (the
 * pick-up-your-phone moment) and on a light poll while the screen is on.
 * Battery-friendly by construction: the browser suspends timers when the app
 * is backgrounded or the screen is locked, and the visibility guard skips any
 * stray tick that fires while hidden. With server reads answered from the
 * tag cache, each refresh is a single cheap request, not a database hit.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}
