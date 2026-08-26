/**
 * Appearance: system, light or dark.
 *
 * The preference lives in its own localStorage key rather than inside the
 * workforce store, for one reason: it has to be readable by a script that
 * runs before React exists. The store's blob is large, versioned and can be
 * discarded on a shape change — none of which you want standing between a
 * page load and knowing what colour to paint.
 *
 * `data-theme` on the html element is always a resolved value, never
 * "system". Resolving in one place means the stylesheet needs a single light
 * block instead of duplicating it into a prefers-color-scheme query.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "workfence.theme";
const MEDIA = "(prefers-color-scheme: light)";

export function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode — fall through to the device default */
  }
  return "system";
}

export function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia(MEDIA).matches
    ? "light"
    : "dark";
}

export function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

/** Writes the resolved theme where CSS can see it. */
export function apply(pref: ThemePreference): ResolvedTheme {
  const resolved = resolve(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function savePreference(pref: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* the choice still applies for this session */
  }
  return apply(pref);
}

/**
 * Runs before first paint, inlined into the document head.
 *
 * Kept as a string because it must execute synchronously ahead of the
 * bundle: anything deferred means a flash of the wrong theme, which is
 * worse on this app than most — a worker opening it at night would get a
 * white screen in the face.
 */
export const PREPAINT_SCRIPT = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";
var r=p==="light"||p==="dark"?p:(matchMedia(${JSON.stringify(MEDIA)}).matches?"light":"dark");
document.documentElement.setAttribute("data-theme",r);
}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
