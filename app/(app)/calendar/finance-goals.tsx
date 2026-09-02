"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import type { FinanceGoal } from "@/db/schema";
import { formatCents } from "@/lib/finance-format";
import { addFinanceGoal, archiveFinanceGoal } from "./finance-actions";

/**
 * Monthly category spending caps, with progress against the currently-shown
 * period's spend in that category (see finance-overview.tsx, which computes
 * `categoryTotals` for the same period this section is scrolled to).
 */
export function FinanceGoals({
  goals,
  categoryTotals,
}: {
  goals: FinanceGoal[];
  categoryTotals: Map<string, number>;
}) {
  const router = useRouter();
  const [adding, startAdding] = useTransition();
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [, startArchiving] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [targetDollars, setTargetDollars] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (adding) return;
    setError(null);
    const targetCents = Math.round(Number(targetDollars) * 100);
    startAdding(async () => {
      const result = await addFinanceGoal({ name, category, targetCents });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setName("");
      setCategory("");
      setTargetDollars("");
      router.refresh();
    });
  }

  function onArchive(goal: FinanceGoal) {
    setArchivingId(goal.id);
    startArchiving(async () => {
      await archiveFinanceGoal(goal.id);
      router.refresh();
    });
  }

  return (
    <div>
      {goals.length === 0 ? (
        <p className="text-sm text-zinc-500">No goals yet — add a monthly cap below.</p>
      ) : (
        <ul className="space-y-3">
          {goals.map((goal) => {
            const spentCents = categoryTotals.get(goal.categoryFilter ?? "") ?? 0;
            const share = Math.min(100, (spentCents / goal.targetCents) * 100);
            const over = spentCents > goal.targetCents;
            return (
              <li key={goal.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    {goal.name} <span className="text-zinc-500 dark:text-zinc-400">({goal.categoryFilter})</span>
                  </span>
                  <button
                    onClick={() => onArchive(goal)}
                    disabled={archivingId === goal.id}
                    aria-label={`Remove goal ${goal.name}`}
                    className="text-zinc-400 hover:text-foreground disabled:opacity-60"
                  >
                    {archivingId === goal.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <X className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-black/5 dark:bg-white/10">
                  <div
                    className={`h-1.5 rounded-full ${over ? "bg-red-500" : "bg-foreground/60"}`}
                    style={{ width: `${share}%` }}
                  />
                </div>
                <p
                  className={`mt-0.5 text-xs ${
                    over ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {formatCents(spentCents)} of {formatCents(goal.targetCents)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={onAdd} className="mt-4 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Goal name (e.g. Groceries)"
          className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Goal name"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Bank category (e.g. Retail & Personal)"
          className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Bank category"
        />
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={targetDollars}
          onChange={(e) => setTargetDollars(e.target.value)}
          placeholder="Monthly cap ($)"
          className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Monthly cap in dollars"
        />
        <button
          type="submit"
          disabled={adding}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/10 px-4 py-2 hover:border-black/30 disabled:opacity-60 dark:border-white/15 dark:hover:border-white/40"
        >
          {adding ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-5" aria-hidden />
          )}
          Add goal
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
