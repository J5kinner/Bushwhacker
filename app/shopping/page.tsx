import { isDbConfigured } from "@/db";
import { getShoppingItems } from "@/lib/queries";
import { DbNotice } from "@/components/db-notice";
import { ShoppingList } from "./shopping-list";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const items = await getShoppingItems();

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Shopping</h1>
      {!isDbConfigured() && <DbNotice />}
      <ShoppingList initialItems={items} />
    </div>
  );
}
