"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
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

/**
 * Saves (or refreshes) the signed-in member's Web Push subscription for this
 * device (PR 8; ADR 0009). Called from two places: the Settings "Enable
 * notifications" button (app/settings/notifications.tsx), always right after
 * an explicit tap subscribes; and the silent re-subscribe on app open
 * (components/push-resubscribe.tsx), for when iOS has expired the previous
 * subscription with no client-side event to notice by.
 *
 * Upserts by `endpoint` — the push service's own unique identity for a
 * device — rather than inserting unconditionally, so a fresh subscribe on a
 * device that already has a (possibly stale) row updates it in place instead
 * of accumulating duplicates.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  await getDb()
    .insert(pushSubscriptions)
    .values({ userId, endpoint: input.endpoint, keys: input.keys })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, keys: input.keys },
    });
}
