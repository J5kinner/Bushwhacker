# 0006. Calendar event time model

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The calendar tab is being brought to TimeTree-premium parity in a series of small PRs (see the
plan at `docs/superpowers/plans/2026-08-18-shared-calendar-timetree-parity.md`).
The first of those, PR 1a, extends `calendar_events` from date-only rows to a model that also
carries a time of day, a location, a URL, a colour label, and an attendee set.
Existing rows must stay valid without a backfill, because the migration is purely additive.

Two designs were on the table for "is this an all-day event or a timed one".

- A `start_time`/`end_time` pair that is nullable, with null meaning all-day.
- The same pair plus a separate `is_all_day` boolean.

The boolean adds a second place the answer could live, and the two can disagree — an all-day
event with a stray `start_time`, or a timed event with the flag left off.
Every existing row already has no time information at all, so "no start time" already means the
correct thing for them today; a boolean would need a value backfilled for it to mean anything.

A related question is what a timed event's end time is relative to, when the event has no
`end_date`.
A trip has `start_date` and `end_date`; a same-day meeting only has `start_date`, so its
`end_time` has nothing else to anchor it to.

The household runs on one device timezone (two people, one house), so there was also a choice
about whether to store a timezone per event now, versus deferring it.

## Decision

**Dates stay canonical; times are optional, nullable wall-clock columns — no `is_all_day` boolean.**
A null `start_time` means the event is all-day.
This is enforced by construction (there is nothing else to disagree with), not by application
logic keeping two fields in sync, and it means every existing row is already a valid all-day event
with no data migration needed.

**Cross-midnight rule: `end_time` belongs to `end_date ?? start_date`.**
A same-day timed event (no `end_date`) is invalid if `end_time <= start_time` — that combination
cannot describe a real interval on a single day.
A multi-day event's `end_time` describes the end of its own day, so no such ordering constraint
applies between it and `start_time`.
This is validated in the server actions, not the database, because it is a cross-column rule.

**No `timezone` column on events yet.**
The household has one timezone; storing one per event today would be an unused column with
nothing to disagree about it either.
`households.timezone` is scoped to the reminders PR, where a real need appears: the reminder
sender runs in UTC and must convert a wall-clock time into an instant to know when to fire, which
a single-timezone assumption cannot do safely across a DST change.
Until then, every event renders in device-local time, which is exact for a household that never
changes timezone mid-event.

**`date-fns` is adopted now, in this PR, even though it is barely used here.**
It formats the new time-of-day display (`h:mm a`).
Landing the dependency here — rather than in whichever later PR first needs date arithmetic for
the month grid or recurrence — means those PRs, which build in parallel per the plan, never race
to add the same line to `package.json`.

## Consequences

- All-day events (every row that exists before this PR, and any created without a time) never
  shift across a timezone change, because they carry no time-of-day at all to shift.
- Existing rows are valid with no backfill: `start_time` defaults to null, which is exactly what
  "this row predates times" should mean.
- A household member travelling across timezones sees events rendered in their device's local
  time, which is correct for a same-timezone household but will need the pending
  `households.timezone` column once wall-clock instants must be computed (reminders).
- The cross-midnight rule lives in `app/calendar/actions.ts`, not a database constraint, so it can
  evolve without a migration — but it also means a direct SQL write could violate it; that risk is
  accepted at two-person scale.
- If HomeSync ever needs true multi-timezone events (unlikely for a household), the schema
  will need a timezone column per event, not just per household, and the cross-midnight rule
  will need to move from wall-clock comparison to instant comparison.
