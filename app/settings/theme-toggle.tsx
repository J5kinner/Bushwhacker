"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
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
