"use client";

/**
 * Appearance: follow the device, or pin it.
 *
 * Three options rather than a switch, because "system" is a real answer and
 * the most useful default — a phone that dims at sunset should take the app
 * with it. Collapsing that into on/off would force everyone to manage a
 * preference the device already manages.
 */

import { Segmented } from "@/components/ui";
import { useTheme } from "@/lib/use-theme";
import type { ThemePreference } from "@/lib/theme";

export function ThemeControl() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div className="flex flex-col gap-2">
      <Segmented<ThemePreference>
        size="sm"
        ariaLabel="Appearance"
        value={preference}
        onChange={setPreference}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <p className="text-[0.72rem] text-[var(--wf-muted)]">
        {preference === "system"
          ? `Following your device — currently ${resolved}.`
          : `Always ${preference}, whatever the device is set to.`}
      </p>
    </div>
  );
}
