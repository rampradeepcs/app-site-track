"use client";

/**
 * Find a place by name.
 *
 * Lifted out of the signup wizard because the same question is asked
 * wherever a premise gets an address: type a few words, pick the place, and
 * the map goes there. Two copies of a geocoder is two sets of debounce
 * timings, two ways of handling a stale response, and eventually two
 * different ideas of what "no results" looks like.
 */

import { useEffect, useRef, useState } from "react";
import { IMapPin, ISearch } from "./WfIcons";
import type { LatLng } from "@/lib/types";

export interface PlaceHit {
  id: string;
  label: string;
  at: LatLng;
}

/**
 * Free-text place search over Nominatim — OpenStreetMap's geocoder, the same
 * project whose tiles the map draws, and equally key-free. A result only
 * jumps the map; the boundary is still placed by tapping, so losing the
 * network (or the service) costs the shortcut, not the step.
 */
export function LocationSearch({ onPick }: { onPick: (hit: PlaceHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /* One live request at a time: a stale response must never repaint. */
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    setFailed(false);
    if (query.length < 3) {
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=" +
            encodeURIComponent(query),
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(String(res.status));
        const rows: Array<{
          place_id: number;
          display_name: string;
          lat: string;
          lon: string;
        }> = await res.json();
        if (seq.current !== id) return;
        setHits(
          rows.map((r) => ({
            id: String(r.place_id),
            label: r.display_name,
            at: { lat: Number(r.lat), lng: Number(r.lon) },
          })),
        );
        setBusy(false);
      } catch {
        if (seq.current !== id) return;
        setHits(null);
        setFailed(true);
        setBusy(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="relative">
      <div className="relative">
        <ISearch
          size={15}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--wf-faint)]"
        />
        <input
          className="wf-input wf-input-search"
          type="search"
          placeholder="Search a place or address"
          aria-label="Search a place or address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {hits && hits.length > 0 ? (
        <ul className="absolute z-20 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface2)] py-1 shadow-xl">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left text-[0.82rem] leading-snug hover:bg-[var(--wf-fill-3)]"
                onClick={() => {
                  onPick(h);
                  setQ("");
                  setHits(null);
                }}
              >
                <IMapPin
                  size={14}
                  className="mt-0.5 shrink-0 text-[var(--wf-amber)]"
                />
                <span>{h.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {busy ? (
        <p className="mt-1.5 text-[0.78rem] text-[var(--wf-muted)]">Searching…</p>
      ) : hits && hits.length === 0 ? (
        <p className="mt-1.5 text-[0.78rem] text-[var(--wf-muted)]">
          No places found — try a broader name, or tap the map.
        </p>
      ) : failed ? (
        <p className="mt-1.5 text-[0.78rem] text-[var(--wf-amber)]">
          Search is unreachable right now — drop the pin on the map instead.
        </p>
      ) : null}
    </div>
  );
}
