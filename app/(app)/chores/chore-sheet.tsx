"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { Chore } from "@/db/schema";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import type { AddChoreInput, UpdateChoreInput } from "./actions";

const inputClass =
  "w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30";

const PRESET_INTERVALS = [
  { label: "Weekly (7d)", days: 7 },
  { label: "Fortnightly (14d)", days: 14 },
  { label: "Monthly (30d)", days: 30 },
  { label: "Quarterly (90d)", days: 90 },
  { label: "One-off", days: null },
] as const;

export interface ChoreSheetProps {
  chore?: Chore | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: AddChoreInput | UpdateChoreInput, choreId?: string) => void | Promise<void>;
  onDelete?: (choreId: string) => void | Promise<void>;
}

export function ChoreSheet({
  chore,
  isOpen,
  onClose,
  onSave,
  onDelete,
}: ChoreSheetProps) {
  const keyboardInset = useKeyboardInset();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const isEditing = Boolean(chore);

  // Form state prefilled from chore if editing
  const [title, setTitle] = useState(chore?.title ?? "");

  // Frequency preset selection
  const initialDays = chore?.intervalDays ?? null;
  const isStandardPreset =
    initialDays === null || [7, 14, 30, 90].includes(initialDays);

  const [selectedInterval, setSelectedInterval] = useState<number | null | "custom">(
    isStandardPreset ? initialDays : "custom",
  );
  const [customDays, setCustomDays] = useState(
    !isStandardPreset && initialDays ? String(initialDays) : "",
  );

  // Confirm delete state
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus heading on open
  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
    }
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Escape key closes sheet
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Clean up delete timer on unmount
  useEffect(() => {
    return () => {
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    };
  }, []);

  if (!isOpen) return null;

  function getResolvedInterval(): number | null {
    if (selectedInterval === "custom") {
      const parsed = parseInt(customDays, 10);
      return !isNaN(parsed) && parsed > 0 ? parsed : null;
    }
    return selectedInterval;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const intervalDays = getResolvedInterval();
    const input: AddChoreInput = {
      title: trimmedTitle,
      intervalDays,
    };

    onSave(input, chore?.id);
    onClose();
  }

  function handleDeleteClick() {
    if (!chore || !onDelete) return;
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);

    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmDeleteTimer.current = setTimeout(() => {
        setConfirmingDelete(false);
      }, 4000);
      return;
    }

    setConfirmingDelete(false);
    onDelete(chore.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? "Edit chore" : "Add chore"}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col rounded-t-2xl bg-background shadow-xl"
        style={{
          bottom: keyboardInset,
          maxHeight: `min(88dvh, calc(100dvh - ${keyboardInset}px - 1rem))`,
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/15">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            {isEditing ? "Edit chore" : "New chore"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {/* Content Form */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-4 overflow-y-auto px-4 pt-3"
          style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        >
          {/* Title */}
          <div>
            <label
              htmlFor="chore-title"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Chore title
            </label>
            <input
              id="chore-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Wash bed sheets"
              className={inputClass}
              autoFocus
              required
            />
          </div>

          {/* Frequency selector chips */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Repeat frequency
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_INTERVALS.map((preset) => {
                const active = selectedInterval === preset.days;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSelectedInterval(preset.days)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedInterval("custom")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedInterval === "custom"
                    ? "border-foreground bg-foreground text-background"
                    : "border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
                }`}
              >
                Custom days
              </button>
            </div>

            {selectedInterval === "custom" && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  Every
                </span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder="e.g. 3"
                  className="w-24 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-base outline-none focus:border-black/30 dark:border-white/15"
                  aria-label="Custom repeat days"
                  required
                />
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  days
                </span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between gap-3 pt-3">
            {isEditing && onDelete ? (
              <button
                type="button"
                onClick={handleDeleteClick}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  confirmingDelete
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                }`}
              >
                <Trash2 className="size-4" aria-hidden />
                {confirmingDelete ? "Confirm delete" : "Delete"}
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                {isEditing ? "Save changes" : "Add chore"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
