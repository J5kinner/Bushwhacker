# Upkeep hub & Almanac retirement — specification

- **Date:** 2026-11-01
- **Status:** approved

## Overview

Replace the underutilised Almanac with a dedicated, mobile-first Upkeep hub.
Transform chores into an interval-decay tracker inspired by Tody and Sweepy:
visual freshness bars, urgency grouping, automatic turn-taking between household members, a quick-tidy filter, and a bottom sheet for adding and editing chores.
Retire and purge the entire Almanac (both the Calendar and Budget/Finance ledger) from the codebase and database.

To keep Reviewer Cognitive Load (RCLI) manageable and ensure safe rollback boundaries, this change is split across two sequential PRs:
1. **PR 1: Upkeep Hub & Mobile Bottom Sheet** (add new functionality and swap navigation).
2. **PR 2: Almanac & Budget Teardown** (remove legacy calendar, finances, API routes, and drop database tables).

---

## PR 1: Upkeep Hub & Bottom Sheet

### 1. Navigation swap
- In `components/bottom-nav.tsx`:
  - Replace tab 3 (`/calendar`, "Almanac", `CalendarDays`) with (`/chores`, "Upkeep", `Sparkles`).
  - Retain the five-tab mobile footprint.

### 2. Upkeep decay & urgency model
For any chore with an `intervalDays` ($N > 0$):
- **Anchor date:** `lastCompletedAt ?? createdAt`.
- **Elapsed days:** $\Delta t = \max(0, \frac{\text{now} - \text{anchor}}{86,400,000})$.
- **Decay ratio:** $R = \frac{\Delta t}{N}$.
- **Status brackets:**
  - **Overdue ($R \ge 1.0$):** Past the target interval. Visualised with a full rose progress bar.
  - **Due soon ($0.7 \le R < 1.0$):** Approaching renewal in the next $\sim 30\%$ of the window. Visualised with an amber progress bar.
  - **Up to date ($R < 0.7$):** Recently done. Visualised with an emerald progress bar filled to $R \times 100\%$.
- For one-off chores (`intervalDays` is null), display as an unscheduled task without a decay bar.

### 3. Turn-taking logic
HomeSync has exactly two members in the household:
- If `lastCompletedById === userA.id`, next turn is `userB.name`.
- If `lastCompletedById === userB.id`, next turn is `userA.name`.
- If `lastCompletedById == null`, default to the chore's `ownerId` (the person who initiated it).
- Completing a chore stamps `lastCompletedById = currentUserId`, instantly advancing the turn to the other partner.

### 4. Streamlined creation & editing via bottom sheet
- Replace the 6-question inline form with a dedicated `ChoreSheet` component:
  - Accessible dialog overlay styled matching existing app sheets (`fixed inset-x-0 bottom-0` with `useKeyboardInset`).
  - Triggered by a prominent "+ Add chore" button or by tapping any existing chore row to edit.
- **Core inputs:**
  - Title input (`placeholder="e.g. Wash bed sheets"`).
  - Quick-preset frequency chips: **Weekly (7d)**, **Fortnightly (14d)**, **Monthly (30d)**, **Quarterly (90d)**, or **Custom days**.
- **Optional cognitive load:**
  - Cognitive load inputs (`anticipate`, `identify`, `decide`, `monitor`, `invisible`, `fragmentation`) default to 0 and are tucked behind a collapsible "Mental load details" toggle.
- **Editing:**
  - Supports updating title, frequency, or deleting directly from the sheet.

### 5. "Quick Tidy" focus mode
- A simple client-side toggle button at the top of the Upkeep list.
- When active, filters the display to only show **Overdue** chores, giving the household an actionable 15-minute hit list without feeling overwhelmed by the full inventory.

### 6. Data actions
- Add `updateChore(id: string, input: UpdateChoreInput)` in `app/(app)/chores/actions.ts`.
- Recomputes CLI score and updates `title`, `intervalDays`, and next due date if interval changed.

---

## PR 2: Almanac & Budget Teardown

### 1. Routes & UI cleanup
- Delete `app/(app)/calendar/` directory entirely (all calendar and finance pages, sheets, actions, and views).
- Remove calendar API routes:
  - `app/api/calendar.ics/` (iCalendar feed).
  - `app/api/reminders/` (reminder cron endpoint).
  - `app/api/attachments/` (blob attachments upload webhook).
- Remove finance script `scripts/finance-narrate.mjs`.

### 2. Library & query cleanup
- Delete calendar and finance helpers:
  - `lib/calendar-window.ts` & `lib/calendar-window.test.mts`
  - `lib/event-colours.ts` & `lib/event-colours.test.mts`
  - `lib/ics.ts` & `lib/ics.test.mts`
  - `lib/month-lanes.ts` & `lib/month-lanes.test.mts`
  - `lib/recurrence.ts` & `lib/recurrence.test.mts`
  - `lib/reminder-instants.ts` & `lib/reminder-instants.test.mts`
  - `lib/time-grid.ts` & `lib/time-grid.test.mts`
  - `lib/finance-format.ts` & `lib/finance-format.test.mts`
  - `lib/finance-import.ts` & `lib/finance-import.test.mts`
  - `lib/finance-overview.ts` & `lib/finance-overview.test.mts`
  - `lib/finance-period.ts` & `lib/finance-period.test.mts`
- Clean up unused query functions in `lib/queries.ts` (e.g. `getCalendarWindow`, `getFinanceMonthOverview`, etc.).

### 3. Database schema & migration
- In `db/schema.ts`, remove table definitions:
  - `calendarEvents`, `eventExdates`, `eventComments`, `activity`, `reminderLog`, `eventAttachments`.
  - `financeAccounts`, `financeImports`, `financeTransactions`, `financeAnalyses`, `financeGoals`.
- Run `pnpm drizzle-kit generate` to produce a migration that drops these tables and indexes cleanly.
- Review and apply migration with `pnpm drizzle-kit migrate`.

---

## Reviewer Cognitive Load (RCLI) forecast
- **PR 1:** ~5 files modified, 2 new files (`lib/chore-decay.ts`, `chore-sheet.tsx`). No schema changes. Focused exclusively on the Upkeep user experience. Estimated RCLI band: **Low**.
- **PR 2:** Deletions across routes and schema, plus one migration file. Standard teardown diff. Estimated RCLI band: **Medium** (straightforward deletions with zero new business logic).
