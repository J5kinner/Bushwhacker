# Shared calendar — TimeTree-premium parity in the calendar tab

- **Status:** approved 2026-08-18; wave-0 answers recorded at the end of this document.
- **Date:** 2026-08-18.
- **Delivery:** waves of Sonnet builder agents, one PR each, human-merged.

## Goal

Bring the HomeSync calendar tab to feature parity with TimeTree Premium (core + premium tiers) for a two-person household,
using the existing stack: Next.js 16 Server Actions, Neon + Drizzle, tagged cache + `LiveRefresh` polling, optimistic UI, PWA.

The feature set was taken from timetreeapp.com/intl/en/premium and the TimeTree App Store listing on 2026-08-18.

## Feature mapping (the fidelity contract)

### Build

| # | Feature | TimeTree tier |
| --- | --- | --- |
| 1 | Event model v2 — times (all-day vs timed), location, URL, colour label, attendees (you/partner/both), editing, pinned flag | core (+ pin = premium) |
| 2 | Month grid view, improved agenda (day-grouped, today marker, pinned section), view switcher | core |
| 3 | Recurring events — daily/weekly/monthly/yearly, interval, weekday set, until; this-occurrence vs whole-series edit/delete | core |
| 4 | Vertical hourly time-grid view, 3 consecutive days (per the premium page: "up to three consecutive days") | premium |
| 5 | ~~Multiple calendars~~ — **deferred** (wave-0 answer: the household uses one calendar; colour labels carry categorisation; addable later without schema pain) | core |
| 6 | Event comments — per-event thread (deliberately "comments", not "chat"; push provides immediacy) | core |
| 7 | Activity feed — who created/edited/deleted/commented, per-user unread badge | core |
| 8 | Reminders + web push — per-event offset, push to partner on create/edit/comment | core |
| 9 | File/photo attachments on events via Vercel Blob (10MB, images + PDF) | premium |
| 10 | ICS feed export so native phone calendars can subscribe to HomeSync (confirmed in wave 0) | approximates core "sync" |

### Automatic — no work needed

Ad-free; cross-platform (already a web PWA); priority support (n/a); "shared calendar" itself (household scoping exists).

### Skipped or trimmed — the visible deltas from TimeTree

Each of these is a deliberate cut; veto any of them and it moves to Build.

- **Photos inside comment threads** — photos attach to the event instead (attachments PR). Comments are text-only.
- **Multiple reminders per event + daily digest notification** — one offset per event. The digest could later reuse the same sender cheaply.
- **Inbound calendar sync** (showing Google/OS calendar events inside HomeSync) — the ICS option is outbound only (HomeSync → native calendar). Inbound is a large ongoing-maintenance surface.
- **In-app event search** — agenda scrolling covers it at household scale; a client-side filter is a cheap later add.
- **Member colour-coding of events** — attendees show as avatar chips; event colour comes from the label/calendar, not the member.
- **Home-screen widgets** — not available to web PWAs; the ICS feed partially recovers this via the native calendar's own widgets.
- **OCR image-scanning event creation** — needs an OCR/AI service; out of scope.
- **Public calendars** — meaningless for two people.
- **Shared photo albums** — overlaps attachments; HomeSync is not a photo service.
- **Keep/memo** — the shopping tab already covers shared lists; a memo tab would be a separate feature outside the calendar.

## Data model

All changes are additive; existing rows stay valid as all-day events.
One migration per PR, generated with `pnpm db:generate`, SQL read before commit.

**M1 (PR 1a) — event model v2.** `calendar_events` gains:
`start_time time` / `end_time time` (null `start_time` = all-day; no separate boolean),
`location text`, `url text`, `colour text` (named palette value),
`attendee_ids jsonb` typed `string[]` (null = both members),
`pinned boolean not null default false`,
`updated_at timestamp default now not null` with Drizzle `$onUpdate`,
index on `(household_id, start_date)`.

**M2 (PR 4) — recurrence.** `calendar_events` gains
`repeat_freq text` enum `daily|weekly|monthly|yearly` (nullable),
`repeat_interval smallint not null default 1`,
`repeat_weekdays jsonb` typed `number[]` (weekly only),
`repeat_until date`,
`series_id uuid` self-FK — **must** be written as `.references((): AnyPgColumn => calendarEvents.id, { onDelete: "cascade" })` (the explicit return type avoids Drizzle's circular-inference error; cascade is a deliberate deviation from the repo's default no-action FKs),
`original_date date` (set on override rows).
New table `event_exdates(event_id FK cascade, date, primary key (event_id, date))` — relational, not jsonb, so concurrent occurrence-deletes are `INSERT … ON CONFLICT DO NOTHING` instead of a lost-update jsonb race.

