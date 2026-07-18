"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ShoppingItem } from "@/db/schema";
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories";
import {
  addShoppingItem,
  deleteShoppingItem,
  setShoppingItemChecked,
} from "./actions";

type Action =
  | { type: "add"; item: ShoppingItem }
  | { type: "toggle"; id: string; checked: boolean }
  | { type: "delete"; id: string };

const OTHER = "Other";

function reduce(items: ShoppingItem[], action: Action): ShoppingItem[] {
  switch (action.type) {
    case "add":
      return [...items, action.item];
    case "toggle":
      return items.map((i) =>
        i.id === action.id ? { ...i, checked: action.checked } : i,
      );
    case "delete":
      return items.filter((i) => i.id !== action.id);
  }
}

// Sort key for a category heading: the dropdown categories come first, in the
// order they are defined; any legacy free-text categories follow; "Other"
// (uncategorised) always sits last.
function categoryRank(name: string): number {
  const defined = (SHOPPING_CATEGORIES as readonly string[]).indexOf(name);
  if (defined !== -1) return defined;
  if (name === OTHER) return Number.MAX_SAFE_INTEGER;
  return SHOPPING_CATEGORIES.length;
}

function groupByCategory(items: ShoppingItem[]) {
  const groups = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.category?.trim() || OTHER;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const rank = categoryRank(a) - categoryRank(b);
    return rank !== 0 ? rank : a.localeCompare(b);
  });
}

export function ShoppingList({ initialItems }: { initialItems: ShoppingItem[] }) {
  const [optimistic, dispatch] = useOptimistic(initialItems, reduce);
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
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
    const cat = category.trim() || null;
    const temp: ShoppingItem = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      name: trimmed,
      category: cat,
      url: null,
      checked: false,
      addedById: null,
      createdAt: new Date(),
    };
    setName("");
    setCategory("");
    run({ type: "add", item: temp }, () =>
      addShoppingItem({ name: trimmed, category: cat }),
    );
  }

  const groups = groupByCategory(optimistic);

  return (
    <div>
      {/*
        Mobile-first, overflow-safe layout: the name takes its own full-width
        row, then the category dropdown (flex-1, min-w-0 so it can shrink) sits
        beside the Add button. This keeps the whole form within the viewport on
        narrow phones, so the Add button — and the fixed bottom nav — stay
        reachable without any sideways scrolling.
      */}
      <form onSubmit={onAdd} className="mb-4 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an item…"
          className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Item name"
        />
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
            aria-label="Category (optional)"
          >
            <option value="">Category (optional)</option>
            {SHOPPING_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="flex shrink-0 items-center justify-center rounded-lg bg-foreground px-4 py-2 text-background"
            aria-label="Add item"
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </div>
      </form>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {groups.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-500">
          Nothing on the list yet.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([cat, items]) => (
            <section key={cat}>
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {cat}
              </h2>
              <ul className="divide-y divide-black/5 dark:divide-white/10">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) =>
                        run({ type: "toggle", id: item.id, checked: e.target.checked }, () =>
                          setShoppingItemChecked(item.id, e.target.checked),
                        )
                      }
                      className="size-5 shrink-0 accent-current"
                      aria-label={`Mark ${item.name} as bought`}
                    />
                    <span
                      className={`flex-1 text-base ${
                        item.checked ? "text-zinc-400 line-through" : ""
                      }`}
                    >
                      {item.name}
                    </span>
                    <button
                      onClick={() =>
                        run({ type: "delete", id: item.id }, () =>
                          deleteShoppingItem(item.id),
                        )
                      }
                      className="text-zinc-400 hover:text-red-500"
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
