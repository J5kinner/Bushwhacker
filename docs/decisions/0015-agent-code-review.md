# 0015. Adopt an agent review stage, scaled to two people

- **Status:** Accepted
- **Date:** 2026-09-02

## Context

[ADR 0013](0013-ai-dlc-artifact-chain.md) adopted the front of the AI-DLC artifact chain
(intent → spec → plan) and deliberately declined the organisation-sized scaffolding around
it, because there is one engineer who is also the product owner and the release manager.

That left the *back* of the chain thin. The delivery workflow ran
plan → confirm → branch → build → **verify (build/lint/test)** → PR description → **self-merge**.
The only gate between "the commands passed" and "it is on production" was a human reading a
diff — and Claude writes most of that diff. Nothing in the repo said how that final read
happens, how it stays convergent, or how to tell a rubber-stamp from a real review.

The model in [Anthropic's code review post](https://claude.dev/blog/solving-code-review-at-anthropic/)
is useful here because most of what it says is *already what this repo does* at a smaller
scale: verify with runnable evidence before anyone reads, a fresh-context reviewer, a
convergence cap so rounds stop re-finding old bugs, and a fast, one-step rollback. What it
adds, and what this repo is missing, is the middle part — *how the review itself behaves*.

## Decision

Add two skills, rework one, and amend the delivery workflow. **No new CI, hooks, or
tooling** — the review is advisory, run in the session, for the same reason ADR 0013
declined organisational gates: at two people and one Vercel project, a deterministic review
gate costs more than it catches.

- **[`review-before-merge`](../../.claude/skills/review-before-merge/SKILL.md)** — runs
  after `pr-description`, before the merge, ideally in a fresh context. It reads the
  finished diff against `intent.md`, always runs a narrow security pass at HomeSync's actual
  trust boundaries (`auth.ts`/`ALLOWED_EMAILS`, Server Action input, keys and Blob URLs),
  requires reading the pasted `build`/`lint`/`test` evidence and stating *what those checks
  would miss*, re-checks the final [RCLI](0002-reviewer-cognitive-load-index.md) score and
  its five-channel breakdown against the PR body, and then **presents to the human** —
  score, band, dominant channel, blocker list, warning list, and the specific items a
  person needs to look at. Capped at three rounds, diff-only re-review, no repeated
  findings — the convergence rules from the post, so the review stops re-surfacing the
  same bugs each pass.
- **[`explain-code`](../../.claude/skills/explain-code/SKILL.md)** — replaces "read the
  whole module before touching it" with "generate a short, current explainer for exactly
  the slice you're about to change." This is how two people keep understanding a codebase
  an agent writes, without paying line-by-line attention to changes that are trivial.
- **`pr-description`** gains a sixth section, **Risk & rollback**. The risk part of that
  section is the RCLI score, band, and dominant channel(s) — the same metric
  [ADR 0002](0002-reviewer-cognitive-load-index.md) already defines and that
  `plan-then-build` step 3 already estimates at plan time. Using RCLI here rather than a
  new ad-hoc "low/medium/high" tier is deliberate: it keeps one metric with one meaning
  across the whole chain (plan estimate → PR score → merge gate), and the channel
  breakdown gives the human a pointer into *where* in the diff the load sits, not just
  that it does. The rollback part names the undo — most changes revert to a single
  command — and requires a **down** statement in any destructive Drizzle migration,
  because Drizzle generates an *up* statement only and the current `db/migrations/`
  confirms it.
- **`plan-then-build`** workflow step 9 is split into 9 (PR), **10 (Review)**, and
  **11 (Human merge gate)**; step 11 states plainly: no self-merge, the human makes the
  call.
- **`AGENTS.md`** delivery-workflow summary and Git-safety section, and **`CLAUDE.md`**
  skill list, updated to match.

**No self-merge.** This is the deliberate departure from the repo's prior "you self-merge
after reviewing your own PR" rule. The reasoning: `plan-then-build` and `pr-description`
already let the agent *write* the review-relevant inputs (the PR body, the RCLI number,
the pasted command output). The one step that keeps the human in the loop has to be a
step the agent cannot do at all, or "self-merge after review" quietly degrades into
"the agent reviews its own work and merges it." Presenting the score and findings to
the human, and letting the human decide, is the smallest possible change to the existing
workflow that preserves the human gate, and it is what the post's "human approval, scaled
by risk" reduces to at this scale.

**Deliberately not adopted** (from the post): role-based approval tiers, CODEOWNERS-style
path gates, a merge queue, feature flags, and staged/gradual release. These are the
organisation-sized machinery ADR 0013 already declined on the same grounds — one Vercel
project, a preview URL is the deployment, and two people are the whole release channel.
The post's *behavioural* ideas (fresh-context review, convergence, a blocking security
read, fast rollback) and its *risk-score* idea (which this repo already had, in RCLI,
and which this ADR now actually wires into the merge gate) are portable to this size;
its *governance* machinery is not.

## Consequences

The review stage is advisory, so it is only as good as being actually run.
`plan-then-build` is the entry skill and already names `pr-description` and now
`review-before-merge` as steps; that is the only enforcement available at this scale.
A session that skips it is not stopped by anything, the same honest limitation ADR 0014
accepted for the migration hooks — the rule stays written in `AGENTS.md` and the skill,
and the guardrail is the habit, not a gate. The human merge gate is not advisory in
the same way: there is no self-merge path to skip past, which is why it is stated as a
hard rule in `AGENTS.md`'s Git-safety section rather than only inside a skill.

The RCLI number in the PR body is a *reasoned estimate* — [ADR 0002](0002-reviewer-cognitive-load-index.md)
is explicit that the weights are defaults, not fitted values, and that this repo applies
it as a plan-time estimate rather than a computed one. Using it as a merge-gate input
does not make it more accurate than that; it makes the *disagreement* between the
plan-time estimate and the post-build estimate visible, which is the useful part. The
saturation constants and the 0.60 high-band threshold still need to be calibrated
against this repo's own review data before being treated as anything stronger than a
triage signal.

The security pass is a *checklist of HomeSync's real trust boundaries*, not a general
vulnerability scanner. It is better than nothing and cheaper than a dependency like
Semgrep, but it is only as current as this file — when a new trust surface appears (a
new auth provider, a new way out to the network), the list in the skill has to be
updated or it silently stops covering the thing that actually matters.

`review-before-merge` and `grill-my-plan` overlap in that both ask hard questions of a
plan/design. They sit at different points in the chain and are not meant to run
together; the risk is a reader seeing two "grill it" skills and assuming they are
duplicates. The distinction is deliberate: `grill-my-plan` hardens the *design before
code*, this skill verifies the *code after the plan was already approved*.

No self-merge is a deliberate small cost on every merge, by design. If it becomes
annoying enough to route around — a human approving from a phone in 30 seconds on a
clearly-low RCLI score, or an agent "merged on my behalf" request — that is a signal
the gate is doing its job: the human is being asked, cheaply, to say yes, rather than
the agent saying yes for them. The thing to watch for is the opposite failure mode: a
human who has been asked so often they stop reading the score, at which point the gate
has the same problem this ADR exists to solve. If that shows up, the fix is to make the
RCLI score more meaningful (better calibration, per ADR 0002's own note), not to
remove the gate.
