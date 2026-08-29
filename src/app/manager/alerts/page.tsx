"use client";

/**
 * Alerts — its own screen.
 *
 * Marking them read is the point of opening it, so that happens on
 * arrival rather than waiting for a tab to be selected.
 */

import { useEffect } from "react";
import { useNowTick } from "@/components/ui";
import { ScreenHeader } from "@/components/shell";
import { fmtRelative } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import { IAlert, ICheckCircle, IInfo } from "@/components/WfIcons";

export default function ManagerAlerts() {
  const { state, markNotificationsRead } = useWorkforce();
  const alerts = state.notifications.filter((n) => n.audience === "manager");
  const now = useNowTick(30);

  useEffect(() => {
    markNotificationsRead("manager");
  }, [markNotificationsRead]);

  return (
    <div>
      <ScreenHeader
        back
        title="Alerts"
        sub={`${alerts.length} notification${alerts.length === 1 ? "" : "s"}`}
      />
      <div className="flex flex-col gap-3 px-4">
          <div className="flex flex-col gap-2">
            {alerts.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--wf-muted)]">No notifications.</p>
            )}
            {alerts.slice(0, 40).map((n) => (
              <div key={n.id} className={`wf-card2 flex items-start gap-3 px-3.5 py-3 ${n.read ? "opacity-70" : ""}`}>
                <span
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: "var(--wf-surface3)",
                    color:
                      n.severity === "critical"
                        ? "var(--wf-red)"
                        : n.severity === "warning"
                          ? "var(--wf-amber)"
                          : n.severity === "success"
                            ? "var(--wf-green)"
                            : "var(--wf-blue)",
                  }}
                >
                  {n.severity === "success" ? <ICheckCircle size={16} /> : n.severity === "info" ? <IInfo size={16} /> : <IAlert size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.86rem] font-semibold leading-snug">{n.title}</p>
                  <p className="text-[0.76rem] leading-snug text-[var(--wf-muted)]">{n.body}</p>
                  <p className="mt-0.5 text-[0.66rem] text-[var(--wf-faint)]">{fmtRelative(n.at, now)}</p>
                </div>
              </div>
            ))}
          </div>
      </div>
    </div>
  );
}
