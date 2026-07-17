import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/db";
import { households, users } from "@/db/schema";

/**
 * The current household. HomeSync has exactly one, so until auth lands we resolve
 * the first (and only) household row. Returns null when the DB is unconfigured or
 * unseeded, so read paths can degrade to an empty state instead of throwing.
 */
export async function getHouseholdId(): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const [h] = await getDb()
    .select({ id: households.id })
    .from(households)
    .limit(1);
  return h?.id ?? null;
}

/** Like getHouseholdId, but throws a friendly error — use in write actions. */
export async function requireHouseholdId(): Promise<string> {
  const id = await getHouseholdId();
  if (!id) {
    throw new Error(
      "No household is configured yet. Connect the database and seed a household (see Settings).",
    );
  }
  return id;
}

/**
 * The acting user. Until auth lands we resolve the first member of the household.
 * Once auth exists this becomes "the signed-in user".
 */
export async function getCurrentUserId(): Promise<string | null> {
  const householdId = await getHouseholdId();
  if (!householdId) return null;
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.householdId, householdId))
    .limit(1);
  return u?.id ?? null;
}

export async function requireCurrentUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) {
    throw new Error(
      "No household member found. Seed at least one user (see Settings).",
    );
  }
  return id;
}
