"use client";

/**
 * Salary & Compensation on the employee profile — plus the shift they are on.
 *
 * Salary is the most closely-held record in the product (spec §11, §24):
 * admins always see it, managers only when the org's pay policy says so, and
 * an employee never sees anyone's but their own — enforced here by rendering
 * nothing rather than by hoping a screen forgets to link to it. History is
 * append-only: a revision adds a record, nothing overwrites.
 */

import { useMemo, useState } from "react";
import { useFeature } from "./FeatureGate";
import { Chip, Field, Segmented, SectionTitle } from "./ui";
import { fmtDateLong, fmtShiftTime, todayISO } from "@/lib/format";
import {
  compFor,
  fmtINR,
  ratesOf,
  shiftFor,
  upcomingShiftFor,
} from "@/lib/payroll";
import { useWorkforce } from "@/lib/store";
import { VEHICLE_LABEL } from "@/lib/allowances";
import type { SalaryType, User, Vehicle, VehicleType } from "@/lib/types";
import { IClock, INav, IWallet } from "./WfIcons";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Compact "Monday–Saturday" from a working-day set, when contiguous. */
function daysLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return "—";
  const contiguous = sorted.every(
    (d, i) => i === 0 || d === sorted[i - 1] + 1,
  );
  return contiguous && sorted.length > 2
    ? `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`
    : sorted.map((d) => DAY_NAMES[d]).join(", ");
}

