"use client";

/**
 * Add/edit employee sheet shared by the workforce directory and the
 * manager's employee profile.
 */

import { useState } from "react";
import { useWorkforce } from "@/lib/store";
import type { User } from "@/lib/types";
import { BottomSheet, Field, Segmented } from "./ui";

const DEPARTMENTS = ["Civil", "MEP", "EHS", "Plant", "Quality"];

export function EmployeeEditor({
  editing,
  onClose,
  onSave,
}: {
  editing: User | null | "new";
  onClose: () => void;
  onSave: (patch: Partial<User> & { name: string }, id?: string) => void;
}) {
  const { state } = useWorkforce();
  const base = editing !== "new" && editing ? editing : null;
  const [name, setName] = useState(base?.name ?? "");
  const [code, setCode] = useState(base?.employeeCode ?? "");
  const [designation, setDesignation] = useState(base?.designation ?? "Worker");
  const [department, setDepartment] = useState(base?.department ?? "Civil");
  const [phone, setPhone] = useState(base?.phone ?? "");
  const [projectIds, setProjectIds] = useState<string[]>(base?.projectIds ?? []);
  const [status, setStatus] = useState<User["status"]>(base?.status ?? "active");
  const [error, setError] = useState("");

  return (
    <BottomSheet
      open={editing !== null}
      onClose={onClose}
      title={base ? `Edit — ${base.name}` : "Add employee"}
      tall
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Full name" required>
          <input className="wf-input" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </Field>
        {error ? <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee ID">
            <input className="wf-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" />
          </Field>
          <Field label="Phone">
            <input className="wf-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation">
            <input className="wf-input" value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </Field>
          <Field label="Department">
            <select className="wf-input" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Status">
          <Segmented
            ariaLabel="Employee status"
            value={status}
            onChange={setStatus}
            size="sm"
            options={[
              { value: "active", label: "Active" },
              { value: "on-leave", label: "On leave" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </Field>
        <div>
          <span className="wf-label">Assigned projects</span>
          <div className="flex flex-col gap-2">
            {state.projects.map((p) => {
              const on = projectIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                    on
                      ? "border-[var(--wf-amber)] bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]"
                      : "border-[var(--wf-line)] bg-[var(--wf-surface2)] text-[var(--wf-muted)]"
                  }`}
                  onClick={() =>
                    setProjectIds((ids) =>
                      on ? ids.filter((x) => x !== p.id) : [...ids, p.id],
                    )
                  }
                >
                  {p.name}
                  <span className="text-[0.68rem]">{on ? "Assigned" : "Tap to assign"}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          className="wf-btn wf-btn-primary"
          onClick={() => {
            if (name.trim().length < 3) {
              setError("Enter the employee's full name.");
              return;
            }
            onSave(
              {
                name: name.trim(),
                employeeCode: code.trim() || undefined,
                designation,
                department,
                phone,
                projectIds,
                status,
              },
              base?.id,
            );
          }}
        >
          {base ? "Save changes" : "Add employee"}
        </button>
      </div>
    </BottomSheet>
  );
}
