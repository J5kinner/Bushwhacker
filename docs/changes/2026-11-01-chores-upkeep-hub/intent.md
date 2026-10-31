# Upkeep hub & Almanac retirement — intent

- **Date:** 2026-11-01
- **Status:** approved

## Problem

The middle tab on our phones (the Almanac) sits mostly empty and goes unused.
Monthly bank statements are too infrequent and cumbersome to check on a phone, and we rarely have enough calendar appointments to justify maintaining a shared calendar grid.
Meanwhile, regular house upkeep — washing sheets, deep-cleaning the bathroom, descaling the coffee machine, taking out bins — happens entirely in our heads.
We lose track of when things were last done, wait until things look dirty, or have to ask who did it last.
The existing chores list is hidden away and feels like a flat to-do list rather than showing what is actually pressing right now.

## Desired outcome

The middle tab becomes our daily "Upkeep" screen.
Each regular chore has a clear freshness bar that gradually turns from green to amber to red as days pass since it was last completed.
At a glance, we can see what is overdue or due today without feeling pressured by rigid calendar clock times.
It is obvious whose turn it is to do each chore next, and tapping done records it, resets the decay bar, and rotates the turn to the other person.
A "Quick tidy" filter lets us isolate the few most urgent tasks when we only have 15 minutes before bed.
A bottom sheet makes creating or editing a chore fast and effortless, replacing the cumbersome survey form.
The underutilised Almanac (both the Calendar and Budget/Finance ledger) is completely retired and removed from the codebase and database.

## Who it is for

The two of us, glancing at our phones around the house or before winding down for the evening to see what needs attention.

## Constraints

- Thumb-first: clear status bars and big tap targets that work comfortably on one hand.
- Zero guilt: tasks decay flexibly by days elapsed rather than turning into red "failed" appointment alarms.
- No fair share or partner comparison: no scoreboards, point systems, or 50/50 balance gauges.
- Australian spelling across all screens and notes.
- Low reviewer cognitive load: split into two sequential pull requests so building Upkeep and tearing down the Almanac can each be reviewed and verified cleanly.

## Out of scope

- Fair-share cognitive load balance gauges, leaderboards, or chore audits.
- Gamification, chore points, or streak counters.
- Automated sensor or calendar-synced scheduling.
