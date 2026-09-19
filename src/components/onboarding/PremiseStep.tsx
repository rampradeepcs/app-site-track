"use client";

/**
 * Place a premise on the map and draw a boundary around it.
 *
 * The same three questions for a site and for an office — what is it called,
 * where is it, how far does it reach — so they share a component rather than
 * two near-identical forms that drift.
 *
 * The boundary is a circle here and only here. A new company has no business
 * drawing a polygon before it has seen the map once, and the geofence editor
 * in Projects does that job properly with vertices and a gate buffer. Signup
 * asks for the smallest thing that makes check-in work today.
 */

import { useState } from "react";
import { SitePlacer } from "../SitePlacer";
import { UseMyLocation } from "../UseMyLocation";
import { Field } from "../ui";
import { LocationSearch } from "../LocationSearch";
import type { Geofence, LatLng } from "@/lib/types";

export interface PremiseFields {
  name: string;
  address: string;
  location: LatLng;
  radius: number;
}

export function PremiseStep({
  value,
  onChange,
  namePlaceholder,
  children,
}: {
  value: PremiseFields;
  onChange: (next: PremiseFields) => void;
  namePlaceholder: string;
  children?: React.ReactNode;
}) {
  /*
   * Where the map should jump: set on a search pick or a geolocation fix,
   * never on a tap. A tap already happens inside the current view, and
   * recentring under someone's finger while they fine-tune reads as the map
   * fighting them. A fresh object each time, because `follow` recentres on
   * reference change.
   */
  const [focus, setFocus] = useState<LatLng | null>(null);

  const fence: Geofence = {
    kind: "circle",
    polygon: [],
    center: value.location,
    radius: value.radius,
    bufferMeters: 40,
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" required>
        <input
          className="wf-input"
          placeholder={namePlaceholder}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Field>

      <Field label="Address" hint="Shown to anyone navigating to it.">
        <input
          className="wf-input"
          placeholder="Street, area, city"
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
        />
      </Field>

      <Field
        label="Find on the map"
        hint="Jumps the map to a place — then use Move the pin to place it exactly."
      >
        <LocationSearch
          onPick={(hit) => {
            setFocus(hit.at);
            onChange({
              ...value,
              location: hit.at,
              address: value.address.trim() ? value.address : hit.label,
            });
          }}
        />
      </Field>

      <SitePlacer
        location={value.location}
        onChange={(p: LatLng) => onChange({ ...value, location: p })}
        fence={fence}
        follow={focus}
        label={value.name || namePlaceholder}
      />

      {/* Under the map, because it acts on the map. */}
      <UseMyLocation
        onPick={(here) => {
          setFocus(here);
          onChange({ ...value, location: here });
        }}
      />
      <p className="text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
        Workers can only check in <strong>inside</strong> the boundary — you
        can reshape it properly from Projects later.
      </p>

      <label className="wf-card2 flex items-center gap-4 px-4 py-3">
        <span className="w-20 shrink-0 text-[0.72rem] font-bold tracking-wider uppercase text-[var(--wf-muted)]">
          Radius
        </span>
        <input
          type="range"
          min={40}
          max={500}
          step={10}
          aria-label="Boundary radius in metres"
          value={value.radius}
          onChange={(e) => onChange({ ...value, radius: Number(e.target.value) })}
          className="flex-1 accent-[var(--wf-amber)]"
        />
        <span className="w-14 text-right text-sm font-bold tabular-nums">
          {value.radius}m
        </span>
      </label>

      {children}
    </div>
  );
}
