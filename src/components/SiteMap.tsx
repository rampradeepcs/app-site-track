"use client";

/**
 * SiteMap — the map engine behind every Workfence surface.
 *
 * Renders real OpenStreetMap raster tiles (© OpenStreetMap contributors,
 * https://www.openstreetmap.org/copyright) on a pannable/zoomable
 * Web-Mercator canvas in SVG, with the project geofence (polygon or
 * circle + buffer band), named site zones, movement polylines with
 * playback support, and rich markers on top. "dark" style runs the tiles
 * through a CSS invert filter to match the app theme; "light" shows the
 * standard OSM cartography. A procedural ground layer stays underneath as
 * an offline fallback while tiles load (or when there is no network).
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  boundsOf,
  fencePoints,
  mercator,
  metersPerPixel,
  unmercator,
} from "@/lib/geo";
import { useTheme } from "@/lib/use-theme";
import type { Geofence, LatLng, Project } from "@/lib/types";
import { ICrosshair, IMinus, IPlus } from "./WfIcons";

export interface MapMarker {
  id: string;
  coords: LatLng;
  label?: string;
  sub?: string;
  color?: string;
  kind?: "worker" | "start" | "end" | "point" | "site" | "playhead";
  pulse?: boolean;
  hue?: number;
  initials?: string;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
}

export interface TrailPoint {
  lat: number;
  lng: number;
  at: number;
  /**
   * Opens a new stretch of recording. Trails from `outside-only` projects are
   * a series of separate trips, and joining them would draw a route the
   * worker never took — straight through the site nobody was watching.
   */
  segmentStart?: boolean;
}

interface View {
  center: LatLng;
  zoom: number; // fractional web-mercator zoom
}

const MIN_ZOOM = 14;
const MAX_ZOOM = 20.5;
/** OSM raster tiles top out at z19; beyond that we upscale the z19 tiles. */
const MAX_TILE_ZOOM = 19;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
/** Approximates a dark basemap from standard OSM tiles. */

function fitView(points: LatLng[], width: number, height: number): View {
  if (!points.length) return { center: { lat: 11.03, lng: 77.0 }, zoom: 16 };
  const b = boundsOf(points, 30);
  const center = {
    lat: (b.min.lat + b.max.lat) / 2,
    lng: (b.min.lng + b.max.lng) / 2,
  };
  const a = mercator(b.min);
  const c = mercator(b.max);
  const dx = Math.abs(c.x - a.x);
  const dy = Math.abs(c.y - a.y);
  let zoom = 17;
  if (dx > 0 && dy > 0 && width > 0 && height > 0) {
    const zx = Math.log2((width * 0.86) / (dx * 256));
    const zy = Math.log2((height * 0.86) / (dy * 256));
    zoom = Math.min(zx, zy);
  }
  return { center, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) };
}

