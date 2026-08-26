"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import { getCurrentUserId } from "@/lib/household";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, themeFor } from "@/lib/theme";

/**
 * Turn dark mode on or off for the signed-in member. Returns whether it was
 * saved, so the toggle can revert itself if the member has no household row.
 *
 * Writes the preference twice on purpose. The `users` row is the source of
 * truth and follows the member to any device; the cookie is this device's
 * mirror of it, and is what the root layout's inline script reads to get the
 * first frame's colour right. The layout cannot read the row itself — awaiting
 * anything there makes every route in the app dynamic, which is exactly what
 * moving the shell into the `(app)` group was for.
 */
export async function setDarkMode(enabled: boolean): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  await getDb()
    .update(users)
    .set({ darkMode: enabled })
    .where(eq(users.id, userId));

  await writeThemeCookie(enabled);
  // /settings renders the toggle's initial state from the row, so it still
  // needs busting; the root layout no longer reads the preference at all.
  revalidatePath("/settings");
  return true;
}

/**
 * Mirrors the saved preference into this device's cookie.
 *
 * Not httpOnly: the root layout's inline script reads it from `document.cookie`
 * before first paint, which is the only reason it exists.
 */
async function writeThemeCookie(enabled: boolean): Promise<void> {
  const jar = await cookies();
  jar.set(THEME_COOKIE, themeFor(enabled), {
    maxAge: THEME_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
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
