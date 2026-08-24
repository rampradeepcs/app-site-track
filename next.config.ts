import type { NextConfig } from "next";

/**
 * SiteTrack is fully client-side (localStorage store, no backend), so the
 * whole app can also be exported statically: set STATIC_EXPORT=true to emit
 * an `out/` directory for any static host.
 */
const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  ...(process.env.STATIC_EXPORT === "true"
    ? {
        output: "export" as const,
        // Capacitor serves the export off the device filesystem, so routes
        // must resolve to <route>/index.html rather than <route>.html.
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
