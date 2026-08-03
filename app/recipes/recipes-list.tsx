"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Download, ExternalLink, ListPlus, Loader2, Trash2 } from "lucide-react";
import type { Recipe } from "@/db/schema";
import { displayDomain } from "@/lib/links";
import { importRecipe, addRecipeToList, deleteRecipe } from "./actions";

export function RecipesList({ initialRecipes }: { initialRecipes: Recipe[] }) {
  const [optimistic, dispatchDelete] = useOptimistic(
    initialRecipes,
    (recipes: Recipe[], id: string) => recipes.filter((r) => r.id !== id),
  );
  const [, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  // The id of the recipe currently being re-added, so its button can show progress.
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onImport(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || importing) return;
    setError(null);
    setNotice(null);
    setImporting(true);
    startTransition(async () => {
      try {
        const result = await importRecipe(trimmed);
        if ("error" in result) {
          setError(result.error);
        } else {
          setUrl("");
          setNotice(
            `Saved “${result.title}” and added its ${result.ingredientCount} ingredients to the shopping list.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setImporting(false);
      }
    });
  }

  function onAddToList(recipe: Recipe) {
    if (addingId) return;
    setError(null);
    setNotice(null);
    setAddingId(recipe.id);
    startTransition(async () => {
      try {
        await addRecipeToList(recipe.id);
        setNotice(
          `Added the ${recipe.ingredients.length} ingredients for “${recipe.title}” to the shopping list.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setAddingId(null);
      }
    });
  }

  function onDelete(recipe: Recipe) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      dispatchDelete(recipe.id);
      try {
        await deleteRecipe(recipe.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onImport} className="space-y-2">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a recipetineats.com link…"
          className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          aria-label="Recipe link"
        />
        <button
          type="submit"
          disabled={importing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-background disabled:opacity-60"
        >
          {importing ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Download className="size-5" aria-hidden />
          )}
          {importing ? "Importing…" : "Import recipe"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {optimistic.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-500">
          No saved recipes yet. Paste a link above to import one.
        </p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {optimistic.map((recipe) => (
            <li key={recipe.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base">{recipe.title}</p>
                <a
                  href={recipe.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                >
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                  {displayDomain(recipe.url)} · {recipe.ingredients.length}{" "}
                  ingredients
                </a>
              </div>
              <button
                onClick={() => onAddToList(recipe)}
                disabled={addingId !== null}
                className="flex shrink-0 items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-sm hover:border-black/30 disabled:opacity-60 dark:border-white/15 dark:hover:border-white/40"
                aria-label={`Add ${recipe.title} ingredients to the shopping list`}
              >
                {addingId === recipe.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ListPlus className="size-4" aria-hidden />
                )}
                Add to list
              </button>
              <button
                onClick={() => onDelete(recipe)}
                className="shrink-0 text-zinc-400 hover:text-red-500"
                aria-label={`Delete ${recipe.title}`}
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
