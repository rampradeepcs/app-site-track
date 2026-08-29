/**
 * The Workfence mark, as geometry.
 *
 * One source of truth: the on-screen component (components/Brand.tsx) and
 * every exported document draw the same three strokes from here, so the
 * logo on a payroll PDF cannot drift from the logo in the app.
 *
 * The paths are straight segments only — no curves — which is why the
 * raster in brand-mark-png.ts could be generated from exactly this data.
 */

export const MARK_VIEWBOX = "90 330 820 340";
export const MARK_ASPECT = 820 / 340;

export const MARK_PATHS = [
  "M103 345H192.521L286.537 507.232L317.224 453.285L357.685 523.651L281.846 654.805L103 345Z",
  "M281.846 345H371.367L461.279 499.805L506.039 422.598L461.279 345H896.178L852.004 422.598H595.56L460.693 654.805L281.846 345Z",
  "M640.32 499.218H814.084L768.737 577.011H685.08L640.515 655L595.364 577.207L640.32 499.218Z",
] as const;

export const BRAND_NAME = "Workfence";
export const BRAND_LINE = "Workfence · Born Creative";

/**
 * Standalone SVG markup for documents rendered outside React — the print
 * window that becomes a PDF. `color` is baked in rather than inherited,
 * because the print sheet has no cascade to inherit from.
 */
export function markSVG(height: number, color = "#111827"): string {
  const width = Math.round(height * MARK_ASPECT);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" ` +
    `width="${width}" height="${height}" role="img" aria-label="${BRAND_NAME}">` +
    MARK_PATHS.map((d) => `<path d="${d}" fill="${color}"/>`).join("") +
    `</svg>`
  );
}
