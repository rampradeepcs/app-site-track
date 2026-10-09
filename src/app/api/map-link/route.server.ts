/**
 * Expand a Google Maps short link — GET /api/map-link?url=<maps.app.goo.gl/…>
 *
 * The Share button in Google Maps produces maps.app.goo.gl links, and the
 * point is behind their redirect. Google sends no CORS headers on it, so the
 * page cannot read where it leads; this reads it for the page.
 *
 * It fetches nothing but Google's shorteners: expandShortLink stops at the
 * first full link and hands it back unread, so nothing can be passed in that
 * makes this request another host. The answer is a link for the client to
 * read coordinates out of — never anywhere it navigates.
 *
 * Named route.server.ts so only a server build picks it up (pageExtensions in
 * next.config.ts). The static export has no server to run it on, and the
 * native app expands links itself over CapacitorHttp.
 */

import { NextResponse, type NextRequest } from "next/server";
import { expandShortLink, isShortMapLink } from "@/lib/maplink";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  let start: URL;
  try {
    start = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Not a link." }, { status: 400 });
  }
  // An old http:// share is still a short link; expandShortLink only ever
  // requests one over https.
  if (!isShortMapLink(start)) {
    return NextResponse.json({ error: "Not a Google Maps short link." }, { status: 400 });
  }

  const url = await expandShortLink(start.href, async (at) => {
    try {
      const res = await fetch(at, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      return res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    } catch {
      return null;
    }
  });

  if (!url) {
    return NextResponse.json(
      { error: "That short link did not lead anywhere — it may have expired." },
      { status: 404 },
    );
  }
  // A short link points at the same place for good.
  return NextResponse.json({ url }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
