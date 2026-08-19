import { head } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { calendarEvents, eventAttachments } from "@/db/schema";
import { getCurrentUserId, getHouseholdId } from "@/lib/household";
import { CACHE_TAGS } from "@/lib/queries";

/**
 * Client-upload handshake for event attachments (PR 9; ADR 0010; plan design
 * decision 9). A naive Server Action can't take a 10MB photo: Server Actions
 * cap their request body at 1MB by default and a Vercel Function hard-caps
 * at 4.5MB regardless — both limits would pass silently under `pnpm dev`
 * (where nothing enforces them locally the same way) and then fail for real
 * the first time somebody attaches an actual photo in production. The
 * client instead uploads straight to Vercel Blob via `upload()`
 * (`@vercel/blob/client`, app/calendar/event-sheet.tsx), and this route only
 * ever handles the small JSON handshake either side of that upload.
 *
 * IMPORTANT — this route is its own entire auth boundary. proxy.ts's
 * matcher excludes `/api` entirely (`matcher: ["/((?!api|_next|signin|.*\\.).*)"]`),
 * so no Auth.js session gate ever runs in front of this route the way it
 * runs in front of every page; `onBeforeGenerateToken` below is where that
 * check has to happen instead, before a single byte of the token it hands
 * back could let an unauthenticated caller mint an upload for household data.
 *
 * Node runtime (the default — no `runtime = "edge"` export here): `head()`
 * below needs the same Node fetch/crypto plumbing `web-push` needs
 * elsewhere in this codebase.
 */
export const dynamic = "force-dynamic";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
];

// Matches db/schema.ts's own comment on why this ceiling exists (Server
// Action/Function body caps) and event-sheet.tsx's client-side pre-check —
// keep all three in sync if this ever changes.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface UploadTokenPayload {
  eventId: string;
  userId: string | null;
  /** The original filename the caller uploaded, captured before Blob's `addRandomSuffix` mangles the stored pathname's basename. */
  filename: string;
}

function parseClientPayload(raw: string | null): { eventId: string } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const eventId = (parsed as { eventId?: unknown } | null)?.eventId;
    return typeof eventId === "string" && eventId ? { eventId } : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/attachments/upload
 *
 * `handleUpload` (from `@vercel/blob/client`, despite the server-side import
 * — the package name is unfortunately shared) dispatches this single POST
 * handler to one of two request shapes depending on the client's own
 * `upload()` call:
 *
 * 1. "Generate a token" — the browser is about to upload a file and needs a
 *    scoped, time-limited client token first. `onBeforeGenerateToken` runs
 *    here, and is where authentication and household ownership are checked.
 * 2. "Upload completed" — Vercel's own storage infrastructure calls this
 *    route directly (not the browser) once the blob has actually landed.
 *    `onUploadCompleted` runs here, and this is where the `event_attachments`
 *    row gets written. This callback does NOT fire against `pnpm dev` —
 *    Vercel's infrastructure needs a publicly reachable deployment URL to
 *    call back into — so the row-insert half of this flow is only
 *    verifiable on a Vercel preview with a Blob store connected, never
 *    locally.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        const session = await auth();
        const userId = await getCurrentUserId(session);
        const householdId = await getHouseholdId();
        // No session, or a session with no matching household member: fail
        // closed exactly like every Server Action in app/calendar/actions.ts
        // does for a missing household, rather than minting a token nobody
        // authenticated for.
        if (!householdId || !userId) {
          throw new Error("Not authenticated.");
        }

        const payload = parseClientPayload(clientPayloadRaw);
        if (!payload) {
          throw new Error("Missing target event.");
        }

        // Scoping the pathname under events/<eventId>/ is enforced here, not
        // just documented as a convention — a client can't smuggle a
        // pathname into another event's "folder" while still passing an
        // unrelated clientPayload eventId.
        const expectedPrefix = `events/${payload.eventId}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("Invalid upload path.");
        }
        const filename = pathname.slice(expectedPrefix.length);

        const [event] = await getDb()
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, payload.eventId),
              eq(calendarEvents.householdId, householdId),
            ),
          )
          .limit(1);
        // Also covers the brief window right after an optimistic "add
        // event" where the sheet could in principle be opened before the
        // real row lands (addComment, app/calendar/actions.ts, fails the
        // same way for the identical reason) — the upload is rejected
        // rather than silently attaching to nothing.
        if (!event) {
          throw new Error("This event no longer exists.");
        }

        const tokenPayload: UploadTokenPayload = { eventId: payload.eventId, userId, filename };
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify(tokenPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload: rawTokenPayload }) => {
        if (!rawTokenPayload) return;
        const { eventId, userId, filename } = JSON.parse(rawTokenPayload) as UploadTokenPayload;

        // PutBlobResult carries no size field, so it's fetched with a
        // separate `head()` call — the one extra round trip this callback
        // pays to get a value the schema's `size` column requires not-null.
        const { size } = await head(blob.url);

        await getDb().insert(eventAttachments).values({
          eventId,
          url: blob.url,
          pathname: blob.pathname,
          filename,
          contentType: blob.contentType,
          size,
          uploadedById: userId,
        });

        // No activity row and no partner push here (the cache-tag matrix,
        // design decision 6 of the shared-calendar plan, routes attachment
        // add/remove through calendar-events only) — an attachment showing
        // up silently on the next 15s LiveRefresh poll is judged enough; a
        // household of two doesn't need a push for every photo added to an
        // event they already have open or will open again shortly.
        updateTag(CACHE_TAGS.calendarEvents);
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    // Mirrors handleUpload's own documented failure contract: a thrown error
    // from either callback above must still produce a response the client's
    // upload() call can surface, not an unhandled 500.
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