**M3 (PR 6) — calendars. DEFERRED per wave 0.** When revived: new `calendars(id, household_id FK, name, colour, created_at)` — no position column, order by `created_at`;
`calendar_events.calendar_id uuid` FK nullable (`onDelete: "set null"`); null = the default calendar, lazy-seeded like shopping categories.

**M4 (PR 7) — comments + activity.** `event_comments(id, event_id FK cascade, author_id FK, body, created_at)`.
`activity(id, household_id FK, actor_id FK, verb text enum created|updated|deleted|commented, event_id uuid nullable — plain uuid, no FK, so history survives event deletion, event_title text snapshot, created_at)` — append-only, written inside each mutating Server Action.
Without this table the promised feed is impossible: `updated_at` cannot attribute who edited, and hard deletes vanish.
`users.activity_seen_at timestamp` nullable.

**M5 (PR 8) — reminders + push.** `push_subscriptions(id, user_id FK, endpoint text unique, keys jsonb, created_at)`.
`calendar_events.reminder_minutes smallint` nullable.
`reminder_log(event_id FK cascade, occurrence_date date, sent_at, unique (event_id, occurrence_date))` — insert-before-send makes the sender idempotent across overlapping/retried ticks and catch-up-safe after missed ones; keyed per occurrence because recurring events remind per occurrence.
`households.timezone text not null default 'Australia/Sydney'` — the sender runs in UTC and cannot turn wall-clock times into instants without an IANA zone (a fixed offset breaks across the October DST change).

**M6 (PR 9) — attachments.** `event_attachments(id, event_id FK cascade, url, pathname, filename, content_type, size, uploaded_by_id FK nullable, created_at)`.

## Design decisions (grilled; these bind the builders)

1. **Time model.** Dates stay canonical (`start_date`/`end_date`); times are optional wall-clock columns; everything renders in device-local time for a single-timezone household.
   **Cross-midnight rule:** `end_time` belongs to `end_date ?? start_date`; a timed event with `end_time <= start_time` and no `end_date` is invalid (server-action validation); the time-grid clamps blocks at midnight; an occurrence's identity is its start date.
2. **Read window + cache contract.** `unstable_cache` caches **raw rows only** (events incl. recurrence masters, plus exdates), keyed by `(householdId, windowStart, windowEnd)` with the window passed in as arguments — **never** computed inside the cached function, or "today" freezes into a cache entry that only a mutation busts.
   The page computes a month-aligned window (first day of last month → +13 months) so cache keys are stable; far navigation goes through a `?m=` search param.
   All "which day is today" logic (today marker, day grouping, past-collapsing, default month) is **client-side** from the device clock — the server clock is UTC and is a day behind an Australian morning.
3. **Recurrence expansion is isomorphic.** `lib/recurrence.ts` is pure and unit-tested (`node --test`): `expandOccurrences(events, exdates, windowStart, windowEnd): Occurrence[]`, where `Occurrence = { event, date, endDate, isOverride, key: "eventId:date" }`.
   It runs in client components from optimistic raw state (never inside a cached function), so the existing `useOptimistic` reducer pattern extends cleanly: the reducer holds `{ events, exdates }` and mirrors server semantics exactly — delete-occurrence appends an exdate, edit-occurrence appends an exdate and inserts a temp override row, series edits update the master.
   Non-recurring rows pass through as identity expansions, so **every view is built against `Occurrence[]` from day one** and recurrence lights up when M2 lands, including in views built in parallel.
4. **Conflict policy is last-write-wins**, hardened one cheap notch: the edit action sends the `updated_at` it loaded and the `UPDATE` includes it in the `WHERE`; zero rows updated returns "this event was just changed — reload". No field merging.
5. **Comments/feed correctness.** Comments flow through server-rendered props (never a one-shot client fetch) so the 15s `LiveRefresh` poll updates an open thread.
   The unread badge is computed outside the household-keyed cache (cached activity rows + per-request read of the user's `activity_seen_at` — never bake one partner's seen state into a shared cache entry).
   Mark-seen is a Server Action that sets `activity_seen_at` to the max `created_at` actually rendered (passed from the client), then busts the activity tag.
6. **Cache-tag matrix.** New tags: `calendars`, `event-comments`, `activity`. Every action busts every tag it touches:
   event add/edit/delete → `calendar-events` + `activity`; occurrence ops → same; comment add → `event-comments` + `activity`; calendar CRUD → `calendars`; mark-seen → `activity`; attachment add/remove → `calendar-events`; reminder/pin/toggle → `calendar-events`.
