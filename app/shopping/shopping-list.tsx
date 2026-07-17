"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ShoppingItem } from "@/db/schema";
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

function groupByCategory(items: ShoppingItem[]) {
  const groups = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.category?.trim() || OTHER;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === OTHER) return 1;
    if (b === OTHER) return -1;
    return a.localeCompare(b);
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
      <form onSubmit={onAdd} className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an item…"
          className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Item name"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          className="w-28 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Category (optional)"
        />
        <button
          type="submit"
          className="flex items-center justify-center rounded-lg bg-foreground px-3 text-background"
          aria-label="Add item"
        >
          <Plus className="size-5" aria-hidden />
        </button>
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
