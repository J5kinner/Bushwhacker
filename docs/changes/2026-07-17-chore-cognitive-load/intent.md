# Chore Cognitive Load Index — intent

- **Date:** 2026-07-17
- **Status:** reconstructed

> Reconstructed on 2026-09-16 from [spec.md](spec.md) and [ADR 0003](../../decisions/0003-chore-mental-load-model.md), after the fact.
> It records what we can tell we wanted, not a document that existed at the time.

## Problem

Splitting chores by who does them misses the part that actually wears a person down: the remembering, the noticing it needs doing, the deciding, and the checking it got done.
A chore that takes five minutes can occupy someone all week.
Because that load is invisible, it never gets counted, and so it never gets shared.

## Desired outcome

Each chore carries an honest sense of how much *thinking* it costs, not how long it takes, so we can look at the list together and see that the mental side is lopsided — and move some of it.

## Who it is for

Both of us, sitting down together every so often to rebalance, rather than in the middle of doing a chore.

## Constraints

- Execution time must not be an input; the whole point is that time is the misleading measure.
- The raw answers must be kept, not only the final number, so the weighting can change later without asking us every question again.
- The weights are reasoned defaults, not measured — it must be presented as a conversation starter, not a verdict.

## Out of scope

- Dashboards and trend charts over time.
- Automatically suggesting who should take what.
- Importing chores from anywhere else.
