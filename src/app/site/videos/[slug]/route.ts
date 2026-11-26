// A how-to video player (Ilies asked 26 Nov 2026: "build the watch videos button"). Public on purpose - example data
// only, no money, no secrets - and under /site/ so it rides the photos tunnel. Only a slug listed in
// lib/howtoVideos.ts is served, from the file name that list gives (the request never reaches a path); anything
// else is 404. The page gets its own CSP (lib/howtoVideos.ts howtoVideoCsp) on top of next.config's headers.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { findHowtoVideo, howtoVideoHeaders } from "@/lib/howtoVideos";

// Read once per server process (a deploy restarts it); ~6 MB each.
const cache = new Map<string, { body: Buffer; etag: string }>();

async function load(slug: string, file: string) {
  const hit = cache.get(slug);
  if (hit) return hit;
  const body = await readFile(path.join(process.cwd(), "howto-videos", file));
  const entry = { body, etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"` };
  cache.set(slug, entry);
  return entry;
}

const notFound = () => new Response("Not found", {
  status: 404,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const video = findHowtoVideo((await params).slug);
  if (!video) return notFound();
  let entry;
  try { entry = await load(video.slug, video.file); } catch { return notFound(); }
  const headers = howtoVideoHeaders(entry.etag);
  const seen = req.headers.get("if-none-match");
  if (seen && seen.split(",").map((s) => s.trim().replace(/^W\//, "")).includes(entry.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(entry.body), { status: 200, headers });
}
