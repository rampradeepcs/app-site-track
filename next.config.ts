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
  /*
   * `route.server.ts` is a route only when there is a server to run it. A
   * static export has none, and a route handler that reads its request
   * fails the export outright — so those files are simply not routes there.
   * The client treats the endpoint as optional (see MapLinkField).
   */
  pageExtensions: isStatic
    ? ["tsx", "ts", "jsx", "js"]
    : ["tsx", "ts", "jsx", "js", "server.ts"],
  env: {
    // Exposed so client code can build correct absolute paths when needed.
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Whether /api routes exist in this build (see pageExtensions below), so
    // the client can tell a missing endpoint from a failing one up front.
    NEXT_PUBLIC_HAS_SERVER: isStatic ? "" : "1",
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
