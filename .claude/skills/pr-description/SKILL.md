---
name: pr-description
description: Use when opening or updating a pull request for HomeSync, or when asked to write or revise a PR title and description.
---

# PR description

## Overview

A pull request description in this repo IS the following title and six sections, in this order.
Produce exactly these parts — nothing restated from the diff, no narrative of how the work went.

## The shape

**Title** — one line, Conventional Commits: `<type>(<scope>): <summary>`.
`<type>` ∈ `feat`/`fix`/`docs`/`chore`/`refactor`/`perf`/`test`/`ci`.
Summary in the imperative, lower case, no full stop.

**Body:**

1. **Summary** — 1–3 sentences: what this PR does and why it exists.
2. **Changes** — a short bullet list of the substantive changes (not a file-by-file dump).
3. **Acceptance criteria** — a numbered checklist a reviewer can tick off to confirm it does what
   it should.
4. **Test plan** — how it was verified: the commands run (`build`, `lint`, `test`), and a note to
   open the **Vercel preview URL on a phone** and confirm the mobile flow.
5. **Risk & rollback** — the [RCLI](../../../docs/decisions/0002-reviewer-cognitive-load-index.md)
   score, its band (`low` / `medium` / `high`), and the dominant channel(s) from the five-channel
   breakdown, on one line each. Most changes are low; if the plan-time estimate (step 3 of
   `plan-then-build`) and the final number disagree by more than a band, say so here. Also name
   the undo: most changes revert to a single command (an un-merge, or an undo of the Drizzle
   migration). A destructive schema change — a `DROP`, `ALTER`, or removed column — must carry a
   **down** statement in its migration, not just the up; the rollback command here is the proof.
   This section is what the human reads to make the merge call, and what
   [`review-before-merge`](../review-before-merge/SKILL.md) re-checks against the finished diff.
6. **Notes** — anything a reviewer needs: a link to the change's folder under
   [`docs/changes/`](../../../docs/changes/) when it has one, linked ADRs, follow-ups, deliberate
   out-of-scope, or "none".

## Example

```markdown
feat(shopping): group list items by category

## Summary
Shopping-list items are now grouped under basic categories so the list is faster to scan on a
phone. Categories come from the item's `category` column; uncategorised items fall back to "Other".

## Changes
- Add a `category` column to `shopping_items` (Drizzle migration).
- Group items by category in the Shopping tab, collapsed headers, "Other" last.
- Optimistic add/check-off preserved across grouping.

## Acceptance criteria
1. Adding an item with a category places it under that category immediately (optimistic).
2. Checking an item off works within a group and reconciles with the server.
3. Items with no category appear under "Other".

## Test plan
- `pnpm run build`, `pnpm run lint`, `pnpm test` — all pass.
- Verified add / check-off / group collapse on the Vercel preview on iOS Safari (standalone PWA).

## Risk & rollback
RCLI: 0.21 → low. Dominant channel: size (ŝ = 0.42), from the backfill script; all others under
0.25.
Rollback: un-merge — or `pnpm db:migrate` the paired down migration to drop the column.

## Notes
Data model change recorded in ADR 0004. No calendar/chores changes in this PR.
```

## Keep it tight

Match the level of detail to the change: a one-line fix needs a one-line Summary, a two-line
Test plan, and a one-line Risk & rollback, not the full template padded out.
