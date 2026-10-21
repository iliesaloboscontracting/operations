import { NextRequest, NextResponse } from "next/server";
import { resolveLink } from "@/lib/siteLinks";

// GET /site/:token/app.webmanifest - makes a supervisor's link installable
// as the "Lobos Site" phone app (22 Oct 2026). The app opens straight onto
// their own link, so they never handle the link again. Served on the photos
// address with the rest of /site/... (no Cloudflare change).
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  const home = `/site/${params.token}`;
  return new NextResponse(
    JSON.stringify({
      name: link.kind === "OFFICE" && !link.shared ? "Lobos Office" : "Lobos Site",
      short_name: link.kind === "OFFICE" && !link.shared ? "Lobos Office" : "Lobos Site",
      description: `Lobos Contracting - ${link.person.name}`,
      id: home,
      start_url: home,
      scope: home,
      display: "standalone",
      background_color: "#0E1115",
      theme_color: "#090B0E",
      icons: [
        { src: "/site/icons/site-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/site/icons/site-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/site/icons/site-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=3600" } },
  );
}
