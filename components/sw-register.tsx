"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker in production only, so dev is not fighting a
 * cache. Rendered once from the root layout.
 */
export function SwRegister() {
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort; ignore failures */
      });
    }
  }, []);

  return null;
}
