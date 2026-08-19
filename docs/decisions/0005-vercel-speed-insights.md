# 0005. Vercel Speed Insights, and why not Web Analytics

- **Status:** Accepted, amended 2026-08-19 (see [Amendment](#amendment-2026-08-19-page-views-are-in-after-all))
- **Date:** 2026-08-07

## Context

HomeSync runs on Vercel as an installed PWA and is used by exactly two people on their phones.
We had no visibility into real-world performance.
Two recent performance commits — `e18efd1` (tab switching) and `396fd59` (tagged cache and live refresh) — were both merged on reasoning alone, with no field measurement to confirm they helped on cellular.
That is the gap worth closing.

We evaluated Vercel's two first-party telemetry packages.
They answer very different questions, and only one of them earns its place here.

### What each package collects

**`@vercel/speed-insights`** collects Core Web Vitals from real devices: LCP, CLS, INP, FCP, TTFB.
Each data point carries the metric value plus the resolved route (`/shopping`, not the raw URL), and coarse dimensions Vercel derives from the request — device type, browser, operating system, and country.
It sets no cookie, assigns no persistent visitor id, and does not fingerprint.

**`@vercel/analytics`** collects page views and, on paid plans, custom events.
A page view records the route, referrer, and the same coarse device/browser/OS/country dimensions.
Visitors are counted with a daily-rotating hash rather than a cookie or a stored identifier, so there is no cross-day tracking and no advertising profile.

### Confirmed plan limits

Taken from Vercel's pricing documentation, not from memory.

| | Hobby included | Reporting window | Custom events |
| --- | --- | --- | --- |
| Speed Insights | 10,000 events / month, **one project only** | **7 days** | n/a |
| Web Analytics | 50,000 events / month | 1 month | **Not available on Hobby.** Pro only, and capped at **2 properties** per event even there. |

Neither cap is remotely near for two users.

### The decisive constraint

For a two-person household, aggregate page views are close to worthless — we already know who used the app and when.
The only genuinely useful thing Web Analytics could tell us is *when something broke*, and custom events are exactly the capability the Hobby plan withholds.
On Hobby, `@vercel/analytics` would ship two deferred scripts and a `track()` API that silently discards everything, which is worse than no monitoring because it looks like monitoring.

A privacy constraint applies to whatever we do send.
HomeSync contains household data — what we buy, what we eat, what needs doing.
Route names and Web Vitals are safe.
Item names, recipe titles, pasted URLs, calendar entries, and email addresses are not.

## Decision

**Install `@vercel/speed-insights` only.**
It is mounted in `app/layout.tsx` via the App Router entrypoint `@vercel/speed-insights/next`, outside the session branch so the sign-in page is measured too.
It is free at our scale and directly answers "did that performance work help on a real phone on real cellular".

**`@vercel/analytics` is deliberately not installed.**
We are on Hobby and not upgrading, so it would deliver nothing.

> **Amended 2026-08-19.** This paragraph no longer holds — the package *is* now installed,
> for page views only. See the [amendment](#amendment-2026-08-19-page-views-are-in-after-all) below.

Enabling the product is a dashboard toggle, not a code change: Vercel dashboard → **Speed Insights** in the sidebar → select the project → **Enable**, then redeploy.
The component sits idle until that toggle is flipped.

### Service worker

`public/sw.js` skips any request under `/_vercel/`.
The telemetry beacons are POSTs and already bypassed the GET-only cache, but the loader script
(`/_vercel/speed-insights/script.js`) is a same-origin GET and was being written into the offline cache.
Excluding it keeps telemetry out of a household device's cache, and avoids the offline fallback
answering a script request with the `/shopping` HTML document — which as a reply to a script request
is only a console parse error.

One maintenance trap: Vercel also exposes this script under a project-specific `/<unique-path>/*`
alias for sites that need to dodge ad blockers.
We do not set `scriptSrc`, so the package requests the `/_vercel/` path and the guard matches.
If we ever switch to the unique-path alias, the guard must be updated to match it.

## Designed but not implemented: custom events

This analysis is retained deliberately.
The two events below were designed and briefly implemented before the Pro-only limitation was confirmed, then removed.
Recording them here means they are cheap to reinstate if we ever move to Pro, and it records the three we rejected so nobody re-proposes them.

**Would be instrumented** — both from the client, both about failures that are otherwise invisible, both within the 2-property Pro ceiling:

| Event | Properties | Decision it would inform |
| --- | --- | --- |
| `recipe_import` | `outcome`, `reason` | Whether the RecipeTin scraper in `lib/recipe-import.ts` has rotted. It parses a third party's HTML, so it will eventually break silently; a run of failures sharing one `reason` is the signal to go and fix the parser. |
| `shopping_action_failed` | `action` | Whether the optimistic UI actually holds up on cellular. A rolled-back optimistic update is easy to miss on a phone. Zero events would mean offline queueing and retries stay unbuilt — a YAGNI guard, not a feature request. |

Only failures would be tracked on the shopping path; a successful add tells us nothing and would burn event budget.

**Rejected, and why:**

- **Tab-switch timing.** Speed Insights already reports INP and per-route performance, which is what commit `e18efd1` was trying to improve. A hand-rolled duration event would duplicate it, less accurately.
- **`LiveRefresh` poll volume.** The 15-second poll is the app's largest source of function invocations, and its cost is a real question — but emitting an event per poll would make it the highest-volume event in the app and defeat its own purpose. Vercel's function-invocation metrics and Neon's compute dashboard already show this for free.
- **`clear_bought` with item count.** Interesting, not decision-informing. Two users already know how they shop.

**Privacy rules, if these are ever reinstated:**

- Never send item names, recipe titles, category names, calendar text, or email addresses.
- Never send a pasted URL. `recipe_import`'s `reason` must be one of our own fixed `RecipeImportError` strings, not the user's input.
- `shopping_action_failed`'s `action` is only the mutation kind: `add`, `toggle`, `delete`, or `clear`.

## Consequences

Performance regressions become measurable instead of anecdotal, and the next performance change can be justified with field data rather than reasoning.
The cost is one deferred third-party script on every page load, which itself consumes a little data transfer and counts as edge requests.

The package collects nothing in development, so local work is unaffected and the dashboard stays clean.

What will need revisiting:

- The **7-day Hobby reporting window** means a regression must be noticed within a week. There is no long-term trend line, so a slow drift over months will be invisible. If that becomes a problem, the options are Pro (30 days) or exporting the numbers ourselves.
- Speed Insights on Hobby covers **one project only**. A second Vercel project would have to share or go without.
- If we ever move to Pro, revisit the custom-event section above rather than redesigning it.

## Amendment 2026-08-19: page views are in after all

The original decision rejected `@vercel/analytics` outright.
That rejection rested on one judgement — that aggregate page views are "close to worthless" for a
two-person household — and on one hard fact: custom events are Pro-only.

The fact still stands and is unchanged.
The judgement has been overridden by the product owner, who explicitly wants to know which
feature/tab is most used.
Page views answer exactly that question, and they are available on Hobby.

**`@vercel/analytics` is now installed and `<Analytics />` is mounted in `app/layout.tsx`,
beside `<SpeedInsights />` and outside the session branch for the same reason.**

Two constraints carry over unchanged and are not negotiable:

- **No `track()` calls anywhere.** On Hobby, `track()` is a no-op that silently discards.
  Shipping calls that look like instrumentation but record nothing is worse than no
  instrumentation, which was the original ADR's strongest argument and remains correct.
  The two designed-but-unimplemented events above stay unimplemented.
- **The privacy rules are unchanged.** Page views record the resolved route only. No item names,
  recipe titles, pasted URLs, calendar text, or email addresses.

### The event-budget trap this opens

Hobby allows 50,000 events per month, shared across every project on the account, and collection
**pauses for 7 days** once the cap is hit — it does not merely stop billing.

`LiveRefresh` polls `router.refresh()` every 15 seconds while the app is foregrounded.
If that were to register a page view, two phones with the app open for a few hours a day would
generate several hundred thousand events a month and blow the cap many times over.

It does not.
Verified by reading the installed package rather than by assuming: in
`@vercel/analytics/dist/next/index.js`, the page view fires from a `useEffect` whose dependency
array is `[props.route, props.path]`, both derived from `usePathname`/`useParams`.
`router.refresh()` re-renders the current route without changing either, so the dependencies stay
referentially equal and the effect does not re-fire.

This is worth re-checking on any `@vercel/analytics` upgrade: it is an internal implementation
detail, not a documented guarantee, and the failure mode is silent — the bill is not the symptom,
a month of missing data is.

**Anyone changing `LiveRefresh` to navigate rather than refresh must re-check this.**

### The reporting window is still the weak point

Web Analytics gives a 1-month window on Hobby; Speed Insights gives 7 days.
Neither is a trend line, and Speed Insights data cannot be exported on Hobby at all — Drains are
Pro-and-above, and there is no public read API.

That gap is closed separately by self-collected Web Vitals stored in our own Neon database
(ADR 0008), which is not subject to anyone's retention window.
Vercel's dashboards remain the convenient view; our table is the durable record.
