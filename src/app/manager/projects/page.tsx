"use client";

/**
 * Project list + create-project flow (details → site location → geofence).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { SiteMap } from "@/components/SiteMap";
import { BottomSheet, Chip, Field, StatusChip, Toggle } from "@/components/ui";
import { offsetMeters } from "@/lib/geo";
import { todayISO } from "@/lib/format";
import { liveBoard } from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import type { LatLng, PremiseKind, Project } from "@/lib/types";
import {
  IAlert,
  IArrowR,
  IHardHat,
  IMapPin,
  IPlus,
  ISearch,
  IUsers,
} from "@/components/WfIcons";

/** Demo geocoder — a handful of Coimbatore-area anchors for the search box. */
const PLACES: Array<{ name: string; at: LatLng }> = [
  { name: "Peelamedu, Coimbatore", at: { lat: 11.0273, lng: 77.0037 } },
  { name: "Saravanampatti, Coimbatore", at: { lat: 11.0794, lng: 76.9997 } },
  { name: "Singanallur, Coimbatore", at: { lat: 11.0045, lng: 77.028 } },
  { name: "Gandhipuram, Coimbatore", at: { lat: 11.0183, lng: 76.9674 } },
  { name: "Ukkadam, Coimbatore", at: { lat: 10.9925, lng: 76.9608 } },
];

export default function ManagerProjects() {
  const { state } = useWorkforce();
  const [creating, setCreating] = useState(false);

  const board = useMemo(() => liveBoard(state), [state]);

  return (
    <div>
      <ScreenHeader
        title="Projects"
        sub={`${state.projects.length} total · ${state.projects.filter((p) => p.status === "active").length} active`}
        action={
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => setCreating(true)}>
            <IPlus size={15} /> New project
          </button>
        }
      />
      <div className="grid gap-3 px-4 md:grid-cols-2">
        {state.projects.map((p) => {
          const onsite = board.filter((b) => b.state === "working" && b.project?.id === p.id).length;
          return (
            <Link
              key={p.id}
              href={`/manager/project?id=${p.id}`}
              className="wf-card overflow-hidden transition hover:border-[var(--wf-line-strong)]"
            >
              <SiteMap
                project={p}
                heightClass="h-36 rounded-none border-0"
                showControls={false}
                interactive={false}
              />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="wf-display truncate font-bold">{p.name}</h2>
                    <p className="truncate text-[0.74rem] text-[var(--wf-muted)]">
                      {p.code} · {p.client}
                    </p>
                  </div>
                  <StatusChip
                    status={p.status === "active" ? "working" : "not-in"}
                    label={p.status[0].toUpperCase() + p.status.slice(1)}
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[0.72rem] text-[var(--wf-muted)]">
                  <Chip tone="green">
                    <IHardHat size={11} /> {onsite} on site
                  </Chip>
                  <Chip tone="neutral">
                    <IUsers size={11} /> {p.employeeIds.length} assigned
                  </Chip>
                  <span className="ml-auto flex items-center gap-1 font-semibold text-[var(--wf-amber)]">
                    Open <IArrowR size={13} />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <CreateProjectSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

/* --------------------------------------------------------- create flow */

function CreateProjectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, saveProject, currentUser } = useWorkforce();
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
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<LatLng>(PLACES[0].at);
  const [radius, setRadius] = useState(160);
  const [kind, setKind] = useState<PremiseKind>("site");
  // Defaults on: recording the whole shift is what people expect, and the
  // narrower policy should be something a manager opts into knowingly.
  const [trackInside, setTrackInside] = useState(true);
  const [error, setError] = useState("");

  const matches = query.trim()
    ? PLACES.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  const reset = () => {
    setStep(0);
    setName("");
    setCode("");
    setClient("");
    setAddress("");
    setContact("");
    setContactPhone("");
    setDescription("");
    setQuery("");
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
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={step === 0 ? "New project" : "Site location & geofence"}
      tall
    >
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
                <option value="site">Construction site</option>
                <option value="office">Office</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
          <Field label="Project address">
            <input className="wf-input" value={address} onChange={(e) => setAddress(e.target.value)} />
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
          <div className="relative">
            <ISearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]" />
            <input
              className="wf-input wf-input-search"
              aria-label="Search for a site location"
            placeholder="Search location…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {matches.length > 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface2)] shadow-xl">
                {matches.map((m) => (
                  <button
                    key={m.name}
                    className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-[var(--wf-surface3)]"
                    onClick={() => {
                      setLocation(m.at);
                      setQuery("");
                      if (!address) setAddress(m.name);
                    }}
                  >
                    <IMapPin size={14} className="text-[var(--wf-amber)]" /> {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
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
    </BottomSheet>
  );
}
