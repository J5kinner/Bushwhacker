"use client";

import { useEffect, useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { themeFor, writeThemeCookieFromBrowser } from "@/lib/theme";
import { setDarkMode } from "./actions";

/**
 * Flips the `.dark` class on `<html>` immediately, ahead of the round trip to
 * persist it — the CSS variables in globals.css already key off that class, so
 * this is the only DOM change a toggle needs for instant feedback.
 */
function applyDarkClass(enabled: boolean) {
  document.documentElement.classList.toggle("dark", enabled);
}

export function ThemeToggle({ initialDarkMode }: { initialDarkMode: boolean }) {
  const [enabled, setEnabled] = useState(initialDarkMode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Reconcile this device with the saved preference. The root layout paints
  // from a cookie, and a device that has never toggled here does not have one
  // yet — so a member who turned dark mode on elsewhere would keep landing on
  // a light app. This page is the one place that knows the stored value, so it
  // is where the cookie gets seeded.
  useEffect(() => {
    writeThemeCookieFromBrowser(themeFor(initialDarkMode));
    applyDarkClass(initialDarkMode);
  }, [initialDarkMode]);

  function toggle(next: boolean) {
    setError(null);
    setEnabled(next);
    applyDarkClass(next);
    startTransition(async () => {
      try {
        const saved = await setDarkMode(next);
        if (!saved) throw new Error("not saved");
      } catch {
        setEnabled(!next);
        applyDarkClass(!next);
        setError("Could not save — check the household setup above.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={pending}
        aria-label="Dark mode"
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
