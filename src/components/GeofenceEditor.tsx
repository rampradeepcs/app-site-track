"use client";

/**
 * Interactive geofence editor for the manager. Supports circular fences
 * (drag centre, radius slider) and custom polygons (tap to drop vertices,
 * drag to adjust), plus the buffer band that counts as "at the gate".
 */

import { useState } from "react";
import { SiteMap } from "./SiteMap";
import { offsetMeters } from "@/lib/geo";
import type { Geofence, LatLng, Project } from "@/lib/types";
import { Segmented } from "./ui";
import { ICheck, IRefresh, ITrash } from "./WfIcons";

export function GeofenceEditor({
  project,
  onSave,
  onCancel,
}: {
  project: Project;
  onSave: (fence: Geofence) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Geofence>(() => ({
    ...project.geofence,
    polygon: [...project.geofence.polygon],
  }));
  const [drawing, setDrawing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const patch = (p: Partial<Geofence>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const startPolygon = () => {
    patch({ kind: "polygon", polygon: [] });
    setDrawing(true);
  };

  const resetDefaultPolygon = () => {
    const poly = [0, 60, 120, 180, 240, 300].map((b) =>
      offsetMeters(draft.center, draft.radius, b + 10),
    );
    patch({ kind: "polygon", polygon: poly });
    setDrawing(false);
  };

  const onMapClick = (p: LatLng) => {
    if (draft.kind === "polygon" && drawing) {
      patch({ polygon: [...draft.polygon, p] });
    } else if (draft.kind === "circle") {
      patch({ center: p });
    }
  };

  const valid =
    draft.kind === "circle" ? draft.radius >= 40 : draft.polygon.length >= 3;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Geofence shape"
          value={draft.kind}
          onChange={(kind) => {
            if (kind === "circle") {
              patch({ kind: "circle" });
              setDrawing(false);
            } else if (draft.polygon.length >= 3) {
              patch({ kind: "polygon" });
            } else {
              startPolygon();
            }
          }}
          options={[
            { value: "circle", label: "Circular" },
            { value: "polygon", label: "Custom polygon" },
          ]}
        />
        {draft.kind === "polygon" && (
          <div className="flex gap-2">
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={resetDefaultPolygon}>
              <IRefresh size={14} /> Auto shape
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm"
              onClick={() => {
                patch({ polygon: [] });
                setDrawing(true);
              }}
            >
              <ITrash size={14} /> Clear
            </button>
          </div>
        )}
      </div>

      <SiteMap
        project={project}
        fence={draft}
        heightClass="h-[320px] md:h-[400px]"
        onMapClick={onMapClick}
        onVertexDrag={
          draft.kind === "polygon"
            ? (i, p) => {
                setDraft((d) => {
                  const polygon = [...d.polygon];
                  polygon[i] = p;
                  return { ...d, polygon };
                });
                setDirty(true);
              }
            : undefined
        }
        onCenterDrag={
          draft.kind === "circle" ? (p) => patch({ center: p }) : undefined
        }
        markers={[
          {
            id: "site",
            coords: project.location,
            kind: "site",
            color: "var(--wf-orange)",
            label: project.name,
          },
        ]}
      />

      <p className="text-xs leading-relaxed text-[var(--wf-muted)]">
        {draft.kind === "circle"
          ? "Tap the map (or drag the amber handle) to move the fence centre; set the radius below."
          : drawing && draft.polygon.length < 3
            ? `Tap the map to drop boundary corners — ${Math.max(0, 3 - draft.polygon.length)} more needed.`
            : "Drag the amber handles to reshape the boundary, or tap the map to append another corner."}{" "}
        Workers can only check in <strong>inside</strong> this boundary.
      </p>

      {draft.kind === "circle" && (
        <label className="wf-card2 flex items-center gap-4 px-4 py-3">
          <span className="w-24 shrink-0 text-[0.74rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Radius
          </span>
          <input
            type="range"
            min={40}
            max={500}
            step={10}
            value={draft.radius}
            onChange={(e) => patch({ radius: Number(e.target.value) })}
            className="flex-1 accent-[var(--wf-amber)]"
          />
          <span className="w-14 text-right text-sm font-bold tabular-nums">
            {draft.radius}m
          </span>
        </label>
      )}

      <label className="wf-card2 flex items-center gap-4 px-4 py-3">
        <span className="w-24 shrink-0 text-[0.74rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
          Gate buffer
        </span>
        <input
          type="range"
          min={0}
          max={120}
          step={5}
          value={draft.bufferMeters}
          onChange={(e) => patch({ bufferMeters: Number(e.target.value) })}
          className="flex-1 accent-[var(--wf-amber)]"
        />
        <span className="w-14 text-right text-sm font-bold tabular-nums">
          {draft.bufferMeters}m
        </span>
      </label>

      <div className="flex justify-end gap-2.5">
        {onCancel && (
          <button className="wf-btn wf-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          className="wf-btn wf-btn-primary"
          disabled={!valid || !dirty}
          onClick={() => onSave(draft)}
        >
          <ICheck size={17} /> Save geofence
        </button>
      </div>
    </div>
  );
}
