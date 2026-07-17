# Practices

How we build HomeSync.
This is the detail behind the conventions in [AGENTS.md](../AGENTS.md); read that first.

## Mobile-first UI

- Design for a phone held in one hand, then scale up — never the reverse.
- Use Tailwind's mobile-first classes: unprefixed utilities are the phone layout;
  add `sm:`/`md:` only to adapt upward.
- Primary navigation is a bottom tab bar (Shopping, Calendar, Chores, Settings) using Lucide icons,
  sized for a thumb.
- Keep tap targets large, contrast high, and interactions single-handed.

## Data and mutations

- The database is **Neon serverless PostgreSQL**, accessed through **Drizzle ORM** — it is the
  backend of record.
  Data and state come from the database, not from hard-coded values in the client.
- All mutations go through **Server Actions**, not ad-hoc client fetches.
- Schema lives in Drizzle table definitions.
  Store raw inputs, not just derived values, so a formula or weight can change without a data migration.

### Migration discipline

1. Change the Drizzle schema.
2. `pnpm drizzle-kit generate` to produce the SQL migration.
3. **Read the generated migration** before applying it — confirm it does only what you intended.
4. `pnpm drizzle-kit migrate` to apply.
5. Never hand-edit an already-applied migration; add a new one.

## Optimistic UI

- The shopping list and chores must feel instantaneous on cellular data.
- Apply the change to local state immediately, fire the Server Action, and reconcile on the response.
- On failure, roll the optimistic change back and surface a non-blocking error.
- Keep the optimistic update and the server truth in one place so they cannot drift.

## Authentication

- Auth is scoped to the **two** household accounts — this is not a multi-tenant product.
- Prefer a simple, secure mechanism (password or magic-link); do not build role systems or
  invitations that YAGNI rules out.

## PWA

- Ship a `manifest.json` and a service worker so HomeSync installs via "Add to Home Screen"
  and runs standalone.
- Verify the installed standalone experience on a real device, not just desktop Chrome.

## Verification before "done"

A task is not done until you have shown proof:

- `pnpm run build` compiles.
- `pnpm run lint` passes.
- Type-checking passes.
- Database queries for the change actually succeed.

Paste the relevant command output into the PR.
Claims of success without evidence do not count.

## Recording decisions

When a change involves a real architectural choice (a data model, a third-party dependency, a
cross-cutting pattern), record it as an ADR under [decisions/](decisions/) using the
[template](decisions/0000-adr-template.md).
Keep ADRs short: context, decision, consequences.
