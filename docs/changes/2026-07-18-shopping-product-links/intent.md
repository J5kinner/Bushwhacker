# Product links on shopping items — intent

- **Date:** 2026-07-18
- **Status:** reconstructed

> Reconstructed on 2026-09-16 from [spec.md](spec.md) and [plan.md](plan.md), after the fact.
> It records what we can tell we wanted, not a document that existed at the time.

## Problem

Sometimes it matters which exact product to buy, not just "shampoo".
The natural thing is to paste the link to it, but pasting a link makes the whole URL the item's name — it wraps over several lines and pushes the list sideways on a phone.

## Desired outcome

Pasting a product link into the add box adds a normally-named item that carries the link, shown small enough not to disturb the list, and tappable at the shops to see exactly what was meant.

## Who it is for

Whoever is adding the item, usually at home on the couch; and whoever is at the shops, needing to check they have the right thing.

## Constraints

- Pasting a link must stay a single paste — no separate link field to fill in.
- The list must never scroll sideways on a phone.

## Out of scope

- Editing a link on an existing item — delete the item and add it again.
- More than one link per item.
- Fetching the site's favicon, title, price, or any preview of the page.
