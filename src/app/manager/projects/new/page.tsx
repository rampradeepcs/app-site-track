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
import { useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { SiteMap } from "@/components/SiteMap";
import { Field, Toggle } from "@/components/ui";
import { LocationSearch } from "@/components/LocationSearch";
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
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<Project["status"]>("planning");
  const [description, setDescription] = useState("");
  /* The label of the place they picked, so the screen can say the map moved
     rather than moving it silently underneath them. */
  const [pickedPlace, setPickedPlace] = useState<string | null>(null);
  /* Opens on a premise this company already has, falling back to the
     country's centre. A hardcoded landmark in one city was fine while the
     product had one customer. */
  const [location, setLocation] = useState<LatLng>(
    () => state.projects[0]?.location ?? { lat: 20.5937, lng: 78.9629 },
  );
  const [radius, setRadius] = useState(160);
  const [kind, setKind] = useState<PremiseKind>("site");
  // Defaults on: recording the whole shift is what people expect, and the
  // narrower policy should be something a manager opts into knowingly.
  const [trackInside, setTrackInside] = useState(true);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(0);
    setName("");
    setCode("");
    setClient("");
    setAddress("");
    setContact("");
    setContactPhone("");
    setDescription("");
    setPickedPlace(null);
    setKind("site");
    setTrackInside(true);
    setError("");
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
          {/*
            * The address is asked once, here, and answering it places the
            * map. Typing a full address twice — once as text and again by
            * hunting for it on a map — was the old shape of this, and the
            * two could disagree.
            */}
          <Field
            label="Project address"
            hint="Search for it, or type it in. Picking a result also sets the map."
          >
            <LocationSearch
              onPick={(hit) => {
                setAddress(hit.label);
                setLocation(hit.at);
                setPickedPlace(hit.label);
              }}
            />
            <input
              className="wf-input mt-2"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setPickedPlace(null);
              }}
              placeholder="Street, area, city"
            />
            {pickedPlace ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-[0.74rem] text-[var(--wf-muted)]">
                <IMapPin size={13} className="mt-0.5 shrink-0 text-[var(--wf-amber)]" />
                <span>Map moved to this place. Fine-tune it on the next step.</span>
              </p>
            ) : null}
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
          <button
            className="wf-btn wf-btn-primary"
            onClick={() => {
              if (name.trim().length < 3) {
                setError("Give the project a name (3+ characters).");
                return;
              }
              setStep(1);
            }}
          >
            Next — site location <IArrowR size={16} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* No second search box. The address field above already placed
              the map; here it is only nudged by tapping. */}
          <SiteMap
            fence={{ kind: "circle", polygon: [], center: location, radius, bufferMeters: 40 }}
            markers={[{ id: "site", coords: location, kind: "site", color: "var(--wf-orange)", label: name || "New site" }]}
            fit={[offsetMeters(location, radius * 1.6, 0), offsetMeters(location, radius * 1.6, 180)]}
            onMapClick={(p) => setLocation(p)}
            heightClass="h-64"
          />
          <p className="text-xs text-[var(--wf-muted)]">
            Tap the map to drop the project marker. You can redraw a precise
            polygon boundary any time from the project&apos;s geofence editor.
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
          <div className="flex gap-2.5">
            <button className="wf-btn wf-btn-ghost flex-1" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="wf-btn wf-btn-primary flex-1" onClick={create}>
              Create project
            </button>
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
