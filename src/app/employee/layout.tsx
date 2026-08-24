"use client";

import { RoleGuard, StatusStrip, TabBar } from "@/components/shell";

export default function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard role="employee">
      <div className="wf-phone">
        <StatusStrip />
        <div className="min-h-0 flex-1 pb-4">{children}</div>
        <TabBar role="employee" />
      </div>
    </RoleGuard>
  );
}
