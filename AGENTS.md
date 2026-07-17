# AGENTS.md

Shared, **tool-neutral** guidance for any AI agent working in this repository —
Claude Code, Cursor, GitHub Copilot, Codex, or otherwise.
This is the single source of truth for the project's conventions and workflow.
Tool-specific entry points (such as [`CLAUDE.md`](CLAUDE.md)) defer here for the shared
rules and add only what is specific to that tool.

## Mission

**Bushwhacker** is the repository for **HomeSync** — a lightweight, highly responsive,
mobile-first web app that helps a two-person household manage daily life: a shared shopping
list, a shared calendar, and shared chores.
It is installed as a Progressive Web App via "Add to Home Screen" and runs on Vercel.

## Agent persona

You are a practical full-stack engineer working in a strict **YAGNI** framework.
Your core strengths are architectural discipline, rapid mobile-first prototyping, and
proactive verification.

## Before you change code

1. Read [docs/practices.md](docs/practices.md) for the "how we build" detail.
2. Follow the [delivery workflow](#delivery-workflow) for any feature, bug, or task.
3. When a change is non-trivial, stress-test the plan before writing code
   (see [`grill-my-plan`](.claude/skills/grill-my-plan/SKILL.md)).

## Engineering conventions

- **Plan before code.** For any task touching more than one file, print a short, bulleted
  implementation plan and wait for confirmation before writing code.
- **Strict minimal scope.** No speculative features, extra columns, or unrequested UI polish.
  Stick to the request. No arbitrary refactoring.
- **Mobile-first.** HomeSync is used primarily on phones as a PWA.
  All UI uses Tailwind mobile-first responsive classes; design for a thumb, then scale up.
- **Clear names and small functions** over clever abstractions; match the existing style.
- **Australian spelling** in all user-facing text, comments, and docs
  (organise, colour, behaviour, prioritise).
- In long Markdown, keep **each full sentence on its own line** to keep diffs clean.
- **Never** commit secrets, tokens, or `.env` contents.
  The Neon connection string lives in `.env.local` and in Vercel's environment settings,
  never in the repository or in chat.

## Tech stack

- **Framework:** Next.js (App Router, TypeScript). Use **Server Actions** for database mutations.
- **Database / ORM:** Neon serverless PostgreSQL via **Drizzle ORM**.
  Always run `pnpm drizzle-kit generate` and review the generated migration files before applying them.
- **UI:** Tailwind CSS + shadcn/ui + Lucide React icons.
  Keep interfaces clean, high-contrast, and tap-friendly.
- **Deployment:** Vercel, as an installable PWA (manifest + service worker).
- **Auth:** simple, secure authentication (password or magic-link) scoped to the two household accounts.

## Git and safety

- Each feature, bug, or change goes on its **own branch**, then a **pull request**.
- **Every commit message** follows [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <summary>`, where `<type>` is one of
  `feat`/`fix`/`docs`/`chore`/`refactor`/`perf`/`test`/`ci`.
  Explain *why* in the body when the summary line alone does not cover it.
- Opening a PR gives you a **Vercel preview URL** — open it on your phone and confirm the
  change before merging.
- **You self-merge** after reviewing your own PR. An agent may push a non-`main` branch and
  open a PR, but does not merge or push directly to `main` — that stays a human action.
- Do not skip hooks or checks unless explicitly asked.

## Delivery workflow

Start any feature, bug, or task with the [`plan-then-build`](.claude/skills/plan-then-build/SKILL.md)
skill.
It is the personal-scale version of a plan/implement split: plan → confirm → branch →
build → verify → PR.
Planning and code live in the same PR here — this is a two-person project, not a company
harness, so there is no separate "plan PR".

Two lighter skills plug into that flow:

- [`grill-my-plan`](.claude/skills/grill-my-plan/SKILL.md) — stress-test a plan before code,
  and record any real architectural decision as an ADR under [docs/decisions/](docs/decisions/).
- [`pr-description`](.claude/skills/pr-description/SKILL.md) — write the PR title and body.

## Cognitive-load metrics

This project uses two research-grounded cognitive-load measures, each documented in an ADR:

- **Reviewer Cognitive Load Index (RCLI)** — estimates how hard a change is to review, used at
  plan time to decide whether to split work across multiple PRs
  ([ADR 0002](docs/decisions/0002-reviewer-cognitive-load-index.md)).
- **Chore Cognitive Load Index (CLI)** — a HomeSync product feature that scores the invisible
  *mental* load of a chore (not its execution time) as low/medium/high
  ([ADR 0003](docs/decisions/0003-chore-mental-load-model.md),
  spec in [docs/superpowers/specs/](docs/superpowers/specs/)).

Both carry the same honest caveat: their weights are reasoned defaults, not empirically fitted
values, and should be calibrated against real data before being treated as authoritative.

## Workflow commands

- Dev server: `pnpm run dev`
- Build: `pnpm run build`
- Lint: `pnpm run lint`
- Generate a migration: `pnpm drizzle-kit generate`
- Apply migrations: `pnpm drizzle-kit migrate`

A task is not "done" until it compiles, passes linting, and its database queries succeed —
show the command output as proof (see [docs/practices.md](docs/practices.md)).
