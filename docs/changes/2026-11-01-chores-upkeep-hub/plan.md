# Upkeep hub & Almanac retirement — plan

- **Date:** 2026-11-01
- **Status:** approved

## Summary

Split across two sequential PRs:
* **PR 1:** Build Upkeep Hub (decay bars, urgency grouping, turn-taking, `ChoreSheet` bottom sheet for quick add/edit, swap bottom nav).
* **PR 2:** Retire Almanac & Budget (delete `/calendar` routes, scripts, API routes, remove schema tables, generate drop migration).

---

## PR 1: Upkeep Hub & Mobile Bottom Sheet

### Tasks

- [x] **1. Unit test & helper module for decay maths and turn-taking**
  - Create `lib/chore-decay.ts` and `lib/chore-decay.test.mts`.
  - Calculate decay ratio, urgency bracket (`overdue`, `due-soon`, `fresh`), remaining/overdue days text, and next turn member.
- [x] **2. Navigation update**
  - Update `components/bottom-nav.tsx`: replace `Almanac` (`/calendar`) with `Upkeep` (`/chores`) using the `Sparkles` icon.
- [x] **3. Server actions for editing chores**
  - Add `updateChore(id: string, input: UpdateChoreInput)` to `app/(app)/chores/actions.ts`.
  - Recomputes CLI score and updates `title`, `intervalDays`, and next due date if interval changed.
- [x] **4. Build `ChoreSheet` bottom sheet component**
  - Create `app/(app)/chores/chore-sheet.tsx` using `useKeyboardInset` and accessible dialog pattern.
  - Support both "Add" mode and "Edit" mode with title, quick frequency chips (7d, 14d, 30d, 90d, custom), optional collapsible mental-load inputs, and delete action.
- [x] **5. Update Chores Page data loading**
  - In `app/(app)/chores/page.tsx`, fetch `getHouseholdMembers()` and `getCurrentUserId()` alongside `getChores()`.
  - Pass members and current user ID into `ChoresList`.
- [x] **6. Build the Upkeep UI in `chores-list.tsx`**
  - Group chores by urgency: **Overdue**, **Due Soon**, and **Up to date**.
  - Render progress/decay bars with colour coding (emerald / amber / rose).
  - Add turn-taking badges: "Turn: [Name]".
  - Add "Quick tidy" toggle button.
  - Tapping a chore row opens `ChoreSheet` in edit mode; tapping the check button marks it done optimistically.
  - Prominent "+ Add chore" button opens `ChoreSheet` in create mode.
- [x] **7. Verification (PR 1)**
  - Run `pnpm test` to verify unit tests for decay and turn calculation.
  - Run `pnpm run lint`.
  - Run `pnpm run build` to ensure type-safety across all modified pages.

### Files touched in PR 1

- `lib/chore-decay.ts` (new)
- `lib/chore-decay.test.mts` (new)
- `components/bottom-nav.tsx`
- `app/(app)/chores/actions.ts`
- `app/(app)/chores/chore-sheet.tsx` (new)
- `app/(app)/chores/page.tsx`
- `app/(app)/chores/chores-list.tsx`

---

## PR 2: Almanac & Budget Teardown (Follow-up)

### Tasks

- [ ] **1. Delete Calendar UI & Routes**
  - Delete `app/(app)/calendar/`.
  - Delete `app/api/calendar.ics/`, `app/api/reminders/`, and `app/api/attachments/`.
- [ ] **2. Delete Scripts & Library Helpers**
  - Delete `scripts/finance-narrate.mjs`.
  - Delete `lib/calendar-window.*`, `lib/event-colours.*`, `lib/ics.*`, `lib/month-lanes.*`, `lib/recurrence.*`, `lib/reminder-instants.*`, `lib/time-grid.*`.
  - Delete `lib/finance-format.*`, `lib/finance-import.*`, `lib/finance-overview.*`, `lib/finance-period.*`.
  - Clean up query exports in `lib/queries.ts`.
- [ ] **3. Database Schema & Migration**
  - Remove calendar and finance tables from `db/schema.ts`.
  - Run `pnpm drizzle-kit generate` to generate the migration dropping the unused tables.
  - Apply with `pnpm drizzle-kit migrate`.
- [ ] **4. Verification (PR 2)**
  - Run `pnpm test`, `pnpm run lint`, and `pnpm run build`.

---

## Edge cases & failure modes

- **Chore with no interval (one-off):** No decay bar displayed; grouped under an unscheduled section.
- **Chore never completed before:** Anchor decay from `createdAt` so that older neglected chores show as overdue.
- **Single-member household fallback:** Gracefully handle turn-taking when only one member exists.
- **Keyboard on mobile:** `useKeyboardInset` ensures bottom sheet form controls remain visible when editing text on mobile iOS Safari/Chrome.
