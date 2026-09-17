"use client";

/**
 * Create a project.
 *
 * Its own screen rather than a sheet. It asks nine questions and then puts a
 * map under your thumb; a sheet that tall is a screen wearing a costume, and
 * it took the back gesture with it — leaving mid-way dropped everything
 * without asking.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { SitePlacer } from "@/components/SitePlacer";
import { Field, Toggle } from "@/components/ui";
import { LocationSearch } from "@/components/LocationSearch";
import { reverseGeocode, type PlaceAddress } from "@/lib/geocode";
import { UseMyLocation } from "@/components/UseMyLocation";
import { DISCARD_PROJECT, confirmDestructive } from "@/lib/confirm";
import { offsetMeters } from "@/lib/geo";
import { todayISO } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import type { LatLng, PremiseKind, Project } from "@/lib/types";
import { IAlert, IArrowR, IMapPin } from "@/components/WfIcons";

export default function NewProjectPage() {
  const { state, saveProject, currentUser } = useWorkforce();
  const router = useRouter();
  const [step, setStep] = useState<0 | 1>(0);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [client, setClient] = useState("");
  /* Read back from the pin rather than typed. See the effect below. */
  const [address, setAddress] = useState("");
  const [place, setPlace] = useState<PlaceAddress | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [contact, setContact] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<Project["status"]>("planning");
  const [description, setDescription] = useState("");
  /* The label of the place they picked, so the screen can say the map moved
     rather than moving it silently underneath them. */
  /*
   * Opens on a premise this company already has, falling back to the
   * country's centre — which is a point in a field in Madhya Pradesh, and
   * why the control below exists.
   */
  const [location, setLocation] = useState<LatLng>(
    () => state.projects[0]?.location ?? { lat: 20.5937, lng: 78.9629 },
  );
  const [radius, setRadius] = useState(160);

  /*
   * Where the pin is, said in words.
   *
   * The address used to be typed on the first step and the pin dropped on
   * the second, which is one question asked twice — and on a site they
   * disagree, because the gate is on a road the postal address has never
   * heard of. The pin is the answer now and this is its label.
   *
   * Debounced, because the pin moves continuously under a dragging thumb
   * and Nominatim is a free service being asked politely. Aborted on the
   * next move so a slow reply cannot overwrite a newer one.
   */
  useEffect(() => {
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      setPlaceBusy(true);
      void reverseGeocode(location, ctl.signal).then((found) => {
        if (ctl.signal.aborted) return;
        setPlaceBusy(false);
        setPlace(found);
        setAddress(found?.label ?? "");
      });
    }, 700);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [location]);
  const [kind, setKind] = useState<PremiseKind>("site");
  // Defaults on: recording the whole shift is what people expect, and the
  // narrower policy should be something a manager opts into knowingly.
  const [trackInside, setTrackInside] = useState(true);
  const [error, setError] = useState("");

  /*
   * Whether there is work here worth protecting.
   *
   * Only what somebody actually typed or moved counts. The screen sets a
   * start date, a radius, a status, a premise type and a tracking policy on
   * its own, and a guard that fires because of its own defaults is a guard
   * people learn to dismiss without reading — which is worse than not having
   * one, because it trains the reflex on the day it matters.
   *
   * The pin is compared against where it opened rather than against any
   * fixed point: it opens on an existing site or, failing that, the centre
   * of the country, and neither is a decision anybody made.
   */
  /* A state that is never set: stable for the life of the screen and,
     unlike a ref, legitimately readable while rendering. */
  const [openedAt] = useState(location);
  const dirty =
    name.trim() !== "" ||
    code.trim() !== "" ||
    client.trim() !== "" ||
    contact.trim() !== "" ||
    contactPhone.trim() !== "" ||
    description.trim() !== "" ||
    endDate !== "" ||
    status !== "planning" ||
    kind !== "site" ||
    !trackInside ||
    radius !== 160 ||
    location.lat !== openedAt.lat ||
    location.lng !== openedAt.lng;

  /*
   * The same question, asked of the ways out that are not our button.
   *
   * Closing the tab or reloading is the browser's to ask, and it only
   * honours the prompt when something has been typed — which is the same
   * condition as ours.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /*
   * Android's hardware back and the system back gesture never reach a
   * button, so they are caught where they arrive. Nothing else in the app
   * listens for this, which is why it is set up and torn down here rather
   * than centrally — a global handler would change every screen's behaviour
   * at once, and that is a bigger decision than this screen gets to make.
   */
  useEffect(() => {
    if (!dirty) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("backButton", () => {
          confirmDestructive(DISCARD_PROJECT, () => router.replace("/manager/projects"));
        });
        if (cancelled) void handle.remove();
        else off = () => void handle.remove();
      } catch {
        /* not a device: the browser's own back is handled by the button */
      }
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [dirty, router]);

  const reset = () => {
    setStep(0);
    setName("");
    setCode("");
    setClient("");
    setAddress("");
    setContact("");
    setContactPhone("");
    setDescription("");
    setPlace(null);
    setKind("site");
    setTrackInside(true);
    setError("");
  };

  /** Step one is done when the project has a name worth saving. */
  const goToLocation = () => {
    if (name.trim().length < 3) {
      setError("Give the project a name (3+ characters).");
      return;
    }
    setStep(1);
  };

  const create = () => {
    saveProject({
      name: name.trim(),
      kind,
      trackingMode: trackInside ? "full-shift" : "outside-only",
      code: code.trim() || undefined,
      client: client.trim(),
      address: address.trim(),
      siteContact: contact.trim(),
      siteContactPhone: contactPhone.trim(),
      startDate,
      endDate,
      status,
      description: description.trim(),
      location,
      geofence: {
        kind: "circle",
        polygon: [],
        center: location,
        radius,
        bufferMeters: 40,
      },
      zones: [
        {
          id: `z_${Date.now().toString(36)}`,
          name: "Main Gate",
          center: offsetMeters(location, radius * 0.9, 200),
          radius: 30,
          kind: "access",
        },
      ],
      managerId: currentUser?.id,
    });
    reset();
    router.replace("/manager/projects");
  };

  return (
    <div>
      <ScreenHeader
        title={step === 0 ? "New project" : "Site location & geofence"}
        sub={
          step === 0
            ? "Name it and say who it is for."
            : "Where it is, and how far the boundary reaches."
        }
        back="/manager/projects"
        confirmBack={dirty ? DISCARD_PROJECT : undefined}
        /* The step's own action, in the bar: on a form this long the button
           that finishes it was below the fold on every phone. */
        action={
          step === 0 ? (
            <button className="wf-btn wf-btn-primary" onClick={goToLocation}>
              Next — site location <IArrowR size={16} />
            </button>
          ) : (
            <>
              <button className="wf-btn wf-btn-ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="wf-btn wf-btn-primary" onClick={create}>
                Create project
              </button>
            </>
          )
        }
      />
      <div className="px-4 pb-6">
      {step === 0 ? (
        <div className="flex flex-col gap-3.5">
          <Field label="Project name" required>
            <input className="wf-input" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Riverside Mall — Phase 1" />
          </Field>
          {error ? <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project ID">
              <input className="wf-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" />
            </Field>
            <Field label="Premise type" hint="Both can start and end a shift.">
              <select
                className="wf-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as PremiseKind)}
              >
                <option value="site">Site</option>
                <option value="office">Office</option>
              </select>
            </Field>
          </div>
          {/* On its own: a two-column grid with one child left half the row
              empty, which reads as a field that failed to render. */}
          <div>
            <Field label="Status">
              <select className="wf-input" value={status} onChange={(e) => setStatus(e.target.value as Project["status"])}>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="on-hold">On hold</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
          </div>
          <Field label="Client name">
            <input className="wf-input" value={client} onChange={(e) => setClient(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site contact">
              <input className="wf-input" value={contact} onChange={(e) => setContact(e.target.value)} />
            </Field>
            <Field label="Contact phone">
              <input className="wf-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input type="date" className="wf-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Expected end">
              <input type="date" className="wf-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Project manager">
            <input className="wf-input" value={currentUser?.name ?? ""} readOnly />
          </Field>
          <Field label="Description">
            <textarea className="wf-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* No second search box. The address field above already placed
              the map; Move the pin puts it exactly. */}
          {/*
            Most new sites are created standing on them. The pin already
            opens on the current fix where there is one; this puts it back
            after somebody has searched or dragged, and says plainly when the
            app has no position to offer rather than doing nothing on a tap.
          */}
          {/* Most new sites are created standing on them. */}
          {/*
            Two ways to place the boundary and no third: stand on it, or
            find it by name. The address is not asked for — it is read back
            from wherever the pin lands, below.
          */}
          <Field
            label="Find on the map"
            hint="Jumps the map to a place — then drag the pin to sit it exactly."
          >
            <LocationSearch onPick={(hit) => setLocation(hit.at)} />
          </Field>
          <UseMyLocation onPick={setLocation} />
          <SitePlacer
            location={location}
            onChange={setLocation}
            fence={{ kind: "circle", polygon: [], center: location, radius, bufferMeters: 40 }}
            label={name || "New site"}
            heightClass="h-64"
          />
          {/*
            What the pin turned out to be. Shown rather than asked, and shown
            honestly when nothing came back — a half-built road on the edge
            of a city often has no address yet, and inventing one would be
            worse than the gap. The boundary is the fact either way; this is
            the line somebody reads on a report.
          */}
          <div className="wf-inset flex items-start gap-2 px-3 py-2.5 text-[0.78rem]">
            <IMapPin size={14} className="mt-0.5 shrink-0 text-[var(--wf-amber)]" />
            {placeBusy ? (
              <span className="text-[var(--wf-muted)]">Looking up the address…</span>
            ) : place ? (
              <span className="min-w-0">
                <span className="font-semibold">
                  {[place.street, place.city].filter(Boolean).join(", ") || place.label}
                </span>
                <span className="block text-[var(--wf-muted)]">{place.label}</span>
              </span>
            ) : (
              <span className="text-[var(--wf-muted)]">
                No address found for this spot. The boundary is what matters;
                the address can be added later.
              </span>
            )}
          </div>

          <p className="text-xs text-[var(--wf-muted)]">
            You can redraw a precise polygon boundary any time from the
            project&apos;s geofence editor.
          </p>
          <label className="wf-card2 flex items-center gap-4 px-4 py-3">
            <span className="w-24 shrink-0 text-[0.74rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
              Radius
            </span>
            <input type="range" min={60} max={500} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="flex-1 accent-[var(--wf-amber)]" />
            <span className="w-14 text-right text-sm font-bold tabular-nums">{radius}m</span>
          </label>
          {/* The policy sits on this step deliberately: it is a rule about the
              boundary drawn just above it, and reads as abstract anywhere else. */}
          <div className="wf-card2 flex flex-col gap-3 px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[0.86rem] font-bold">
                  Track employees inside the boundary
                </p>
                <p className="mt-0.5 text-[0.74rem] leading-snug text-[var(--wf-muted)]">
                  {trackInside
                    ? "The full shift is recorded, from check-in to checkout."
                    : "Nothing is recorded on site. Recording starts when someone leaves the boundary and runs until checkout."}
                </p>
              </div>
              <Toggle
                checked={trackInside}
                onChange={setTrackInside}
                label="Track employees inside the project boundary"
              />
            </div>
            {!trackInside && (
              <p className="flex items-start gap-2 border-t border-[var(--wf-line)] pt-3 text-[0.72rem] leading-snug text-[var(--wf-amber-hi)]">
                <IAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  Checkout will only be accepted at one of the employee&apos;s
                  assigned premises — this site, another site, or the office.
                  Without that the trail could end anywhere.
                </span>
              </p>
            )}
          </div>
          <p className="text-center text-[0.68rem] text-[var(--wf-faint)]">
            {state.projects.length} existing projects
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
