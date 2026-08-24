"use client";

/**
 * Work updates — log progress during the shift and browse everything
 * submitted before, grouped by day, with sync state visible.
 */

import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { WorkUpdateForm } from "@/components/WorkUpdateForm";
import { BottomSheet, Chip, EmptyState, StatusChip } from "@/components/ui";
import { fmtDateLong, fmtTime } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import {
  IClipboard,
  IImage,
  IMapPin,
  IMic,
  IPlus,
} from "@/components/WfIcons";

export default function EmployeeUpdates() {
  const { state, currentUser, openShift } = useWorkforce();
  const [adding, setAdding] = useState(false);

  const mine = useMemo(
    () =>
      state.updates
        .filter((u) => u.employeeId === currentUser?.id)
        .sort((a, b) => b.at - a.at),
    [state.updates, currentUser],
  );

  const groups = useMemo(() => {
    const m = new Map<string, typeof mine>();
    for (const u of mine) {
      const list = m.get(u.date) ?? [];
      list.push(u);
      m.set(u.date, list);
    }
    return [...m.entries()];
  }, [mine]);

  return (
    <div>
      <ScreenHeader
        title="Work Updates"
        sub={`${mine.length} update${mine.length === 1 ? "" : "s"} submitted`}
        action={
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => setAdding(true)}>
            <IPlus size={15} /> Add
          </button>
        }
      />
      <div className="flex flex-col gap-5 px-4">
        {!openShift && (
          <p className="wf-inset px-3.5 py-2.5 text-[0.78rem] leading-snug text-[var(--wf-muted)]">
            You&apos;re not on shift — updates you add now are logged without an
            attendance session.
          </p>
        )}
        {groups.length === 0 && (
          <EmptyState
            icon={<IClipboard size={30} />}
            title="No work updates yet"
            body="Log what you're working on — location and time attach automatically."
            action={
              <button className="wf-btn wf-btn-primary" onClick={() => setAdding(true)}>
                <IPlus size={16} /> Add first update
              </button>
            }
          />
        )}
        {groups.map(([date, list]) => (
          <section key={date}>
            <h2 className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.09em] text-[var(--wf-faint)]">
              {fmtDateLong(date)}
            </h2>
            <div className="flex flex-col gap-2.5">
              {list.map((u) => (
                <article key={u.id} className="wf-card2 p-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[0.78rem] font-bold tabular-nums text-[var(--wf-amber)]">
                      {fmtTime(u.at)}
                    </span>
                    <Chip tone={u.kind === "daily" ? "blue" : "neutral"}>
                      {u.kind === "daily" ? "Daily summary" : u.category}
                    </Chip>
                    <span className="ml-auto">
                      <StatusChip status={u.status} />
                    </span>
                  </div>
                  <p className="text-[0.9rem] leading-relaxed">{u.description}</p>
                  {u.kind === "daily" && (u.completed || u.blockers) ? (
                    <div className="mt-2 flex flex-col gap-1 border-t border-[var(--wf-line)] pt-2 text-[0.78rem] text-[var(--wf-muted)]">
                      {u.completed ? <p>✓ {u.completed}</p> : null}
                      {u.blockers ? (
                        <p className="text-[var(--wf-amber)]">⚠ {u.blockers}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.7rem] text-[var(--wf-faint)]">
                    {u.place ? (
                      <span className="flex items-center gap-1">
                        <IMapPin size={11} /> {u.place}
                      </span>
                    ) : null}
                    {u.photos.length ? (
                      <span className="flex items-center gap-1">
                        <IImage size={11} /> {u.photos.length} photo{u.photos.length > 1 ? "s" : ""}
                      </span>
                    ) : null}
                    {u.voiceNoteSeconds ? (
                      <span className="flex items-center gap-1">
                        <IMic size={11} /> {u.voiceNoteSeconds}s
                      </span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add work update" tall>
        <WorkUpdateForm kind="shift" onDone={() => setAdding(false)} />
      </BottomSheet>
    </div>
  );
}
