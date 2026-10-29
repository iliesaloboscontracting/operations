import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink } from "@/lib/dailyLog/store";
import { linkSafe } from "@/lib/dailyLog/rules";
import { handleVoice } from "@/lib/dailyLog/voice";
import { TOO_LONG, VOICE_LIMITS } from "@/lib/dailyLog/voiceRules";

// Voice entry on the daily site log (29 Oct 2026, Ilies "go"; docs/lci/DAILY-LOG-VOICE-DESIGN.md).
// POST multipart { audio, jobId, seconds } -> { voiceId, note, sections[], delays[], checkThis[], amountsNotice }:
// the supervisor's spoken day as clean headed notes and suggested delays, for them to edit and tap to use - nothing
// is put in the log here. Under /api/site/..., so it rides the photos tunnel route (no Cloudflare change).
// - Not a link with the Daily log (OFFICE, POSTER, DRIVER, revoked...) -> 404, as the log route.
// - 20 recordings per link per Sydney day (429), voice off or a key missing (503 "type it instead"), 5 minutes /
//   10 MB and an audio type the transcriber takes. The reply comes inside the tunnel's 100 s (VOICE_TIMEOUTS).
// - The audio is held in memory only and dropped once it's text. Never a dollar figure in the reply.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveLink((await paramsP).token);
  if (!link || !(await isPilotLink(link))) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  // A body far over the limit is refused before it's read.
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > VOICE_LIMITS.maxBytes + 256 * 1024) return NextResponse.json({ error: TOO_LONG }, { status: 413 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "No recording came through - try again." }, { status: 400 });
  const out = await handleVoice(link, form, new Date());
  return linkSafe(out.body) ? NextResponse.json(out.body, { status: out.status }) : NextResponse.json({ error: "Something went wrong - type it instead." }, { status: 500 });
});
