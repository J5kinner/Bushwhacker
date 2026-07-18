"use server";

import { and, eq, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { shoppingItems, shoppingCategories } from "@/db/schema";
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

/**
 * Add a shopping category for the household. No-ops on blank input or a
 * case-insensitive duplicate; new categories sort last (highest position).
 */
export async function addShoppingCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const householdId = await requireHouseholdId();
  const db = getDb();

  const [dupe] = await db
    .select({ id: shoppingCategories.id })
    .from(shoppingCategories)
    .where(
      and(
        eq(shoppingCategories.householdId, householdId),
        sql`lower(${shoppingCategories.name}) = ${trimmed.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (dupe) return;

  const [agg] = await db
    .select({ max: max(shoppingCategories.position) })
    .from(shoppingCategories)
    .where(eq(shoppingCategories.householdId, householdId));

  await db
    .insert(shoppingCategories)
    .values({ householdId, name: trimmed, position: (agg?.max ?? -1) + 1 })
    .onConflictDoNothing();
  revalidatePath("/settings");
  revalidatePath("/shopping");
}

/**
 * Remove a household category. Items already labelled with it are moved to
 * "Other" (their `category` is nulled) before the category row is deleted.
 */
export async function removeShoppingCategory(id: string) {
  const householdId = await requireHouseholdId();
  const db = getDb();

  const [category] = await db
    .select({ name: shoppingCategories.name })
    .from(shoppingCategories)
    .where(
      and(
        eq(shoppingCategories.id, id),
        eq(shoppingCategories.householdId, householdId),
      ),
    )
    .limit(1);
  if (!category) return;

  await db
    .update(shoppingItems)
    .set({ category: null })
    .where(
      and(
        eq(shoppingItems.householdId, householdId),
        eq(shoppingItems.category, category.name),
      ),
    );
  await db
    .delete(shoppingCategories)
    .where(
      and(
        eq(shoppingCategories.id, id),
        eq(shoppingCategories.householdId, householdId),
      ),
    );
  revalidatePath("/settings");
  revalidatePath("/shopping");
}
