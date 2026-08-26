import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, eventExdates } from "@/db/schema";
import { getHouseholdId } from "@/lib/household";
import { buildCalendarFeed } from "@/lib/ics";
import { measure, serverTimingHeader, type Timing } from "@/lib/timing";

/**
 * Outbound ICS subscription feed (shared-calendar plan, PR 10): a native
 * phone calendar app subscribes to this URL and polls it periodically,
 * read-only. proxy.ts's matcher excludes `/api` entirely
 * (`matcher: ["/((?!api|_next|signin|.*\\.).*)"]`), so no Auth.js session
 * ever reaches this route — the `?token=` query param below IS this route's
 * whole authentication, not a supplement to one.
 */
/**
 * SHA-256 digest of a string. Hashing both sides before comparing means a
 * length mismatch between the raw provided/expected tokens can never
 * short-circuit the comparison before it reaches `timingSafeEqual` — the
 * digest is always the same fixed length regardless of the input's length.
 */
function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(hash(provided), hash(expected));
}

/**
 * GET /api/calendar.ics?token=...
 *
 * A missing `CALENDAR_FEED_TOKEN` env var, a missing `?token=`, or a wrong
 * one all answer 404 rather than 401 — a 401 confirms to an unauthenticated
 * prober that a calendar feed lives at this URL and is merely locked, which
 * is itself information worth not giving away; 404 makes this path
 * indistinguishable from any other path that doesn't exist.
 */
export async function GET(request: Request) {
  const expected = process.env.CALENDAR_FEED_TOKEN;
  const provided = new URL(request.url).searchParams.get("token");
  if (!expected || !provided || !tokenMatches(provided, expected)) {
    return new Response("Not found.", { status: 404 });
  }

  const householdId = await getHouseholdId();
  // No seeded household is a setup gap, not an auth failure (the token was
  // valid) — degrade to an empty-but-valid feed rather than erroring, the
  // same way the app's own cached reads degrade to an empty array
  // (lib/household.ts's getHouseholdId docstring).
  if (!householdId) {
    return icsResponse(buildCalendarFeed([], []));
  }

  // Direct reads, no unstable_cache: a subscribing calendar app polls
  // infrequently (hourly at best), so there is no page-navigation hit rate
  // here worth protecting, and sharing the page's cache tag would tie this
  // route's freshness to an unrelated surface's revalidation timing. The
  // whole household is read — not a window — because a subscribed native
  // calendar wants history too, and a recurring master is one row with an
  // RRULE no matter how long it has been running, so there is nothing here
  // that grows the way an expanded occurrence list would.
  const db = getDb();
  const { result, timing } = await measure("feed-read", () =>
    Promise.all([
      db.select().from(calendarEvents).where(eq(calendarEvents.householdId, householdId)),
      // event_exdates carries no household_id of its own, so the join back to
      // calendar_events is the household scope.
      db
        .select({ eventId: eventExdates.eventId, date: eventExdates.date })
        .from(eventExdates)
        .innerJoin(calendarEvents, eq(eventExdates.eventId, calendarEvents.id))
        .where(eq(calendarEvents.householdId, householdId)),
    ]),
  );
  const [events, exdates] = result;

  const { result: ics, timing: buildTiming } = await measure("feed-build", async () =>
    buildCalendarFeed(events, exdates),
  );

  return icsResponse(ics, [timing, buildTiming]);
}

/**
 * Timings are attached on the success path only: a Server-Timing header on the
 * 404 above would confirm something real sits behind the URL, undoing the
 * indistinguishability that response is chosen for.
 */
function icsResponse(ics: string, timings: Timing[] = []): Response {
  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="homesync.ics"',
      "Cache-Control": "private, max-age=300",
      ...(timings.length ? { "Server-Timing": serverTimingHeader(timings) } : {}),
    },
  });
}
