"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Plus, Check, Trash2 } from "lucide-react";
import type { Chore } from "@/db/schema";
import { scoreChoreLoad, type CliBand, type Rating0to3 } from "@/lib/chore-load";
import { addChore, completeChore, deleteChore } from "./actions";

type Action =
  | { type: "add"; chore: Chore }
  | { type: "complete"; id: string; at: Date }
  | { type: "delete"; id: string };

function reduce(chores: Chore[], action: Action): Chore[] {
  switch (action.type) {
    case "add":
      return [...chores, action.chore];
    case "complete":
      return chores.map((c) =>
        c.id === action.id ? { ...c, lastCompletedAt: action.at } : c,
      );
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${BAND_STYLES[band]}`}
      title="Mental-load score (0–100). Tap the chore for the breakdown."
    >
      {band} · {score}
    </span>
  );
}

const STAGES = [
  { key: "anticipate", label: "Anticipate" },
  { key: "identify", label: "Identify" },
  { key: "decide", label: "Decide" },
  { key: "monitor", label: "Monitor" },
] as const;

export function ChoresList({ initialChores }: { initialChores: Chore[] }) {
  const [optimistic, dispatch] = useOptimistic(initialChores, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [ratings, setRatings] = useState({
    anticipate: 0,
    identify: 0,
    decide: 0,
    monitor: 0,
  });
  const [invisible, setInvisible] = useState(false);
  const [fragmentation, setFragmentation] = useState(0);
  const [intervalDays, setIntervalDays] = useState("");

  const preview = scoreChoreLoad({
    anticipate: ratings.anticipate as Rating0to3,
    identify: ratings.identify as Rating0to3,
    decide: ratings.decide as Rating0to3,
    monitor: ratings.monitor as Rating0to3,
    invisible,
    fragmentation: fragmentation as 0 | 1 | 2,
  });

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

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const interval = intervalDays ? Number(intervalDays) : null;
    const temp: Chore = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      ownerId: "optimistic",
      title: trimmed,
      anticipate: ratings.anticipate,
      identify: ratings.identify,
      decide: ratings.decide,
      monitor: ratings.monitor,
      invisible,
      fragmentation,
      cliScore: preview.score,
      cliBand: preview.band,
      intervalDays: interval,
      lastCompletedAt: null,
      lastCompletedById: null,
      nextDueAt: interval ? new Date() : null,
      createdAt: new Date(),
    };
    setTitle("");
    setRatings({ anticipate: 0, identify: 0, decide: 0, monitor: 0 });
    setInvisible(false);
    setFragmentation(0);
    setIntervalDays("");
    run({ type: "add", chore: temp }, () =>
      addChore({ title: trimmed, ...ratings, invisible, fragmentation, intervalDays: interval }),
    );
  }

  return (
    <div>
      <details className="mb-4 rounded-lg border border-black/10 dark:border-white/15">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Add a chore
        </summary>
        <form onSubmit={onAdd} className="space-y-3 px-3 pb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Plan the weekly meals"
            className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15"
            aria-label="Chore title"
          />
          <div className="grid grid-cols-2 gap-2">
            {STAGES.map(({ key, label }) => (
              <label key={key} className="flex items-center justify-between gap-2 text-sm">
                {label}
                <select
                  value={ratings[key]}
                  onChange={(e) =>
                    setRatings((r) => ({ ...r, [key]: Number(e.target.value) }))
                  }
                  className="rounded border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
                  aria-label={label}
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={invisible}
                onChange={(e) => setInvisible(e.target.checked)}
                className="size-4 accent-current"
              />
              Invisible
            </label>
            <label className="flex items-center gap-2">
              Fragmentation
              <select
                value={fragmentation}
                onChange={(e) => setFragmentation(Number(e.target.value))}
                className="rounded border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
                aria-label="Fragmentation"
              >
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Every
              <input
                type="number"
                min={0}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                placeholder="—"
                className="w-16 rounded border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
                aria-label="Recurrence interval in days"
              />
              days
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              Mental load: <CliBadge score={preview.score} band={preview.band} />
            </span>
            <button
              type="submit"
              className="flex items-center gap-1 rounded-lg bg-foreground px-3 py-2 text-sm text-background"
            >
              <Plus className="size-4" aria-hidden /> Add
            </button>
          </div>
        </form>
      </details>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {optimistic.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-500">No chores yet.</p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {optimistic.map((chore) => (
            <li key={chore.id} className="flex items-center gap-3 py-3">
              <button
                onClick={() =>
                  run({ type: "complete", id: chore.id, at: new Date() }, () =>
                    completeChore(chore.id),
                  )
                }
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-black/15 text-zinc-500 hover:border-emerald-500 hover:text-emerald-600 dark:border-white/20"
                aria-label={`Mark ${chore.title} done`}
              >
                <Check className="size-4" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-base">{chore.title}</span>
                  <CliBadge score={chore.cliScore} band={chore.cliBand} />
                </div>
                <p className="text-xs text-zinc-500">
                  {chore.lastCompletedAt
                    ? `Last done ${new Date(chore.lastCompletedAt).toLocaleDateString()}`
                    : "Not done yet"}
                  {chore.nextDueAt
                    ? ` · due ${new Date(chore.nextDueAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <button
                onClick={() =>
                  run({ type: "delete", id: chore.id }, () =>
                    deleteChore(chore.id),
                  )
                }
                className="text-zinc-400 hover:text-red-500"
                aria-label={`Delete ${chore.title}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
