"use client";

/**
 * Interactive geofence editor for the manager. Supports circular fences
 * (drag the centre handle, radius slider) and custom polygons (tap to drop
 * vertices, drag to adjust), plus the buffer band that counts as "at the
 * gate".
 */

import { useState } from "react";
import { SiteMap } from "./SiteMap";
import { UseMyLocation } from "./UseMyLocation";
import { offsetMeters } from "@/lib/geo";
import type { Geofence, LatLng, Project } from "@/lib/types";
import { Segmented } from "./ui";
import { showToast } from "@/lib/toast";
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

  /*
   * Only while drawing a polygon does a tap mean anything.
   *
   * A circular fence used to move its centre on any tap the map did not read
   * as a pan — three pixels apart — so looking around a site with a steady
   * finger moved the boundary, and nothing said it had. Dragging the amber
   * handle is the deliberate gesture and was always there; the tap is gone.
   * Drawing a polygon is different: it is a mode entered on purpose, and
   * dropping corners is the whole of it.
   */
  const onMapClick = (p: LatLng) => {
    if (draft.kind === "polygon" && drawing) {
      patch({ polygon: [...draft.polygon, p] });
    }
  };

  const valid =
    draft.kind === "circle" ? draft.radius >= 40 : draft.polygon.length >= 3;

  return (
    <div className="flex flex-col gap-4">
      {/* The shape choice is the first decision on this screen, so it gets
          the full width rather than sharing a row with the draw tools. */}
      <div className="flex flex-col gap-3">
        <Segmented
          className="w-full"
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
          <div className="grid grid-cols-2 gap-2">
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={resetDefaultPolygon}>
              <IRefresh size={14} /> Auto shape
            </button>
            {/* Clear throws away a drawn boundary, so it is coloured like
                what it does rather than sitting quiet beside Auto shape. */}
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm wf-btn-danger-text"
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

      {/*
        A circular boundary is nearly always redrawn by somebody standing in
        the middle of it — a manager who has walked the ground and found the
        gate is not where the pin says. Dragging a handle across a map to a
        place you are already standing is the long way round.

        Only for a circle: a polygon has no single centre to move, and
        shifting every corner by the same offset is a different action that
        should be asked for, not implied by a button about location.
      */}
      {draft.kind === "circle" ? (
        <UseMyLocation
          label="Centre on my location"
          onPick={(here) => patch({ center: here })}
        />
      ) : null}

      <p className="text-xs leading-relaxed text-[var(--wf-muted)]">
        {draft.kind === "circle"
          ? "Drag the amber handle to move the fence centre; set the radius below."
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

      <div className="flex flex-col gap-2.5">
        {/* Saving settles the draft, so `dirty` clears and the button goes
            back to disabled — otherwise it stays lit over a boundary that
            is already saved and invites a second, identical save. */}
        <button
          className="wf-btn wf-btn-primary wf-btn-lg w-full"
          disabled={!valid || !dirty}
          onClick={() => {
            onSave(draft);
            setDirty(false);
            setDrawing(false);
            showToast("Geofence saved — check-in is limited to the new boundary");
          }}
        >
          <ICheck size={17} /> Save geofence
        </button>
        {onCancel && (
          <button className="wf-btn wf-btn-ghost w-full" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
