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
  const [, startTransition] = useTransition();

  function toggle(next: boolean) {
    setEnabled(next);
    applyDarkClass(next);
    startTransition(async () => {
      await setDarkMode(next);
    });
  }

  return (
    <Switch
      checked={enabled}
      onCheckedChange={toggle}
      aria-label="Dark mode"
    />
  );
}