export function SalaryAndShiftSection({ user }: { user: User }) {
  const wf = useWorkforce();
  const { state, currentUser } = wf;
  const today = todayISO();
  const salaryOn = useFeature("salary");
  const shiftsOn = useFeature("shifts");

  const shift = useMemo(() => shiftFor(state, user.id, today), [state, user.id, today]);
  const upcoming = useMemo(
    () => upcomingShiftFor(state, user.id, today),
    [state, user.id, today],
  );
  const comp = useMemo(() => compFor(state, user.id, today), [state, user.id, today]);
  const history = useMemo(
    () =>
      state.comp
        .filter((c) => c.employeeId === user.id)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)),
    [state.comp, user.id],
  );

  // Who may see money: admins and the platform owner always; managers only
  // when the org's policy grants it. Everyone may see the shift.
  const role = currentUser?.role;
  const canSeeSalary =
    role === "admin" ||
    role === "superadmin" ||
    (role === "manager" && state.payPolicy.managerSeesSalary);

  const [editing, setEditing] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(false);
  const petrolOn = useFeature("petrolAllowance");

  return (
    <>
      {shiftsOn && shift ? (
        <div>
          <SectionTitle>Current shift</SectionTitle>
          <div className="wf-card flex items-center gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IClock size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{shift.name}</p>
              <p className="text-[0.78rem] tabular-nums text-[var(--wf-muted)]">
                {shift.kind === "flexible"
                  ? `${Math.round(shift.requiredMinutes / 60)} working hours`
                  : `${fmtShiftTime(shift.startMinute)} – ${fmtShiftTime(shift.endMinute)}`}
                {" · "}
                {daysLabel(shift.workingDays)}
              </p>
              {upcoming ? (
                <p className="mt-0.5 text-[0.72rem] text-[var(--wf-blue)]">
                  → {upcoming.shift.name} effective {fmtDateLong(upcoming.effectiveFrom)}
                </p>
              ) : null}
            </div>
            <Chip tone="neutral">{shift.code}</Chip>
          </div>
        </div>
      ) : null}

      {salaryOn && canSeeSalary ? (
        <div>
          <div className="flex items-center justify-between">
            <SectionTitle>Salary & compensation</SectionTitle>
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Close" : comp ? "Revise" : "Set salary"}
            </button>
          </div>

          {comp ? (
            <div className="wf-card flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-green-soft)] text-[var(--wf-green)]">
                <IWallet size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="wf-display text-lg font-bold tabular-nums">
                  {fmtINR(comp.amount)}
                  <span className="text-[0.8rem] font-semibold text-[var(--wf-muted)]">
                    {" "}
                    / {comp.type === "monthly" ? "month" : comp.type === "daily" ? "day" : "hour"}
                  </span>
                </p>
                <p className="text-[0.72rem] tabular-nums text-[var(--wf-muted)]">
                  ≈ {fmtINR(ratesOf(comp).daily)}/day · {fmtINR(ratesOf(comp).hourly)}/hour ·
                  effective {fmtDateLong(comp.effectiveFrom)}
                </p>
              </div>
            </div>
          ) : (
            <p className="wf-card2 p-4 text-[0.82rem] text-[var(--wf-muted)]">
              No salary configured — this person's attendance generates no pay
              until one is set.
            </p>
          )}

          {editing ? (
            <div className="mt-3">
              <SalaryForm
                user={user}
                onDone={() => setEditing(false)}
              />
            </div>
          ) : null}

          {petrolOn ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  Vehicle
                </p>
                <button
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  onClick={() => setEditingVehicle((v) => !v)}
                >
                  {editingVehicle ? "Close" : user.vehicle ? "Edit" : "Assign"}
                </button>
              </div>
              {user.vehicle ? (
                <div className="wf-card2 mt-1.5 flex items-center gap-3 px-4 py-3">
                  <INav size={16} className="shrink-0 text-[var(--wf-blue)]" />
                  <p className="min-w-0 flex-1 text-[0.84rem]">
                    <span className="font-semibold">{VEHICLE_LABEL[user.vehicle.type]}</span>
                    <span className="text-[var(--wf-muted)]">
                      {" "}· {user.vehicle.ownership}
                      {user.vehicle.registration ? ` · ${user.vehicle.registration}` : ""}
                      {user.vehicle.fuelType ? ` · ${user.vehicle.fuelType}` : ""}
                    </span>
                  </p>
                </div>
              ) : !editingVehicle ? (
                <p className="wf-card2 mt-1.5 px-4 py-3 text-[0.78rem] text-[var(--wf-muted)]">
                  No vehicle assigned — travel earns no petrol allowance.
                </p>
              ) : null}
              {editingVehicle ? (
                <VehicleForm user={user} onDone={() => setEditingVehicle(false)} />
              ) : null}
            </div>
          ) : null}

          {history.length > 1 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                Salary history
              </p>
              <div className="wf-card2 divide-y divide-[var(--wf-line)]">
                {history.map((c) => {
                  const by = state.users.find((u) => u.id === c.setBy);
                  return (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                      <span>
                        <span className="block text-[0.82rem] font-semibold tabular-nums">
                          {fmtINR(c.amount)} / {c.type}
                        </span>
                        <span className="block text-[0.68rem] text-[var(--wf-muted)]">
                          {c.note ? `${c.note} · ` : ""}set by {by?.name ?? "—"}
                        </span>
                      </span>
                      <span className="text-[0.72rem] tabular-nums text-[var(--wf-muted)]">
                        {fmtDateLong(c.effectiveFrom)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function VehicleForm({ user, onDone }: { user: User; onDone: () => void }) {
  const wf = useWorkforce();
  const [type, setType] = useState<VehicleType>(user.vehicle?.type ?? "two-wheeler");
  const [ownership, setOwnership] = useState<Vehicle["ownership"]>(
    user.vehicle?.ownership ?? "personal",
  );
  const [registration, setRegistration] = useState(user.vehicle?.registration ?? "");
  const [fuelType, setFuelType] = useState(user.vehicle?.fuelType ?? "Petrol");
  return (
    <div className="wf-card mt-2 flex flex-col gap-3.5 p-4">
      <Field label="Vehicle type">
        <Segmented
          size="sm"
          ariaLabel="Vehicle type"
          value={type}
          onChange={(v) => setType(v as VehicleType)}
          options={[
            { value: "two-wheeler", label: "Two wheeler" },
            { value: "four-wheeler", label: "Four wheeler" },
          ]}
        />
      </Field>
      <Field label="Ownership">
        <Segmented
          size="sm"
          ariaLabel="Ownership"
          value={ownership}
          onChange={(v) => setOwnership(v as Vehicle["ownership"])}
          options={[
            { value: "personal", label: "Personal" },
            { value: "company", label: "Company" },
            { value: "rental", label: "Rental" },
            { value: "other", label: "Other" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Registration">
          <input
            className="wf-input"
            placeholder="TN 00 AB 0000"
            value={registration}
            onChange={(e) => setRegistration(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Fuel">
          <input
            className="wf-input"
            value={fuelType}
            onChange={(e) => setFuelType(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <button
          className="wf-btn wf-btn-primary flex-1"
          onClick={() => {
            wf.saveVehicle(user.id, {
              type,
              ownership,
              registration: registration.trim() || undefined,
              fuelType: fuelType.trim() || undefined,
            });
            onDone();
          }}
        >
          Save vehicle
        </button>
        {user.vehicle ? (
          <button
            className="wf-btn wf-btn-ghost text-[var(--wf-red)]"
            onClick={() => {
              wf.saveVehicle(user.id, null);
              onDone();
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SalaryForm({ user, onDone }: { user: User; onDone: () => void }) {
  const wf = useWorkforce();
  const [type, setType] = useState<SalaryType>("monthly");
  const [amount, setAmount] = useState(0);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [workingDays, setWorkingDays] = useState(26);
  const [dayHours, setDayHours] = useState(8);
  const [note, setNote] = useState("");

  return (
    <div className="wf-card flex flex-col gap-3.5 p-4">
      <Field label="Salary type">
        <Segmented
          ariaLabel="Salary type"
          value={type}
          onChange={(v) => setType(v as SalaryType)}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "daily", label: "Daily wage" },
            { value: "hourly", label: "Hourly" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={`Amount (₹ / ${type === "monthly" ? "month" : type === "daily" ? "day" : "hour"})`}
          required
        >
          <input
            className="wf-input"
            type="number"
            min={0}
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Effective from">
          <input
            className="wf-input"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Working days / month">
          <input
            className="wf-input"
            type="number"
            min={1}
            max={31}
            value={workingDays}
            onChange={(e) => setWorkingDays(Number(e.target.value) || 26)}
          />
        </Field>
        <Field label="Standard hours / day">
          <input
            className="wf-input"
            type="number"
            min={1}
            max={16}
            value={dayHours}
            onChange={(e) => setDayHours(Number(e.target.value) || 8)}
          />
        </Field>
      </div>
      <Field label="Reason / note" hint="Recorded in the salary history and audit trail.">
        <input
          className="wf-input"
          placeholder="e.g. Annual revision"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <button
        className="wf-btn wf-btn-primary"
        disabled={amount <= 0 || !effectiveFrom}
        onClick={() => {
          wf.saveComp({
            employeeId: user.id,
            type,
            amount,
            effectiveFrom,
            workingDaysPerMonth: workingDays,
            standardDayMinutes: dayHours * 60,
            note: note.trim() || undefined,
          });
          onDone();
        }}
      >
        Save salary revision
      </button>
    </div>
  );
}
