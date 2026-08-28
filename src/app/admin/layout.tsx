"use client";

import { ImpersonationBanner, RoleGuard, TabBar } from "@/components/shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard role="admin">
      <div className="mx-auto flex min-h-[calc(100dvh-var(--wf-safe-top))] w-full max-w-5xl flex-col">
        <ImpersonationBanner />
        <div className="min-h-0 flex-1 pb-4">{children}</div>
        <TabBar role="admin" />
      </div>
    </RoleGuard>
  );
}
