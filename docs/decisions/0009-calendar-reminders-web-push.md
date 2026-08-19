# 0009. Calendar reminders and web push

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The shared-calendar TimeTree-parity plan
(`docs/superpowers/plans/2026-08-18-shared-calendar-timetree-parity.md`) calls for a per-event
reminder offset, plus web push for both reminders and partner-activity notifications ("Sam added
'Dentist'").
This is PR 8 of the plan (M5).

Four structural questions had to be settled before writing any of it.

The first is how a reminder offset in minutes becomes an actual moment to fire at.
`calendar_events` has no timezone of its own (ADR 0006 deferred it), and the reminder sender runs
on Vercel's own clock, which is UTC.
A wall-clock reminder time ("9:00 am") cannot become a UTC instant without knowing which IANA zone
that wall-clock time is in, and a household's own UTC offset is not fixed year-round — it changes
at the October daylight-saving transition.

The second is how the sender avoids sending the same reminder twice, given that it is invoked by
an external pinger every five minutes rather than a single durable scheduler, and given that the
plan wants a catch-up window so a missed tick does not silently skip a reminder forever.

The third is how the sender gets invoked at all.
The deployment is on Vercel Hobby, which does not support the sub-daily schedule reminders need.

The fourth is how a push subscription survives the realities of iOS Safari, which is stricter and
less observable than desktop browsers about push permissions and notification behaviour.

## Decision

**`households.timezone` is a new, required IANA-zone column, defaulting to `Australia/Sydney`.**
The reminder sender reads it once per run and passes it into `lib/reminder-instants.ts`'s
`reminderInstant`, which resolves a wall-clock anchor to a UTC instant with `date-fns-tz`'s
`fromZonedTime` — never a fixed numeric offset, which would be silently wrong by an hour either
side of the DST transition.
The anchor itself is the event's own `startTime` for a timed event, or local midnight for an
all-day one; `reminderMinutes` is subtracted from that anchor, so a negative value (the all-day
"morning of"/"day before" presets) fires *after* the anchor rather than before it.

**`reminder_log` is the idempotency arbiter, keyed per occurrence.**
The sender INSERTs a `(event_id, occurrence_date)` row FIRST, with `onConflictDoNothing`, and only
sends a push when that insert actually lands a new row.
Two overlapping or retried five-minute ticks racing the same due occurrence both attempt the
identical insert, so only one of them ever sends — the same "insert first, act only if it landed"
pattern `deleteOccurrence` already uses for `event_exdates` (app/calendar/actions.ts).
Keying per occurrence, not per event, is what makes a recurring event remind on every occurrence
rather than once ever.
`dueReminders` (lib/reminder-instants.ts) computes which occurrences are due at all: an occurrence
qualifies when its reminder instant satisfies `instant <= now && instant >= now - 24h` — the lower
bound is the catch-up window, so a pinger outage does not silently skip a reminder, and the upper
bound stops a reminder from ever firing days late once the outage has gone on longer than that.

**The scheduler is an external pinger, not a Vercel cron.**
The deployment is Hobby, where a `crons` entry in `vercel.json` that fires more often than once a
day fails the *entire* deployment, and even a once-daily Hobby cron only fires with hour-level
imprecision — neither is workable for a five-minute reminder tick.
Instead, `app/api/reminders/run/route.ts` is a plain `GET` route, authenticated by
`Authorization: Bearer <CRON_SECRET>` compared with a hashed `timingSafeEqual` (the same pattern
`app/api/calendar.ics` already uses for its own token, right down to answering 404 rather than 401
on anything unauthenticated), invoked every five minutes by a free external service
(cron-job.org) against the production URL.
The route must never declare `runtime = "edge"`: `web-push` needs Node's crypto/https built-ins.
Preview verification is a manual `curl` with the header, because the pinger only ever targets
production.

**Four rules keep a push subscription alive on iOS, and the sender/client cooperate on all four.**
Every `push` handler in the service worker calls
`event.waitUntil(self.registration.showNotification(...))` unconditionally, even for a payload
that fails to parse — a push with no visible notification gets the subscription revoked by Safari
after roughly three in a row.
Subscribing only ever happens from an explicit tap inside the installed PWA (the Settings
"Enable notifications" button, `app/settings/notifications.tsx`) — never on page load, because iOS
revokes a permission grant obtained outside a user gesture.
Nothing relies on notification action buttons, because iOS ignores them.
And `sendPushToUsers` (lib/push.ts) deletes a `push_subscriptions` row the moment the push service
answers 404/410 for it — iOS expires a subscription silently, with no client-side event to react
to — while `components/push-resubscribe.tsx` re-subscribes just as silently on next app open when
permission is already granted but no live subscription exists.

**Reminders and partner-activity pushes both deliver to every household member, not just the
event's own attendee subset.**
A shared two-person calendar's notifications are a shared concern: `app/calendar/actions.ts`'s
`notifyPartner` sends to everyone except the actor after the same mutations that already write an
`activity` row (created/updated/deleted/commented), reusing that verb mapping for its message
text; `togglePinned` fires neither, for the same reason it already skips `recordActivity`.

## Consequences

- A household that ever needs more than one timezone (unlikely) will need a timezone column on
  events, not just on the household — the same limitation ADR 0006 already noted for wall-clock
  event rendering in general.
- `reminder_log` grows without bound, like `activity` before it (ADR 0008) — cheap at two-person,
  low-volume scale, and a retention policy is a fair future addition if that ever changes.
- The sender's own freshness depends entirely on the external pinger actually running every five
  minutes; the 24-hour catch-up window absorbs a missed tick or two, but a pinger that stops
  altogether stops reminders altogether, silently, with nothing in this PR to alert on it.
- The `-1440..1440` range the server actions and the DB CHECK both validate is deliberately equal
  to what `lib/reminder-instants.ts`'s `dueReminders` window (yesterday through tomorrow+1 in the
  household's own calendar day) can ever actually deliver, not a wider "plausible" range — a value
  outside it is rejected outright rather than accepted and silently never firing. If the reminder
  picker's own preset range ever needs to grow beyond a day either side of the anchor, the
  validated range and the expansion window must widen together, in the same change.
- Push is untestable under `pnpm dev` (the service worker only registers in production); the
  Vercel preview, with the VAPID/`CRON_SECRET` env vars set, is where PR 8 must actually be
  verified end-to-end.
