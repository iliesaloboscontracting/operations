// How-to videos (Ilies asked 26 Nov 2026: "build the watch videos button"). The narrated how-to players (one
// self-contained HTML file each - inline CSS / JS, embedded logos, MP3 narration as data: URIs, Google Fonts only) are
// kept in the repo under howto-videos/<slug>.html and served at /site/videos/<slug> - under /site/ so they ride the
// photos tunnel's existing `site/.*` route (no Cloudflare change) and need no login: they hold example data only, no
// money and no secrets, so a worker on the QR sign-in screen (no link of their own) can watch too.
//
// This file is plain data and pure functions (no fs, no database, no fetch) so the unit tests and the pages share it.
// The route (src/app/site/videos/[slug]/route.ts) serves ONLY a slug listed here - the slug is never joined into a
// path; the file name comes from this list. Update or add a video with scripts/howto/import-video.mjs (see there).
//
// The LCI explainer is for the directors and the office, never the crews - it is deliberately not listed here.

export type HowtoAudience = "supervisor" | "driver" | "crew";
export type HowtoVideo = {
  slug: string;
  /** File name in howto-videos/ - fixed here, never built from the request. */
  file: string;
  title: string;
  /** One line under the title on the list page. */
  blurb: string;
  /** A couple of words for the supervisor tile's sub-line. */
  short: string;
  audience: readonly HowtoAudience[];
};

export const HOWTO_VIDEOS: readonly HowtoVideo[] = [
  {
    slug: "sign-in",
    file: "sign-in.html",
    title: "Signing in and out",
    blurb: "Showing the QR, scanning in, hire workers, the site poster, signing out once, approving hours, travel.",
    short: "signing in",
    audience: ["supervisor", "driver", "crew"],
  },
  {
    slug: "variation-docket",
    file: "variation-docket.html",
    title: "Variation dockets",
    blurb: "Extra work, labour hire, materials and rubbish on your phone - the client signs, then you send it.",
    short: "variation dockets",
    audience: ["supervisor"],
  },
  {
    // Ilies 26 Nov 2026: "ok yes". Supervisor and hand-over links only - a driver link has no Site documents tile.
    slug: "site-documents",
    file: "site-documents.html",
    title: "Site documents",
    blurb: "Plans, signing the SWMS, the pre-start, the weekly toolbox talk and an incident report - all on your phone.",
    short: "site documents",
    audience: ["supervisor"],
  },
] as const;

/** The list page (token-free, so forwarding it gives nothing away). */
export const HOWTO_LIST_PATH = "/site/videos";
export const howtoVideoPath = (slug: string) => `${HOWTO_LIST_PATH}/${slug}`;

/** The video for exactly this slug, or null. No trimming, decoding or case-folding: anything else is a 404. */
export function findHowtoVideo(slug: unknown): HowtoVideo | null {
  if (typeof slug !== "string") return null;
  return HOWTO_VIDEOS.find((v) => v.slug === slug) ?? null;
}

export const howtoVideosFor = (who: HowtoAudience) => HOWTO_VIDEOS.filter((v) => v.audience.includes(who));

/** "4:54" from seconds - the length the player itself shows (worked out by the import script). */
export function videoLength(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.floor(seconds); // as the player shows it
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The players' own Content-Security-Policy - exactly what they need and nothing more: their inline <script> and
// <style>, the Google Fonts stylesheet and font files, and data: images and narration. No connections (connect-src
// 'none' - nothing is fetched or sent), no frames, no forms, never framed by another page.
export const HOWTO_CSP_DIRECTIVES: readonly (readonly [string, string])[] = [
  ["default-src", "'none'"],
  ["script-src", "'unsafe-inline'"],
  ["style-src", "'unsafe-inline' https://fonts.googleapis.com"],
  ["font-src", "https://fonts.gstatic.com"],
  ["img-src", "data:"],
  ["media-src", "data:"],
  ["connect-src", "'none'"],
  ["frame-src", "'none'"],
  ["object-src", "'none'"],
  ["base-uri", "'none'"],
  ["form-action", "'none'"],
  ["frame-ancestors", "'none'"],
  // HV-001 (Ilies approved 26 Nov 2026): the player runs in its own sealed, opaque origin - its script can't read the
  // photos origin's storage (the crew's travel pass, sign-in identity) or cookies, whatever a future import carries.
  ["sandbox", "allow-scripts"],
];

export function howtoVideoCsp(): string {
  return HOWTO_CSP_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join("; ");
}

/** Cached for 6 hours, then checked again with the ETag (a 304 costs nothing) - a re-imported video reaches phones
 *  within the day without them downloading ~6 MB on every open. */
export const HOWTO_CACHE_CONTROL = "public, max-age=21600, must-revalidate";

export function howtoVideoHeaders(etag: string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": howtoVideoCsp(),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": HOWTO_CACHE_CONTROL,
    ETag: etag,
    "Referrer-Policy": "same-origin",
    "X-Robots-Tag": "noindex",
  };
}
