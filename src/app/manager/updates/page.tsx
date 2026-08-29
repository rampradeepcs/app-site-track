"use client";

/**
 * The work-update feed — its own screen.
 *
 * It is a stream you read, which is a page, not a segment sharing a
 * scroll position with a settings form.
 */

import { ScreenHeader } from "@/components/shell";
import { Avatar, Chip } from "@/components/ui";
import { fmtDateLong, fmtTime } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import { IMapPin } from "@/components/WfIcons";

export default function ManagerUpdates() {
  const { state } = useWorkforce();
  return (
    <div>
      <ScreenHeader
        back
        title="Work updates"
        sub={`${state.updates.length} from the site`}
      />
      <div className="flex flex-col gap-3 px-4">
          <div className="flex flex-col gap-2.5">
            {state.updates.slice(0, 30).map((u) => {
              const emp = state.users.find((x) => x.id === u.employeeId);
              const proj = state.projects.find((p) => p.id === u.projectId);
              return (
                <article key={u.id} className="wf-card2 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar name={emp?.name ?? "?"} hue={emp?.avatarHue ?? 0} size={26} />
                    <span className="text-[0.82rem] font-semibold">{emp?.name}</span>
                    <Chip tone={u.kind === "daily" ? "blue" : "neutral"}>
                      {u.kind === "daily" ? "Daily" : u.category}
                    </Chip>
                    <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                      {fmtDateLong(u.date)} · {fmtTime(u.at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
                    {u.description}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[0.66rem] text-[var(--wf-faint)]">
                    {proj?.name}
                    {u.place ? (
                      <span className="flex items-center gap-1">
                        · <IMapPin size={10} /> {u.place}
                      </span>
                    ) : null}
                  </p>
                </article>
              );
            })}
          </div>
      </div>
    </div>
  );
}
