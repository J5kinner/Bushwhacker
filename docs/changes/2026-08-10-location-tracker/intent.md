# Location tracker — intent

- **Date:** 2026-08-10
- **Status:** reconstructed

> Reconstructed on 2026-09-16 from [spec.md](spec.md) and [plan.md](plan.md), after the fact.
> It records what we can tell we wanted, not a document that existed at the time.

## Problem

The question we ask each other most often is "are you nearly home?".
Answering it means texting, waiting, and someone reading a phone while driving.
The Chores tab is the one we never open, so there is room for something we would.

## Desired outcome

Opening HomeSync shows where the other person is right now, accurately enough to know whether to put dinner on.

## Who it is for

Both of us, checking on a phone — usually the one at home wondering about the one who is out.

## Constraints

- No app-store fees and no yearly re-signing ritual; HomeSync stays a web app installed to the home screen.
- It must work across one iPhone and one Android.
- It must not noticeably drain either phone's battery.
- Either of us can switch sharing off, and off must mean off — not merely hidden from the screen.
- No history: where someone has been is a different and far more invasive thing than where they are now, and we do not want it stored.

## Out of scope

- A trail, a timeline, or any record of past positions.
- Alerts on arriving at or leaving a place.
- Sharing with anyone outside the two of us.
