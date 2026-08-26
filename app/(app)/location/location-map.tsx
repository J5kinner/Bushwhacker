"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
// Static, not dynamic. Only Leaflet's JS touches `window` at import time; its
// stylesheet is a plain CSS import that Next extracts at build time, and
// `await import()` on a stylesheet is not reliably handled.
import "leaflet/dist/leaflet.css";
import type { MemberLocation } from "@/lib/queries";

/** Members with a position worth drawing. */
function plottable(members: MemberLocation[]) {
  return members.filter(
    (m) => m.sharing && m.latitude !== null && m.longitude !== null,
  );
}

// One colour per member, by position in the (name-ordered) list, so each person
// keeps the same pin colour between renders.
const PIN_COLOURS = ["#10b981", "#6366f1"] as const;

/**
 * Both members on an OpenStreetMap base layer.
 *
 * Plain Leaflet rather than react-leaflet: one map, one dependency instead of
 * two. Leaflet's JS is imported dynamically inside the effect because it
 * touches `window` at module scope, which would break the server render.
 *
 * Markers are `divIcon`s rather than Leaflet's default marker. The default one
 * resolves its PNGs relative to the stylesheet, which bundlers rewrite — the
 * well-known result is invisible or broken-image pins. A CSS dot has no assets
 * to lose, and colour-coding two people reads better than two identical pins.
 *
 * OSM's tile usage policy allows light use like this and requires the
 * attribution rendered below.
 */
export function LocationMap({ members }: { members: MemberLocation[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  // Read inside the effect so `members` itself need not be a dependency — a new
  // array identity on every poll would redraw the markers each render. Synced
  // from its own effect, not during render, because React forbids mutating a
  // ref's `.current` outside an effect or event handler (react-hooks/refs).
  // Declared before the draw effect below so it always runs first within a
  // commit, keeping the ref current by the time draw() reads it.
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // A primitive dependency, so the effect re-runs only when a position actually
  // changes.
  const signature = plottable(members)
    .map((m) => `${m.userId}:${m.latitude},${m.longitude}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;

    async function draw() {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          // A two-person map is read, not explored. Dragging still works.
          zoomControl: false,
          attributionControl: false,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;

      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      const current = plottable(membersRef.current);
      if (current.length === 0) {
        // Nothing to show: a wide view beats an empty grey square.
        map.setView([-37.8136, 144.9631], 9);
        return;
      }

      current.forEach((member, i) => {
        const colour = PIN_COLOURS[i % PIN_COLOURS.length];
        const marker = L.marker([member.latitude!, member.longitude!], {
          icon: L.divIcon({
            className: "", // Suppress Leaflet's default divIcon chrome.
            html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${colour};box-shadow:0 0 0 3px rgba(255,255,255,0.9),0 1px 3px rgba(0,0,0,0.4)"></span>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        })
          .addTo(map)
          .bindTooltip(member.name, { permanent: true, direction: "top" });
        markersRef.current.push(marker);
      });

      if (current.length === 1) {
        map.setView([current[0].latitude!, current[0].longitude!], 14);
      } else {
        map.fitBounds(
          current.map((m) => [m.latitude!, m.longitude!] as [number, number]),
          { padding: [40, 40], maxZoom: 15 },
        );
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [signature]);

  // Tear the map down only on unmount; the effect above reuses it otherwise.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return (
    <div>
      {/*
        Hidden from assistive technology on purpose: a pane of tiles conveys
        nothing without sight, and the detail rows below carry the same
        information as text. Labelling this as an image would promise a
        description that a tile grid cannot give.
      */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-64 w-full overflow-hidden rounded-lg border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5"
      />
      <p className="mt-1 text-right text-xs text-zinc-500">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}
