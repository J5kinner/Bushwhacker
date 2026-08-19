# 0008. Calendar activity feed

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The shared-calendar TimeTree-parity plan
(`docs/superpowers/plans/2026-08-18-shared-calendar-timetree-parity.md`) calls for an activity
feed — who created, edited, deleted, or commented on which event, and when — plus a per-user
unread badge, and event comments as a per-event thread (deliberately "comments", not "chat";
push notifications, not typing indicators or read receipts, are what supplies the immediacy).
This is PR 7 of the plan (M4).

Two structural questions had to be settled before writing any of it.

The first is where the feed's data comes from.
`calendar_events` already carries `created_by_id` and, since PR 1a, an `updated_at` bumped by
Drizzle's `$onUpdate`.
That is not enough to build a feed from.
`updated_at` records *when* a row last changed, not *who* changed it or *what* changed — a
second edit overwrites the first edit's attribution with nothing left to show for it.
A hard delete is worse: the row required for a "so-and-so removed this event" entry is exactly
the row deletion removes, and an edited/deleted recurrence override behaves the same way for its
one occurrence.
A feed derived from the event table's own current state is therefore impossible for two of the
plan's four verbs (`updated`, `deleted`) the moment more than one edit or any deletion happens.

The second is how the unread badge can know what a specific person has and hasn't seen, given
that every calendar read in this codebase is `unstable_cache`'d per household (design decision 2
of the plan) and a household has exactly two members reading the same cache entry.

## Decision

**An append-only `activity` table is the feed's only source of truth.**
Every mutating calendar Server Action (`app/calendar/actions.ts`) writes one row here in addition
to its usual work: `addCalendarEvent` → `created`, `updateCalendarEvent` → `updated`,
`deleteCalendarEvent`/`deleteSeries` → `deleted`, `addComment` → `commented`.
`editOccurrence` and `deleteOccurrence` also write `updated` — an occurrence is not an
independent thing from the feed's point of view, it is one date of a series, so changing or
suppressing it reads as a change to the series, logged against the master's own id and title
rather than a synthetic per-occurrence identity.
`togglePinned` deliberately writes nothing: a pin/unpin is a personal triage flag flipped often
and in passing, and logging every toggle would swamp the feed with noise nobody asked to see
"who pinned this" for.

**`event_id` is a plain uuid with no foreign key, and `event_title` is a snapshot taken at write
time.**
A deleted event (or a cascade-deleted recurrence override) must not take its own history down
with it, which an `onDelete: "cascade"` FK would do, and `onDelete: "set null"` would erase which
event a row was ever about either way.
The snapshot exists for the identical reason: once the event is gone there is no row left to join
back to for a name, so the feed keeps its own copy, taken at the moment each row is written.
This is a deliberate, permanent trade-off, not a stopgap — a later edit to a still-live event's
title does not retroactively rename its past activity rows, the same way a real activity log
would not.

**The unread badge is computed outside the shared cache.**
`getActivity` (`lib/queries.ts`) is cached per household exactly like every other calendar read,
and both members share that one cache entry.
Baking either partner's `activity_seen_at` into it would leak one partner's read state into the
other's badge the moment the cache is warm.
Instead, `getCurrentUserActivitySeenAt` is a small, deliberately uncached, per-request `SELECT`
by the signed-in user's id, and `app/calendar/page.tsx` combines its result with the cached
activity rows to compute `unseenCount` itself, per request.
Marking the feed seen (`markActivitySeen`) stamps `activity_seen_at` to the max `created_at` of
the rows the client actually rendered when it opened the feed — never `now()` — so a row that
lands between the client's fetch and the tap that marks it seen stays unseen instead of being
silently swallowed by a timestamp that raced ahead of it.

**Activity writes are best-effort companions to the mutation they describe.**
Each write is wrapped so a transient failure (a Neon hiccup, say) cannot fail the whole Server
Action and hand the caller an error over a change that in fact succeeded.
The trade-off is a feed that can silently miss an entry on the rare write that itself fails,
which is strictly better than surfacing a false failure for a save that worked.

## Consequences

- The feed and the events it describes are now two independent tables with independent
  lifecycles by design — an event's own row can be edited any number of times or deleted outright
  without losing the history of who did what and when, at the cost of `activity` growing without
  bound (nothing in this PR prunes it; `getActivity` only ever reads its latest ~50 rows, so an
  unbounded table costs nothing at read time, but a retention policy is a fair future addition if
  the table's size ever becomes a concern).
- `event_title` can drift from the event's current title after a rename — this is intentional
  (see the Decision above) but is a real surprise worth remembering if the feed's copy is ever
  extended to link back to the live event.
- The uncached `activity_seen_at` lookup is one extra small query per calendar page render, on
  top of the household's shared cached reads — cheap at two-person scale, and the only way to
  keep one partner's read state from ever contaminating the other's.
- If a future feature needs to know *what* changed on an `updated` row (not just *that* it
  changed), this table has nowhere to put it — a diff or before/after snapshot would need its own
  column or table, added deliberately rather than overloading `event_title`.
