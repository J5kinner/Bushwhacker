# CLAUDE.md

Guidance for **Claude Code** in this repository.

The shared, tool-neutral guidance for every agent — mission, persona, engineering
conventions, git/safety policy, and the delivery workflow — lives in **[AGENTS.md](AGENTS.md)**.
It is the single source of truth and is imported below; read it first.

@AGENTS.md

## Claude Code specifics

- **Skills.** The workflows referenced in [AGENTS.md](AGENTS.md) are implemented as skills
  under [`.claude/skills/`](.claude/skills/). Invoke them by name with the Skill tool:
  - `plan-then-build` — start any feature, bug, or change that touches more than one file.
  - `grill-my-plan` — stress-test a plan or design before writing code.
  - `pr-description` — write a pull-request title and body.
- **Decisions.** Architectural decisions are recorded as ADRs under
  [`docs/decisions/`](docs/decisions/); use the
  [template](docs/decisions/0000-adr-template.md).
- **Specs.** Feature designs live under [`docs/superpowers/specs/`](docs/superpowers/specs/).
