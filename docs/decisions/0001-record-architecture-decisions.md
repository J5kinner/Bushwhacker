# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

HomeSync is small but long-lived, and worked on by a mix of humans and AI agents.
Decisions about the data model, dependencies, and cross-cutting patterns need a durable record,
so that later work — human or agent — understands *why* the code is the way it is and does not
silently undo a deliberate choice.

## Decision

We record architecturally significant decisions as Architecture Decision Records (ADRs), one
Markdown file per decision under `docs/decisions/`, numbered sequentially, using the format in
[0000-adr-template.md](0000-adr-template.md).

The format follows Michael Nygard's ADR pattern: Context, Decision, Consequences.
An ADR is immutable once accepted; to change a decision, add a new ADR that supersedes it and
update the old one's status.

## Consequences

- The reasoning behind a choice survives even when the people involved move on.
- Grilling a plan (see [`grill-my-plan`](../../.claude/skills/grill-my-plan/SKILL.md)) has a
  natural home for the decisions it surfaces.
- There is a small, deliberate overhead per decision — which is the point; it keeps us from
  recording trivia and focuses ADRs on choices that genuinely constrain future work.
