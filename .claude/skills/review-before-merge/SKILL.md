---
name: review-before-merge
description: Use after the PR description is written and before merging a non-trivial change in HomeSync, to verify the diff, read the evidence, and decide what still needs a human to look at.
---

# Review before merge

## Overview

The last step of the delivery workflow, and the one `plan-then-build` leaves unfinished:
**how do you actually review the code the agent wrote before you self-merge?**
This skill is the personal-scale version of the code review that machines now do most of,
scaled to two people and one Vercel project.

Run it **after** [`pr-description`](../pr-description/SKILL.md) and **before** you merge.
It reads the finished diff, not the plan — it is a check on what was *actually* built,
so run it in a fresh context whenever possible (ideally a subagent that did not write the
code). Its output is a triaged list of findings plus an explicit answer to
"what still needs a human to read?"

## The pass

1. **Re-read the diff in fresh context.** Read the full branch diff (`git diff main...HEAD`)
   against `intent.md`. Confirm what was built still delivers what the intent asked for —
   this is the intent-drift check that nothing else in the chain catches at this stage.
2. **Security read** (a separate pass, always run, not a spot-check): the HomeSync trust
   boundaries are small and specific, so go straight at them —
   - `auth.ts` and the `ALLOWED_EMAILS` allowlist: did any change widen who can sign in?
   - VAPID / web-push keys, the Neon `DATABASE_URL`, anything that could land in a
     client-visible path, a URL, a log, or a Vercel Blob object.
   - Any new or changed **Server Action** that accepts user input and mutates the database:
     is the input validated, and is there a path where one household account acts on the
     other's data?
   - Anything that could run untrusted input (a URL, a file name, a push notification's
     payload) through a code path.
   An open finding here is a **blocker**: fix it and re-run the pass before merging.

   One check is the exception to "verify it yourself": whether the **phone-preview
   confirmation** in the PR's Test plan was actually done. The commands paste here, but only a
   human sees the phone — so an unconfirmed preview is an open item, and it goes in the
   "still needs a human" list (step 3 below), not in Blockers, because it is a human
   confirmation, not a defect.
3. **Correctness read** — the class of bug, not the instance. For every bug you spot,
   ask whether its *pattern* exists elsewhere in the diff (or the file) and say so, so
   the fix covers every instance rather than one line.
4. **Read the evidence.** The PR body (from `pr-description`) pastes `build`/`lint`/`test`
   output and a phone-preview result. Read them. Then, in one sentence, state **what those
   checks would not have caught** for this change. If you cannot articulate that, the honest
   output is "this needs a real human review", not a pass.
5. **Read the RCLI score.** The PR body's Risk & rollback section carries the
   [RCLI](../../../docs/decisions/0002-reviewer-cognitive-load-index.md) score, its band, and
   the five-channel breakdown. If the plan-time estimate (step 3 of `plan-then-build`) and
   this final number disagree by more than a band, say so — the PR grew past what was planned,
   and the reviewer should know before the human does. A high score is not a defect; it is
   the reason the human's attention is being asked for, and the channel breakdown names where
   to look first.

## Convergence

The point of capping rounds is that a second pass mostly re-finds the same things.

- **Cap at three rounds.** After that, stop and re-approach: either the plan was wrong, or
  the same fix is being applied shallowly. Do not run a fourth pass over the same lines.
- **Re-review only the new diff** after the first round — the lines that changed in
  response to round one, not the whole PR again.
- **Never re-post a finding already made.** If a round surfaces only things a prior round
  already flagged, the diff has converged; say so and move to merge.
- **Flag the class, not the instance**, so the fix is one pass, not N.

## The output

A short, severity-ranked note — not a wall of text:

1. **Blockers** (anything that must not merge): the security findings above, plus
   anything that contradicts `intent.md` or the `build`/`lint`/`test` evidence.
2. **Warnings** (should fix, or consciously accept with a note in the PR): a pattern bug,
   a missed convention from [practices.md](../../../docs/practices.md), a spot where the
   diff is harder to follow than it needs to be.
3. **What still needs a human.** Name the specific file, hunk, or verification that only a
   person can do, and say which: a product-taste judgement, an optimisation whose trade-off
   only the user can take, a security assumption you cannot verify from code alone, or — most
   often — the phone-preview confirmation (step 2) if it was not actually done. If the honest
   answer is "nothing left", say so plainly; do not manufacture a warning to look thorough.

Then the **merge gate**, stated out loud — the agent does not merge, it presents:

1. The RCLI score and band from step 5, with the dominant channel(s) named.
2. The blocker and warning lists from above.
3. Which of the "still needs a human" items the human should actually look at, in the order
   the channel breakdown suggests.

The human then makes the call: merge, merge after fixing the listed blockers, or split the PR
if the band is high or the [hard-split override](../../../docs/decisions/0002-reviewer-cognitive-load-index.md)
applies. This is this project's stand-in for the risk-tier approval gate that
[ADR 0013](../../../docs/decisions/0013-ai-dlc-artifact-chain.md) declined at organisation
scale: the score is the risk signal, the human is the gate, and no self-merge happens before
both exist.
