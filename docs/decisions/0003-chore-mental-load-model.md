# 0003. Chore mental-load model (Chore Cognitive Load Index)

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

HomeSync's chores feature should help two people share the household fairly.
The hard part of fairness is not the visible *doing* of a chore but the invisible *thinking*
around it — noticing a need, researching options, deciding, and tracking it to completion.
This "mental load" is well studied.

[Daminger (2019)](https://journals.sagepub.com/doi/10.1177/0003122419859007) decomposes household
cognitive labour into four stages: **anticipate, identify, decide, monitor**, and finds the
anticipate and monitor stages are the most invisible and the most unevenly carried.
Crucially, [Barigozzi et al. (2025)](https://arxiv.org/abs/2505.11426) find that perceived
responsibility for *managing* tasks predicts the within-couple gap far better than execution time
does — so a model based on minutes would measure the wrong thing.

## Decision

Adopt the **Chore Cognitive Load Index (CLI)** — a per-chore score in `0–100`, banded
low / medium / high, that scores mental load and **deliberately excludes execution time**.

It scores Daminger's four stages (each rated `0–3` by the chore's owner), combines them with a
fixed-weight, [NASA-TLX](https://doi.org/10.1016/S0166-4115(08)62386-9)-style weighted average,
then applies two evidence-based amplifiers.

```
RawStage   = 0.30·A + 0.20·I + 0.15·D + 0.35·M          (A,I,D,M each 0–3)
StageScore = (RawStage / 3) · 100
CLI        = round( min(100, StageScore · (1 + 0.15·inv) · (1 + 0.10·frag)) )
```

| Input | Meaning | Weight | Grounding |
| --- | --- | --- | --- |
| **A** anticipate | foreseeing the need unprompted | 0.30 | Daminger 2019 |
| **I** identify | researching options | 0.20 | Daminger 2019 |
| **D** decide | choosing (couples share this most → lowest weight) | 0.15 | Daminger 2019 |
| **M** monitor | vigilance / chasing to completion | **0.35** | Daminger 2019; [Warm 2008](https://pubmed.ncbi.nlm.nih.gov/18689050/) (vigilance is hard, stressful) |
| **inv** invisibility | work unseen by the partner → ×1.15 | +15% | [Reich-Stiebert 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10148620/) |
| **frag** fragmentation | interrupted / resumed / recurring nag → ×1.10 per level (0–2) | +10–20% | [Rubinstein 2001](https://www.apa.org/pubs/journals/releases/xhp274763.pdf); [Monk 2008](https://pubmed.ncbi.nlm.nih.gov/19102614/) |

**Bands:** `0–33` low · `34–66` medium · `67–100` high.

**Worked examples** (they land where the theory predicts):

- "Take out the bins" — `A1 I0 D0 M0, inv0 frag0` → **10, LOW**.
- "Book & manage a vet appointment" — `A2 I2 D2 M3, inv1 frag2` → `78.3 ×1.15 ×1.20 = 108 → capped` **100, HIGH**.
- "Plan the weekly meals & shopping" — `A3 I2 D2 M2, inv1 frag1` → **97, HIGH**.

The full data model, scoring function, and UI treatment are specified in
[docs/superpowers/specs/2026-07-17-chore-cognitive-load.md](../superpowers/specs/2026-07-17-chore-cognitive-load.md).
Raw inputs are stored (not only the derived score) so the weights can be re-tuned without
re-surveying the household.

## Consequences

- HomeSync can surface the *invisible* half of household labour, so a low-minutes chore like
  meal-planning stops reading as "nothing".
- The stage breakdown explains *why* a chore is heavy, which supports rebalancing conversations.
- **Honest limits and risks:**
  - The weights (`M` highest, `D` lowest), the `0–3` anchors, and the `33/66` thresholds are
    reasoned encodings of the qualitative findings, **not empirically fitted** — calibrate against
    real HomeSync data before treating them as authoritative.
  - Self-report bias is real, and partners systematically *underestimate* each other's mental
    load ([Barigozzi 2025](https://arxiv.org/abs/2505.11426);
    [Ciciolla & Luthar 2019](https://link.springer.com/article/10.1007/s11199-018-1001-x)) —
    so treat the owner's self-rating as authoritative and consider capturing both perceptions to
    surface the gap rather than averaging it away.
  - A per-chore number can become a scoreboard in a two-person relationship.
    Present CLI as a conversation-starter with its stage breakdown, not a leaderboard, and let
    either person flag a rating as disputed.
  - The underlying research is drawn largely from different-gender couples with children;
    applying it to any two-person household is a reasonable but unvalidated extension.
