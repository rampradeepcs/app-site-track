"use client";

/**
 * Changing what a project is, after it exists.
 *
 * Everything a project was given at creation could be corrected in one
 * place except the details themselves: the boundary had an editor, the
 * tracking policy had a toggle, the roster had its own tab, and a client
 * name typed wrong on day one stayed wrong. This is the missing door.
 *
 * The map is deliberately not here. Address is text; where the pin and
 * the boundary sit is decided under Geofence, with the crosshair, because
 * moving a site by retyping a street is how a boundary ends up two roads
 * from the gate it guards.
 */

import { useState } from "react";
import { BottomSheet, Field } from "./ui";
import { useWorkforce } from "@/lib/store";
import type { PremiseKind, Project, ProjectStatus } from "@/lib/types";
import { ICheck } from "./WfIcons";

export function EditProjectSheet({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Edit project" tall>
      {/* Keyed on the opening so every open starts from what is saved, not
          from what was typed and abandoned last time. */}
      {open ? <EditProjectForm key={project.id} project={project} onDone={onClose} /> : null}
    </BottomSheet>
  );
}

function EditProjectForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const { state, saveProject } = useWorkforce();

  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code);
  const [kind, setKind] = useState<PremiseKind>(project.kind);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [client, setClient] = useState(project.client);
  const [address, setAddress] = useState(project.address);
  const [siteContact, setSiteContact] = useState(project.siteContact);
  const [siteContactPhone, setSiteContactPhone] = useState(project.siteContactPhone);
  const [startDate, setStartDate] = useState(project.startDate);
  const [endDate, setEndDate] = useState(project.endDate);
  const [managerId, setManagerId] = useState(project.managerId);
  const [description, setDescription] = useState(project.description);
  const [error, setError] = useState("");

  /*
   * Who may own a project: the company's managers and administrators. The
   * current owner is kept in the list even if they have since been made an
   * employee or deactivated, so the field never opens on a blank.
   */
  const owners = state.users.filter(
    (u) =>
      u.id === project.managerId ||
      (u.orgId === project.orgId &&
        (u.role === "manager" || u.role === "admin") &&
        u.status !== "inactive"),
  );

  const save = () => {
    if (name.trim().length < 3) {
      setError("Give the project a name (3+ characters).");
      return;
    }
    if (endDate && startDate && endDate < startDate) {
      setError("The expected end is before the start.");
      return;
    }
    saveProject(
      {
        name: name.trim(),
        code: code.trim() || project.code,
        kind,
        status,
        client: client.trim(),
        address: address.trim(),
        siteContact: siteContact.trim(),
        siteContactPhone: siteContactPhone.trim(),
        startDate,
        endDate,
        managerId,
        description: description.trim(),
      },
      project.id,
    );
    onDone();
  };

  return (
    <div className="flex flex-col gap-3.5 pb-2">
      <Field label="Project name" required>
        <input
          className="wf-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
        />
      </Field>
      {error ? (
        <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Project ID">
          <input className="wf-input" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Premise type">
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

      <Field label="Status">
        <select
          className="wf-input"
          value={status}
          onChange={(e) => setStatus(e.target.value as ProjectStatus)}
        >
          <option value="planning">Planning</option>
          <option value="active">Active</option>
          <option value="on-hold">On hold</option>
          <option value="completed">Completed</option>
        </select>
      </Field>

      <Field label="Client name">
        <input className="wf-input" value={client} onChange={(e) => setClient(e.target.value)} />
      </Field>

      <Field
        label="Project address"
        hint="Text only. The pin and the boundary are moved under Geofence."
      >
        <input
          className="wf-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, area, city"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Site contact">
          <input
            className="wf-input"
            value={siteContact}
            onChange={(e) => setSiteContact(e.target.value)}
          />
        </Field>
        <Field label="Contact phone">
          <input
            className="wf-input"
            type="tel"
            value={siteContactPhone}
            onChange={(e) => setSiteContactPhone(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <input
            type="date"
            className="wf-input"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setError("");
            }}
          />
        </Field>
        <Field label="Expected end">
          <input
            type="date"
            className="wf-input"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setError("");
            }}
          />
        </Field>
      </div>

      <Field label="Project manager" hint="Who is raised with a boundary alert.">
        <select
          className="wf-input"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
        >
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.role === "admin" ? " · Admin" : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Description">
        <textarea
          className="wf-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {/* Stacked, not side by side: "Save changes" wraps to two lines in
          half a row at phone widths, so each action gets the full row
          instead of a cramped half. */}
      <div className="mt-1 flex flex-col gap-2">
        <button type="button" className="wf-btn wf-btn-ghost w-full" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="wf-btn wf-btn-primary w-full" onClick={save}>
          <ICheck size={16} /> Save changes
        </button>
      </div>
    </div>
  );
}
