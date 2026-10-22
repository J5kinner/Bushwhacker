---
name: explain-code
description: Use when you need to understand a part of the HomeSync codebase before changing it, or when asked "how does X work here?" — reads the real code and writes a short explainer for that slice, instead of assuming a stable mental model.
---

# Explain code

## Overview

Code review's second job has always been to spread an understanding of the codebase.
If machines do most of the reading, that job doesn't disappear — it just moves to a cheaper
form. This skill is that form: **a short, current, plain-language explainer of exactly the
slice of code you're about to touch**, generated on demand, not a stale diagram or a
comprehensive mental model of the whole app.

## When to use

- Before changing a module you haven't read recently — especially `lib/`, which is where
  the app's logic lives.
- When asked "how does this work?" about any part of HomeSync.
- When a plan or a `grill-my-plan` session hits a boundary you don't understand well enough
  to answer a question about.

## How to write it

- **Read the actual code first.** Grep and open the real files; do not explain from a name
  or a remembered shape. The explainer has to match the code *as it is today* — that is the
  whole point of generating it fresh rather than relying on something that was accurate in
  March.
- **Scope it to the slice asked about.** One module, one component, one flow. Not "how the
  whole app works" — that's not a useful answer at this size, and it isn't going to be
  accurate.
- **Cover four things, briefly, in this order:**
  1. What it does, in one or two plain sentences (household language where that's natural).
  2. Its shape: the main functions/components, and what calls what.
  3. Where it talks to the outside: the database queries it runs, the Server Actions it
     calls or exposes, and any client state it owns.
  4. Its failure modes: what happens when the network drops, when the second partner's
     change arrives mid-edit, or when a query comes back empty.
- **Name the file(s)** at the top so the reader can jump straight to the source.
- **Stop when it's enough to change the code safely.** The test is the one from the
  delivery workflow: could a second person read this and build the same change? If yes, it's
  done. Do not keep adding detail just to be thorough — that recreates the expensive
  "read the whole thing" habit this skill exists to replace.

## Where it lives

A throwaway answer in the conversation is fine. But if the slice is likely to be touched
again, or if the explainer surfaced something genuinely non-obvious, note where it should
live so it isn't re-derived: the relevant entry in [docs/practices.md](../../../docs/practices.md)
for a cross-cutting pattern, or an ADR if it turns out to be a decision worth recording.
