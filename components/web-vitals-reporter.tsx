"use client";

import { useReportWebVitals } from "next/web-vitals";
import type { Metric, Rating } from "@/lib/web-vitals";

/**
 * Mirrors each Web Vital into our own database alongside Speed Insights, which
 * on Hobby keeps only 7 days and cannot be exported. See ADR 0011.
 *
 * Sent with sendBeacon so the request survives the page being closed, which is
 * exactly when the final LCP and INP values are known. fetch with keepalive is
 * the fallback for browsers without it.
 */
export function WebVitalsReporter() {
  useReportWebVitals(reportVital);
  return null;
}

/**
 * Web Vitals describe the hard page load, so every metric is attributed to the
 * route that was loaded — not whichever route a later soft navigation shows.
 * Captured at module evaluation, which the browser runs once per hard load;
 * the server render never reports, so the placeholder is never sent.
 */
const hardLoadRoute = typeof window === "undefined" ? "" : window.location.pathname;

/**
 * Kept at module scope because useReportWebVitals re-registers every handler
 * whenever the callback's identity changes, and re-registered handlers replay
 * the initial load's buffered metrics. An inline closure over usePathname()
 * changed identity on every soft navigation, so each bottom-nav tap inserted
 * the hard load's metrics again under the new route's name.
 */
function reportVital(metric: { name: string; value: number; rating: string }) {
  if (process.env.NODE_ENV !== "production") return;

  const body = JSON.stringify({
    route: hardLoadRoute,
    metric: metric.name as Metric,
    value: metric.value,
    rating: metric.rating as Rating,
    deviceType: window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop",
  });

  if (navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }))) {
    return;
  }
  void fetch("/api/vitals", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
}
