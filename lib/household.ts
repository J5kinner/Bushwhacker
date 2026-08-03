import { cache } from "react";
import { sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/db";
import { households, users } from "@/db/schema";
import { auth } from "@/auth";

// The household id never changes once seeded, so remember it for the lifetime
// of the server instance. Never caches null — an unseeded DB keeps retrying.
let knownHouseholdId: string | null = null;

/**
 * The current household. HomeSync has exactly one, so we resolve the first (and
 * only) household row. Returns null when the DB is unconfigured or unseeded, so
 * read paths can degrade to an empty state instead of throwing.
 *
 * Wrapped in React cache() so concurrent queries in one request share a single
 * lookup instead of each paying their own Neon round trip.
 */
export const getHouseholdId = cache(async (): Promise<string | null> => {
  if (knownHouseholdId) return knownHouseholdId;
  if (!isDbConfigured()) return null;
  const [h] = await getDb()
    .select({ id: households.id })
    .from(households)
    .limit(1);
  if (h?.id) knownHouseholdId = h.id;
  return h?.id ?? null;
});

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
 * The signed-in user, mapped from the session email to a `users` row.
 * Email comparison is case-insensitive (Gmail normalises case).
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !isDbConfigured()) return null;
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return u?.id ?? null;
}

export async function requireCurrentUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) {
    throw new Error(
      "Signed-in account is not a household member. Check ALLOWED_EMAILS and the seeded users.",
    );
  }
  return id;
}
