"use client";

/**
 * "Use my current location", in one place.
 *
 * Three screens ask the browser where the phone is, and every one of them had
 * to get the same four things right: that the device can answer at all, that
 * a decline reads differently from a timeout, that the button says it is
 * working, and that a failure tells somebody what to do instead of leaving
 * them tapping. Two had their own copy of it and the third — the geofence
 * editor, used by a manager standing on the boundary they are drawing — had
 * none.
 *
 * It asks the browser rather than the store's live fix on purpose. That fix
 * comes from a watch that only runs for an employee on shift, so a manager
 * setting a site up would have waited for a position that was never coming.
 * Inside the app the browser call goes through Capacitor's WebView bridge,
 * which raises the Android runtime prompt the first time; on the web it is
 * the ordinary permission dialog.
 *
 * Asked on a tap, never on mount. A permission prompt that appears because
 * somebody walked into a screen is a prompt they decline, and a decline is
 * remembered by the operating system long after they wanted it.
 *
 * Getting a fix is only half of it. onPick hands back a position; the caller
 * still has to point the map at it, and the way to do that is a `follow` /
 * `focus` value held separately from the location itself — see PremiseStep.
 * Separately, because the location changes when a pin is dragged too, and a
 * map that re-centres on every drag tick chases the finger across the screen.
 */

import { useState } from "react";
import type { LatLng } from "@/lib/types";
import { ICrosshair } from "./WfIcons";

export function UseMyLocation({
  onPick,
  label = "Use my current location",
  // Full width, under the map. It is the primary way somebody standing on a
  // site places it, and a small w-fit button tucked beside a search box read
  // as a minor option next to the thing it is usually better than.
  className = "wf-btn wf-btn-ghost w-full",
}: {
  onPick: (at: LatLng) => void;
  /** Override where the surrounding words need something more specific. */
  label?: string;
  className?: string;
}) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device can't share a location.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onPick({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        // A decline and a failure need different advice: one is a setting
        // they changed, the other is a sky they cannot see.
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was declined — search for the address or drag the pin instead."
            : "Couldn't get a fix. Search for the address or drag the pin instead.",
        );
      },
      // High accuracy matters: this places a boundary people are paid
      // against. Ten seconds is long enough for a cold GPS start and short
      // enough that somebody does not think the app has died.
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <>
      <button type="button" className={className} onClick={ask} disabled={locating}>
        <ICrosshair size={15} />
        {locating ? "Locating…" : label}
      </button>
      {error ? (
        <p className="text-[0.78rem] text-[var(--wf-amber)]">{error}</p>
      ) : null}
    </>
  );
}