7. **Reminder sender.** A `CRON_SECRET`-protected route (default Node runtime — `web-push` needs Node built-ins, never `runtime = "edge"`).
   Query: reminder instant ≤ now, within a 24h catch-up lookback, not in `reminder_log`; insert log row first (unique constraint = idempotency), then send.
   Wall-clock → instant conversion uses `households.timezone`.
   Scheduler (decided in wave 0 — the deployment is on **Hobby**): no `crons` entry is ever added to vercel.json (**a sub-daily cron there fails the whole deployment on Hobby**, and Hobby crons are once-daily with hour-level imprecision); instead an external 5-minute pinger (e.g. cron-job.org, free) sends `Authorization: Bearer CRON_SECRET` to the sender route.
   Crons only invoke production; preview verification is a manual `curl` with the header.
8. **iOS push survival rules** (acceptance criteria for PR 8):
   every push handler calls `event.waitUntil(self.registration.showNotification(...))` — a push with no visible notification gets the subscription revoked by Safari (commonly after ~3);
   subscribe only from an explicit user tap inside the installed PWA (an "Enable notifications" control in Settings — never an on-load prompt);
   no reliance on notification action buttons (iOS ignores them);
   the sender deletes `push_subscriptions` rows on 404/410 and the client re-subscribes on app open when permission is granted but no subscription exists.
   Requires iOS 16.4+ and the home-screen install — HomeSync already meets the install half.
   Push is untestable under `pnpm dev` (SW registers in production only): verify with `pnpm build && pnpm start` or the Vercel preview.
9. **Uploads are client-side by necessity, not choice.** Server Actions cap at 1MB by default and Vercel Functions hard-cap request bodies at 4.5MB, so 10MB files must use `upload()` from `@vercel/blob/client` with a `handleUpload()` route that authenticates the session and enforces the size/type allowlist in `onBeforeGenerateToken`, and records the row in `onUploadCompleted` (which does not fire against localhost — verify on the preview).
   Hobby Blob quota (~1GB storage, capped transfer, project pauses rather than bills on overage) is fine for a household; start with images + PDF.
10. **Migrations.** ADR 0004 means migrations run on **every** deploy, previews included — isolation comes from per-preview Neon branches, so wave 0 confirms that integration is actually enabled.
    At most one migration-bearing PR per wave.
    If a rebase ever forces regeneration: `drizzle-kit drop` (or delete the SQL + snapshot + journal entry), rebase onto main, re-run `pnpm db:generate`, re-read the SQL, recommit — owned by the orchestrator, not the finished builder.
11. **New dependencies** (each in an ADR): `date-fns` (grids + recurrence, lands in PR 1a so parallel builders never race on package.json), `web-push` + `date-fns-tz` (PR 8), `@vercel/blob` (PR 9).

## PR breakdown and RCLI forecasts

Estimates use ADR 0002's channels; the original two-PR foundation forecast HIGH (PR 1 ≈ 0.75–0.82; the view-shell PR tripped the D̂ ≥ 0.80 hard-split override), so it is re-split below.
Every PR now forecasts medium or lower; the ~0.55s name their dominant channels in the PR description.

| PR | Scope | Migration | RCLI forecast |
| --- | --- | --- | --- |
| 1a | Schema M1 + hardened actions (add/update/delete scoped by household, `togglePinned`, validation) + plain form gains time/location/url/colour/attendee fields + date-fns + ADR 0005 | M1 | ~0.55 medium (Ŝ, V̂) |
| 1b | Event detail/edit sheet + optimistic edit path (reducer `edit` case) + delete confirm | — | ~0.45 medium (Ĉ) |
| 3 | `lib/recurrence.ts` + tests + frozen `Occurrence` contract + ADR 0006 | — | ~0.35 medium (Ĉ, contained) |
| 2a | Windowed read (`getCalendarWindow`) + agenda regroup (day groups, client-side today, pinned section, bounded past) + view-switcher shell + `?m=` navigation | — | ~0.50 medium (D̂) |
| 2b | Month grid (week-row spanning bars, 3-pill cap + "+n") + tap-day sheet | — | ~0.55 medium (Ĉ) |
| 4 | Recurrence wiring: M2 + repeat options in edit sheet + this-vs-series flows + exdate/override/series actions | M2 | ~0.55 medium (Ĉ, V̂) |
| 5 | 3-day vertical time-grid view (consumes `Occurrence[]`, midnight clamping, overlap columns) | — | ~0.45 medium (Ĉ) |
| 6 | ~~Multiple calendars~~ — deferred per wave 0 | — | — |
| 7 | Comments + activity: M4 + comments section in event sheet + activity writes added to existing actions + feed sheet + unread badge + mark-seen + ADR 0009 | M4 | ~0.55 medium (D̂ — watch it) |
| 8 | Reminders + push: M5 + web-push/VAPID + sender route + sw.js push/notificationclick + Settings enable-notifications + partner-activity push + reminder picker + ADR 0007 | M5 | ~0.55 medium (V̂, platform) |
| 9 | Attachments: M6 + Blob client upload + event-sheet section + ADR 0008 | M6 | ~0.45 medium |
| 10 | Tokened `/api/calendar.ics` feed route (confirmed in wave 0) | — | ~0.30 low |

