"use client";

/**
 * Editing a person.
 *
 * Opened from the workforce list, from a profile and from the admin's Team &
 * Roles, so where back goes is carried in the address rather than guessed.
 * A `from` that does not look like a path in this app is ignored: a back
 * button is not a place to accept an arbitrary destination from a URL.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EmployeeForm } from "@/components/EmployeeForm";
import { ScreenHeader } from "@/components/shell";
import { useWorkforce } from "@/lib/store";

export default function EditEmployeePage() {
  return (
    <Suspense fallback={null}>
      <EditEmployee />
    </Suspense>
  );
}

function EditEmployee() {
  const params = useSearchParams();
  const { state } = useWorkforce();
  const id = params.get("id") ?? "";
  const person = state.users.find((u) => u.id === id) ?? null;

  const from = params.get("from") ?? "";
  const backTo =
    from.startsWith("/") && !from.startsWith("//") ? from : "/manager/workforce";

  if (!person) {
    return (
      <div>
        <ScreenHeader back={backTo} title="Person not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          They may have been removed from this company.
        </p>
      </div>
    );
  }
  /* Keyed on the person, so opening another one starts from their values
     rather than from what was typed against the last. */
  return <EmployeeForm key={person.id} base={person} backTo={backTo} />;
}
