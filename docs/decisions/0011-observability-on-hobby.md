# 0011. Observability on the Hobby plan

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

[ADR 0005](0005-vercel-speed-insights.md) installed Speed Insights and left two questions open.
Both have now been asked directly, so both need answering.

1. **Which feature actually gets used?**
   Speed Insights cannot answer this — it reports performance, not usage.
2. **Where are we losing performance?**
   Speed Insights reports that `/calendar` has a bad TTFB.
   It never reports *why*, because it measures the browser and the cause is on the server.

The binding constraint is the plan.
HomeSync is on Hobby, and the capabilities that would answer question 2 directly are not on it.

### What Vercel offers, and what Hobby actually gets

Confirmed against Vercel's pricing and tracing documentation on 2026-08-19, not from memory.

| Capability | Package | Hobby |
| --- | --- | --- |
| Core Web Vitals from real devices | `@vercel/speed-insights` | ✅ 10,000/month, **7-day** window, one project |
| Page views | `@vercel/analytics` | ✅ 50,000/month, **1-month** window |
| Custom events (`track()`) | `@vercel/analytics` | ❌ Pro only |
| OpenTelemetry traces | `@vercel/otel` | ❌ Requires Drains, Pro and above |
| Reading your own data back out | — | ❌ No public read API; Drains are Pro and above |

The last row is the one that shapes this ADR.
On Hobby there is no supported way to export Speed Insights data, so the 7-day window is not merely
short — it is lossy.
Data older than a week is gone, and no amount of dashboard discipline recovers it.

## Decision

Three separate mechanisms, because no single one covers both questions.

### 1. Page views answer "what gets used"

`@vercel/analytics` is installed for page views only.
This overrides ADR 0005's rejection of the package; that ADR is amended rather than superseded,
so the original reasoning and the reason for the override both stay readable.

**No `track()` calls anywhere.**
On Hobby `track()` is a silent no-op.
Shipping calls that look like instrumentation but record nothing is worse than shipping none, which
was ADR 0005's strongest argument and is still correct.

### 2. Slow-query logging answers "where are we losing performance"

`lib/timing.ts` wraps every read in `lib/queries.ts`.
Reads at or over `SLOW_QUERY_MS` (default 200) emit one JSON line to the runtime log, filterable as
`evt=slow_query`.

Two properties of this design matter more than the code:

- **The wrappers sit inside `unstable_cache`.**
  A cache hit never reaches them, so what is timed is real Neon work.
  That is the thing worth attributing, and it makes the log volume proportional to cache misses
  rather than to traffic.
- **Query arguments are never logged.**
  A household id, a date window, and a search term are all household data.
  The operation name alone is enough to find the query.

`/api/calendar.ics` additionally emits a real `Server-Timing` header, split into `feed-read` and
`feed-build`, so the browser waterfall distinguishes a slow query from slow serialisation.
This is available only where we construct the `Response` ourselves.
**A server-rendered page cannot set a response header from inside its own render**, and middleware
runs before the render it would need to measure — which is why pages get the log path instead.
This was the one part of the original plan that did not survive contact with the App Router.

### 3. Our own `web_vitals` table answers "what changed over months"

Web Vitals are mirrored into Neon via `useReportWebVitals`, independently of Speed Insights.

This is the only part of the stack not subject to somebody else's retention policy.
Vercel's dashboard stays the convenient day-to-day view; our table is the durable record, and it is
what makes a claim like "the calendar got slower after the time-grid work" checkable three months
later instead of three days later.

`pnpm report:vitals [days]` prints p75 per route per metric against Google's thresholds.

**p75, not mean**, because that is what Core Web Vitals are defined against and because a mean lets
one fast load hide a consistently slow one.

The ingest endpoint is unauthenticated by necessity: `sendBeacon` fires during page unload and
`proxy.ts` excludes `/api` entirely, so there is no session to check, and the sign-in page's own
load performance is worth measuring.
What makes that acceptable is that the body is validated to a fixed shape, the route is rejected
unless it is a clean path, and nothing identifying the caller is stored.
The worst outcome is junk rows in a performance table.

## Consequences

The two questions are answerable, and the 7-day cliff stops being a data-loss event.

What this costs:

- **Two deferred third-party scripts** on every page load instead of one, plus one small beacon per
  metric per page view. Both count toward data transfer and edge requests.
- **A table that grows forever.** Nothing prunes `web_vitals` yet. At two users this is negligible
  for years, and a retention policy is the right thing to add when it stops being negligible —
  not before.

Known limits, recorded so they are not rediscovered:

- **The 200ms threshold is a reasoned default, not a fitted one.** Like the RCLI and Chore CLI
  weights, it should be recalibrated against real data before being treated as authoritative.
  Collecting that data is the point.
- **The rate limit on `/api/vitals` is per-instance and in-memory.** Serverless gives each instance
  its own counter, so it bounds a single runaway client rather than providing a real distributed
  limit. That is the only case that exists at two users.
- **Page views are thin data at this scale.** They will show that Calendar beats Recipes. They will
  not show why, and there is no session or funnel concept to dig with.
- **`LiveRefresh` must not start navigating.** Page views fire on pathname change; `router.refresh()`
  does not change the pathname, which is the only reason the 15-second poll does not blow the
  50,000-event cap. See the amendment in ADR 0005.

If we ever move to Pro, revisit in this order: custom events (ADR 0005 already designs two), then
`@vercel/otel` traces, which would subsume mechanism 2 above with far better attribution.
