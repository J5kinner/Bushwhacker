"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { shoppingItems } from "@/db/schema";
import { requireHouseholdId } from "@/lib/household";
import { extractLink } from "@/lib/links";

export async function addShoppingItem(input: {
  name: string;
  category?: string | null;
}) {
  // `input.name` is the raw typed text; the server is the source of truth for
  // splitting out any pasted product URL.
  const { name, url } = extractLink(input.name);
  if (!name) return;
  const householdId = await requireHouseholdId();
  await getDb().insert(shoppingItems).values({
    householdId,
    name,
    url,
    category: input.category?.trim() || null,
  });
  revalidatePath("/shopping");
}

export async function setShoppingItemChecked(id: string, checked: boolean) {
  await requireHouseholdId();
  await getDb()
    .update(shoppingItems)
    .set({ checked })
    .where(eq(shoppingItems.id, id));
  revalidatePath("/shopping");
}

export async function deleteShoppingItem(id: string) {
  await requireHouseholdId();
  await getDb().delete(shoppingItems).where(eq(shoppingItems.id, id));
  revalidatePath("/shopping");
}
