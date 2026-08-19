import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Web Push plumbing for the shared calendar (PR 8; ADR 0009): reminders and
 * partner-activity notifications both go through `sendPushToUsers` below.
 *
 * Configured from env at module load; a deployment (or local dev) missing
 * any of the three VAPID vars runs with push silently disabled rather than
 * throwing on every mutation — the same "degrade, don't error" posture as
 * `getHouseholdId`'s missing-DB case (lib/household.ts).
 */
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT;

const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY && SUBJECT);
if (configured) {
  webpush.setVapidDetails(SUBJECT as string, PUBLIC_KEY as string, PRIVATE_KEY as string);
}

/**
 * Whether all three VAPID env vars are set. The reminder sender
 * (app/api/reminders/run) MUST check this before writing anything to
 * `reminder_log` — see that route's own comment on why: inserting the
 * idempotency row first and then silently no-op'ing the send here would mark
 * a reminder "sent" forever the moment it's merely unconfigured, which is
 * exactly the state of the world for the whole first hour (or however long)
 * between merging this PR and setting the env vars in Vercel.
 */
export function isPushConfigured(): boolean {
  return configured;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link the service worker's `notificationclick` handler opens/focuses. */
  url: string;
}

/**
 * Sends `payload` to every push subscription belonging to `userIds`.
 *
 * Best-effort and NEVER throws to its caller — mirrors `recordActivity`
 * (app/calendar/actions.ts): whether a push actually lands is a nice-to-have
 * alongside a mutation (or the reminder sender's own write) that has already
 * committed, never something worth failing that over.
 *
 * A 404/410 response from the push service means the subscription itself is
 * gone — iOS revokes a subscription silently (no client-side event fires to
 * react to), so the only way to notice is a failed send. That row is deleted
 * so it stops being retried on every future push (design decision 8 of the
 * shared-calendar plan; the client re-subscribes on next app open via
 * components/push-resubscribe.tsx).
 *
 * A no-op when the VAPID env vars aren't configured (see `configured`
 * above) — a preview or local dev without them must not throw on every
 * calendar mutation.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!configured || userIds.length === 0) return;

  try {
    const subscriptions = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify(payload),
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number } | null)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await getDb()
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, sub.id))
              .catch(() => {});
          }
          // Any other failure (a network blip, a transient 5xx from the push
          // service) is swallowed — best-effort, see the doc comment above.
        }
      }),
    );
  } catch {
    // Best-effort — covers the subscriptions SELECT itself failing.
  }
}
