"use server";

import { and, eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getDb } from "@/db";
import { recipes, shoppingItems } from "@/db/schema";
import { getHouseholdId } from "@/lib/household";
import { CACHE_TAGS } from "@/lib/queries";
import { fetchRecipe, RecipeImportError } from "@/lib/recipe-import";

// No seeded household means nowhere to store the recipe or its ingredients, so
// these writes fail closed rather than throwing a 500 at the user — the
// SetupNotice on the page says which step is missing.

/** Insert one shopping item per ingredient, uncategorised (grouped as "Other"). */
async function addIngredientsToList(householdId: string, ingredients: string[]) {
  if (ingredients.length === 0) return;
  await getDb()
    .insert(shoppingItems)
    .values(ingredients.map((name) => ({ householdId, name })));
  updateTag(CACHE_TAGS.shoppingItems);
}

/**
 * Import a recipe from a pasted recipetineats.com link: save (or refresh) the
 * recipe and put its ingredients straight onto the shopping list.
 *
 * Expected failures (wrong site, no recipe on the page…) come back as
 * `{ error }` rather than being thrown, because Next.js masks thrown error
 * messages from Server Actions in production.
 */
export async function importRecipe(
  url: string,
): Promise<{ error: string } | { title: string; ingredientCount: number }> {
  const householdId = await getHouseholdId();
  if (!householdId) {
    // This action already has a channel for expected failures, so say it inline
    // as well as in the page notice.
    return {
      error:
        "This deployment has no household set up yet, so nothing can be saved.",
    };
  }

  let recipe;
  try {
    recipe = await fetchRecipe(url);
  } catch (e) {
    if (e instanceof RecipeImportError) return { error: e.message };
    throw e;
  }

  await getDb()
    .insert(recipes)
    .values({
      householdId,
      title: recipe.title,
      url: recipe.url,
      ingredients: recipe.ingredients,
    })
    .onConflictDoUpdate({
      target: [recipes.householdId, recipes.url],
      set: { title: recipe.title, ingredients: recipe.ingredients },
    });

  await addIngredientsToList(householdId, recipe.ingredients);
  updateTag(CACHE_TAGS.recipes);
  return { title: recipe.title, ingredientCount: recipe.ingredients.length };
}

/** Put a saved recipe's ingredients onto the shopping list again. */
export async function addRecipeToList(id: string) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const [recipe] = await getDb()
    .select({ ingredients: recipes.ingredients })
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!recipe) return;
  await addIngredientsToList(householdId, recipe.ingredients);
}

export async function deleteRecipe(id: string) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  await getDb()
    .delete(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)));
  updateTag(CACHE_TAGS.recipes);
}
