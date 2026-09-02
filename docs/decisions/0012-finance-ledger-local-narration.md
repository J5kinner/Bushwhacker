# 0012. Finance ledger: bank-provided categories, and local-model narration outside the app

- **Status:** Accepted
- **Date:** 2026-09-02

## Context

HomeSync is adding a personal-finance ledger to the Almanac (the renamed Calendar tab): monthly
bank statement CSVs (home loan, savings, credit card — all the same column layout) are imported,
and a locally-run LLM (via LM Studio on a home gaming PC) writes a monthly narrative over the
resulting numbers to help with budgeting.

Two things about this feature don't fit the app's usual shape.

**The bank statement already categorises every row.**
The CSV carries `Category`/`SubCategory` columns filled in by the bank
(e.g. `Retail & Personal` / `Retail (shopping)`) on every line. A rules engine or a
model-categorisation pass would be solving a problem the data doesn't have.

**The model is not reachable from where the app runs.**
HomeSync is deployed on Vercel; the LLM runs on a machine in the household, reachable only as
`http://localhost:1234` on that machine's own network. Vercel's serverless functions cannot open
a connection to it, and exposing an inference endpoint to the public internet (a tunnel) just to
let Vercel call it home once a month is a standing security liability for a feature used a dozen
times a year.

## Decision

**Store the bank's category and subcategory verbatim** on each transaction
(`finance_transactions.category` / `.subcategory`). No `category_rules` table, no
model-categorisation step, no promotion-to-rule UI. If a future statement format arrives without
categories, or the household wants to override the bank's categorisation, that is a separate,
later decision — not one this schema needs to anticipate now.

**Split the pipeline at the network boundary, not through an API route.** CSV upload and parsing
need no model at all — they run as an ordinary Server Action in the deployed app, the same as any
other HomeSync mutation. Only the narrative-writing step needs the local LLM, so that step runs
as a standalone script (`scripts/finance-narrate.mjs`, PR 4) invoked by hand on the household's
own machine. It connects to Neon directly with `DATABASE_URL`, exactly like `scripts/seed.mjs`
already does, computes the month's rollup in SQL, calls LM Studio's OpenAI-compatible endpoint,
and writes the result straight to `finance_analyses`. There is no new HTTP route and nothing new
for Vercel to expose.

**`finance_transactions.dedupe_hash` includes the bank's running balance.** These CSVs carry no
bank transaction id, so a hash of just date + amount + description cannot tell a genuine
duplicate import apart from two separate, coincidentally identical transactions on the same day
(e.g. two $7 purchases at the same shop). The running balance breaks the tie: a true duplicate
import leaves the balance unchanged, while two distinct transactions leave it at two different
values. The hash is unique per account, so re-importing an overlapping statement silently skips
rows already on the ledger instead of double-counting them.

## Consequences

- Categorisation is only as good as the bank's own taxonomy. If it turns out to be too coarse for
  real budgeting, that becomes a follow-up feature (rules or model-assisted reclassification),
  not a gap in this one.
- The monthly narrative is not automatic — running `finance-narrate.mjs` is a manual step on the
  gaming PC. This is an accepted trade for keeping the model entirely off the public internet;
  the ledger itself (import, browsing, goals) works from any device regardless of whether that
  month's narrative has been generated yet.
- `finance-narrate.mjs` needs its own copy of `DATABASE_URL` (from `.env.local`, same as the
  other local scripts) and LM Studio running locally — it has no access to Vercel's environment
  and needs none.
- `metrics_json` on `finance_analyses` is what keeps a stored narrative auditable later: since the
  script can be re-run against a newer model or an edited prompt, the exact numbers behind a given
  summary need to travel with it rather than be re-derived from a ledger that may have changed
  since.
