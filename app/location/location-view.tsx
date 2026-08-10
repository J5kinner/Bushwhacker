"use client";

import { useEffect, useState, useTransition } from "react";
import { MapPin, BatteryLow, Crosshair } from "lucide-react";
import type { MemberLocation } from "@/lib/queries";
import { setLocationSharing, recordMyLocation } from "./actions";
import { LocationMap } from "./location-map";

/** A coarse relative age: exact seconds are noise for "are they nearly home?". */
function relativeAge(capturedAt: Date): string {
  const minutes = Math.floor((Date.now() - capturedAt.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** One member's row: name, freshness, and how precise the fix was. */
function MemberRow({ member }: { member: MemberLocation }) {
  if (!member.sharing) {
    return (
      <li className="py-3">
        <p className="text-base">{member.name}</p>
        <p className="text-sm text-zinc-500">Not sharing location</p>
      </li>
    );
  }

  if (member.capturedAt === null) {
    return (
      <li className="py-3">
        <p className="text-base">{member.name}</p>
        <p className="text-sm text-zinc-500">Sharing on, no position yet</p>
      </li>
    );
  }

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 wrap-break-word text-base">{member.name}</p>
        <p className="shrink-0 text-sm text-zinc-500">
          {relativeAge(member.capturedAt)}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" aria-hidden />
          {member.latitude?.toFixed(5)}, {member.longitude?.toFixed(5)}
        </span>
        {member.accuracyM !== null && (
          <span className="inline-flex items-center gap-1">
            <Crosshair className="size-3.5" aria-hidden />
            ±{member.accuracyM} m
          </span>
        )}
        {member.batteryPct !== null && member.batteryPct <= 20 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <BatteryLow className="size-3.5" aria-hidden />
            {member.batteryPct}%
          </span>
        )}
      </div>
    </li>
  );
}

export function LocationView({
  members,
  currentUserId,
}: {
  members: MemberLocation[];
  currentUserId: string | null;
}) {
  const me = members.find((m) => m.userId === currentUserId) ?? null;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
    Post one fresh fix for yourself while you are looking at the map.

    Scoped to this page on purpose: an app-wide hook would prompt for location
    permission when you open the shopping list. This is also the only path that
    works before OwnTracks is installed — and it stops the moment the page is
    backgrounded, which is precisely the limitation OwnTracks exists to cover.
  */
  useEffect(() => {
    if (!me?.sharing) return;
    if (!("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void recordMyLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy ?? null,
        });
      },
      () => {
        // Denied, unavailable, or timed out. Not worth a banner: OwnTracks data
        // still renders, and the browser already told the user what it asked.
      },
      // Wifi and cell triangulation rather than GPS — far cheaper on battery,
      // and plenty for "roughly where is my partner". A minute-old cached fix
      // is accepted rather than forcing a new one.
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }, [me?.sharing]);

  function toggle() {
    if (!me) return;
    const next = !me.sharing;
    setError(null);
    startTransition(async () => {
      try {
        await setLocationSharing(next);
      } catch {
        setError("Could not change sharing. Try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {me && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 p-3 dark:border-white/15">
          <div className="min-w-0">
            <p className="text-base">Share my location</p>
            <p className="text-sm text-zinc-500">
              {me.sharing ? "On" : "Off — nothing is stored"}
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={pending}
            role="switch"
            aria-checked={me.sharing}
            aria-label="Share my location"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              me.sharing ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-1 size-5 rounded-full bg-white transition-all ${
                me.sharing ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <LocationMap members={members} />

      {members.length === 0 ? (
        <p className="text-sm text-zinc-500">No household members yet.</p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {members.map((member) => (
            <MemberRow key={member.userId} member={member} />
          ))}
        </ul>
      )}
    </div>
  );
}
