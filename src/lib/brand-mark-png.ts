/**
 * The Workfence mark as a PNG, for file formats that can only carry a
 * raster: the image embedded in every .xlsx export.
 *
 * 480x199, black ink on transparency, generated from the MARK_PATHS in
 * ./brand.ts — the same geometry the app draws on screen. Greyscale+alpha,
 * so it stays crisp on a white sheet and legible on a dark one.
 */

const BASE64 =
  "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";

export const MARK_PNG_BASE64 = BASE64;
export const MARK_PNG_WIDTH = 480;
export const MARK_PNG_HEIGHT = 199;

/** The PNG as bytes, for writing into a zip container. */
export function markPngBytes(): Uint8Array {
  const bin = atob(BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
