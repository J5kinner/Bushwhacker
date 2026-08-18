# 0007. Calendar recurrence model

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The shared-calendar TimeTree-parity plan
(`docs/superpowers/plans/2026-08-18-shared-calendar-timetree-parity.md`) calls for recurring
events — daily/weekly/monthly/yearly, an interval, a weekday set, and an inclusive end date —
plus editing or deleting either a single occurrence or the whole series.
This PR (3 of the plan) lands only the pure expansion library and its frozen `Occurrence`
contract; the schema columns that back it (`repeat_freq`, `repeat_interval`, `repeat_weekdays`,
`repeat_until`, `series_id`, `original_date`, and the `event_exdates` table) land in PR 4 (M2).
Every calendar view is built against `expandOccurrences`'s output from this PR onward, so
recurrence "lights up" for free once PR 4's columns exist.

Two structural questions had to be settled before writing any expansion code.

The first is how a single edited occurrence is represented.
A recurring event needs a way to say "this one Tuesday moved to Wednesday" or "this one Tuesday
was deleted" without disturbing the rest of the series.
The second is where and when expansion happens: whether the database (or a cached read) hands
back already-expanded rows, or whether the raw master rows are expanded on the way to the
screen.

## Decision

**Storage: one master row per series, RRULE-lite columns, relational exdates, and override rows
keyed by `series_id`/`original_date`.**
The master row carries `repeat_freq`, `repeat_interval` (default 1), `repeat_weekdays` (weekly
only), and an inclusive `repeat_until`.
Deleting a single occurrence inserts a row into `event_exdates` (`event_id`, `date`), not a flag
on the master — a relational table makes a concurrent "delete this occurrence" an
`INSERT … ON CONFLICT DO NOTHING` rather than a read-modify-write race on a JSON array.
Editing a single occurrence does both: it adds an exdate for the original date **and** inserts an
ordinary `calendar_events` row carrying `series_id` (pointing at the master) and `original_date`
(the date it replaces).
An override row is not a second kind of recurrence — it is a plain event at its own date, and the
expansion library treats it exactly like any other non-recurring row, distinguished only by
carrying `isOverride: true` on its `Occurrence` because `seriesId` and `originalDate` are set.

**Expansion: read-time, isomorphic, pure, with the window always a parameter.**
`lib/recurrence.ts` exports `expandOccurrences(events, exdates, windowStart, windowEnd)`.
It is plain TypeScript with no database access, so the same function runs in a server component
reading committed rows and in a client component's `useOptimistic` reducer reading in-flight
state — a series edit, an occurrence delete, or a still-saving new event all render through the
same code path as a committed row.
The window is always an explicit argument, never computed inside the function from `Date.now()`.
This matters because the read side of the calendar caches raw rows (events and exdates, not
expanded occurrences) in `unstable_cache`, keyed by `(householdId, windowStart, windowEnd)`
(design decision 2 of the plan).
If expansion ran inside that cached function, "today" would be baked into whichever cache entry
computed it first, and would only change on the next unrelated mutation that busts the tag —
keeping expansion outside the cache, as a pure function the caller applies to the cached rows,
avoids that entirely.

**Monthly skips a short month rather than clamping into it; yearly skips a non-leap year rather
than clamping to 28 Feb.**
A monthly event on the 31st does not become the 30th (or the 28th) in a shorter month — that
month is skipped, and the series resumes on the next month that has a 31st.
The same rule falls out of itself for 29 February: a yearly event on 29 Feb only fires in leap
years, with no separate leap-year branch, because "does this month have this day-of-month" is
the same question either way once the year-stepper holds the month fixed and only moves the
year.
`date-fns`'s own `addMonths`/`addYears` clamp instead (Jan 31 + 1 month lands on Feb 28), so the
day-of-month is placed by hand once `getDaysInMonth` on the stepped-to month confirms it is long
enough, rather than trusting the library's month arithmetic to place the day itself.

**No RRULE library.**
The plan's recurrence surface is small and fixed — four frequencies, an interval, a weekday set,
an inclusive until — set entirely through HomeSync's own edit sheet, never parsed from someone
else's calendar export.
A full RRULE implementation (`BYSETPOS`, `COUNT`, multiple `BYDAY`/`BYMONTHDAY` combinations,
`WKST`, exotic frequency combinations) buys correctness for rules this app never generates and
never needs to parse, at the cost of a dependency whose edge cases HomeSync would otherwise
never touch.
`date-fns`, already a dependency since PR 1a, is enough for the day/week/month/year arithmetic
this model actually needs.

## Consequences

- The frozen contract — `RecurrenceFields`, `ExpandableEvent`, `Occurrence`,
  `expandOccurrences`, `occursOnDay` — is what PRs 2a/2b/4/5 build their views against.
  Every view already renders `Occurrence[]` from day one; PR 4 adding the real columns to
  `calendar_events` and the `event_exdates` table is the only change needed for recurrence to
  start actually appearing, because `ExpandableEvent` is structurally satisfied by the schema
  the moment those columns exist.
- Because expansion is pure and reads no clock, every "which occurrences are in this window"
  question is answered identically whether the caller is server-rendering committed rows or a
  client optimistically rendering an in-flight edit — there is exactly one implementation of the
  recurrence rules to keep in sync with the plan, not two.
- The monthly/yearly skip rule means a "31st of every month" series visibly has gaps (7–8
  occurrences a year, not 12) and a "29 Feb yearly" series fires roughly once every four years —
  this is deliberate TimeTree-equivalent behaviour, not a bug, but it is a real surprise for a
  household member expecting every month to have an entry and should be called out in the edit
  sheet's copy when PR 4 wires it up.
- If HomeSync ever needs a recurrence rule this model cannot express (`BYSETPOS`-style "last
  Friday of the month", multiple weekly patterns per series, an occurrence count instead of an
  end date), the columns and this library will need to grow together rather than adopting an
  RRULE string retroactively — the two are different storage shapes and cannot be bridged
  without a migration.
