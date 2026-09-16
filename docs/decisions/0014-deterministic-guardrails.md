# 0014. Enforce the two migration rules with hooks rather than prose

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

[ADR 0013](0013-ai-dlc-artifact-chain.md) noted that every control in this repo was advisory.
`AGENTS.md`, `CLAUDE.md`, `docs/practices.md` and the skills all ask politely, and an agent that
misreads or never loads them is not stopped by anything.

Two of those rules are not stylistic preferences.

**Hand-editing an applied migration.** `docs/practices.md` has always said to add a new migration
rather than edit an existing one, because editing applied SQL desynchronises the database from
`db/migrations`. CI's "Migrations in sync" job cannot catch this: it regenerates from
`db/schema.ts` and diffs, so an edit that happens to match the schema passes cleanly while the real
database is something else.

**Applying migrations.** `drizzle.config.ts` loads `DATABASE_URL` from `.env.local`, which is the
production Neon database — [ADR 0004](0004-database-migrations-on-deploy.md)'s preview isolation was
never actually set up. So `pnpm db:migrate` from a dev machine writes production, and so does
`drizzle-kit push`, which skips the migration files altogether.

The playbook's distinction is the useful one: deterministic controls block, advisory controls guide.
These two belong in the first category.

## Decision

Two `PreToolUse` hooks, configured in a tracked `.claude/settings.json` and implemented as small
Python scripts under `.claude/hooks/`:

- **`guard-migration-edit.py`** — `deny` on `Edit`/`Write` to `db/migrations/*.sql`, with the
  reason pointing at the schema-then-generate path instead.
- **`guard-migration-run.py`** — `ask` on any Bash command matching `drizzle-kit migrate`,
  `db:migrate`, `drizzle-kit push` or `db:push`. Deliberately `ask`, not `deny`: the point is that a
  human is made aware a migration is about to run and says yes each time, not that migrations become
  impossible from a session.

`pnpm db:generate` is explicitly not matched — the word boundary in the pattern also keeps the path
`db/migrations` from tripping it, so `git diff db/migrations` still runs freely.

Both fail open. Unparseable hook input exits 0 rather than blocking, because a malformed payload is
not evidence of a dangerous command and a guardrail that wedges every tool call would be removed
within the day.

## Consequences

The `ask` hook is friction on a weekly action, by design. If it becomes annoying enough to route
around — running the migration in a terminal outside the session — that is a signal to fix the real
problem, which is that previews share the production database, not to weaken the hook.

Hooks are read when a session starts, so changing them needs a restart, and a session started
before this landed is unguarded. The rules stay written in `docs/practices.md` for that reason: the
hook is a second line, not a replacement for knowing the rule.

Enforcement is local to Claude Code sessions. A plain terminal, another editor, or a different agent
bypasses all of it. This closes the accident case, not the determined one.

Coverage is deliberately narrow — only the two rules where being wrong is expensive and hard to
undo. Adding a hook per convention would make the config a second rulebook to maintain, out of step
with the prose one.
