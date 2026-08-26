"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  apply,
  readPreference,
  resolve,
  savePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

const listeners = new Set<() => void>();
function announce() {
  for (const l of listeners) l();
}

/**
 * The current preference and what it resolves to.
 *
 * Subscribed rather than held in state so every consumer — the settings
 * screen, the map, a header toggle — sees one value. It also listens to the
 * system query, so a device that flips to dark at sunset takes the app with
 * it while it is open, which is the whole point of choosing "system".
 */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onSystem = () => {
        // Only matters while following the device; an explicit choice wins.
        if (readPreference() === "system") apply("system");
        notify();
      };
      mq.addEventListener("change", onSystem);
      return () => {
        listeners.delete(notify);
        mq.removeEventListener("change", onSystem);
      };
    },
    () => readPreference(),
    () => "system" as ThemePreference,
  );

  const resolved = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", notify);
      return () => {
        listeners.delete(notify);
        mq.removeEventListener("change", notify);
      };
    },
    () => resolve(readPreference()),
    () => "dark" as ResolvedTheme,
  );

  const setPreference = useCallback((p: ThemePreference) => {
    savePreference(p);
    announce();
  }, []);

  return { preference, resolved, setPreference };
}
