import { isDbConfigured } from "@/db";
import { getRecipes } from "@/lib/queries";
import { DbNotice } from "@/components/db-notice";
import { RecipesList } from "./recipes-list";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const recipes = await getRecipes();

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Recipes</h1>
      {!isDbConfigured() && <DbNotice />}
      <RecipesList initialRecipes={recipes} />
    </div>
  );
}
