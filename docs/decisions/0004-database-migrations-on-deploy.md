# 0004. Database migrations on deploy

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

HomeSync uses Drizzle ORM against Neon serverless PostgreSQL and deploys to Vercel.
Schema changes are captured as versioned migration files (`pnpm db:generate` writes SQL under
`db/migrations/`, `pnpm db:migrate` applies it).
We needed a way to apply those migrations to the deployed database that is automatic, low-friction,
and correct for a serverless target, so that a schema change is nothing more than
"edit the schema, generate the migration, merge".

Three forces matter.

- **Serverless has no single startup.**
  Every route on Vercel is an independent function with many concurrent cold starts, so running
  migrations in the request path would mean many instances racing to migrate the same database.
  Drizzle's guidance is that migrations belong in the deploy pipeline, not at runtime.
- **Ordering must be safe.**
  New code must not serve traffic against an un-migrated database.
  A Vercel deployment is only promoted to its alias after its build succeeds, so running the
  migration inside the build step means the schema is ready before the new code goes live, while
  the previous deployment keeps serving during the build.
- **Previews must not migrate production.**
  The build step runs for preview deployments too, so a preview pointed at the production database
  would apply migrations to it.

We also want to catch the one step that cannot be safely automated away: generating the migration
file.
Auto-generating and applying SQL without a human reading it is how a column gets dropped by
accident, so a person must review the generated SQL — but nothing today stops a schema edit from
being merged without its migration.

## Decision

Apply migrations in the **Vercel build step**, keep migrations **versioned and human-reviewed**,
and guard the generate step in **CI**.

- **Build step.**
  [`vercel.json`](../../vercel.json) sets `buildCommand` to `pnpm db:migrate && pnpm build`.
  `db:migrate` is idempotent — it applies only pending migrations and is a no-op otherwise — so it
  runs harmlessly on every deploy.
  This requires `DATABASE_URL` to be present at build time.
- **Preview isolation via Neon branching.**
  The Neon–Vercel integration injects `DATABASE_URL` per environment and gives each preview
  deployment its own Neon branch, so preview builds migrate an isolated copy of the data rather
  than production.
  This is an account-side setup, not a repository change.
- **CI generate-guard.**
  A `migrations` job in [`ci.yml`](../../.github/workflows/ci.yml) runs `pnpm db:generate` and fails
  if the working tree gains an uncommitted migration, i.e. a schema change was merged without its
  generated SQL.
  `generate` is schema-only and needs no database.
- **Discipline for breaking changes.**
  Backwards-incompatible changes follow expand/contract (parallel change): add the new shape, deploy
  code that writes both, backfill, then remove the old shape in a later change — never rename or drop
  in a single step.
  This keeps the overlap between old and new code during a deploy safe.

## Consequences

- A schema change is now: edit `db/schema.ts`, run `pnpm db:generate`, review the SQL, commit, merge.
  Everything after merge is automatic.
- `DATABASE_URL` must be available to the Vercel build, not only at runtime.
  With the Neon integration this is automatic; set manually otherwise.
- Migrations run on every deploy, including previews.
  With per-preview Neon branches this is isolated; without them, previews sharing the production
  connection string would migrate production, which is the situation the integration exists to avoid.
- If `db:migrate` ever fails against Neon's pooled endpoint, point the build-time `DATABASE_URL` at
  the direct (unpooled) connection string.
- We deliberately did **not** adopt a dedicated, gated CI job that migrates and then triggers the
  deploy.
  It gives stronger control and observability, but the coordination cost (disabling Vercel's
  automatic deploys and ordering migrate-before-deploy ourselves) is not worth it at two-person
  scale.
  Revisit if the team or the blast radius of a bad migration grows.
