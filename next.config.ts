import type { NextConfig } from "next";

/**
 * SiteTrack is fully client-side (localStorage store, no backend), so the
 * whole app can also be exported statically: set STATIC_EXPORT=true to emit
 * an `out/` directory for any static host.
 */
const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  ...(process.env.STATIC_EXPORT === "true" ? { output: "export" as const } : {}),
};

export default nextConfig;
