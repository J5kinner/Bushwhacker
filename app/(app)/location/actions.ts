"use server";

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users, userLocations } from "@/db/schema";
import { getCurrentUserId, getHouseholdId } from "@/lib/household";

// Every action here needs a seeded household member, so each fails closed by
// returning early rather than throwing a 500 at the user — the SetupNotice on
// the page says which setup step is missing.

/**
 * Turn location sharing on or off for the signed-in member.
 *
 * Turning it off does not delete the last stored position: the pin simply stops
 * advancing and its age label keeps growing, which reads honestly as "this is
 * where they were when they stopped sharing".
 */
export async function setLocationSharing(sharing: boolean) {
  const userId = await getCurrentUserId();
  if (!userId) return;

  await getDb()
    .update(users)
    .set({ locationSharing: sharing })
    .where(eq(users.id, userId));

  revalidatePath("/location");
  revalidatePath("/settings");
}

/**
 * Issue a fresh OwnTracks token for the signed-in member, returning it so
 * Settings can display it. Regenerating invalidates the previous token, so the
 * phone must be updated before it can publish again.
 */
export async function regenerateLocationToken(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  // 32 hex characters from the CSPRNG. Long enough that the endpoint cannot be
  // guessed, short enough to retype off a screen if the copy button fails on an
  // older phone. Imported from node:crypto rather than the global, which is not
  // guaranteed on every Node version Next supports.
  const token = randomUUID().replaceAll("-", "");

  await getDb()
    .update(users)
    .set({ locationToken: token })
    .where(eq(users.id, userId));

  revalidatePath("/settings");
  return token;
}

/**
 * Store a fix the browser produced for the signed-in member.
 *
 * This is the fallback path that makes the feature work before OwnTracks is set
 * up, and keeps your own pin current while you are looking at the map. It runs
 * only in the foreground — a web page cannot read location in the background,
 * which is the whole reason OwnTracks exists in this design.
 *
 * Respects the same sharing gate as the ingest endpoint, and the same
 * monotonicity rule, so the two writers cannot fight.
 */
export async function recordMyLocation(input: {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}) {
  const userId = await getCurrentUserId();
  const householdId = await getHouseholdId();
  if (!userId || !householdId) return;

  const [member] = await getDb()
    .select({ sharing: users.locationSharing })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!member?.sharing) return;

  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return;
  }

  const accuracyM =
    input.accuracyM === null || !Number.isFinite(input.accuracyM)
      ? null
      : Math.min(32_767, Math.max(0, Math.round(input.accuracyM)));

  const capturedAt = new Date();

  await getDb()
    .insert(userLocations)
    .values({
      userId,
      householdId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM,
      // The browser does not report battery, so leave the last known value be
      // rather than overwriting it with null.
      capturedAt,
    })
    .onConflictDoUpdate({
      target: userLocations.userId,
      set: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM,
        capturedAt,
        updatedAt: new Date(),
      },
      setWhere: sql`${userLocations.capturedAt} < ${capturedAt}`,
    });

  revalidatePath("/location");
}
