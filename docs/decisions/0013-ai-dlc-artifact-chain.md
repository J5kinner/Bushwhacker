# 0013. Adopt the AI-DLC artifact chain, scaled to two people

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) describes
a development lifecycle in which every stage ends by committing a version-controlled artifact that
the next stage reads: `intent.md` (plan) → `spec.md` (design) → `plan.md` (build) → test results →
reviewed PR → incident intent on the way back round.
Governance is split between *deterministic* controls that block (hooks, permissions) and *advisory*
ones that guide (skills, `CLAUDE.md`).

HomeSync already had most of the middle of that chain.
[`plan-then-build`](../../.claude/skills/plan-then-build/SKILL.md) enforced plan-before-code,
specs and plans were committed under `docs/superpowers/`, CI covered the test stage, and
[ADR 0002](0002-reviewer-cognitive-load-index.md) already moved review load upstream to plan time.

Three things were missing:

1. **No intent artifact.** Specs opened at "Problem" already written in engineering language, with
   several decisions absorbed. What was originally asked for existed only in a chat transcript.
2. **No traceability.** Specs and plans sat in two flat directories keyed loosely by date-slug, and
   they did not line up — one feature had a spec and no plan, another a plan and no spec, one spec
   did not follow the others' naming. A broken chain was invisible.
3. **Every control was advisory.** Rules that matter — never hand-edit an applied migration, never
   let an agent migrate the production database — lived in prose that asks politely.

Against that sits the fact that the playbook is written for engineering organisations, and most of
its value comes from handoffs between different people. This is two people and one Vercel project.

## Decision

Adopt the front of the chain and the deterministic controls; skip the organisational scaffolding.

**Adopted:**

- One folder per change under [`docs/changes/`](../changes/) named `YYYY-MM-DD-slug`, holding
  `intent.md`, `spec.md` and `plan.md`. `docs/superpowers/` is retired — it was named after the
  skills plugin, not the content.
- `intent.md` becomes step 1 of `plan-then-build`, written in household language and confirmed by
  the person who wanted the thing before any design happens.
- Existing changes were back-filled with reconstructed intents, marked as such. Genuine gaps were
  left as gaps.
- Two `PreToolUse` hooks (ADR 0014): edits to applied migrations are denied, and migration commands
  pause for explicit human permission.

**Deliberately not adopted:**

- *The maintain-stage incident loop* — monitoring breaches autonomously opening an intent. With
  [hobby-tier observability](0011-observability-on-hobby.md) and two users, an incident is one of us
  noticing something is broken.
- *Continuous evals on configuration changes.* There is no fleet of agent configs to regress.
- *Subagent scoping and role-based approval gates* — code owners, release managers, tech-lead review
  of high-risk changes. There is one engineer, who is also the product owner and the release
  manager.

## Consequences

Intent is now the thing most likely to be skipped under time pressure, and skipping it is invisible
until months later when nobody can say why a feature works the way it does. The README's
completeness table is the only check; there is no CI gate asserting a chain exists, because a docs
gate on a two-person repo costs more than it catches.

Reconstructed intents read more coherently than the original thinking actually was — hindsight
tidies. They are marked `Status: reconstructed` so they are not mistaken for contemporaneous
records, but they should be trusted less than the specs they were derived from.

The split between intent and spec will feel redundant for small changes, where the honest intent is
one sentence. `plan-then-build` allows stopping after intent and spec for those, but the boundary is
a judgement call and will drift.

Retiring `docs/superpowers/` breaks any external link into the old paths. All in-repo references
were updated; anything pasted into a chat log or a browser bookmark is now dead.