export function SiteMap({
  project,
  fence,
  markers = [],
  trail = [],
  trailUpto,
  trailColor = "var(--wf-blue)",
  highlight,
  follow,
  fit,
  onMapClick,
  onVertexDrag,
  onCenterDrag,
  heightClass = "h-72",
  showControls = true,
  interactive = true,
  accuracy,
  children,
}: {
  project?: Project | null;
  fence?: Geofence | null;
  markers?: MapMarker[];
  trail?: TrailPoint[];
  trailUpto?: number;
  trailColor?: string;
  highlight?: LatLng | null;
  follow?: LatLng | null;
  fit?: LatLng[];
  onMapClick?: (p: LatLng) => void;
  onVertexDrag?: (index: number, p: LatLng) => void;
  onCenterDrag?: (p: LatLng) => void;
  heightClass?: string;
  showControls?: boolean;
  interactive?: boolean;
  accuracy?: number;
  children?: React.ReactNode;
}) {
  // The map follows the app theme. The tile filter and ground colour come
  // from tokens; this only gates the procedural fallback texture, which is
  // drawn for dark and would muddy the light tiles.
  //
  // Read here rather than beside its use further down: there are early
  // returns between, and a hook after one of them changes call order.
  const isDark = useTheme().resolved === "dark";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 360, h: 288 });
  const [view, setView] = useState<View | null>(null);
  const uid = useId().replace(/[:]/g, "");

  const activeFence = fence ?? project?.geofence ?? null;

  /* measure the container */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) {
        setDims((d) =>
          Math.abs(d.w - r.width) > 1 || Math.abs(d.h - r.height) > 1
            ? { w: r.width, h: r.height }
            : d,
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* initial framing — refit only when the framing target actually changes */
  const fitJson = fit ? JSON.stringify(fit) : "";
  const fenceKind = activeFence?.kind ?? "";
  const fitKey = `${fitJson}|${fenceKind}`;

  useEffect(() => {
    const pts =
      fit ??
      (activeFence ? fencePoints(activeFence) : markers.map((m) => m.coords));
    if (!pts.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(fitView(pts, dims.w, dims.h));
    // Re-fit only when the framing target or canvas size meaningfully changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, dims.w, dims.h]);

  /* follow mode keeps the subject centred while it moves */
  useEffect(() => {
    if (!follow) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView((v) => (v ? { ...v, center: follow } : v));
  }, [follow]);

  /* projection helpers */
  const world = view ? 256 * Math.pow(2, view.zoom) : 1;
  const centerPx = view
    ? { x: mercator(view.center).x * world, y: mercator(view.center).y * world }
    : { x: 0, y: 0 };

  const toScreen = useCallback(
    (p: LatLng) => {
      const m = mercator(p);
      return {
        x: m.x * world - centerPx.x + dims.w / 2,
        y: m.y * world - centerPx.y + dims.h / 2,
      };
    },
    [world, centerPx.x, centerPx.y, dims.w, dims.h],
  );

  const toLatLng = useCallback(
    (sx: number, sy: number): LatLng =>
      unmercator(
        (sx - dims.w / 2 + centerPx.x) / world,
        (sy - dims.h / 2 + centerPx.y) / world,
      ),
    [world, centerPx.x, centerPx.y, dims.w, dims.h],
  );

  const mpp = view ? metersPerPixel(view.center.lat, view.zoom) : 1;

  /* --------------------------------------------------- pointer plumbing */

  const gesture = useRef<{
    mode: "pan" | "vertex" | "center" | "pinch" | null;
    vertexIndex: number;
    startX: number;
    startY: number;
    startCenter: LatLng;
    moved: boolean;
    pointers: Map<number, { x: number; y: number }>;
    pinchDist: number;
    pinchZoom: number;
  }>({
    mode: null,
    vertexIndex: -1,
    startX: 0,
    startY: 0,
    startCenter: { lat: 0, lng: 0 },
    moved: false,
    pointers: new Map(),
    pinchDist: 0,
    pinchZoom: 16,
  });

  const localXY = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || !view) return;
    const g = gesture.current;
    const { x, y } = localXY(e);
    g.pointers.set(e.pointerId, { x, y });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.mode = "pinch";
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.pinchZoom = view.zoom;
      return;
    }
    if (g.mode === "vertex" || g.mode === "center") return; // handle drags set these
    g.mode = "pan";
    g.startX = x;
    g.startY = y;
    g.startCenter = view.center;
    g.moved = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || !view) return;
    const g = gesture.current;
    const { x, y } = localXY(e);
    if (g.pointers.has(e.pointerId)) g.pointers.set(e.pointerId, { x, y });

    if (g.mode === "pinch" && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist > 0) {
        const dz = Math.log2(dist / g.pinchDist);
        setView((v) =>
          v
            ? {
                ...v,
                zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.pinchZoom + dz)),
              }
            : v,
        );
      }
      return;
    }
    if (g.mode === "vertex" && g.vertexIndex >= 0) {
      onVertexDrag?.(g.vertexIndex, toLatLng(x, y));
      return;
    }
    if (g.mode === "center") {
      onCenterDrag?.(toLatLng(x, y));
      return;
    }
    if (g.mode === "pan") {
      const dx = x - g.startX;
      const dy = y - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      const start = mercator(g.startCenter);
      setView((v) =>
        v
          ? {
              ...v,
              center: unmercator(start.x - dx / world, start.y - dy / world),
            }
          : v,
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.mode === "pan" && !g.moved && onMapClick && view) {
      const { x, y } = localXY(e);
      onMapClick(toLatLng(x, y));
    }
    if (g.pointers.size === 0) {
      g.mode = null;
      g.vertexIndex = -1;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!interactive || !view) return;
    e.preventDefault();
    const { x, y } = localXY(e);
    const before = toLatLng(x, y);
    const dz = -e.deltaY * 0.0022;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom + dz));
    // Keep the point under the cursor stable through the zoom.
    const w2 = 256 * Math.pow(2, zoom);
    const m = mercator(before);
    const cx = m.x * w2 - (x - dims.w / 2);
    const cy = m.y * w2 - (y - dims.h / 2);
    setView({ center: unmercator(cx / w2, cy / w2), zoom });
  };

  const zoomBy = (dz: number) => {
    setView((v) =>
      v ? { ...v, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom + dz)) } : v,
    );
  };

  const recenter = () => {
    const pts =
      fit ??
      (activeFence ? fencePoints(activeFence) : markers.map((m) => m.coords));
    if (pts.length) setView(fitView(pts, dims.w, dims.h));
  };

  /* --------------------------------------------------------- rendering */

  const visibleTrail = useMemo(() => {
    if (!trail.length) return [];
    return trailUpto == null ? trail : trail.filter((p) => p.at <= trailUpto);
  }, [trail, trailUpto]);

  const trailPath = useMemo(() => {
    if (!view || visibleTrail.length < 2) return "";
    return visibleTrail
      .map((p, i) => {
        const s = toScreen(p);
        // A segment start lifts the pen: the stretch before it and the stretch
        // after it are separate journeys, not two ends of one line.
        const cmd = i === 0 || p.segmentStart ? "M" : "L";
        return `${cmd}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      })
      .join(" ");
  }, [visibleTrail, toScreen, view]);

  /* visible OSM tile set for the current view */
  const tiles = useMemo(() => {
    if (!view || dims.w <= 0 || dims.h <= 0) return [];
    const tz = Math.max(3, Math.min(MAX_TILE_ZOOM, Math.round(view.zoom)));
    const n = Math.pow(2, tz);
    const size = world / n; // on-screen px per tile (256 * 2^(zoom - tz))
    const normAt = (sx: number, sy: number) => ({
      x: (sx - dims.w / 2 + centerPx.x) / world,
      y: (sy - dims.h / 2 + centerPx.y) / world,
    });
    const a = normAt(0, 0);
    const b = normAt(dims.w, dims.h);
    const x0 = Math.floor(a.x * n);
    const x1 = Math.floor(b.x * n);
    const y0 = Math.max(0, Math.floor(a.y * n));
    const y1 = Math.min(n - 1, Math.floor(b.y * n));
    const out: Array<{ key: string; href: string; x: number; y: number; size: number }> = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n; // wrap antimeridian
        out.push({
          key: `${tz}/${tx}/${ty}`,
          href: TILE_URL(tz, wx, ty),
          x: (tx / n) * world - centerPx.x + dims.w / 2,
          y: (ty / n) * world - centerPx.y + dims.h / 2,
          // Tiny overlap hides sub-pixel seams between scaled tiles.
          size: size + 0.75,
        });
      }
    }
    return out.length > 300 ? [] : out;
  }, [view, dims.w, dims.h, world, centerPx.x, centerPx.y]);

  if (!view) {
    return (
      <div
        ref={wrapRef}
        className={`relative overflow-hidden rounded-2xl border border-[var(--wf-line)] bg-[var(--wf-map-ground)] ${heightClass}`}
      />
    );
  }

  const fencePath =
    activeFence && activeFence.kind === "polygon" && activeFence.polygon.length >= 3
      ? activeFence.polygon
          .map((p, i) => {
            const s = toScreen(p);
            return `${i === 0 ? "M" : "L"}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
          })
          .join(" ") + " Z"
      : "";
  const fenceCenter = activeFence ? toScreen(activeFence.center) : null;
  const fenceRadiusPx = activeFence ? activeFence.radius / mpp : 0;
  const bufferPx = activeFence ? activeFence.bufferMeters / mpp : 0;

  const startPt = visibleTrail[0];
  const lastPt = visibleTrail[visibleTrail.length - 1];

  return (
    <div
      ref={wrapRef}
      className={`relative touch-none select-none overflow-hidden rounded-2xl border border-[var(--wf-line)] ${heightClass}`}
      style={{ background: "var(--wf-map-ground)", cursor: interactive ? "grab" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      role="application"
      aria-label={project ? `Site map — ${project.name}` : "Site map"}
    >
      <svg width={dims.w} height={dims.h} className="absolute inset-0">
        <defs>
          <filter id={`terr${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.014" numOctaves="3" seed="7" result="n" />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 0.07  0 0 0 0.25 0.10  0 0 0 0.6 0.15  0 0 0 0 1"
            />
          </filter>
          <pattern id={`grid${uid}`} width={64} height={64} patternUnits="userSpaceOnUse">
            <path d="M64 0H0V64" fill="none" stroke="var(--wf-slate-soft)" strokeWidth="1" />
          </pattern>
          <radialGradient id={`glow${uid}`}>
            <stop offset="0%" stopColor="var(--wf-blue-edge)" />
            <stop offset="100%" stopColor="var(--wf-blue-soft)" />
          </radialGradient>
        </defs>

        {/* offline/loading fallback ground under the tiles */}
        {isDark && (
          <>
            <rect width={dims.w} height={dims.h} filter={`url(#terr${uid})`} opacity={0.75} />
            <rect width={dims.w} height={dims.h} fill={`url(#grid${uid})`} />
          </>
        )}

        {/* real OpenStreetMap tiles */}
        <g style={{ filter: "var(--wf-tile-filter)" }}>
          {tiles.map((t) => (
            <image
              key={t.key}
              href={t.href}
              x={t.x}
              y={t.y}
              width={t.size}
              height={t.size}
              preserveAspectRatio="none"
            />
          ))}
        </g>
        {/* keep overlays legible on busy cartography */}
        <rect
          width={dims.w}
          height={dims.h}
          fill="var(--wf-map-veil)"
          pointerEvents="none"
        />

        {/* zones */}
        {project?.zones.map((z) => {
          const s = toScreen(z.center);
          const r = z.radius / mpp;
          const tone =
            z.kind === "work"
              ? "rgba(69,184,245"
              : z.kind === "material"
                ? "rgba(246,167,35"
                : z.kind === "welfare"
                  ? "rgba(47,211,118"
                  : z.kind === "hazard"
                    ? "rgba(244,87,77"
                    : "rgba(167,139,250";
          return (
            <g key={z.id}>
              <circle cx={s.x} cy={s.y} r={r} fill={`${tone},0.08)`} stroke={`${tone},0.35)`} strokeWidth="1.2" strokeDasharray="5 4" />
              {view.zoom > 16.2 && (
                <text
                  x={s.x}
                  y={s.y - r - 5}
                  textAnchor="middle"
                  fill={`${tone},0.85)`}
                  fontSize="10.5"
                  fontWeight="650"
                  style={{ letterSpacing: "0.04em" }}
                >
                  {z.name}
                </text>
              )}
            </g>
          );
        })}

        {/* geofence */}
        {activeFence && (
          <g>
            {activeFence.kind === "circle" && fenceCenter ? (
              <>
                <circle
                  cx={fenceCenter.x}
                  cy={fenceCenter.y}
                  r={fenceRadiusPx + bufferPx}
                  fill="none"
                  stroke="var(--wf-amber-edge)"
                  strokeWidth="1.4"
                  strokeDasharray="3 5"
                />
                <circle
                  cx={fenceCenter.x}
                  cy={fenceCenter.y}
                  r={fenceRadiusPx}
                  fill="var(--wf-amber-soft)"
                  stroke="var(--wf-amber)"
                  strokeWidth="2.2"
                  strokeDasharray="9 6"
                />
              </>
            ) : fencePath ? (
              <path
                d={fencePath}
                fill="var(--wf-amber-soft)"
                stroke="var(--wf-amber)"
                strokeWidth="2.2"
                strokeDasharray="9 6"
                strokeLinejoin="round"
              />
            ) : null}
          </g>
        )}

        {/* editor vertex handles */}
        {onVertexDrag &&
          activeFence?.kind === "polygon" &&
          activeFence.polygon.map((p, i) => {
            const s = toScreen(p);
            return (
              <circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={9}
                fill="var(--wf-amber)"
                stroke="var(--wf-trail-halo)"
                strokeWidth="2.5"
                style={{ cursor: "move" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  gesture.current.mode = "vertex";
                  gesture.current.vertexIndex = i;
                  (e.currentTarget.ownerSVGElement?.parentElement as Element | null)?.setPointerCapture?.(
                    e.pointerId,
                  );
                }}
              />
            );
          })}
        {onCenterDrag && activeFence?.kind === "circle" && fenceCenter && (
          <circle
            cx={fenceCenter.x}
            cy={fenceCenter.y}
            r={10}
            fill="var(--wf-amber)"
            stroke="var(--wf-trail-halo)"
            strokeWidth="2.5"
            style={{ cursor: "move" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              gesture.current.mode = "center";
            }}
          />
        )}

        {/* movement trail */}
        {trailPath && (
          <>
            <path d={trailPath} fill="none" stroke="var(--wf-trail-halo)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={trailPath} fill="none" stroke={trailColor} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {startPt && visibleTrail.length > 1 && (
          <StartFlag at={toScreen(startPt)} />
        )}

        {/* GPS accuracy halo around the last trail point */}
        {accuracy != null && lastPt && (
          <circle
            cx={toScreen(lastPt).x}
            cy={toScreen(lastPt).y}
            r={Math.max(10, accuracy / mpp)}
            fill={`url(#glow${uid})`}
          />
        )}

        {/* highlight ring (timeline selection) */}
        {highlight && (
          <g>
            <circle
              cx={toScreen(highlight).x}
              cy={toScreen(highlight).y}
              r={16}
              fill="none"
              stroke="var(--wf-violet)"
              strokeWidth="3"
            />
            <circle
              cx={toScreen(highlight).x}
              cy={toScreen(highlight).y}
              r={5}
              fill="var(--wf-violet)"
            />
          </g>
        )}
      </svg>

      {/* HTML markers on top of the SVG for crisp text + easy a11y */}
      {markers.map((m) => {
        const s = toScreen(m.coords);
        if (s.x < -60 || s.y < -60 || s.x > dims.w + 60 || s.y > dims.h + 60)
          return null;
        return (
          <MarkerEl key={m.id} marker={m} x={s.x} y={s.y} />
        );
      })}

      {/* controls */}
      {showControls && (
        <div className="absolute right-2.5 top-2.5 z-10 flex flex-col gap-1.5">
          <MapBtn label="Zoom in" onClick={() => zoomBy(0.6)}>
            <IPlus size={16} />
          </MapBtn>
          <MapBtn label="Zoom out" onClick={() => zoomBy(-0.6)}>
            <IMinus size={16} />
          </MapBtn>
          <MapBtn label="Recenter map" onClick={recenter}>
            <ICrosshair size={16} />
          </MapBtn>
        </div>
      )}

      {/* scale bar */}
      <div className="pointer-events-none absolute bottom-2 left-3 z-10 flex items-center gap-1.5">
        <span
          className="block h-[3px] rounded bg-white/70"
          style={{ width: Math.max(24, Math.min(90, 50 / mpp)) }}
        />
        <span className="text-[0.6rem] font-semibold text-white/80 drop-shadow">
          {mpp < 1 ? `${Math.round(50)} m` : `${Math.round(Math.max(24, Math.min(90, 50 / mpp)) * mpp)} m`}
        </span>
      </div>

      {/* OpenStreetMap attribution — required by the ODbL licence */}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-1.5 right-2 z-10 rounded bg-black/45 px-1.5 py-0.5 text-[0.56rem] font-medium text-white/85 no-underline backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        © OpenStreetMap contributors
      </a>

      {children}
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function MapBtn({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-[var(--wf-line)] shadow-md transition hover:brightness-125"
      style={{
        background: active ? "var(--wf-amber)" : "color-mix(in srgb, var(--wf-surface) 92%, transparent)",
        color: active ? "var(--wf-on-amber)" : "var(--wf-fg)",
      }}
    >
      {children}
    </button>
  );
}

function StartFlag({ at }: { at: { x: number; y: number } }) {
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={7} fill="var(--wf-green)" stroke="var(--wf-marker-ring)" strokeWidth="2.4" />
      <circle cx={at.x} cy={at.y} r={2.4} fill="var(--wf-marker-ring)" />
    </g>
  );
}

function MarkerEl({ marker: m, x, y }: { marker: MapMarker; x: number; y: number }) {
  const color = m.color ?? "var(--wf-blue)";
  const clickable = !!m.onClick;
  const Comp = clickable ? "button" : "div";

  if (m.kind === "worker") {
    return (
      <Comp
        onClick={m.onClick}
        onPointerDown={(e: React.PointerEvent) => clickable && e.stopPropagation()}
        aria-label={m.label ? `${m.label}${m.sub ? ` — ${m.sub}` : ""}` : undefined}
        className={`absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center ${clickable ? "cursor-pointer" : "pointer-events-none"} ${m.dim ? "opacity-45" : ""}`}
        style={{ left: x, top: y }}
      >
        <span
          className="grid h-9 w-9 place-items-center rounded-full text-[0.68rem] font-bold shadow-lg"
          style={{
            background: `hsl(${m.hue ?? 200} 48% 30%)`,
            color: `hsl(${m.hue ?? 200} 85% 84%)`,
            border: `2.5px solid ${m.selected ? "var(--wf-amber)" : "var(--wf-marker-ring)"}`,
          }}
        >
          {m.initials ?? "•"}
        </span>
        <span
          className="-mt-[3px] h-2.5 w-2.5 rotate-45 border-b-2 border-r-2 border-white/85"
          style={{ background: `hsl(${m.hue ?? 200} 48% 30%)` }}
        />
        {m.label ? (
          <span className="mt-0.5 max-w-[110px] truncate rounded-md bg-black/75 px-1.5 py-0.5 text-[0.62rem] font-semibold text-white shadow">
            {m.label}
          </span>
        ) : null}
        {m.pulse ? (
          <span
            className="wf-pulse-dot absolute -top-1 right-0"
            style={{ background: "var(--wf-green)" }}
          />
        ) : null}
      </Comp>
    );
  }

  const dotSize = m.kind === "playhead" ? 18 : m.kind === "site" ? 13 : 12;
  return (
    <Comp
      onClick={m.onClick}
      onPointerDown={(e: React.PointerEvent) => clickable && e.stopPropagation()}
      aria-label={m.label}
      className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${clickable ? "cursor-pointer" : "pointer-events-none"}`}
      style={{ left: x, top: y }}
    >
      <span
        className={`block rounded-full shadow-lg ${m.pulse ? "wf-pulse-dot" : ""}`}
        style={{
          width: dotSize,
          height: dotSize,
          background: color,
          border: "2.5px solid var(--wf-marker-ring)",
        }}
      />
      {m.label ? (
        <span className="mt-1 whitespace-nowrap rounded-md bg-black/75 px-1.5 py-0.5 text-[0.62rem] font-semibold text-white shadow">
          {m.label}
        </span>
      ) : null}
    </Comp>
  );
}
