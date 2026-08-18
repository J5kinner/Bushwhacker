"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUserId } from "@/lib/household";

/**
 * Turn dark mode on or off for the signed-in member. Returns whether it was
 * saved, so the toggle can revert itself if the member has no household row.
 *
 * Revalidates the root layout (not just /settings) because the `.dark` class
 * lives on the <html> element that layout renders, not on the settings page.
 */
export async function setDarkMode(enabled: boolean): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  await getDb()
    .update(users)
    .set({ darkMode: enabled })
    .where(eq(users.id, userId));

  revalidatePath("/", "layout");
  return true;
}
