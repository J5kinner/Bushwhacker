import { eq, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/db";
import { users, userLocations } from "@/db/schema";
import { parseOwnTracksLocation } from "@/lib/owntracks";

/**
 * Location ingest for OwnTracks (owntracks.org), the free app that holds the
 * native background-location permission no web page can obtain.
 *
 * A Route Handler rather than a Server Action because the caller is a
 * third-party app. Authenticated with HTTP Basic, which OwnTracks supports
 * natively — the token travels in a header rather than a URL, where Vercel's
 * request logs would capture it.
 *
 * OwnTracks expects a JSON array of commands in reply and retries against
 * anything else, so almost every outcome is `200 []`:
 *
 * - wrong `_type`, or an unusable payload → accepted and ignored
 * - sharing turned off                    → accepted and DISCARDED, never 403,
 *   because a rejection would make the app retry and alarm its user. This is
 *   what makes the toggle authoritative while the sender stays dumb.
 * - an older fix than the stored one      → accepted and ignored, so a
 *   late-arriving publish cannot drag the pin backwards
 *
 * Bad credentials are the one real failure and answer 401, so a mistyped token
 * is diagnosable instead of silently dropping fixes forever.
 */

/**
 * OwnTracks reads commands from the response body; an empty array means "none".
 *
 * Built fresh on every call, deliberately. A Response body is a single-use
 * stream, so one shared module-scope instance serves an empty body from the
 * second request onwards — which is precisely the malformed reply this endpoint
 * exists to avoid, and would provoke the retry storm the docstring above warns
 * about.
 */
function ack() {
  return Response.json([]);
}

/** The password from an HTTP Basic header, or null when absent or malformed. */
function basicAuthPassword(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    // The username is ignored: the token is unique, so it identifies the member
    // on its own. An empty password is not a token.
    if (separator === -1) return null;
    return decoded.slice(separator + 1) || null;
  } catch {
    // Not valid base64.
    return null;
  }
}

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return Response.json({ error: "No database configured." }, { status: 503 });
  }

  const token = basicAuthPassword(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  const [member] = await getDb()
    .select({
      id: users.id,
      householdId: users.householdId,
      sharing: users.locationSharing,
    })
    .from(users)
    .where(eq(users.locationToken, token))
    .limit(1);

  if (!member) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  // Authenticated but not sharing: acknowledge and drop.
  if (!member.sharing) return ack();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ack();
  }

  const fix = parseOwnTracksLocation(body);
  if (!fix) return ack();

  await getDb()
    .insert(userLocations)
    .values({
      userId: member.id,
      householdId: member.householdId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyM: fix.accuracyM,
      batteryPct: fix.batteryPct,
      capturedAt: fix.capturedAt,
    })
    .onConflictDoUpdate({
      target: userLocations.userId,
      set: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM,
        batteryPct: fix.batteryPct,
        capturedAt: fix.capturedAt,
        updatedAt: new Date(),
      },
      // Monotonic in device time: publishes can arrive out of order, and an old
      // fix must not overwrite a newer one.
      setWhere: sql`${userLocations.capturedAt} < ${fix.capturedAt}`,
    });

  return ack();
}
