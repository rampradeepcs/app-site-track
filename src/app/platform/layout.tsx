"use client";

import { PlatformGuard, PlatformShell } from "@/components/platform/PlatformShell";

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PlatformGuard>
      <PlatformShell>{children}</PlatformShell>
    </PlatformGuard>
  );
}
