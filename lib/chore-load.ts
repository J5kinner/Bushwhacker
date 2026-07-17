/**
 * Chore Cognitive Load Index (CLI).
 *
 * Scores the invisible *mental* load of a chore (0-100, banded low/medium/high)
 * from Daminger's four cognitive-labour stages plus two amplifiers.
 * Execution time is deliberately NOT an input.
 *
 * See docs/decisions/0003-chore-mental-load-model.md and
 * docs/superpowers/specs/2026-07-17-chore-cognitive-load.md.
 *
 * The weights and thresholds are reasoned defaults, NOT empirically fitted.
 * Keep them here so a re-weighting is a one-line change shared by the write
 * path and any SQL backfill.
 */

export const CLI_WEIGHTS = { A: 0.3, I: 0.2, D: 0.15, M: 0.35 } as const;
export const CLI_AMP = { invisible: 0.15, fragmentation: 0.1 } as const;
export const CLI_BANDS = { lowMax: 33, mediumMax: 66 } as const;

export type Rating0to3 = 0 | 1 | 2 | 3;
export type CliBand = "low" | "medium" | "high";

export interface ChoreLoadInput {
  anticipate: Rating0to3;
  identify: Rating0to3;
  decide: Rating0to3;
  monitor: Rating0to3;
  invisible: boolean;
  fragmentation: 0 | 1 | 2;
}

export interface CliResult {
  score: number; // 0-100
  band: CliBand;
}

export function scoreChoreLoad(input: ChoreLoadInput): CliResult {
  const { A, I, D, M } = CLI_WEIGHTS;
  const raw =
    A * input.anticipate +
    I * input.identify +
    D * input.decide +
    M * input.monitor;

  // Each stage input maxes at 3, so raw maxes at 3 -> normalise to 0-100.
  const stageScore = (raw / 3) * 100;

  const amplified =
    stageScore *
    (1 + CLI_AMP.invisible * (input.invisible ? 1 : 0)) *
    (1 + CLI_AMP.fragmentation * input.fragmentation);

  const score = Math.min(100, Math.round(amplified));
  const band: CliBand =
    score <= CLI_BANDS.lowMax
      ? "low"
      : score <= CLI_BANDS.mediumMax
        ? "medium"
        : "high";

  return { score, band };
}
