"use client";

/**
 * Shift management — reusable shift definitions (fixed / flexible /
 * overnight / custom), their break and overtime rules, and who is assigned
 * to them from when. The definitions here are what the payroll engine reads;
 * nothing about pay is decided anywhere else.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { EmployeePicker } from "@/components/EmployeePicker";
import { FeatureGate } from "@/components/FeatureGate";
import { ScreenHeader } from "@/components/shell";
import {
  Avatar,
  BottomSheet,
  Chip,
  Field,
  Segmented,
} from "@/components/ui";
import { fmtDateLong, fmtShiftTime, todayISO } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import type {
  BreakRule,
  OvertimeConfig,
  OvertimeTier,
  Project,
  ShiftDef,
  ShiftKind,
} from "@/lib/types";
import { DEFAULT_OVERTIME } from "@/lib/payroll";
import {
  ICheck,
  IClock,
  ICoffee,
  IPlus,
  ISearch,
  ITrash,
  IUsers,
} from "@/components/WfIcons";

/** The rail, plus a bucket for names that do not start with a letter. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/** minutes-from-midnight ↔ the value an <input type="time"> speaks. */
const toHM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHM = (v: string, fallback: number) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : fallback;
};

export default function ManagerShifts() {
  const wf = useWorkforce();
  const { state } = wf;
  const [editing, setEditing] = useState<ShiftDef | "new" | null>(null);
  const [assigning, setAssigning] = useState<ShiftDef | null>(null);
  const [deleting, setDeleting] = useState<ShiftDef | null>(null);

  const shifts = useMemo(
    () =>
      state.shifts
        .filter((x) => x.status === "active")
        .sort((a, b) => a.createdAt - b.createdAt),
    [state.shifts],
  );

  /** Current headcount per shift — who it applies to as of today. */
  const headcount = useMemo(() => {
    const today = todayISO();
    const m = new Map<string, number>();
    for (const u of state.users) {
      if (u.role === "superadmin" || u.status !== "active") continue;
      const a = state.shiftAssignments
        .filter((x) => x.employeeId === u.id && x.effectiveFrom <= today)
        .sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? -1 : 1))
        .pop();
      if (a) m.set(a.shiftId, (m.get(a.shiftId) ?? 0) + 1);
    }
    return m;
  }, [state.users, state.shiftAssignments]);

  return (
    <div>
      <ScreenHeader
        title="Shifts"
        sub={`${shifts.length} active shift${shifts.length === 1 ? "" : "s"}`}
        back
        action={
          <button
            className="wf-btn wf-btn-primary wf-btn-sm"
            onClick={() => setEditing("new")}
          >
            <IPlus size={15} /> New shift
          </button>
        }
      />

      <div className="flex flex-col gap-3 px-4">
        <FeatureGate feature="shifts">
          {shifts.length === 0 ? (
            <div className="wf-card p-6 text-center">
              <IClock size={28} className="mx-auto mb-2 text-[var(--wf-faint)]" />
              <p className="font-semibold">No shifts yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--wf-muted)]">
                People are currently measured against their contracted hours.
                Create a shift to configure grace, breaks and overtime in one
                place and assign it to the crew.
              </p>
            </div>
          ) : (
            shifts.map((sh) => (
              <div key={sh.id} className="wf-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* The name owns its line. Sharing it with the code and
                        kind chips clipped "General Shift" to "General Sh…"
                        while a short name showed in full, so one list read
                        two different ways. */}
                    <h2 className="wf-display truncate text-[1.05rem]">
                      {sh.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chip tone="neutral">{sh.code}</Chip>
                      <Chip tone={sh.kind === "overnight" ? "violet" : "blue"}>
                        {sh.kind}
                      </Chip>
                    </div>
                    <p className="mt-1 text-[1.05rem] font-semibold tabular-nums">
                      {sh.kind === "flexible"
                        ? `${Math.round(sh.requiredMinutes / 60)} working hours`
                        : `${fmtShiftTime(sh.startMinute)} → ${fmtShiftTime(sh.endMinute)}`}
                      {sh.kind === "overnight" ? (
                        <span className="ml-1 text-[0.72rem] text-[var(--wf-muted)]">
                          (+1 day)
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                      Assigned
                    </p>
                    <p className="wf-display text-lg tabular-nums">
                      {headcount.get(sh.id) ?? 0}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.76rem] text-[var(--wf-muted)]">
                  <span>Grace {sh.graceMinutes}m</span>
                  <span>
                    <ICoffee size={12} className="mr-1 inline" />
                    {sh.breakRules.length
                      ? sh.breakRules
                          .map(
                            (b) =>
                              `${b.name} ${b.durationMinutes}m ${b.paid ? "paid" : "unpaid"}`,
                          )
                          .join(" · ")
                      : "No scheduled breaks"}
                  </span>
                  <span>
                    OT{" "}
                    {sh.overtime.enabled
                      ? sh.overtime.method === "fixed-hourly"
                        ? `₹${sh.overtime.hourlyRate}/h after ${sh.overtime.graceMinutes}m grace`
                        : `${sh.overtime.tiers.map((t) => `${t.multiplier}×`).join(" / ")} after ${sh.overtime.graceMinutes}m grace`
                      : "off"}
                    {sh.overtime.approval === "manager" ? " · approval required" : ""}
                  </span>
                </div>

                <div className="mt-2 flex gap-1">
                  {DAY_LABELS.map((d, i) => (
                    <span
                      key={i}
                      className="grid h-6 w-6 place-items-center rounded-md text-[0.62rem] font-bold"
                      style={{
                        background: sh.workingDays.includes(i)
                          ? "var(--wf-fill)"
                          : "transparent",
                        color: sh.workingDays.includes(i)
                          ? "var(--wf-fg)"
                          : "var(--wf-faint)",
                      }}
                    >
                      {d}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex gap-2 border-t border-[var(--wf-line)] pt-3">
                  <button
                    className="wf-btn wf-btn-ghost wf-btn-sm"
                    onClick={() => setEditing(sh)}
                  >
                    Edit
                  </button>
                  <button
                    className="wf-btn wf-btn-ghost wf-btn-sm"
                    onClick={() => setAssigning(sh)}
                  >
                    <IUsers size={14} /> Assign
                  </button>
                  <button
                    className="wf-btn wf-btn-ghost wf-btn-sm ml-auto wf-btn-danger-text"
                    onClick={() => setDeleting(sh)}
                  >
                    <ITrash size={14} /> Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </FeatureGate>
      </div>

      <BottomSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Create shift" : "Edit shift"}
        tall
      >
        {editing ? (
          <ShiftEditor
            base={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={assigning ? `Assign — ${assigning.name}` : ""}
        tall
      >
        {assigning ? (
          <AssignSheet shift={assigning} onDone={() => setAssigning(null)} />
        ) : null}
      </BottomSheet>

      {/* Deleting a shift is not a small thing: the payroll engine reads
          these definitions, so the confirmation says what is still attached
          to it rather than asking "are you sure?" in the abstract. */}
      <BottomSheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete shift"
      >
        {deleting ? (
          <div className="flex flex-col gap-4">
            <p className="text-[0.9rem] leading-relaxed">
              Delete <span className="font-semibold">{deleting.name}</span>?
            </p>
            {(headcount.get(deleting.id) ?? 0) > 0 ? (
              <p className="wf-inset px-3.5 py-3 text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
                <span className="font-semibold text-[var(--wf-fg)]">
                  {headcount.get(deleting.id)} people
                </span>{" "}
                are on this shift today. They keep every hour already recorded,
                and fall back to their contracted hours until you assign them
                another shift.
              </p>
            ) : (
              <p className="wf-inset px-3.5 py-3 text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
                Nobody is on this shift. Attendance already recorded against it
                is unaffected.
              </p>
            )}
            <button
              className="wf-btn wf-btn-lg"
              style={{ background: "var(--wf-red)", color: "#fff" }}
              onClick={() => {
                wf.archiveShift(deleting.id);
                setDeleting(null);
              }}
            >
              <ITrash size={16} /> Delete shift
            </button>
            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => setDeleting(null)}
            >
              Keep it
            </button>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

/* -------------------------------------------------------------- editor */

function ShiftEditor({ base, onDone }: { base: ShiftDef | null; onDone: () => void }) {
  const wf = useWorkforce();
  const [name, setName] = useState(base?.name ?? "");
  const [kind, setKind] = useState<ShiftKind>(base?.kind ?? "fixed");
  const [start, setStart] = useState(base?.startMinute ?? 8 * 60 + 30);
  const [end, setEnd] = useState(base?.endMinute ?? 17 * 60 + 30);
  const [requiredHours, setRequiredHours] = useState(
    Math.round((base?.requiredMinutes ?? 480) / 60),
  );
  const [grace, setGrace] = useState(base?.graceMinutes ?? 15);
  const [days, setDays] = useState<number[]>(base?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const [breaks, setBreaks] = useState<BreakRule[]>(
    base?.breakRules ?? [
      { id: `brl_${Date.now()}`, name: "Lunch", startMinute: 13 * 60, endMinute: 13 * 60 + 45, durationMinutes: 45, paid: false },
    ],
  );
  const [maxBreaks, setMaxBreaks] = useState(base?.maxBreaksPerShift ?? 3);
  const [selfServe, setSelfServe] = useState(base?.employeeBreaksAllowed ?? true);
  // The shared default rather than a second copy of it — the local literal
  // silently drifted from OvertimeConfig the moment a field was added.
  const [ot, setOt] = useState<OvertimeConfig>(
    base?.overtime ?? { ...DEFAULT_OVERTIME },
  );

  const save = () => {
    if (!name.trim()) return;
    wf.saveShift(
      {
        name: name.trim(),
        kind,
        startMinute: start,
        endMinute: end,
        requiredMinutes: requiredHours * 60,
        graceMinutes: grace,
        workingDays: days,
        breakRules: breaks.filter((b) => b.name.trim()),
        maxBreaksPerShift: maxBreaks,
        employeeBreaksAllowed: selfServe,
        overtime: ot,
      },
      base?.id,
    );
    onDone();
  };

  const toggleDay = (i: number) =>
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));

  return (
    <div className="flex flex-col gap-4">
      <Field label="Shift name" required>
        <input
          className="wf-input"
          placeholder="e.g. General Shift"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Shift type">
        <Segmented
          ariaLabel="Shift type"
          value={kind}
          onChange={(v) => setKind(v as ShiftKind)}
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "flexible", label: "Flexible" },
            { value: "overnight", label: "Overnight" },
            { value: "custom", label: "Custom" },
          ]}
        />
      </Field>

      {kind === "flexible" ? (
        <Field label="Required working hours">
          <input
            className="wf-input"
            type="number"
            min={1}
            max={16}
            value={requiredHours}
            onChange={(e) => setRequiredHours(Number(e.target.value) || 8)}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <input
              className="wf-input"
              type="time"
              value={toHM(start)}
              onChange={(e) => setStart(fromHM(e.target.value, start))}
            />
          </Field>
          <Field
            label="End time"
            hint={kind === "overnight" ? "Next calendar day" : undefined}
          >
            <input
              className="wf-input"
              type="time"
              value={toHM(end)}
              onChange={(e) => setEnd(fromHM(e.target.value, end))}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Grace period (min)">
          <input
            className="wf-input"
            type="number"
            min={0}
            max={120}
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Breaks allowed per shift">
          <input
            className="wf-input"
            type="number"
            min={0}
            max={10}
            value={maxBreaks}
            onChange={(e) => setMaxBreaks(Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <Field label="Working days">
        <div className="flex gap-1.5">
          {DAY_LABELS.map((d, i) => (
            <button
              key={i}
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl text-[0.78rem] font-bold transition"
              style={{
                background: days.includes(i) ? "var(--wf-amber)" : "var(--wf-fill-3)",
                color: days.includes(i) ? "var(--wf-on-amber)" : "var(--wf-muted)",
              }}
              onClick={() => toggleDay(i)}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>

      {/* break rules */}
      <div className="wf-card2 p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Scheduled breaks
          </p>
          <button
            className="wf-btn wf-btn-ghost wf-btn-sm"
            onClick={() =>
              setBreaks((b) => [
                ...b,
                { id: `brl_${Date.now()}_${b.length}`, name: "", durationMinutes: 15, paid: false },
              ])
            }
          >
            <IPlus size={13} /> Add
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {breaks.map((b, i) => (
            <div key={b.id} className="flex items-center gap-2">
              <input
                className="wf-input min-w-[6.5rem] flex-1"
                placeholder="Name"
                value={b.name}
                onChange={(e) =>
                  setBreaks((all) =>
                    all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <input
                className="wf-input w-20 text-center"
                type="number"
                min={5}
                aria-label="Break minutes"
                value={b.durationMinutes}
                onChange={(e) =>
                  setBreaks((all) =>
                    all.map((x, j) =>
                      j === i ? { ...x, durationMinutes: Number(e.target.value) || 0 } : x,
                    ),
                  )
                }
              />
              <button
                className="wf-btn wf-btn-ghost wf-btn-sm w-20"
                onClick={() =>
                  setBreaks((all) =>
                    all.map((x, j) => (j === i ? { ...x, paid: !x.paid } : x)),
                  )
                }
              >
                {b.paid ? "Paid" : "Unpaid"}
              </button>
              <button
                className="cursor-pointer p-1.5 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
                aria-label="Remove break"
                onClick={() => setBreaks((all) => all.filter((_, j) => j !== i))}
              >
                <ITrash size={15} />
              </button>
            </div>
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between border-t border-[var(--wf-line)] pt-3 text-[0.82rem]">
          Workers can start breaks themselves
          <span
            className="wf-switch"
            data-on={selfServe}
            role="switch"
            aria-checked={selfServe}
            tabIndex={0}
            onClick={() => setSelfServe((v) => !v)}
            onKeyDown={(e) => e.key === "Enter" && setSelfServe((v) => !v)}
          />
        </label>
      </div>

      {/* overtime */}
      <div className="wf-card2 p-3.5">
        <label className="flex items-center justify-between text-[0.82rem] font-semibold">
          Overtime
          <span
            className="wf-switch"
            data-on={ot.enabled}
            role="switch"
            aria-checked={ot.enabled}
            tabIndex={0}
            onClick={() => setOt((o) => ({ ...o, enabled: !o.enabled }))}
            onKeyDown={(e) =>
              e.key === "Enter" && setOt((o) => ({ ...o, enabled: !o.enabled }))
            }
          />
        </label>
        {ot.enabled ? (
          <div className="mt-3 flex flex-col gap-3">
            {/* Two long labels in half a phone width left the Approval
                control scrolling sideways, so "Manager approval" sat off
                the edge and read as clipped. They get a row each until
                there is room for two. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="OT grace after shift end (min)">
                <input
                  className="wf-input"
                  type="number"
                  min={0}
                  value={ot.graceMinutes}
                  onChange={(e) =>
                    setOt((o) => ({ ...o, graceMinutes: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field label="Approval">
                <Segmented
                  size="sm"
                  ariaLabel="Overtime approval"
                  value={ot.approval}
                  onChange={(v) => setOt((o) => ({ ...o, approval: v as "auto" | "manager" }))}
                  options={[
                    { value: "auto", label: "Auto approve" },
                    { value: "manager", label: "Manager approval" },
                  ]}
                />
              </Field>
              <Field
                label="Minimum OT to count (min)"
                hint="Below this, staying late is not overtime."
              >
                <input
                  className="wf-input"
                  type="number"
                  min={0}
                  value={ot.minimumMinutes}
                  onChange={(e) =>
                    setOt((o) => ({ ...o, minimumMinutes: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field
                label="Count OT in blocks of"
                hint="Part-blocks are not credited, so a payslip reads 30 or 60 rather than 47."
              >
                <Segmented
                  size="sm"
                  ariaLabel="Overtime increment"
                  value={String(ot.incrementMinutes)}
                  onChange={(v) =>
                    setOt((o) => ({ ...o, incrementMinutes: Number(v) }))
                  }
                  options={[
                    { value: "15", label: "15 min" },
                    { value: "30", label: "30 min" },
                    { value: "0", label: "Every minute" },
                  ]}
                />
              </Field>
            </div>
            <Field label="Compensation method">
              <Segmented
                size="sm"
                ariaLabel="Overtime method"
                value={ot.method}
                onChange={(v) =>
                  setOt((o) => ({ ...o, method: v as "fixed-hourly" | "salary-multiplier" }))
                }
                options={[
                  { value: "salary-multiplier", label: "Salary multiplier" },
                  { value: "fixed-hourly", label: "Fixed hourly rate" },
                ]}
              />
            </Field>
            {ot.method === "fixed-hourly" ? (
              <Field label="Rate (₹ / overtime hour)">
                <input
                  className="wf-input"
                  type="number"
                  min={0}
                  value={ot.hourlyRate}
                  onChange={(e) =>
                    setOt((o) => ({ ...o, hourlyRate: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                    Multiplier tiers
                  </p>
                  <button
                    className="wf-btn wf-btn-ghost wf-btn-sm"
                    onClick={() =>
                      setOt((o) => ({
                        ...o,
                        tiers: [
                          ...o.tiers,
                          {
                            afterHours: (o.tiers[o.tiers.length - 1]?.afterHours ?? 0) + 2,
                            multiplier: 2,
                          },
                        ],
                      }))
                    }
                  >
                    <IPlus size={13} /> Tier
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {ot.tiers.map((t: OvertimeTier, i: number) => (
                    /* Fixed-width inputs plus three text labels overflow a
                       phone, and flex answers that by shrinking the text —
                       which wrapped "h of OT →" onto three lines, one word
                       each. The labels hold together and the row wraps. */
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.82rem]"
                    >
                      <span className="whitespace-nowrap text-[var(--wf-muted)]">After</span>
                      <input
                        className="wf-input wf-input-num shrink-0"
                        type="number"
                        min={0}
                        aria-label="Tier threshold hours"
                        value={t.afterHours}
                        onChange={(e) =>
                          setOt((o) => ({
                            ...o,
                            tiers: o.tiers.map((x, j) =>
                              j === i ? { ...x, afterHours: Number(e.target.value) || 0 } : x,
                            ),
                          }))
                        }
                      />
                      <span className="whitespace-nowrap text-[var(--wf-muted)]">h of OT →</span>
                      <input
                        className="wf-input wf-input-num shrink-0"
                        type="number"
                        step={0.25}
                        min={0}
                        aria-label="Tier multiplier"
                        value={t.multiplier}
                        onChange={(e) =>
                          setOt((o) => ({
                            ...o,
                            tiers: o.tiers.map((x, j) =>
                              j === i ? { ...x, multiplier: Number(e.target.value) || 0 } : x,
                            ),
                          }))
                        }
                      />
                      <span className="whitespace-nowrap text-[var(--wf-muted)]">× hourly rate</span>
                      {ot.tiers.length > 1 ? (
                        <button
                          className="ml-auto cursor-pointer p-1.5 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
                          aria-label="Remove tier"
                          onClick={() =>
                            setOt((o) => ({
                              ...o,
                              tiers: o.tiers.filter((_, j) => j !== i),
                            }))
                          }
                        >
                          <ITrash size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bonus after (OT hours)" hint="Blank = no bonus">
                <input
                  className="wf-input"
                  type="number"
                  min={0}
                  value={ot.bonusAfterHours ?? ""}
                  onChange={(e) =>
                    setOt((o) => ({
                      ...o,
                      bonusAfterHours:
                        e.target.value === "" ? null : Number(e.target.value) || 0,
                    }))
                  }
                />
              </Field>
              <Field label="Bonus amount (₹)">
                <input
                  className="wf-input"
                  type="number"
                  min={0}
                  value={ot.bonusAmount}
                  onChange={(e) =>
                    setOt((o) => ({ ...o, bonusAmount: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
            </div>
          </div>
        ) : null}
      </div>

      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        disabled={!name.trim()}
        onClick={save}
      >
        {base ? "Save shift" : "Create shift"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ assigning */

function AssignSheet({ shift, onDone }: { shift: ShiftDef; onDone: () => void }) {
  const wf = useWorkforce();
  const { state } = wf;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());

  const people = useMemo(
    () =>
      state.users.filter((u) => u.role !== "superadmin" && u.status === "active"),
    [state.users],
  );

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /*
   * Project quick-select.
   *
   * A chip is "on" when everyone it covers is currently ticked — derived
   * rather than stored, so it stays honest: unticking one person by hand
   * turns the chip off instead of leaving it lit over a partial selection.
   * That also means several projects can be on at once, which is the point.
   *
   * Only people actually in the list count. A project's employeeIds can
   * name someone inactive or since removed, and counting those would leave
   * a chip that could never reach "on" no matter how many you ticked.
   */
  const shownIds = useMemo(() => new Set(people.map((u) => u.id)), [people]);

  const membersOf = useCallback(
    (proj: Project) => proj.employeeIds.filter((id) => shownIds.has(id)),
    [shownIds],
  );

  const isProjectOn = useCallback(
    (proj: Project) => {
      const members = membersOf(proj);
      return members.length > 0 && members.every((id) => chosen.has(id));
    },
    [membersOf, chosen],
  );

  const toggleProject = (proj: Project) => {
    const members = membersOf(proj);
    if (members.length === 0) return;

    if (!isProjectOn(proj)) {
      setChosen((prev) => new Set([...prev, ...members]));
      return;
    }

    // Turning a project off removes its people — except anyone another
    // switched-on project still covers, who would otherwise vanish from a
    // selection the user never touched.
    const keep = new Set<string>();
    for (const other of state.projects) {
      if (other.id === proj.id || !isProjectOn(other)) continue;
      for (const id of membersOf(other)) keep.add(id);
    }
    setChosen((prev) => {
      const next = new Set(prev);
      for (const id of members) if (!keep.has(id)) next.delete(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Effective from"
        hint="Future dates schedule the change; the current shift applies until then."
      >
        <input
          className="wf-input"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </Field>

      {state.projects.length > 0 ? (
        <Field
          label="Quick select — everyone on a project"
          hint="Tap to add the crew, tap again to remove them. Several projects can be on at once."
        >
          {/* One row that scrolls sideways. Wrapping stacked four full
              project names down the sheet and pushed the people — the
              actual subject — below the fold. */}
          <div className="wf-scroll-x -mx-1 flex gap-2 px-1 pb-1">
            {state.projects.map((proj) => {
              const members = membersOf(proj);
              const on = isProjectOn(proj);
              return (
                <button
                  key={proj.id}
                  aria-pressed={on}
                  disabled={members.length === 0}
                  className={`wf-btn wf-btn-sm shrink-0 whitespace-nowrap ${
                    on ? "wf-btn-primary" : "wf-btn-ghost"
                  }`}
                  onClick={() => toggleProject(proj)}
                >
                  {on ? <ICheck size={14} /> : null}
                  {proj.name}
                  <span className="opacity-60 tabular-nums">{members.length}</span>
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      <EmployeePicker
        people={people}
        selected={chosen}
        onToggle={(u) => toggle(u.id)}
      />

      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        disabled={chosen.size === 0 || !effectiveFrom}
        onClick={() => {
          wf.assignShift([...chosen], shift.id, effectiveFrom);
          onDone();
        }}
      >
        Assign to {chosen.size} {chosen.size === 1 ? "person" : "people"} from{" "}
        {fmtDateLong(effectiveFrom)}
      </button>
    </div>
  );
}
