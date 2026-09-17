"use client";

/**
 * Adding a person — its own screen, like every other thing this app creates.
 */

import { EmployeeForm } from "@/components/EmployeeForm";

export default function NewEmployeePage() {
  return <EmployeeForm base={null} backTo="/manager/workforce" />;
}
