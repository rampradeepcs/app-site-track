"use client";

/**
 * Putting a site where it actually is.
 *
 * The map used to move the pin on any tap that did not travel three pixels,
 * which made panning and placing the same gesture with a hair between them:
 * look around the map with a steady finger and the site quietly moved; aim
 * carefully at a gate and a slight wobble panned instead. On a phone that is
 * a coin flip, and the losing side silently relocates a company's first site.
 *
 * So placing is now a mode you enter. While it is on, the pin is fixed to
 * the middle of the screen and the map moves under it — the gesture every
 * ride-hailing and delivery app uses, and the only one that lets a fingertip
 * be precise, because the target is a crosshair rather than whatever is
 * under the finger that is covering it.
 *
 * Outside that mode the map only pans and zooms, so nothing can be moved by
 * accident.
 */

import { useState } from "react";
import { SiteMap } from "./SiteMap";
import type { Geofence, LatLng } from "@/lib/types";
import { ICheck, ICrosshair } from "./WfIcons";

export function SitePlacer({
  location,
  onChange,
  fence,
  follow,
  label,
  heightClass = "h-[260px]",
}: {
  location: LatLng;
  onChange: (p: LatLng) => void;
  fence: Geofence;
  /** Somewhere the map should jump to — a search result, a GPS fix. */
  follow?: LatLng | null;
  label: string;
  heightClass?: string;
}) {
  const [placing, setPlacing] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SiteMap
          fence={fence}
          follow={follow}
          heightClass={heightClass}
          /* In placing mode the map reports where it is looking and that
             becomes the location; the marker rides along under the
             crosshair. Otherwise nothing the map does can move the site. */
          onViewCenter={placing ? onChange : undefined}
          onCenterDrag={placing ? undefined : onChange}
          /* No marker while placing: the crosshair is the pin, and drawing
             both put a label and a pin head on top of the very spot the
             person is trying to see. */
          markers={
            placing
              ? []
              : [
                  {
                    id: "premise",
                    coords: location,
                    kind: "site",
                    color: "var(--wf-orange)",
                    label,
                  },
                ]
          }
        />

        {placing ? (
          <>
            {/* Sits over the map and takes no pointer events, so the gesture
                underneath is an ordinary pan. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <svg width="46" height="46" viewBox="0 0 46 46" fill="none">
                <circle cx="23" cy="23" r="13" stroke="var(--wf-orange)" strokeWidth="2.5" />
                <circle cx="23" cy="23" r="2.5" fill="var(--wf-orange)" />
                <path
                  d="M23 2v8M23 36v8M2 23h8M36 23h8"
                  stroke="var(--wf-orange)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            {/* Stops short of the zoom controls rather than running under
                them, and wraps instead of being clipped. */}
            <p className="pointer-events-none absolute left-3 right-16 top-3 rounded-xl bg-black/75 px-3 py-1.5 text-center text-[0.72rem] font-semibold leading-snug text-white">
              Move the map to put the crosshair on the site
            </p>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className={`wf-btn wf-btn-sm ${placing ? "wf-btn-primary" : "wf-btn-ghost"}`}
          onClick={() => setPlacing((v) => !v)}
        >
          {placing ? (
            <>
              <ICheck size={15} /> Done — pin is here
            </>
          ) : (
            <>
              <ICrosshair size={15} /> Move the pin
            </>
          )}
        </button>
        <span className="text-right text-[0.7rem] tabular-nums text-[var(--wf-faint)]">
          {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
        </span>
      </div>
    </div>
  );
}
