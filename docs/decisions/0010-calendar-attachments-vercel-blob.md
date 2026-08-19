# 0010. Calendar attachments via Vercel Blob

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The shared-calendar TimeTree-parity plan
(`docs/superpowers/plans/2026-08-18-shared-calendar-timetree-parity.md`) calls for file and photo
attachments on events — TimeTree premium's flagship feature.
This is PR 9 of the plan (M6), the final PR of the plan.

Two structural questions had to be settled before writing any of it.

The first is how a 10MB file gets from a phone into storage at all.
HomeSync's mutations go through Next.js Server Actions, and Server Actions cap their own request
body at 1MB by default; a Vercel Function hard-caps a request body at 4.5MB regardless of runtime.
Both limits are well under the 10MB ceiling this feature wants, and both would pass silently under
`pnpm dev` — nothing in local development enforces either cap the way production does — only to
fail the first time somebody actually attaches a real photo on the deployed app.

The second is what happens to the underlying blob when its event (or the attachment itself) is
deleted.
A foreign-key cascade can delete a database row for free; it cannot reach out and delete an object
sitting in a separate object store.

## Decision

**Uploads go client-to-store, never through a Server Action.**
The event sheet (`app/calendar/event-sheet.tsx`) calls `upload()` from `@vercel/blob/client`
directly against the browser's own network connection.
`upload()` first asks `app/api/attachments/upload/route.ts` for a short-lived, scoped client
token, then uploads the file straight to Vercel Blob — neither the Server Action body cap nor the
Vercel Function body cap ever comes into play, because the file itself never passes through either.

**The upload route is its own entire authentication boundary.**
`proxy.ts`'s matcher excludes `/api` entirely, the same as `/api/calendar.ics` and
`/api/reminders/run` before it, so no Auth.js session gate protects this route automatically.
`onBeforeGenerateToken` resolves the caller's session to a household member (`lib/household.ts`)
and confirms the target event belongs to that household before minting a token — an unauthenticated
or cross-household request never gets far enough to upload anything.
The same callback enforces `maximumSizeInBytes: 10 * 1024 * 1024` and an allowlist of common image
types plus `application/pdf`, and scopes the blob's pathname under `events/<eventId>/`, rejecting
any pathname the client tries to request outside that prefix.
The event-sheet's own pre-checks mirror both the size and the type allowlist, purely so an
obviously-bad file fails instantly with a friendly message — the server enforces both for real,
since a client-side check can always be bypassed.

**The `event_attachments` row is written from `onUploadCompleted`, not from the client.**
Vercel's own storage infrastructure calls this callback directly once the upload has actually
landed, which means it does not fire against `pnpm dev` — verifying the row actually gets written
is only possible on a Vercel preview with a Blob store connected.
The callback busts the cache with `revalidateTag(CACHE_TAGS.calendarEvents, { expire: 0 })`, not
`updateTag`.
`updateTag` throws when called from a Route Handler rather than a Server Action, and Next 16's own
thrown message for that case names `revalidateTag` as the replacement.
The `{ expire: 0 }` profile asks for the same immediate, hard invalidation `updateTag` performs,
rather than `revalidateTag`'s own default stale-while-revalidate window, which would let the
15-second `LiveRefresh` poll below read a stale cache entry for far longer than 15 seconds.
Vercel also retries this webhook up to five times on anything but a 200 response, so the insert
uses `onConflictDoNothing()` against a UNIQUE constraint on `pathname` — the same
insert-is-the-idempotency-check pattern `reminder_log` already uses (ADR 0009) — so a retried
callback for an upload this route already processed re-targets the same row instead of duplicating
it.
`addRandomSuffix: true` is what makes `pathname` unique per upload attempt in the first place.

