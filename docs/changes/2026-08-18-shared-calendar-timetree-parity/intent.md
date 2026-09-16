# Shared calendar — intent

- **Date:** 2026-08-18
- **Status:** reconstructed

> Reconstructed on 2026-09-16 from [plan.md](plan.md), after the fact.
> It records what we can tell we wanted, not a document that existed at the time.
>
> This chain has **no spec.md**.
> The plan was written straight from the feature comparison and carries the design decisions itself, with the substantial ones split out as [ADRs 0006–0010](../../decisions/).
> Left as it is rather than reverse-engineering a spec for work already shipped.

## Problem

We were using TimeTree for the household calendar and HomeSync for everything else, which means two apps, two logins, and the calendar living somewhere we do not control.
HomeSync's own calendar tab is not good enough to replace it, so the split persists.

## Desired outcome

The calendar in HomeSync is good enough that we delete TimeTree — including the parts we were paying for — and the household runs out of one app.

## Who it is for

Both of us, mostly on a phone, checking what is on and adding things as they come up.

## Constraints

- Built on what HomeSync already has: Server Actions, Neon and Drizzle, the existing cache and polling, optimistic UI, the PWA.
- Phones we already own must be able to subscribe to it from their native calendar app, so a plan does not have to live only inside HomeSync.
- Parity is measured against TimeTree's own published feature list, not against a general idea of "a calendar".

## Out of scope

- Multiple separate calendars — the household keeps one, with colour labels doing the categorising.
- Anyone beyond the two of us: no guests, no sharing, no invitations.
