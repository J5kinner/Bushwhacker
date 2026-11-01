"use client";

import { useOptimistic, useState, useTransition, useSyncExternalStore } from "react";
import { Plus, Check, ChevronRight, Sparkles } from "lucide-react";
import type { Chore } from "@/db/schema";
import type { HouseholdMember } from "@/lib/queries";
import type { CliBand } from "@/lib/chore-load";
import {
  calculateChoreDecay,
  getNextTurn,
  groupChoresByUrgency,
  type ChoreUrgency,
} from "@/lib/chore-decay";
import {
  addChore,
  completeChore,
  updateChore,
  deleteChore,
  type AddChoreInput,
  type UpdateChoreInput,
} from "./actions";
import { ChoreSheet } from "./chore-sheet";

function subscribeToNothing() {
  return () => {};
}
function getDeviceNow(): number {
  return Date.now();
}
function getServerNow(): null {
  return null;
}

function useDeviceNow(): Date | null {
  const ms = useSyncExternalStore(subscribeToNothing, getDeviceNow, getServerNow);
  return ms === null ? null : new Date(ms);
}

type Action =
  | { type: "add"; chore: Chore }
  | { type: "update"; chore: Chore }
  | { type: "complete"; id: string; at: Date; completedById: string | null }
  | { type: "delete"; id: string };

function reduce(chores: Chore[], action: Action): Chore[] {
  switch (action.type) {
    case "add":
      return [...chores, action.chore];
    case "update":
      return chores.map((c) => (c.id === action.chore.id ? action.chore : c));
    case "complete":
      return chores.map((c) => {
        if (c.id !== action.id) return c;
        const nextDueAt =
          c.intervalDays && c.intervalDays > 0
            ? new Date(action.at.getTime() + c.intervalDays * 86_400_000)
            : null;
        return {
          ...c,
          lastCompletedAt: action.at,
          lastCompletedById: action.completedById,
          nextDueAt,
        };
      });
    case "delete":
      return chores.filter((c) => c.id !== action.id);
  }
}

const BAND_STYLES: Record<CliBand, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  high: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};