## Waves (Sonnet builders in isolated worktrees)

Pairs were re-checked for file collisions; the event sheet (PRs 4, 6, 7, 8, 9 all touch it) is never paired with itself, and no wave carries two migrations.
A wave starts only after the previous wave's PRs are merged.

| Wave | Builders | Why safe in parallel |
| --- | --- | --- |
| 0 | none — humans/orchestrator | Done 2026-08-18: answers recorded below; Neon preview-branching check remains on Jonah's checklist |
| 1 | PR 1a | Foundation, solo |
| 2 | PR 1b ∥ PR 3 | Sheet/reducer vs pure lib + tests — disjoint |
| 3 | PR 2a | Rewrites the tab shell — too central to pair |
| 4 | PR 2b ∥ PR 4 | New grid components vs schema/actions/edit-sheet; both consume the frozen `Occurrence` contract |
| 5 | PR 5 ∥ PR 10 | New time-grid component + one switcher line vs a standalone ICS route file |
| 6 | PR 7 | Comments + activity — touches actions and the event sheet, runs solo |
| 7 | PR 8 | Solo — touches sheet, sw.js, Settings, env |
| 8 | PR 9 | Solo — touches the sheet again |

Each builder's diff gets an adversarial Sonnet review pass in the worktree against this plan and house conventions before its PR opens; findings are fixed first.
Parallelism is deliberately modest: Jonah's phone-review gates every wave, so wider fan-out buys conflicts, not wall-clock.

### Builder prompt template (every builder gets)

- Read `CLAUDE.md` → `AGENTS.md` → `docs/practices.md` first (builders run as Claude Code agents inside the worktree, so these auto-load; the prompt repeats the digest anyway: Australian spelling, mobile-first Tailwind, optimistic-UI pattern, Server Actions + tag busting per the matrix, Conventional Commits, **no** AI co-author trailers).
- The PR's scope section from this plan, verbatim, including its migration and ADR ownership.
- A file-ownership manifest: files it may create/touch, files it must not touch.
- The frozen seams: the `Occurrence` type + `expandOccurrences` signature (PR 3), the view-switcher registration point (PR 2a), the event-sheet section slots (PR 1b), the cache-tag matrix.
- Verification: `pnpm run build`, `pnpm run lint`, `pnpm test` where tests exist, migration SQL read and pasted, output included in the PR body (pr-description skill format).
- Branch + PR only — never merge, never push main.

### Environment checklist (Jonah, dashboard-side)

- **Wave 0:** ~~confirm Vercel plan~~ (answered: Hobby); confirm the Neon–Vercel integration has preview branching enabled.
- **Before wave 7:** `npx web-push generate-vapid-keys`; set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), `CRON_SECRET` (`openssl rand -hex 32`) in Vercel env + `.env.local`; blanks added to `.env.local.example`.
  Create the external pinger job (every 5 min, production URL, `Authorization: Bearer` header) — Hobby plan, so no `vercel.json` crons.
- **Before wave 8:** create the Blob store in the Vercel dashboard (auto-creates `BLOB_READ_WRITE_TOKEN`); `vercel env pull` locally.

## ADRs to record

- 0005 — calendar event time model (dates + optional wall-clock times, single-timezone household) and the date-fns dependency (PR 1a).
- 0006 — recurrence storage and read-time isomorphic expansion (PR 3).
- 0007 — reminders and web push: timezone column, `reminder_log` idempotency, scheduler choice, iOS constraints (PR 8).
- 0008 — event attachments via Vercel Blob with client upload (PR 9).
- 0009 — append-only activity table as the feed's source of truth (PR 7).

## Wave-0 answers (recorded 2026-08-18)

1. **Vercel plan:** Hobby — reminders use an external 5-minute pinger against the `CRON_SECRET` route; never add `crons` to vercel.json.
2. **ICS export feed:** build the outbound subscribe feed (PR 10); inbound import stays skipped.
3. **Multiple calendars:** the household uses one — PR 6/M3 deferred; colour labels carry categorisation.
4. **Trims:** no vetoes; the "Skipped or trimmed" list stands as scoped.
