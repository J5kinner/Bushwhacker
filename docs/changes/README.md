# Change artifacts

One folder per change, named `YYYY-MM-DD-slug`, holding the artifact chain:
`intent.md` → `spec.md` → `plan.md`.

Each artifact is written for a different reader, which is the whole point of keeping them apart:

- **`intent.md`** — what is annoying and what would make it better, in household language.
  The only record of what was *wanted*, as opposed to what got built.
  Start from [TEMPLATE-intent.md](TEMPLATE-intent.md).
- **`spec.md`** — what we are building and why this shape.
  Real architectural choices are split out as ADRs under [../decisions/](../decisions/).
- **`plan.md`** — which files change, in what order, and what could go wrong.

See the artifact chain section in [AGENTS.md](../../AGENTS.md) for when each one is required, and
[ADR 0013](../decisions/0013-ai-dlc-artifact-chain.md) for why the chain exists.

## Chain completeness

Everything before 2026-09-16 predates this convention.
Those intents were reconstructed after the fact and say so at the top; the two gaps were left as
gaps rather than back-filled with fiction.

| Change | intent | spec | plan |
| --- | --- | --- | --- |
| [2026-07-17-chore-cognitive-load](2026-07-17-chore-cognitive-load/) | reconstructed | ✓ | — not written |
| [2026-07-18-shopping-product-links](2026-07-18-shopping-product-links/) | reconstructed | ✓ | ✓ |
| [2026-08-03-shopping-clear-bought](2026-08-03-shopping-clear-bought/) | reconstructed | ✓ | — not written |
| [2026-08-10-location-tracker](2026-08-10-location-tracker/) | reconstructed | ✓ | ✓ |
| [2026-08-18-shared-calendar-timetree-parity](2026-08-18-shared-calendar-timetree-parity/) | reconstructed | — not written | ✓ |
