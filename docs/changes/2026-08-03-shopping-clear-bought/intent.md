# Clear bought items — intent

- **Date:** 2026-08-03
- **Status:** reconstructed

> Reconstructed on 2026-09-16 from [spec.md](spec.md), after the fact.
> It records what we can tell we wanted, not a document that existed at the time.
>
> This chain has **no plan.md**.
> The change was small enough that the spec was implemented directly.
> Left as it is rather than writing a plan for work already shipped.

## Problem

Items we have already bought stay on the shopping list forever.
After a shop there are a dozen ticked items sitting there, and the only way to get rid of them is to tap the bin on each one.
This is the most annoying thing about the app day to day.

## Desired outcome

After a shop, one action clears everything already bought and leaves the list showing only what is still needed.
It is hard to do by accident, because clearing the wrong thing means retyping it in the supermarket.

## Who it is for

Both of us, standing in the kitchen or at the checkout, one-handed, straight after shopping.

## Constraints

- Must work on a phone with one thumb.
- Must not need a dialog or a new screen — the list is the whole interface.
- Must be safe against a mis-tap without being annoying to confirm.

## Out of scope

- Undo after clearing.
- An archive or history of what was bought.
- Clearing a single category rather than the whole list.
