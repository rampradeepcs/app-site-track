"use client";

/**
 * Editing a project.
 *
 * A screen, like creating one next door at /manager/projects/new. The two
 * were the same twelve questions rendered two different ways: one with a
 * back gesture and a guard, one a sheet that a downward flick could throw
 * away while somebody was still typing into it.
 *
 * It loads the project itself rather than being handed one, because a route
 * has no parent to hand it anything — which is also what makes the address
 * shareable and the back button honest.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { Field, FormError } from "@/components/ui";
import { DISCARD_EDITS, confirmDestructive } from "@/lib/confirm";
import { useWorkforce } from "@/lib/store";
import type { PremiseKind, Project, ProjectStatus } from "@/lib/types";
import { ICheck } from "@/components/WfIcons";

export default function EditProjectPage() {
  return (
    <Suspense fallback={null}>
      <EditProjectScreen />
    </Suspense>
  );
}

function EditProjectScreen() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { state } = useWorkforce();
  const project = state.projects.find((p) => p.id === id) ?? null;

  if (!project) {
    return (
      <div>
        <ScreenHeader back title="Project not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          It may have been removed.
        </p>
      </div>
    );
  }
  /* Keyed on the project so switching to another one starts from its values
     rather than from what was typed against the last. */
  return <EditProjectForm key={project.id} project={project} />;
}

function EditProjectForm({ project }: { project: Project }) {
  const router = useRouter();
  const { saveProject, state } = useWorkforce();
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
   * Changed from what was loaded, not merely non-empty: every field here
   * opens with the project's current value, so "has a name" is true the
   * instant the sheet appears and would ask on a sheet nobody touched.
   */
  const dirty =
    name !== project.name ||
    code !== project.code ||
    kind !== project.kind ||
    status !== project.status ||
    client !== project.client ||
    address !== project.address ||
    siteContact !== project.siteContact ||
    siteContactPhone !== project.siteContactPhone ||
    startDate !== project.startDate ||
    endDate !== project.endDate ||
    managerId !== project.managerId ||
    description !== project.description;

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
    router.replace(`/manager/project?id=${project.id}`);
  };

  /* Where the back control goes, and where a save lands. */
  const backTo = `/manager/project?id=${project.id}`;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("backButton", () => {
          confirmDestructive(DISCARD_EDITS, () => router.replace(backTo));
        });
        if (cancelled) void handle.remove();
        else off = () => void handle.remove();
      } catch {
        /* not a device */
      }
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [dirty, router, backTo]);

  return (
    <div>
      <ScreenHeader
        back={backTo}
        confirmBack={dirty ? DISCARD_EDITS : undefined}
        title="Edit project"
        sub={project.name}
        /* Just Save. The bar's back control returns to the project, which is
           all Cancel did. */
        action={
          <button type="button" className="wf-btn wf-btn-primary" onClick={save}>
            <ICheck size={16} /> Save changes
          </button>
        }
      />
      <div className="flex flex-col gap-3.5 px-4 pb-8">
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
        <FormError tight>{error}</FormError>
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
      </div>
    </div>
  );
}
