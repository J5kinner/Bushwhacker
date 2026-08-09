# Vercel preview deployments

What a Vercel preview deployment needs before sign-in works.
Read this when a preview URL signs in fine locally but fails on Vercel.

This document was written from the repository alone — no Vercel dashboard, Google Cloud console, or
runtime log was available.
Everything under [Open questions](#open-questions-for-a-human) is inference and must be confirmed by
someone with dashboard access before it is treated as fact.

## Environment variables

Vercel scopes every environment variable to an environment: Production, Preview, and Development.
A variable ticked for Production only is simply absent in a preview build, and the app cannot tell
the difference between "not set" and "set for the other environment".
All of these must be present for the **Preview** environment (names only — never paste values into
the repository, an issue, or a chat):

- `DATABASE_URL` — the Neon connection string the preview should use.
- `AUTH_SECRET` — Auth.js session/JWT secret.
- `AUTH_GOOGLE_ID` — Google OAuth client id.
- `AUTH_GOOGLE_SECRET` — Google OAuth client secret.
- `ALLOWED_EMAILS` — the comma-separated household allowlist that `auth.ts` checks in its `signIn`
  callback.
  An address missing from this list is denied at sign-in and lands back on `/signin` with
  "That account isn't on the household allowlist".

`SEED_MEMBERS` and `HOUSEHOLD_NAME` are only read by `scripts/seed.mjs`, which runs from a
workstation against a chosen database.
They are not needed by the deployed app.

`auth.ts` sets `trustHost: true`, so Auth.js derives its own base URL from the request host and no
`AUTH_URL`/`NEXTAUTH_URL` needs to be set per preview.

## The preview database must be seeded

Migrations create empty tables.
They do not create a household or its members, so a freshly migrated preview database has zero rows
in `households` and zero in `users`.

Both matter, in different ways:

- **No `households` row.**
  Every table is scoped by `household_id`, so there is nowhere to store anything.
  Reads return empty lists and every write is refused.
- **No matching `users` row.**
  Sign-in still succeeds — the allowlist in `ALLOWED_EMAILS` is what gates it, and it is independent
  of the database.
  But `chores.owner_id` is `NOT NULL`, so a chore cannot be created or ticked off by an account that
  has no member row.
  Email matching is case-insensitive, so a capitalisation difference is not the cause; a genuinely
  different address is.

Both cases now show an amber notice on each page naming the missing step, and the affected writes fail
closed instead of throwing.
They used to throw inside a Server Action, which Vercel returned as a bare HTTP 500 with no
explanation.
So a half-seeded preview is now diagnosable from the phone that hit it, but it is still broken until
it is seeded.

To seed a preview database, point `DATABASE_URL` in your local `.env.local` at that database, set
`SEED_MEMBERS` to the same addresses as `ALLOWED_EMAILS`, and run `node scripts/seed.mjs`.
The script is idempotent: it creates the household if it is missing, then inserts or renames member
rows.

## Preview builds run migrations

`vercel.json` sets the build command to:

```
pnpm db:migrate && pnpm build
```

Every preview build therefore applies the migrations in `db/migrations/` to whatever `DATABASE_URL`
that build was given, before Next.js compiles.
`drizzle.config.ts` reads that variable from the environment (its `dotenv` call finds no `.env.local`
on Vercel and quietly does nothing), so the value the build migrates is exactly the one Vercel
injected for that environment.
Two consequences:

- If the preview's `DATABASE_URL` is unset, the build fails at the migrate step rather than producing
  a broken deployment.
- If the preview's `DATABASE_URL` is the **production** connection string, then every preview build
  migrates the production database — including a build from a branch whose migrations are not ready
  to ship.
  A separate Neon branch or database for previews avoids this.

## Google OAuth redirect URIs are exact-match

Google matches `redirect_uri` against the registered list character for character; there are no
wildcards and no subdomain patterns.
Auth.js sends `https://<host>/api/auth/callback/google`, and with `trustHost: true` that `<host>` is
whatever host the browser used.

Vercel gives each deployment a fresh, per-commit URL (`homesync-<hash>-<scope>.vercel.app`), so the
callback URL changes on every push and cannot all be pre-registered.
A preview reached on a per-commit URL therefore fails at Google's end with `redirect_uri_mismatch` —
before the app runs at all, so no in-app notice can help.

The fix is to reach previews through one stable host and register only that:

- Vercel's branch alias (`homesync-git-<branch>-<scope>.vercel.app`) is stable for the branch, so one
  registered redirect URI covers every build of that branch.
- A custom preview domain (for example `preview.<your-domain>`) aliased to the branch works the same
  way and is easier to keep in the Google client's list.

Either way, register `https://<stable-host>/api/auth/callback/google` as an Authorised redirect URI
on the same OAuth client whose id and secret the Preview environment uses, and open previews via that
host rather than the URL Vercel prints for the individual deployment.

## Open questions for a human

These need dashboard access and were not verifiable from the repository.
Do not treat the guesses above as confirmed until each is answered.

1. **Which variables are actually ticked for Preview in Vercel?**
   The failure described — Google sign-in succeeding, then a 500 — is consistent with `DATABASE_URL`
   being absent or pointing at an unseeded database, but it has not been observed directly.
2. **Does Preview use its own Neon branch, or the production database?**
   This decides both whether seeding is needed per preview and whether preview builds are migrating
   production.
3. **Is a stable preview host registered in the Google OAuth client?**
   If sign-in fails with `redirect_uri_mismatch` rather than a 500, this is the whole problem and the
   database is a red herring.
4. **Do Preview and Production share one OAuth client?**
   If they use different clients, the redirect URI must be registered on the one whose credentials
   Preview holds.
5. **What did the runtime log actually say?**
   The Vercel function log for the failing request names the thrown error and settles which of the
   above it was.
   Nothing in this repository can substitute for that line.

## Known gap

A `DATABASE_URL` that is set but wrong — unreachable host, wrong credentials, or a database whose
migrations never ran — is not covered by the in-app notices.
The query in `getHouseholdId()` throws, the page render fails, and the user still gets a 500.
That case was deliberately left out of the graceful-degradation change, which handles only "connected
but unseeded".
Worth revisiting if it turns out to be what previews actually hit.
