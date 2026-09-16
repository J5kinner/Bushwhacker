# Feature spec — Chore Cognitive Load Index (CLI)

- **Date:** 2026-07-17
- **Status:** Design (approved, not yet implemented)
- **Decision record:** [ADR 0003](../../decisions/0003-chore-mental-load-model.md)

## Goal

Score the invisible *mental* load of each HomeSync chore — the anticipating, researching,
deciding, and monitoring around it — as a `0–100` index banded low / medium / high, so the two
partners can see and rebalance hidden labour rather than only visible doing.
Execution time is deliberately **not** an input (see ADR 0003).

## Scope

**In scope:** a data model for the six raw inputs, a pure scoring function, and surfacing the
band + stage breakdown in the Chores tab.

**Out of scope (YAGNI for now):** cross-partner analytics dashboards, historical trend charts,
auto-suggesting a rebalance, and importing chores from third parties.
These may become their own specs later.

## Data model

Neon PostgreSQL via Drizzle ORM.
Store the **raw inputs**, not only the derived score, so weights can be re-tuned without
re-surveying the household.
The derived `cli_score` / `cli_band` are cached for cheap querying and sorting, and recomputed on
every write.

```ts
import { pgTable, uuid, text, smallint, boolean, timestamp } from "drizzle-orm/pg-core";

export const chores = pgTable("chores", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id").notNull(),
  ownerId: uuid("owner_id").notNull(),            // which of the two people owns the thinking
  title: text("title").notNull(),

  // Daminger stage ratings, 0–3 each (CHECK 0..3)
  anticipate: smallint("anticipate").notNull(),
  identify: smallint("identify").notNull(),
  decide: smallint("decide").notNull(),
  monitor: smallint("monitor").notNull(),

  // amplifiers
  invisible: boolean("invisible").notNull().default(false),      // inv 0/1
  fragmentation: smallint("fragmentation").notNull().default(0), // frag 0–2

  // derived, cached; recompute on write
  cliScore: smallint("cli_score").notNull(),                     // 0–100
  cliBand: text("cli_band", { enum: ["low", "medium", "high"] }).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Add CHECK constraints in the migration: `anticipate`/`identify`/`decide`/`monitor` `BETWEEN 0 AND 3`,
`fragmentation BETWEEN 0 AND 2`, `cli_score BETWEEN 0 AND 100`.

## Scoring function

Pure, deterministic, no I/O — trivially unit-testable against the worked examples in ADR 0003.
Keep the weights and thresholds in one exported constant object so a re-weighting is a one-line
change shared by the write path and any SQL backfill.

```ts
export const CLI_WEIGHTS = { A: 0.30, I: 0.20, D: 0.15, M: 0.35 } as const;
export const CLI_AMP = { invisible: 0.15, fragmentation: 0.10 } as const;
export const CLI_BANDS = { lowMax: 33, mediumMax: 66 } as const;

export interface ChoreLoadInput {
  anticipate: 0 | 1 | 2 | 3;
  identify: 0 | 1 | 2 | 3;
  decide: 0 | 1 | 2 | 3;
  monitor: 0 | 1 | 2 | 3;
  invisible: boolean;
  fragmentation: 0 | 1 | 2;
}

export type CliBand = "low" | "medium" | "high";
export interface CliResult { score: number; band: CliBand; }

export function scoreChoreLoad(input: ChoreLoadInput): CliResult {
  const { A, I, D, M } = CLI_WEIGHTS;
  const raw = A * input.anticipate + I * input.identify + D * input.decide + M * input.monitor;
  const stageScore = (raw / 3) * 100; // each input maxes at 3
  const amplified =
    stageScore *
    (1 + CLI_AMP.invisible * (input.invisible ? 1 : 0)) *
    (1 + CLI_AMP.fragmentation * input.fragmentation);
  const score = Math.min(100, Math.round(amplified));
  const band: CliBand =
    score <= CLI_BANDS.lowMax ? "low" : score <= CLI_BANDS.mediumMax ? "medium" : "high";
  return { score, band };
}
```

## UI

- On each chore in the **Chores** tab, show a small band chip (low / medium / high) — colour-coded,
  never a raw leaderboard of one partner vs the other.
- Tapping the chip reveals the **stage breakdown** (which of anticipate / identify / decide /
  monitor drove the score, plus the amplifiers) so "why is this high?" is always answerable.
- Ratings are collected on the create/edit chore form as four `0–3` pickers plus the two
  amplifier toggles, with the short anchor text from ADR 0003 as helper copy.
- `frequency`/recurrence, if the chore has a recurrence rule, is a *separate* equity signal — it is
  **not** folded into CLI (CLI is mental load, not cadence).

## Edge cases and rules

- The **owner's self-rating is authoritative.** The partner may add their own perception, but does
  not silently overwrite the owner's; if both are captured, surface the divergence rather than
  averaging it away.
- Either partner can flag a rating as **disputed**, which shows on the chip.
- Recompute `cliScore`/`cliBand` on every write to any raw input.

## Acceptance criteria

1. `scoreChoreLoad` reproduces ADR 0003's worked examples: bins → 10 (low), vet → 100 (high),
   meal-planning → 97 (high).
2. Raw inputs are persisted; the score/band are derived, never hand-set.
3. Changing a weight constant changes stored scores only after a recompute/backfill, with no schema
   change.
4. The Chores tab shows the band chip and, on tap, the stage breakdown.
5. Execution time never influences the score.

## Caveats

Carried from ADR 0003: the weights and thresholds are reasoned defaults (not empirically fitted)
and need calibration on real data; self-report bias and cross-partner underestimation are expected;
the score is a rebalancing conversation-starter, not a scoreboard; and the underlying research
generalises from different-gender couples with children, so applying it here is reasonable but
unvalidated.

## References

See ADR 0003 for the full citation list (Daminger 2019; NASA-TLX; Reich-Stiebert 2023;
Rubinstein 2001; Monk 2008; Warm 2008; Barigozzi 2025; Ciciolla & Luthar 2019; Walzer 1996).
