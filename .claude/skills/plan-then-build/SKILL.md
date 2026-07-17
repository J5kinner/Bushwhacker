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
2. **Forecast review load.** Estimate the change against RCLI
   ([ADR 0002](../../../docs/decisions/0002-reviewer-cognitive-load-index.md)): roughly how many
   files, how much new complexity, how scattered. If the change forecasts **high** (or dispersion
   looks like it will dominate), split it into multiple PRs landed in dependency order, and say so
   in the plan.
3. **Grill if non-obvious.** If the plan has open questions or unexamined assumptions, run
   [`grill-my-plan`](../grill-my-plan/SKILL.md) first and record any real decision as an ADR.
4. **Confirm.** Wait for the user's go-ahead on the plan before writing code.
5. **Branch.** Work on a task-named branch (e.g. `add-shopping-categories`), never on `main`.
6. **Build.** Implement to the plan. Server Actions for mutations; mobile-first Tailwind;
   optimistic UI for the shopping and chore lists (see [practices](../../../docs/practices.md)).
7. **Verify.** `pnpm run build`, `pnpm run lint`, type-check, and confirm DB queries succeed.
   Paste the output — no success claims without evidence.
8. **PR.** Open a PR with [`pr-description`](../pr-description/SKILL.md), open the Vercel preview
   on a phone, review your own diff, then self-merge.

## Red flags — stop and plan first

- "It's faster to just start coding."
- "I'll write the plan after, once I know it works."
- "This bug fix grew into a refactor while I was in there."
- "I'll verify later / it obviously compiles."

Each of these means: stop, write the plan, and get confirmation before continuing.
Growing scope mid-change means going back to step 1, not carrying on.
