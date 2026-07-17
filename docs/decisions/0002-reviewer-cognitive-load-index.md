# 0002. Reviewer Cognitive Load Index (RCLI) for gating PR size

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

We want pull requests that stay easy to review, and we want a principled way to decide when a
change is too big and should be split into several PRs.

A naive "lines changed" heuristic is a poor proxy: the software-engineering literature is
consistent that **no single metric captures how hard code is to understand**
([Scalabrino et al., 2021](https://doi.org/10.1109/TSE.2019.2901468)), and that **combined**
metrics carry the signal ([Trockman et al., 2018](https://doi.org/10.1145/3196398.3196441)).
Structural complexity, change size, how scattered the change is, new vocabulary, and nesting are
distinct channels of load ([Peitek et al., 2021](https://doi.org/10.1109/ICSE43902.2021.00056);
[Siegmund et al., 2014](https://doi.org/10.1145/2568225.2568252)).

## Decision

Adopt the **Reviewer Cognitive Load Index (RCLI)** — a weighted composite in `[0, 1]` of five
independent, saturating load channels, each derived from a diff / AST / git, and each capped so
no single channel can dominate.

```
RCLI = 0.30·Ĉ + 0.20·Ŝ + 0.25·D̂ + 0.15·V̂ + 0.10·N̂
```

| Channel | Symbol | Weight | Raw signal → normalised term | Grounding |
| --- | --- | --- | --- | --- |
| Structure | Ĉ | 0.30 | `C_raw = Σ max(0, ΔCognitiveComplexity_f)`; `Ĉ = min(1, C_raw / 15)` | [Campbell 2018](https://doi.org/10.1145/3194164.3194186); validated [Muñoz Barón 2020](https://doi.org/10.1145/3382494.3410636) |
| Size / churn | Ŝ | 0.20 | `S_raw = LA + LD`; `Ŝ = log₂(1 + S_raw) / log₂(1 + 400)`, clamped | [Kamei 2013](https://doi.org/10.1109/TSE.2012.70) (log-damps skewed churn) |
| Dispersion | D̂ | 0.25 | `0.5·min(1, NF/10) + 0.5·H_norm`, where `H_norm = (−Σ pₖ·log₂ pₖ) / log₂(NF)` for `NF > 1` else `0` | [Kamei 2013](https://doi.org/10.1109/TSE.2012.70) (diffusion / change entropy) |
| Vocabulary | V̂ | 0.15 | `V_raw = distinct new identifiers`; `V̂ = min(1, V_raw / 40)` | [Halstead 1977]; [Peitek 2021](https://doi.org/10.1109/ICSE43902.2021.00056) (working memory) |
| Nesting | N̂ | 0.10 | `N̂ = min(1, maxNestingDepth_touched / 5)` | [Campbell 2018](https://doi.org/10.1145/3194164.3194186) |

Use **Cognitive Complexity** (Campbell), not McCabe cyclomatic complexity, for the structure
channel — McCabe measures testability, Campbell's metric targets human understandability.
Where no Cognitive Complexity engine exists for a language, a McCabe cyclomatic delta is an
acceptable coarser fallback.

**Bands and action:**

- `RCLI < 0.30` — **low.** Single PR, routine review.
- `0.30 ≤ RCLI < 0.60` — **medium.** Keep as one PR, but name the dominant channel(s) in the PR
  description so the reviewer knows where the load sits.
- `RCLI ≥ 0.60` — **high.** Split into multiple PRs, landed in dependency order, until each child
  scores below `0.60`.
- **Hard-split override:** if `D̂ ≥ 0.80`, split regardless of the total, because extreme
  dispersion defeats segmented review even when each hunk is small.

**How this project uses it (lightweight).**
This is a two-person harness, so RCLI is applied as a **plan-time estimate**, not an automated
gate: when planning a change (see
[`plan-then-build`](../../.claude/skills/plan-then-build/SKILL.md)), estimate the channels from
the plan — how many files, how much new complexity, how scattered — and if the forecast is high
(or dispersion is forecast to saturate), split the work into multiple PRs before starting.
Computing RCLI exactly from a real diff and AST (e.g. tree-sitter for TypeScript) is a valid
future enhancement, but it is optional; the default is a reasoned estimate plus the caveat below.

### Worked example

A discount-code change touching 4 files: `LA = 120, LD = 30` (`S_raw = 150`); `C_raw = 11`;
`NF = 4` with changed-line shares `90/25/20/15`; `V_raw = 18` new identifiers; deepest nesting `3`.

```
Ĉ = min(1, 11/15)                      = 0.733
Ŝ = log₂(151)/log₂(401)                = 0.837
H = 1.592 bits → H_norm = 1.592/2      = 0.796
D̂ = 0.5·min(1, 4/10) + 0.5·0.796       = 0.598
V̂ = min(1, 18/40)                      = 0.450
N̂ = min(1, 3/5)                        = 0.600

RCLI = 0.30·0.733 + 0.20·0.837 + 0.25·0.598 + 0.15·0.450 + 0.10·0.600 = 0.664 → HIGH → split
```

A pure "lines changed" view (150) reads as a routine medium PR; a single-metric complexity view
(`Ĉ = 0.73`) flags it but gives no reason.
RCLI shows the load is *jointly* driven by structure, size, and real dispersion — so splitting
into two smaller, less-scattered PRs is justified.

## Consequences

- We can gate PR size on a principled, multi-channel estimate instead of raw line count.
- The per-channel breakdown is actionable: it names *why* a change is heavy, which guides how to
  split it.
- **Honest limits (from the research, not hand-waving):**
  the weights are reasoned defaults, **not empirically fitted**;
  Cognitive Complexity predicts understandability only about as well as LOC/McCabe
  ([Lavazza et al., 2023](https://doi.org/10.1016/j.jss.2022.111561)), which is exactly why Ĉ is
  capped; and higher reviewer load sometimes *improves* review outcomes for novices
  ([Wurzel Goncalves et al., 2022](https://doi.org/10.1007/s10664-022-10123-8)).
  RCLI is a triage aid, not ground truth.
  The saturation constants (`15, 400, 10, 40, 5`) and the `0.60` threshold belong in a config
  value to be calibrated against our own review data.
