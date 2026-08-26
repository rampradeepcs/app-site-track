import type { NextConfig } from "next";

/**
 * Workfence is fully client-side (localStorage store, no backend), so the
 * whole app also exports statically.
 *
 *   STATIC_EXPORT=true   → emit `out/` for Capacitor or any static host
 *   GITHUB_PAGES=true    → same, but served from a repo sub-path
 *
 * Pages serves the site under /<repo>/, so basePath has to be baked into the
 * build; Next rewrites internal links and asset URLs to match.
 */
const isPages = process.env.GITHUB_PAGES === "true";
const isStatic = isPages || process.env.STATIC_EXPORT === "true";
const basePath = isPages ? "/app-site-track" : "";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  env: {
    // Exposed so client code can build correct absolute paths when needed.
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  ...(isStatic
    ? {
        output: "export" as const,
        // Capacitor and Pages both serve from a filesystem, so routes must
        // resolve to <route>/index.html rather than <route>.html.
        trailingSlash: true,
        images: { unoptimized: true },
        ...(isPages ? { basePath, assetPrefix: `${basePath}/` } : {}),
      }
    : {}),
};

export default nextConfig;
