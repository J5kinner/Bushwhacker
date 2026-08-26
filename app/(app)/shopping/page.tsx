import { getShoppingItems, getShoppingCategories } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { ShoppingList } from "./shopping-list";

export default async function ShoppingPage() {
  const [items, categories, setupIssue] = await Promise.all([
    getShoppingItems(),
    getShoppingCategories(),
    getSetupIssue(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Shopping</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <ShoppingList
        initialItems={items}
        categories={categories.map((c) => c.name)}
      />
    </div>
  );
}
