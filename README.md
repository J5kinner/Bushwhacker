# Bushwhacker

Repository for **HomeSync** — a lightweight, mobile-first PWA for a two-person household to
manage daily life: a shared shopping list, a shared calendar, and shared chores.

**Stack:** Next.js (App Router, TypeScript) · Neon PostgreSQL via Drizzle ORM ·
Tailwind CSS + shadcn/ui + Lucide · deployed on Vercel as an installable PWA.

HomeSync is single-household by design: one `households` row, two members, and an email
allowlist instead of sign-ups.
That shapes the setup below — you point the app at *your own* Neon database and *your own*
Google OAuth client, then seed yourself in as a member.

---

## Local setup

Follow these steps in order.
The whole thing takes about fifteen minutes, most of which is clicking through Google Cloud.

### 1. Prerequisites

**Node.js 26.**
This README was verified against Node `v26.7.0`.
Check yours:

```bash
node -v
```

**pnpm.**
Install it directly — on macOS:

```bash
brew install pnpm
```

Elsewhere, use [pnpm's standalone installer](https://pnpm.io/installation).
Then verify:

```bash
pnpm -v
```

**Do not worry about matching a specific pnpm version.**
[`package.json`](package.json) pins `"packageManager": "pnpm@10.28.2"`, and pnpm 10 and later
read that field and switch themselves to the pinned version automatically.
So a newer pnpm installed system-wide still runs 10.28.2 inside this repo — Homebrew currently
ships pnpm 11, and `pnpm -v` here reports `10.28.2`.
That mismatch is the mechanism working as intended; there is nothing to downgrade.

<details>
<summary>Optional: using Corepack instead</summary>

Corepack also honours the `packageManager` field, so `corepack enable pnpm` is a fine
alternative if you already use it to manage package managers.
It is not required for this repo, and recent Node releases no longer bundle it, so a plain
pnpm install is the simpler path.

</details>

You will also want a **Neon** account (the free tier is plenty) and a **Google Cloud** project
for OAuth.
Both are set up in step 3.

### 2. Clone and install

```bash
git clone https://github.com/J5kinner/Bushwhacker.git
cd Bushwhacker
pnpm install
```

`pnpm install` prints a warning that build scripts for `esbuild` were ignored.
That is expected and harmless — pnpm blocks postinstall scripts by default, and nothing in
HomeSync needs esbuild's.

### 3. Environment variables

Copy the template and fill it in:

```bash
cp .env.local.example .env.local
```

`.env.local` is gitignored and must never be committed.
Every variable below is read from it — by Next.js at runtime, and by
[`drizzle.config.ts`](drizzle.config.ts) and the `scripts/*.mjs` helpers via `dotenv`.

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon dashboard → your project → **Connection Details**. Take the **pooled** connection string (its host contains `-pooler`) and keep the `?sslmode=require` suffix. HomeSync talks to Neon over HTTP from serverless functions, so the pooled endpoint is the right one. |
| `AUTH_SECRET` | Generate it yourself: `openssl rand -base64 33`. Any random value works; it only has to stay stable, since changing it invalidates existing sessions. |
| `AUTH_GOOGLE_ID` | Google Cloud Console → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → application type **Web application**. See the redirect URI note below. Copy the generated **Client ID**. |
| `AUTH_GOOGLE_SECRET` | The **Client secret** from the same OAuth client. |
| `ALLOWED_EMAILS` | You choose these — a comma-separated list of the Google account emails allowed to sign in, e.g. `you@gmail.com,partner@gmail.com`. [`auth.ts`](auth.ts) rejects every other account, so an empty value locks everyone out. Matching is case-insensitive. |
| `SEED_MEMBERS` | You choose these — comma-separated `Name:email` pairs, e.g. `Jane:jane@gmail.com,Sam:sam@gmail.com`. Consumed only by the seed script in step 5. **The emails must match `ALLOWED_EMAILS`** — see the warning there. |

On the Google OAuth client, add these two entries before saving.
The field names below are the console's own labels, spelled the way they appear on screen:

- **Authorized JavaScript origins:** `http://localhost:3000`
- **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google`

That redirect path is not arbitrary — it is where Auth.js mounts its Google callback via
[`app/api/auth/[...nextauth]/route.ts`](app/api/auth/%5B...nextauth%5D/route.ts).
Get a character wrong and Google returns `redirect_uri_mismatch`.

You do **not** need to set `AUTH_URL`; [`auth.ts`](auth.ts) sets `trustHost: true`.

There is one further optional variable, `HOUSEHOLD_NAME`, which names the household row the
seed script creates and defaults to `Home`.
**It is deliberately absent from `.env.local.example`, so do not go looking for it there** —
add the line yourself only if you want a household name other than `Home`.

### 4. Apply the migrations

```bash
pnpm db:migrate
```

This runs `drizzle-kit migrate`, which reads `DATABASE_URL` from `.env.local` and applies
every SQL file in [`db/migrations/`](db/migrations) to your database.
Run it against a brand-new Neon project and you get the full schema in one go.

Production applies the same migrations during the Vercel build — see
[ADR 0004](docs/decisions/0004-database-migrations-on-deploy.md).

### 5. Seed your household

```bash
node scripts/seed.mjs
```

There is no `pnpm` alias for this one; call it with `node` directly.

[`scripts/seed.mjs`](scripts/seed.mjs) loads `.env.local`, parses `SEED_MEMBERS` into
`Name`/`email` pairs, and then:

1. creates the single `households` row (named `HOUSEHOLD_NAME`, or `Home`) if none exists;
2. walks your `SEED_MEMBERS` list against the existing `users` rows **in creation order**,
   updating the name and email of each row that already exists and inserting the extras;
3. prints the resulting member list.

It is safe to re-run — that is how you rename a member or correct a typo'd email.
With `SEED_MEMBERS` unset it exits with an error rather than guessing.
Because `users.email` is unique, pointing two members at the same address will fail.

> **The seed is only "optional" in the sense that the app boots without it.**
> Read paths degrade gracefully to an empty state, but every write goes through
> `requireHouseholdId()` and `requireCurrentUserId()` in [`lib/household.ts`](lib/household.ts),
> which map your *session email* to a `users` row.
> If the signed-in address is not a seeded member you can sign in and see the UI, but adding a
> shopping item throws "Signed-in account is not a household member".
> In practice: seed the same addresses you put in `ALLOWED_EMAILS`.

### 6. Run it

```bash
pnpm dev
```

Open <http://localhost:3000>.
`/` redirects to `/shopping`, and anything unauthenticated redirects to `/signin`, where the
only control is **Continue with Google**.
Sign in with an address from `ALLOWED_EMAILS`; anything else is bounced with "That account
isn't on the household allowlist."

`/settings` shows whether the database is connected, which is the quickest confirmation that
`DATABASE_URL` is being read.

---

## Scripts

Every script in [`package.json`](package.json):

| Script | When to reach for it |
| --- | --- |
| `pnpm dev` | Day-to-day development. Starts Next.js on port 3000 with hot reload. |
| `pnpm build` | Production build. Also the fastest full type-check of the repo, and it runs without any environment variables — useful for confirming a clone compiles before you have a database. |
| `pnpm start` | Serves the output of `pnpm build`. Reach for it when you need production behaviour locally, most notably the service worker (see the PWA section). |
| `pnpm lint` | ESLint over the repo. Silence means clean. |
| `pnpm test` | Runs the Node test runner over `lib/*.test.mts` — pure unit tests for link parsing and recipe import, no database required. |
| `pnpm db:generate` | After you change [`db/schema.ts`](db/schema.ts), to generate a new SQL migration. Read the generated file before applying it. |
| `pnpm db:migrate` | Applies pending migrations to the database in `DATABASE_URL`. Step 4 above. |
| `pnpm db:studio` | Opens Drizzle Studio, a browser UI for browsing and editing rows in your Neon database. |

Three helper scripts are not wired to `pnpm` aliases and are run with `node`:

| Command | What it does |
| --- | --- |
| `node scripts/seed.mjs` | Seeds or re-syncs the household and its members from `SEED_MEMBERS` (step 5). |
| `node scripts/db-check.mjs [counts\|insert\|clean]` | `counts` (the default) prints row counts for the core tables; `insert` writes a marked `__VERIFY__` shopping item; `clean` deletes those marked rows again. |
| `node scripts/db-inspect.mjs` | Read-only inventory of the database: tables with row estimates, views, sequences, and enum types. |

---

## Troubleshooting

**The app cannot reach the database.**
Run the connection check first:

```bash
node scripts/db-check.mjs
```

It loads `.env.local` exactly the way the app does and queries Neon directly, which separates
"my connection string is wrong" from "my Next.js code is wrong".
A row count per table means the connection and the migrations are both fine.
An error here means `DATABASE_URL` is missing, malformed, or pointing at a database you cannot
reach — check that you copied the *pooled* string and kept `?sslmode=require`.

**`db:migrate` succeeded but the tables look wrong.**

```bash
node scripts/db-inspect.mjs
```

This prints what actually exists in the `public` schema — tables and approximate row counts,
plus views, sequences, and enum types — so you can compare it against
[`db/schema.ts`](db/schema.ts).
It is read-only and never prints your connection string, so the output is safe to paste into a
PR or an issue.
`db-check.mjs` fails outright on a missing table, so reach for `db-inspect.mjs` when you want
the whole picture instead of one error.

**Google returns `redirect_uri_mismatch`.**
The entry under **Authorized redirect URIs** on the OAuth client must be exactly
`http://localhost:3000/api/auth/callback/google` — right scheme, right port, no trailing slash.

**"That account isn't on the household allowlist."**
The signed-in address is not in `ALLOWED_EMAILS`.
Add it and restart `pnpm dev`, since the allowlist is read from the environment at startup.

**"Signed-in account is not a household member."**
Sign-in worked, but there is no `users` row for that address.
Add it to `SEED_MEMBERS` and re-run `node scripts/seed.mjs`.

**Lists are empty and saving is disabled, with an amber banner.**
`DATABASE_URL` is not set at all.
The app is deliberately built to boot without it rather than crash, so this is the expected
unconfigured state, not a bug.

---

## Testing the PWA on a phone

The service worker is registered **in production builds only** —
[`components/sw-register.tsx`](components/sw-register.tsx) gates registration on
`NODE_ENV === "production"` so that dev is not fighting a cache.
`pnpm dev` will therefore never give you a real install to test.
Browsers also require a secure context, so `http://<your-laptop-ip>:3000` will not register a
service worker even after a production build; it must be `localhost` or HTTPS.

That leaves two workable routes.

**Open a Vercel preview URL on the phone.** This is the normal path for this project — push a
branch, open a PR, and Vercel gives you an HTTPS preview.
It is real HTTPS on a real device with no local networking to arrange.

**Or serve a production build through an HTTPS tunnel.**

```bash
pnpm build
pnpm start
```

Then expose port 3000 through a tunnel that terminates TLS and open the HTTPS URL on the phone.
Sign-in will fail until you add that tunnel origin to the OAuth client under **Authorized
JavaScript origins** *and* add `<tunnel-origin>/api/auth/callback/google` under **Authorized
redirect URIs**.
The same applies to a Vercel preview domain.

Once the page loads over HTTPS:

1. **iOS Safari** — Share → **Add to Home Screen**.
   **Android Chrome** — the ⋮ menu → **Install app** / **Add to Home screen**.
2. Launch from the home-screen icon, not from the browser.

What you are checking, per [`public/manifest.webmanifest`](public/manifest.webmanifest):

- it opens on the shopping list (`start_url` is `/shopping`);
- there is no browser chrome — no URL bar (`display: standalone`);
- it stays portrait and the dark `#0f172a` theme colour tints the status bar;
- the bottom tab bar sits above the home indicator and is comfortable to reach one-handed.

For offline behaviour, load a few tabs, then put the phone in aeroplane mode.
[`public/sw.js`](public/sw.js) is network-first with a cache fallback, so previously visited
pages should still render.
It is intentionally minimal — offline *writes* are not supported.

---

## For contributors and agents

Conventions, workflow, and architecture live in their own documents — this README covers only
getting the thing running.

- **[AGENTS.md](AGENTS.md)** — the single source of truth for conventions and workflow
  (read this first).
- **[docs/practices.md](docs/practices.md)** — how we build.
- **[docs/decisions/](docs/decisions/)** — architecture decision records (ADRs).
- **[.claude/skills/](.claude/skills/)** — the reusable agent workflows.
