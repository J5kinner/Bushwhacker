---
name: pr-description
description: Use when opening or updating a pull request for HomeSync, or when asked to write or revise a PR title and description.
---

# PR description

## Overview

A pull request description in this repo IS the following title and five sections, in this order.
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
4. **Test plan** — how it was verified: the commands run (`build`, `lint`, type-check), and a note
   to open the **Vercel preview URL on a phone** and confirm the mobile flow.
5. **Notes** — anything a reviewer needs: linked ADRs, follow-ups, deliberate out-of-scope, or
   "none".

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
- `pnpm run build`, `pnpm run lint`, type-check — all pass.
- Verified add / check-off / group collapse on the Vercel preview on iOS Safari (standalone PWA).

## Notes
Data model change recorded in ADR 0004. No calendar/chores changes in this PR.
```

## Keep it tight

Match the level of detail to the change: a one-line fix needs a one-line Summary and a two-line
Test plan, not the full template padded out.
