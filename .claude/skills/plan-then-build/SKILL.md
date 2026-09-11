---
name: plan-then-build
description: Use when starting any feature, bug, or change in HomeSync that touches more than one file, or is otherwise non-trivial, before writing code.
---

# Plan, then build

## Overview

The personal-scale delivery workflow for HomeSync: **plan → confirm → branch → build → verify → PR.**
Planning and code land in the *same* PR — this is a two-person project, not a company harness.
The one rule that is not negotiable: a plan and a confirmation come **before** code.

## When to use

- Any change touching more than one file.
- Any new feature, schema change, or dependency.
- Any bug whose fix is not a one-line, obvious edit.

Skip only for genuinely trivial, single-file edits (a typo, a copy tweak).

## Workflow

1. **Plan.** Print a short, bulleted implementation plan: what files change, what the data/UI
   change is, and what you will verify. Keep it to the request — no speculative scope.
2. **Forecast review load.** Judge how hard the change will be to review: how many files, how much
   new complexity, how scattered across the codebase. If it looks heavy on any of those — scattered
   especially — split it into multiple PRs landed in dependency order and say so in the plan.
   ([ADR 0002](../../../docs/decisions/0002-reviewer-cognitive-load-index.md) is the reasoning
   behind those three channels. It is a plan-time judgement, not a score to compute: its inputs
   come from a diff that does not exist yet.)
3. **Grill if non-obvious.** If the plan has open questions or unexamined assumptions, run
   [`grill-my-plan`](../grill-my-plan/SKILL.md) first and record any real decision as an ADR.
4. **Confirm.** Wait for the user's go-ahead on the plan before writing code.
5. **Branch.** Work on a task-named branch (e.g. `add-shopping-categories`), never on `main`.
6. **Build.** Implement to the plan. Server Actions for mutations; mobile-first Tailwind;
   optimistic UI for the shopping and chore lists (see [practices](../../../docs/practices.md)).
7. **Verify.** `pnpm run build` (which type-checks), `pnpm run lint`, `pnpm test`, and confirm DB
   queries succeed. Paste the output — no success claims without evidence.
8. **PR.** Open a PR with [`pr-description`](../pr-description/SKILL.md), open the Vercel preview
   on a phone, review your own diff, then self-merge.

If scope grows mid-change, go back to step 1 and re-plan rather than carrying on.
