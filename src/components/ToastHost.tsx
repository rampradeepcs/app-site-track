"use client";

/**
 * Renders the confirmation pills raised by lib/toast.
 *
 * One at a time, bottom-centred, clearing the tab bar by the same measured
 * offset the demo chip uses. It is not a dialog: it steals no focus, takes
 * no tap, and leaves on its own, because the action it is confirming has
 * already happened and there is nothing to decide.
 *
 * `role="status"` with `aria-live="polite"` so a screen reader hears the
 * same confirmation at the same moment, without interrupting.
 */

import { useEffect, useRef, useState } from "react";
import { subscribeToast, type Toast } from "@/lib/toast";
import { ICheck, IAlert } from "./WfIcons";

const DWELL_MS = 2600;

export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      subscribeToast((t) => {
        // A newer message replaces the current one rather than queueing:
        // by the time a queue drained, the pill would be describing an
        // action several taps in the past.
        if (timer.current) clearTimeout(timer.current);
        setToast(t);
        timer.current = setTimeout(() => setToast(null), DWELL_MS);
      }),
    [],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!toast) return null;

  return (
    <div className="wf-toast" role="status" aria-live="polite" key={toast.id}>
      <span
        aria-hidden
        className="shrink-0"
        style={{
          color:
            toast.tone === "danger"
              ? "var(--wf-red)"
              : toast.tone === "info"
                ? "var(--wf-blue)"
                : "var(--wf-green)",
        }}
      >
        {toast.tone === "danger" ? <IAlert size={15} /> : <ICheck size={15} />}
      </span>
      <span className="min-w-0">{toast.message}</span>
    </div>
  );
}
