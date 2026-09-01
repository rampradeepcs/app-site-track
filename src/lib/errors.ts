/**
 * Turn anything thrown into a sentence a person can read.
 *
 * `e instanceof Error ? e.message : String(e)` looks like it covers the
 * ground and does not. PostgREST and GoTrue reject with plain objects —
 * `{ code, message, details, hint }` — which are not Error instances, so
 * String() renders them "[object Object]". That is what a site supervisor
 * saw at the top of the screen when a check-in failed to reach the server:
 * an alert that told them something was wrong and nothing about what.
 *
 * Order matters. `message` is the human sentence; `details` and `hint` are
 * Postgres's own follow-ups and are better than nothing when message is
 * absent; `error_description` and `error` are what OAuth returns.
 */

const FIELDS = [
  "message",
  "error_description",
  "error_message",
  "details",
  "hint",
  "error",
] as const;

export function describeError(e: unknown): string {
  if (typeof e === "string") return e.trim() || FALLBACK;
  if (e instanceof Error) return e.message.trim() || FALLBACK;

  if (e && typeof e === "object") {
    const bag = e as Record<string, unknown>;
    for (const field of FIELDS) {
      const v = bag[field];
      if (typeof v === "string" && v.trim()) return v.trim();
      /* OAuth sometimes nests the real reason one level down. */
      if (v && typeof v === "object") {
        const nested = (v as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
  }
  return FALLBACK;
}

const FALLBACK = "Something went wrong.";

/**
 * The same, ending in a full stop.
 *
 * For the places that drop the reason into the middle of a sentence, where
 * a message without one runs into the next clause.
 */
export function describeErrorSentence(e: unknown): string {
  const text = describeError(e);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
