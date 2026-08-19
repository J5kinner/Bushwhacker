"use client";

import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") return;

    const body = JSON.stringify({
      route: pathname,
      metric: metric.name as Metric,
      value: metric.value,
      rating: metric.rating as Rating,
      deviceType: window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop",
    });

    if (navigator.sendBeacon?.(("/api/vitals"), new Blob([body], { type: "application/json" }))) {
      return;
    }
    void fetch("/api/vitals", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  });

  return null;
}
