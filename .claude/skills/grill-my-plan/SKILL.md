---
name: grill-my-plan
description: Use when a plan or design needs stress-testing before implementation — to surface hidden assumptions, ambiguous requirements, edge cases, and speculative scope in HomeSync.
---

# Grill my plan

## Overview

A relentless, codebase-grounded interview that hardens a plan **before** any code is written.
The goal is shared understanding: resolve every branch of the decision tree until nothing
load-bearing is left to assumption.

## When to use

- Before implementing a non-trivial feature or schema change.
- When a plan has open questions, or when requirements could be read two ways.
- When you suspect scope is creeping past what was actually asked.

## How to run it

- **One question at a time.** Never batch. Each answer shapes the next question.
- **Answer what the codebase can answer yourself.** Do not ask the user what a quick read of the
  code, schema, or docs would tell you — grep first, then ask only what is genuinely undecided.
- **Prefer sharp, closed questions.** "Should a checked-off shopping item disappear or grey out?"
  beats "how should checking off work?"
- **Chase edge cases.** Empty states, the second user acting at the same time, offline/optimistic
  rollback, what happens on failure.
- **Cut speculative scope.** For every column, feature, or abstraction, ask: is this in the
  request, or are we guessing at a future need? If it is a guess, drop it (YAGNI).

## What to probe

| Area | Example question |
| --- | --- |
| Data model | What is the minimal set of columns? What is nullable, and why? |
| Concurrency | Both partners edit the same list at once — what wins? |
| Optimistic UI | What does the user see before the server responds, and on rollback? |
| Boundaries | What is explicitly *out* of scope for this change? |
| Failure | What happens when the Server Action fails or the network drops? |

## Recording decisions

When grilling settles a real architectural choice — a data model, a dependency, a cross-cutting
pattern — record it as an ADR under [`docs/decisions/`](../../../docs/decisions/) using the
[template](../../../docs/decisions/0000-adr-template.md).
Do not record trivia; record the choices that will constrain future work.

## When to stop

Stop when every branch of the plan is resolved, out-of-scope is written down, and you could hand
the plan to someone else who would build the same thing.
Then return to [`plan-then-build`](../plan-then-build/SKILL.md) step 4 (confirm) and proceed.
