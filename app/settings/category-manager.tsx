"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  addShoppingCategory,
  removeShoppingCategory,
} from "@/app/shopping/actions";

type Category = { id: string; name: string };

type Action =
  | { type: "add"; category: Category }
  | { type: "remove"; id: string };

function reduce(categories: Category[], action: Action): Category[] {
  switch (action.type) {
    case "add":
      return [...categories, action.category];
    case "remove":
      return categories.filter((c) => c.id !== action.id);
  }
}

export function CategoryManager({
  initialCategories,
}: {
  initialCategories: Category[];
}) {
  const [optimistic, dispatch] = useOptimistic(initialCategories, reduce);
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(optimistic: Action, action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      dispatch(optimistic);
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // Guard the duplicate here too so the optimistic row never flashes in for a
    // name the server will reject.
    if (optimistic.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setError("That category already exists.");
      return;
    }
    const temp: Category = { id: crypto.randomUUID(), name: trimmed };
    setName("");
    run({ type: "add", category: temp }, () => addShoppingCategory(trimmed));
  }

  return (
    <div>
      <form onSubmit={onAdd} className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a category…"
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="New category name"
        />
        <button
          type="submit"
          className="flex shrink-0 items-center justify-center rounded-lg bg-foreground px-4 py-2 text-background"
          aria-label="Add category"
        >
          <Plus className="size-5" aria-hidden />
        </button>
      </form>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {optimistic.length === 0 ? (
        <p className="text-sm text-zinc-500">No categories yet.</p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {optimistic.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-base">
                {category.name}
              </span>
              <button
                onClick={() =>
                  run({ type: "remove", id: category.id }, () =>
                    removeShoppingCategory(category.id),
                  )
                }
                className="text-zinc-400 hover:text-red-500"
                aria-label={`Remove ${category.name}`}
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
