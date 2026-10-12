"use client";

/**
 * Create or amend a labour team.
 *
 * The type list is offered, never enforced: a site with a False Ceiling
 * gang should not be told its own trade is not a real one. Picking
 * "Custom…" swaps the select for a text field, and the typed value is
 * stored exactly as written.
 *
 * The code is issued once and then shown read-only. It gets painted on a
 * board and read out on a radio, so it is not something to edit casually.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ScreenHeader } from "../shell";
import { DISCARD_EDITS, DISCARD_TEAM } from "@/lib/confirm";
import { useWorkforce } from "@/lib/store";
import { leaderOnSave, nextTeamCode } from "@/lib/teams";
import { LABOUR_TEAM_TYPES, type LabourTeam } from "@/lib/types";
import { Field, Segmented } from "../ui";
import { useUnsavedGuard } from "@/lib/unsaved";

const CUSTOM = "__custom__";

export function TeamForm({
  projectId,
  editing,
  backTo,
}: {
  projectId: string;
  editing?: LabourTeam | null;
  backTo: string;
}) {
  const router = useRouter();
  const { state, saveTeam } = useWorkforce();

  const isKnownType =
    !editing || (LABOUR_TEAM_TYPES as readonly string[]).includes(editing.type);

  const [type, setType] = useState(
    editing ? (isKnownType ? editing.type : CUSTOM) : "Plumbing",
  );
  const [customType, setCustomType] = useState(isKnownType ? "" : (editing?.type ?? ""));
  const [name, setName] = useState(editing?.name ?? "");
  const [leaderId, setLeaderId] = useState(editing?.leaderId ?? "");
  const [engineerId, setEngineerId] = useState(editing?.siteEngineerId ?? "");
  const [zoneId, setZoneId] = useState(editing?.workZoneId ?? "");
  const [shiftId, setShiftId] = useState(editing?.shiftId ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [startDate, setStartDate] = useState(editing?.startDate ?? "");
  const [endDate, setEndDate] = useState(editing?.endDate ?? "");

  /*
   * Changed from the team when editing, typed at all when new. The type
   * opens on the first of a fixed list, which is the screen's choice rather
   * than anybody's.
   */
  const dirty = editing
    ? name !== editing.name ||
      leaderId !== (editing.leaderId ?? "") ||
      engineerId !== (editing.siteEngineerId ?? "") ||
      zoneId !== (editing.workZoneId ?? "") ||
      shiftId !== (editing.shiftId ?? "") ||
      description !== (editing.description ?? "") ||
      startDate !== (editing.startDate ?? "") ||
      endDate !== (editing.endDate ?? "") ||
      (isKnownType ? type !== editing.type : customType !== editing.type)
    : name.trim() !== "" ||
      leaderId !== "" ||
      engineerId !== "" ||
      zoneId !== "" ||
      shiftId !== "" ||
      description.trim() !== "" ||
      startDate !== "" ||
      endDate !== "" ||
      customType.trim() !== "";

  const project = state.projects.find((p) => p.id === projectId);
  const crew = useMemo(
    () =>
      state.users.filter(
        (u) => u.status === "active" && u.projectIds.includes(projectId),
      ),
    [state.users, projectId],
  );

  const resolvedType = type === CUSTOM ? customType.trim() : type;
  /* The name follows the trade unless someone has said otherwise — one
     less field to fill for the common case, still editable for the rest. */
  const resolvedName = name.trim() || (resolvedType ? `${resolvedType} Team` : "");
  const code = editing?.code ?? nextTeamCode(state, projectId);
  /* A gang works on a project. Opened with none — a company with no sites
     yet, a stale link — the team would be saved belonging to nothing, and
     on a live backend the write would fail outright. */
  const canSave = resolvedName.length > 0 && resolvedType.length > 0 && !!project;

  /* What Save will do with the chosen leader, worked out by the same rule
     the store applies, so the promise under the field is the outcome. */
  const leaderName = crew.find((u) => u.id === leaderId)?.name ?? "They";
  const leaderOutcome = leaderOnSave(state, projectId, leaderId || undefined, editing?.leaderId, editing?.id);
  const leaderHint =
    leaderOutcome === "joins"
      ? `Saving puts ${leaderName} on the gang.`
      : leaderOutcome === "not-labour"
        ? `${leaderName} is not labour, so they lead without being on the gang's roster. Add its workers from the team page.`
        : leaderOutcome === "other-gang"
          ? `${leaderName} is on another gang on this project, so they won't be added to this one.`
          : leaderOutcome === "unchanged-off"
            ? `${leaderName} isn't on the gang. Add them from Add labour on the team page.`
            : "A worker who leads the gang on site.";

  const submit = () => {
    if (!canSave) return;
    // saveTeam also puts a newly chosen leader on the gang — see the store.
    const saved = saveTeam(
      {
        projectId,
        name: resolvedName,
        type: resolvedType,
        code,
        leaderId: leaderId || undefined,
        siteEngineerId: engineerId || undefined,
        workZoneId: zoneId || undefined,
        shiftId: shiftId || undefined,
        description: description.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      },
      editing?.id,
    );
    /* A new gang has nobody on it, and is useless until it does — straight
       to its page with Add labour open, rather than back to a list that
       may be showing another project's teams. */
    router.replace(editing ? backTo : `/manager/team?id=${saved.id}&add=1`);
  };

  const leaving = editing ? DISCARD_EDITS : DISCARD_TEAM;

  const confirmBack = useUnsavedGuard({
    dirty: dirty,
    message: leaving,
    onLeave: () => router.replace(backTo),
  });

  return (
    <div>
      <ScreenHeader
        back={backTo}
        confirmBack={confirmBack}
        title={editing ? "Edit team" : "New labour team"}
        sub={editing ? editing.name : "A gang, its leader and where it works"}
        action={
          <button className="wf-btn wf-btn-primary" disabled={!canSave} onClick={submit}>
            {editing ? "Save team" : "Create team"}
          </button>
        }
      />
      <div className="flex flex-col gap-3.5 px-4 pb-8">
      <div className="wf-inset flex items-center justify-between px-3.5 py-2.5">
        <span className="text-[0.74rem] text-[var(--wf-muted)]">
          {project?.name ?? "Project"}
        </span>
        <span className="text-[0.8rem] font-bold tabular-nums">{code}</span>
      </div>
      {/* Why Create is off, on the screen rather than nowhere. */}
      {!project ? (
        <p className="text-[0.78rem] leading-relaxed text-[var(--wf-amber)]">
          A labour team belongs to a project, and none is chosen. Open Teams
          from a project — or create the project first.
        </p>
      ) : null}

      <Field label="Trade" required>
        <select
          className="wf-input"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {LABOUR_TEAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </Field>

      {type === CUSTOM ? (
        <Field label="Custom trade" required hint="e.g. False Ceiling, Glass Installation">
          <input
            className="wf-input"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            placeholder="False Ceiling"
          />
        </Field>
      ) : null}

      <Field label="Team name" hint={`Defaults to "${resolvedType || "Trade"} Team"`}>
        <input
          className="wf-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={resolvedType ? `${resolvedType} Team` : "Team name"}
        />
      </Field>

      <Field label="Team leader" hint={leaderHint}>
        <select
          className="wf-input"
          value={leaderId}
          onChange={(e) => setLeaderId(e.target.value)}
        >
          <option value="">Not set</option>
          {crew.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.designation}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Site engineer"
        hint="Accountable for this team's attendance. Naming someone here lets them take group attendance for this project."
      >
        <select
          className="wf-input"
          value={engineerId}
          onChange={(e) => setEngineerId(e.target.value)}
        >
          <option value="">Not set</option>
          {crew.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.designation}
            </option>
          ))}
        </select>
      </Field>

      {project?.zones.length ? (
        <Field label="Work zone">
          <select
            className="wf-input"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
          >
            <option value="">Whole site</option>
            {project.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Default shift" hint="Individual shift assignments still win.">
        <select
          className="wf-input"
          value={shiftId}
          onChange={(e) => setShiftId(e.target.value)}
        >
          <option value="">Project default</option>
          {state.shifts.map((sh) => (
            <option key={sh.id} value={sh.id}>
              {sh.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Start date">
          <input
            type="date"
            className="wf-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="End date">
          <input
            type="date"
            className="wf-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="wf-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this gang is here to do."
        />
      </Field>

      {editing ? (
        <Field label="Status">
          <Segmented
            ariaLabel="Team status"
            size="sm"
            value={editing.status}
            onChange={(v) => saveTeam({ projectId, name: resolvedName, status: v }, editing.id)}
            options={[
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "completed", label: "Completed" },
            ]}
          />
        </Field>
      ) : null}
      </div>
    </div>
  );
}