**The event sheet reconciles a pending upload against plain local state, not `useOptimistic`.**
`useOptimistic`'s overlay reverts as soon as the transition that set it settles — for an upload,
that is the instant `upload()` itself resolves, which is *before* `onUploadCompleted` has written
the row and long before a `LiveRefresh` poll has delivered it back as a prop.
Using `useOptimistic` here made a freshly-uploaded photo flash in and then vanish.
Instead, `pendingAttachments` is a plain `useState` array: `upload()` resolving appends a
locally-built row to it, and the sheet renders `attachments` (the server-confirmed prop, minus
anything locally deleted) followed by whichever `pendingAttachments` entries have no matching
`pathname` in `attachments` yet.
Once the real row lands as a prop, the pending entry is filtered out because the real one is now
rendering in its place — deterministic, and never dependent on a transition's own revert timing.
Deleting an attachment uses the mirror-image mechanism: a plain `deletedAttachmentIds` set hides a
row the instant its delete is confirmed, and is rolled back if the Server Action itself fails.

**Deleting an attachment, or the event it belongs to, is a database delete first and a best-effort
blob delete second.**
`deleteAttachment` (`app/calendar/actions.ts`) removes the `event_attachments` row, then calls
`del()` from `@vercel/blob` on its `pathname`, wrapped so a failed blob delete cannot fail the
action over a row the user already sees gone.
`deleteCalendarEvent` collects the pathnames of an event's own attachments — and, because
`deleteSeries` delegates straight to it, any recurrence overrides' attachments too — before running
its delete, since the FK cascade (`event_attachments.event_id`, `onDelete: "cascade"`) removes those
rows in the same statement the event itself goes in, leaving nothing to read a pathname from
afterwards.
An orphaned blob (a `del()` that fails, or an event deleted by a path this PR didn't anticipate) is
an accepted trade-off at household scale, not a correctness bug to chase down.

**Attachment add/remove is silent: no activity row, no partner push.**
The cache-tag matrix (design decision 6 of the shared-calendar plan) routes both operations through
the existing `calendar-events` tag rather than a new one, and neither writes to `activity` — a photo
appearing on an event the other member already has open (or will reopen) doesn't carry the same
"something changed that needs a heads-up" weight a new event, edit, delete or comment does.

**Blobs are uploaded with `access: "public"`.**
A public blob's URL is unguessable (the store path includes Blob's own random suffix) but carries
no authentication check of its own and never expires.
Anyone who obtains the URL — a forwarded link, a leaked screenshot, a browser history entry on a
shared device — can view or download the file indefinitely, with no way to revoke access short of
deleting the blob outright.
Accepted at household scale, the same posture the plan already takes toward the ICS feed's own
long-lived token-in-URL access model.

**Images plus PDF is the initial allowlist**, matching what the plan's premium-parity feature
mapping actually asks for; widening it later is a one-line change to the allowlist in both the
upload route and the event sheet's own pre-check.

**Vercel Blob on the Hobby plan** (~1GB storage, capped monthly transfer, the project pauses rather
than incurring a bill on overage) is accepted as adequate for a two-person household's calendar
attachments, the same Hobby-tier posture the plan already accepted for Postgres and for the
reminder sender's scheduling constraints (ADR 0009).

## Consequences

- The upload route's `onUploadCompleted` half of this flow has no local verification path at
  all — `pnpm dev` never receives the callback, so a bug there can only be caught on a Vercel
  preview with a Blob store connected, not in ordinary development.
- Orphaned blobs are a known, accepted cost: a failed `del()`, or any future code path that removes
  an event without going through `deleteCalendarEvent`, leaves storage Vercel Blob will keep
  billing usage against (within the Hobby quota) with nothing in this PR to reconcile it.
  A cleanup job is a fair future addition if the household ever approaches the Hobby storage ceiling.
- The 10MB/allowlist ceiling is enforced in three places that must be changed together if it ever
  moves: the upload route's `onBeforeGenerateToken`, the event sheet's client-side pre-check, and
  this ADR's own description of the trade-off.
- A household member sees no notification when their partner attaches a photo — by design, per the
  cache-tag matrix — which means an attachment can go unnoticed until the event is next opened,
  unlike every other calendar mutation in this plan.
- Every attachment URL is publicly and permanently readable by anyone who has it, with no
  authentication and no expiry — deleting the blob is the only way to revoke access.
  If HomeSync ever needs a stronger guarantee than "the URL is hard to guess", this would need
  `access: "private"` plus a signed-URL read path, which is a bigger change than this PR takes on.
