import { getRecipes } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { RecipesList } from "./recipes-list";

export default async function RecipesPage() {
  const [recipes, setupIssue] = await Promise.all([
    getRecipes(),
    getSetupIssue(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Recipes</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <RecipesList initialRecipes={recipes} />
    </div>
  );
}
