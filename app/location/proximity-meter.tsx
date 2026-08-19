"use client";

import type { MemberLocation } from "@/lib/queries";
import {
  resolveProximity,
  formatDistance,
  STALE_AFTER_MS,
  type MemberFix,
} from "@/lib/proximity";

/**
 * The pair on the track, and what they become once they reach each other.
 *
 * Decorative and unmapped: neither figure stands for a particular member, since
 * nothing in the data says who is who. The names live in the list above, and
 * both figures are aria-hidden, so the meter never makes a claim about which of
 * you is which.
 *
 * 💑 rather than 🫂 for the meeting: the hug emoji needs iOS 14.2 or Android 11,
 * while this one has been in Unicode since 6.0 and renders on anything.
 */
const FIGURES = ["👩", "👨"] as const;
const TOGETHER = "💑";

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
  imprecise: "Too fuzzy to call",
} as const;

/**
 * An "as of" caveat for a fix old enough to warrant one, or null while it is
 * still live. The clock is read here rather than in the markup: the purity rule
 * rightly objects to Date.now() during render, and the caption is refreshed by
 * LiveRefresh revalidating the page anyway.
 */
function ageCaption(measuredAt: Date): string | null {
  const ageMs = Date.now() - measuredAt.getTime();
  if (ageMs <= STALE_AFTER_MS) return null;

  const minutes = Math.floor(ageMs / 60_000);
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
 * Greys out rather than guessing when the senders' error is too wide to place
 * them in a band: it still shows the band, but desaturated and captioned with
 * the reason.
 *
 * Age does not grey it out. A phone reports rarely enough that nearly every
 * reading was old, so the grey said "old" about everything and therefore about
 * nothing. The age is stated in the caption instead.
 */
export function ProximityMeter({ members }: { members: MemberLocation[] }) {
  const fixes = members.map(toFix).filter((fix): fix is MemberFix => fix !== null);

  // Needs both of them. One pin cannot have a distance to anything.
  if (fixes.length < 2) {
    return (
      <div className="rounded-lg border border-black/10 px-4 py-6 text-center dark:border-white/15">
        <p className="text-3xl leading-none opacity-40" aria-hidden>
          {FIGURES[0]}
          <span className="mx-3 text-base align-middle text-zinc-400">·····</span>
          {FIGURES[1]}
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
  const age = ageCaption(measuredAt);

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
            {TOGETHER}
          </p>
        ) : (
          <>
            <p
              aria-hidden
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl leading-none transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ left: `${50 - spread}%` }}
            >
              {FIGURES[0]}
            </p>
            <p
              aria-hidden
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl leading-none transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ left: `${50 + spread}%` }}
            >
              {FIGURES[1]}
            </p>
          </>
        )}
      </div>

      <p className="mt-1 text-center text-xs text-zinc-500">
        {formatDistance(distanceM)} apart
        {age && ` · as of ${age}`}
      </p>
    </div>
  );
}