function CliBadge({ score, band }: { score: number; band: CliBand }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-medium ${BAND_STYLES[band]}`}
      title="Mental-load score (0–100)"
    >
      {band} · {score}
    </span>
  );
}

const URGENCY_STYLES: Record<
  ChoreUrgency,
  { bar: string; label: string; dot: string }
> = {
  overdue: {
    bar: "bg-rose-500 dark:bg-rose-400",
    label: "text-rose-600 dark:text-rose-400 font-medium",
    dot: "bg-rose-500",
  },
  "due-soon": {
    bar: "bg-amber-500 dark:bg-amber-400",
    label: "text-amber-600 dark:text-amber-400 font-medium",
    dot: "bg-amber-500",
  },
  "up-to-date": {
    bar: "bg-emerald-500 dark:bg-emerald-400",
    label: "text-zinc-500 dark:text-zinc-400",
    dot: "bg-emerald-500",
  },
  "one-off": {
    bar: "bg-zinc-400",
    label: "text-zinc-500 dark:text-zinc-400",
    dot: "bg-zinc-400",
  },
};

export function ChoresList({
  initialChores,
  members,
  currentUserId,
}: {
  initialChores: Chore[];
  members: HouseholdMember[];
  currentUserId: string | null;
}) {
  const [optimistic, dispatch] = useOptimistic(initialChores, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Quick tidy filter
  const [quickTidy, setQuickTidy] = useState(false);

  // Bottom sheet modal state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingChore, setEditingChore] = useState<Chore | null>(null);

  // Device-local clock for hydration safety
  const deviceNow = useDeviceNow();
  const activeNow = deviceNow ?? new Date();

  function run(optimisticAction: Action, action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      dispatch(optimisticAction);
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function handleSave(input: AddChoreInput | UpdateChoreInput, choreId?: string) {
    if (choreId) {
      // Editing existing chore
      const existing = optimistic.find((c) => c.id === choreId);
      if (!existing) return;

      const intervalDays =
        input.intervalDays !== undefined ? input.intervalDays : existing.intervalDays;
      let nextDueAt = existing.nextDueAt;
      if (intervalDays !== existing.intervalDays) {
        if (intervalDays) {
          const anchor = existing.lastCompletedAt ?? existing.createdAt;
          nextDueAt = new Date(anchor.getTime() + intervalDays * 86_400_000);
        } else {
          nextDueAt = null;
        }
      }

      let lastCompletedById = existing.lastCompletedById;
      let ownerId = existing.ownerId;
      if (input.nextTurnUserId) {
        const other = members.find((m) => m.id !== input.nextTurnUserId);
        if (other) {
          lastCompletedById = other.id;
        }
        if (!existing.lastCompletedAt) {
          ownerId = input.nextTurnUserId;
        }
      }

      const updatedChore: Chore = {
        ...existing,
        title: input.title,
        intervalDays,
        nextDueAt,
        lastCompletedById,
        ownerId,
      };

      run({ type: "update", chore: updatedChore }, () =>
        updateChore(choreId, input as UpdateChoreInput),
      );
    } else {
      // Creating new chore
      const intervalDays =
        input.intervalDays && input.intervalDays > 0 ? input.intervalDays : null;

      const ownerId = input.nextTurnUserId ?? currentUserId ?? "optimistic";

      const temp: Chore = {
        id: crypto.randomUUID(),
        householdId: "optimistic",
        ownerId,
        title: input.title,
        anticipate: 0,
        identify: 0,
        decide: 0,
        monitor: 0,
        invisible: false,
        fragmentation: 0,
        cliScore: 0,
        cliBand: "low",
        intervalDays,
        lastCompletedAt: null,
        lastCompletedById: null,
        nextDueAt: intervalDays ? new Date() : null,
        createdAt: new Date(),
      };

      run({ type: "add", chore: temp }, () =>
        addChore(input as AddChoreInput),
      );
    }
  }

  function handleComplete(chore: Chore) {
    const now = new Date();
    run(
      { type: "complete", id: chore.id, at: now, completedById: currentUserId },
      () => completeChore(chore.id),
    );
  }

  function handleDelete(choreId: string) {
    run({ type: "delete", id: choreId }, () => deleteChore(choreId));
  }

  function openAddSheet() {
    setEditingChore(null);
    setSheetOpen(true);
  }

  function openEditSheet(chore: Chore) {
    setEditingChore(chore);
    setSheetOpen(true);
  }

  const grouped = groupChoresByUrgency(optimistic, activeNow);

  const sections: {
    key: ChoreUrgency;
    title: string;
    items: Chore[];
  }[] = [
    { key: "overdue", title: "Overdue", items: grouped.overdue },
    ...(!quickTidy
      ? [
          { key: "due-soon" as const, title: "Due soon", items: grouped.dueSoon },
          { key: "up-to-date" as const, title: "Up to date", items: grouped.upToDate },
          { key: "one-off" as const, title: "One-off", items: grouped.oneOff },
        ]
      : []),
  ];

  const totalOverdue = grouped.overdue.length;

  return (
    <div>
      {/* Controls Header: Quick tidy filter & Add chore */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setQuickTidy((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            quickTidy
              ? "border-amber-500 bg-amber-500/15 text-amber-900 dark:border-amber-400/40 dark:text-amber-200"
              : "border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"
          }`}
          aria-pressed={quickTidy}
        >
          <Sparkles className="size-3.5" aria-hidden />
          <span>Quick tidy</span>
          {totalOverdue > 0 && (
            <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] text-white">
              {totalOverdue}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={openAddSheet}
          className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden /> Add chore
        </button>
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Quick Tidy Banner */}
      {quickTidy && (
        <div className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <strong>Quick tidy mode:</strong> Focus on completing {totalOverdue} overdue {totalOverdue === 1 ? "chore" : "chores"} to bring the house back up to standard.
        </div>
      )}

      {/* Empty State */}
      {optimistic.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-sm text-zinc-500">No chores yet.</p>
          <button
            type="button"
            onClick={openAddSheet}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium hover:border-black/30 dark:border-white/20"
          >
            <Plus className="size-4" aria-hidden /> Add your first chore
          </button>
        </div>
      ) : quickTidy && totalOverdue === 0 ? (
        <div className="mt-12 text-center text-sm text-zinc-500">
          <p className="font-medium text-emerald-600 dark:text-emerald-400">
            All caught up!
          </p>
          <p className="mt-1">There are no overdue chores right now.</p>
          <button
            type="button"
            onClick={() => setQuickTidy(false)}
            className="mt-3 text-xs text-zinc-600 underline dark:text-zinc-400"
          >
            Show all chores
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map(({ key, title, items }) => {
            if (items.length === 0) return null;
            const style = URGENCY_STYLES[key];

            return (
              <section key={key} aria-labelledby={`heading-${key}`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`size-2 rounded-full ${style.dot}`} />
                  <h2
                    id={`heading-${key}`}
                    className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    {title} ({items.length})
                  </h2>
                </div>

                <ul className="divide-y divide-black/5 rounded-xl border border-black/10 bg-black/[0.01] dark:divide-white/10 dark:border-white/15 dark:bg-white/[0.01]">
                  {items.map((chore) => {
                    const decay = calculateChoreDecay(chore, activeNow);
                    const turn = getNextTurn(chore, members, currentUserId);

                    return (
                      <li
                        key={chore.id}
                        onClick={() => openEditSheet(chore)}
                        className="group flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                      >
                        {/* Checkmark Completion Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleComplete(chore);
                          }}
                          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-black/15 text-zinc-400 transition-colors hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 dark:border-white/20 dark:hover:bg-emerald-950/20"
                          aria-label={`Mark ${chore.title} done`}
                        >
                          <Check className="size-4" aria-hidden />
                        </button>

                        {/* Chore Details */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-base leading-tight">
                              {chore.title}
                            </span>
                            <span className={`shrink-0 text-xs ${style.label}`}>
                              {decay.label}
                            </span>
                          </div>

                          {/* Decay Progress Bar (if recurring) */}
                          {chore.intervalDays !== null && chore.intervalDays > 0 && (
                            <div className="my-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${style.bar}`}
                                style={{ width: `${decay.percentage}%` }}
                              />
                            </div>
                          )}

                          {/* Metadata row: Turn badge */}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                turn.isCurrentUser
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                                  : "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
                              }`}
                            >
                              {turn.label}
                            </span>

                            {chore.cliScore > 0 && (
                              <CliBadge
                                score={chore.cliScore}
                                band={chore.cliBand}
                              />
                            )}
                          </div>
                        </div>

                        {/* Edit Chevron */}
                        <ChevronRight
                          className="size-4 shrink-0 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200"
                          aria-hidden
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Add / Edit Bottom Sheet */}
      <ChoreSheet
        key={editingChore?.id ?? "new"}
        chore={editingChore}
        members={members}
        currentUserId={currentUserId}
        isOpen={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setEditingChore(null);
        }}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
