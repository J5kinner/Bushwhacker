"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import type { ShoppingItem } from "@/db/schema";
import { extractLink, displayDomain } from "@/lib/links";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
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

// Sort key for a category heading: the household's categories come first, in
// their configured order; any legacy free-text categories follow; "Other"
// (uncategorised) always sits last.
function categoryRank(name: string, categories: string[]): number {
  const defined = categories.indexOf(name);
  if (defined !== -1) return defined;
  if (name === OTHER) return Number.MAX_SAFE_INTEGER;
  return categories.length;
}

function groupByCategory(items: ShoppingItem[], categories: string[]) {
  const groups = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.category?.trim() || OTHER;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const rank = categoryRank(a, categories) - categoryRank(b, categories);
    return rank !== 0 ? rank : a.localeCompare(b);
  });
}

export function ShoppingList({
  initialItems,
  categories,
}: {
  initialItems: ShoppingItem[];
  categories: string[];
}) {
  const [optimistic, dispatch] = useOptimistic(initialItems, reduce);
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keyboardInset = useKeyboardInset();

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
    const raw = name.trim();
    if (!raw) return;
    const cat = category.trim() || null;
    // Same rule as the server: split any pasted product URL out of the text so
    // the optimistic row shows the clean name + chip straight away.
    const { name: cleanName, url } = extractLink(raw);
    if (!cleanName) return;
    const temp: ShoppingItem = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      name: cleanName,
      category: cat,
      url,
      checked: false,
      addedById: null,
      createdAt: new Date(),
    };
    setName("");
    setCategory("");
    run({ type: "add", item: temp }, () =>
      addShoppingItem({ name: raw, category: cat }),
    );
  }

  const groups = groupByCategory(optimistic, categories);

  return (
    <div>
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
                      className={`min-w-0 flex-1 truncate text-base ${
                        item.checked ? "text-zinc-400 line-through" : ""
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open link for ${item.name}`}
                        className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 rounded-full border border-black/10 px-2 py-0.5 text-xs text-zinc-600 hover:border-black/30 dark:border-white/15 dark:text-zinc-300 dark:hover:border-white/40"
                      >
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate">
                          {displayDomain(item.url)}
                        </span>
                      </a>
                    )}
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

      {/* Spacer so the last item can scroll clear of the fixed add bar. */}
      <div aria-hidden className="h-24" />

      {/*
        The add-item bar is pinned to the bottom of the screen, just above the
        bottom nav, so adding items is always within thumb reach. While typing
        it lifts to sit above the on-screen keyboard (keyboardInset); when the
        keyboard is closed it rests above the nav (nav height + safe area).

        Mobile-first, overflow-safe form: the name takes its own full-width row,
        then the category dropdown (flex-1, min-w-0 so it can shrink) sits beside
        the Add button, keeping everything within a narrow viewport.
      */}
      <div
        className="fixed inset-x-0 z-30 mx-auto w-full max-w-md border-t border-black/10 bg-background/95 px-4 py-3 backdrop-blur dark:border-white/10"
        style={{
          bottom:
            keyboardInset > 0
              ? keyboardInset
              : "calc(4rem + env(safe-area-inset-bottom))",
        }}
      >
        {error && (
          <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <form onSubmit={onAdd} className="space-y-2">
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
              {categories.map((c) => (
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
      </div>
    </div>
  );
}
