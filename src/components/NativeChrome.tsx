"use client";

/**
 * Keeps the device's status bar legible against the app's own theme.
 *
 * Capacitor's built-in SystemBars plugin defaults the bar style to the
 * *Android* theme, but Workfence carries its own light/dark preference —
 * so a phone in system-light running the app pinned to dark would paint
 * dark status icons on a black header. This syncs the two.
 *
 * `STYLE_DARK` means "dark surface behind the bar", which is what makes
 * Android render the clock and battery in white; `STYLE_LIGHT` is the
 * reverse. So the style tracks the resolved background, not the word.
 *
 * Reads the plugin off `window.Capacitor.Plugins` rather than importing
 * the runtime, matching lib/contacts.ts: the bridge injects a callable
 * object before the bundle runs, so no import and no registration is
 * needed, and off-device this is simply null and the effect does nothing.
 */

import { useEffect } from "react";
import { useTheme } from "@/lib/use-theme";

interface SystemBarsPlugin {
  setStyle?: (opts: { style: string; bar?: string }) => Promise<void>;
}

function systemBars(): SystemBarsPlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { SystemBars?: SystemBarsPlugin } };
  }).Capacitor;
  const plugin = cap?.Plugins?.SystemBars;
  return typeof plugin?.setStyle === "function" ? plugin : null;
}

export function NativeChrome() {
  const { resolved } = useTheme();

  useEffect(() => {
    const bars = systemBars();
    if (!bars?.setStyle) return;
    const style = resolved === "dark" ? "DARK" : "LIGHT";
    // Both bars: the gesture pill needs the same treatment as the clock.
    void bars.setStyle({ style }).catch(() => {
      /* older shell without the plugin — the theme default still applies */
    });
  }, [resolved]);

  return null;
}
