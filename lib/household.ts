import { cache } from "react";
import { sql } from "drizzle-orm";
import type { Session } from "next-auth";
import { getDb, isDbConfigured } from "@/db";
import { households, users } from "@/db/schema";
import { auth } from "@/auth";

// The household id never changes once seeded, so remember it for the lifetime
// of the server instance. Never caches null — an unseeded DB keeps retrying.
let knownHouseholdId: string | null = null;

/**
 * The current household. HomeSync has exactly one, so we resolve the first (and
 * only) household row. Returns null when the DB is unconfigured or unseeded, so
 * read paths can degrade to an empty state instead of throwing — and so write
 * actions can fail closed by returning early rather than throwing a 500 at the
 * user. Either way the page's SetupNotice explains what is missing.
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

// A member's id never changes once seeded either, and the membership check now
// runs on every page render, so remember the ids we resolve for the lifetime of
// the server instance (two entries, this being a two-person household). Never
// caches a miss — an unseeded DB keeps retrying.
const knownUserIds = new Map<string, string>();

/**
 * The signed-in user, mapped from the session email to a `users` row.
 * Email comparison is case-insensitive (Gmail normalises case).
 *
 * Null means "signed in, but no matching household member" — the account passed
 * the ALLOWED_EMAILS allowlist yet nobody seeded a row for it. Callers that need
 * an owner (chores) return early on null instead of throwing.
 *
 * Accepts an already-resolved session for callers that have already called
 * `auth()` themselves, so the session isn't fetched twice in one request.
 */
export async function getCurrentUserId(
  session?: Session | null,
): Promise<string | null> {
  const resolvedSession = session !== undefined ? session : await auth();
  const email = resolvedSession?.user?.email?.toLowerCase();
  if (!email) return null;
  const known = knownUserIds.get(email);
  if (known) return known;
  if (!isDbConfigured()) return null;
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (u?.id) knownUserIds.set(email, u.id);
  return u?.id ?? null;
}

/**
 * The ways a deployment can be half-configured, in the order they must be fixed.
 * Each has a different cause and a different fix, so they are reported
 * separately — see SetupNotice for the wording shown on screen.
 */
export type SetupIssue = "no-database" | "no-household" | "not-a-member";

/**
 * Which setup step is missing, or null when the deployment is ready. Feature
 * pages call this and render a SetupNotice, so a preview deployment with an
 * unseeded database explains itself instead of quietly saving nothing.
 */
export async function getSetupIssue(): Promise<SetupIssue | null> {
  if (!isDbConfigured()) return "no-database";
  if (!(await getHouseholdId())) return "no-household";
  if (!(await getCurrentUserId())) return "not-a-member";
  return null;
}
