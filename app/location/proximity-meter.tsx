"use client";

import type { MemberLocation } from "@/lib/queries";
import {
  resolveProximity,
  formatDistance,
  type MemberFix,
} from "@/lib/proximity";

/** The people on the track, and what they become once they reach each other. */
const PERSON = "🧑";
const EMBRACE = "🫂";

/** A member's row reduced to a fix, or null when there is nothing to plot. */
function toFix(member: MemberLocation): MemberFix | null {
  if (!member.sharing) return null;
  if (member.latitude === null || member.longitude === null) return null;
  if (member.capturedAt === null) return null;
  return {
    latitude: member.latitude,
    longitude: member.longitude,
    accuracyM: member.accuracyM,
    capturedAt: member.capturedAt,
  };
}

/** Wording for a reading that cannot be believed, keyed by why. */
const DOUBT_BLURB = {
  stale: "Waiting on a fresher fix",
  imprecise: "Too fuzzy to call",
} as const;

function relativeAge(measuredAt: Date): string {
  const minutes = Math.floor((Date.now() - measuredAt.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * Hotter/colder, played with real coordinates: two figures on a track who close
 * the gap as the distance between the household's two phones shrinks, and fall
 * into an embrace once they are within a stone's throw.
 *
 * Greys out rather than guessing. A reading built on a stale or wide-error fix
 * still shows its band, but desaturated and captioned with the reason — the
 * failure this feature invites is confidently announcing "together" about where
 * somebody was an hour ago.
 */
export function ProximityMeter({ members }: { members: MemberLocation[] }) {
  const fixes = members.map(toFix).filter((fix): fix is MemberFix => fix !== null);

  // Needs both of them. One pin cannot have a distance to anything.
  if (fixes.length < 2) {
    return (
      <div className="rounded-lg border border-black/10 px-4 py-6 text-center dark:border-white/15">
        <p className="text-3xl leading-none opacity-40" aria-hidden>
          {PERSON}
          <span className="mx-3 text-base align-middle text-zinc-400">·····</span>
          {PERSON}
        </p>
        <p className="mt-3 text-sm text-zinc-500">
          Needs a position from both of you before it can measure anything.
        </p>
      </div>
    );
  }

  const reading = resolveProximity(fixes[0], fixes[1]);
  const { band, doubt, distanceM, measuredAt } = reading;
  const together = band.key === "together" && doubt === null;

  // Warmth drives the gap: touching at the top of the scale, wide apart at the
  // bottom. Percent of half the track, so the pair stays centred throughout.
  const spread = (1 - band.warmth) * 38;

  return (
    <div
      className={`rounded-lg border border-black/10 px-4 py-5 dark:border-white/15 ${
        doubt ? "opacity-60 grayscale" : ""
      }`}
    >
      <div className="text-center">
        <p
          className="text-4xl leading-none transition-opacity duration-500 motion-reduce:transition-none"
          aria-hidden
        >
          {band.emoji}
        </p>
        <p className="mt-2 text-lg font-semibold tracking-tight">{band.word}</p>
        <p className="text-sm text-zinc-500">
          {doubt ? DOUBT_BLURB[doubt] : band.blurb}
        </p>
      </div>

      {/* The track. Fixed height so the swap to an embrace does not reflow. */}
      <div className="relative mt-5 h-10">
        <div
          aria-hidden
          className="absolute top-1/2 h-px -translate-y-1/2 bg-black/10 transition-all duration-700 ease-out motion-reduce:transition-none dark:bg-white/15"
          style={{ left: `${50 - spread}%`, right: `${50 - spread}%` }}
        />
        {together ? (
          <p
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl leading-none"
          >
            {EMBRACE}
          </p>
        ) : (
          <>
            <p
              aria-hidden
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl leading-none transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ left: `${50 - spread}%` }}
            >
              {PERSON}
            </p>
            <p
              aria-hidden
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl leading-none transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ left: `${50 + spread}%` }}
            >
              {PERSON}
            </p>
          </>
        )}
      </div>

      <p className="mt-1 text-center text-xs text-zinc-500">
        {formatDistance(distanceM)} apart
        {doubt === "stale" && ` · as of ${relativeAge(measuredAt)}`}
      </p>
    </div>
  );
}
