import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink } from "@/lib/dailyLog/store";
import { linkSafe } from "@/lib/dailyLog/rules";
import { handleVoice, voicePrecheck } from "@/lib/dailyLog/voice";
import { ONE_AT_A_TIME, TOO_LONG, VOICE_LIMITS } from "@/lib/dailyLog/voiceRules";

// Voice entry on the daily site log (29 Oct 2026, Ilies "go"; docs/lci/DAILY-LOG-VOICE-DESIGN.md).
// POST /api/site/[token]/log/voice?jobId=<id>&seconds=<n>, multipart { audio }
//   -> { voiceId, note, sections[], delays[], checkThis[], amountsNotice }: the supervisor's spoken day as clean headed
//   notes and suggested delays, for them to edit and tap to use - nothing is put in the log here. Under /api/site/...,
//   so it rides the photos tunnel route (no Cloudflare change).
// Before the recording is read (security review SEC-001 / SEC-003):
// - not a link with the Daily log (OFFICE, POSTER, DRIVER, revoked, an expired hand-over...) -> 404, as the log route;
// - one recording at a time per link -> 429;
// - no Content-Length -> 411; over the size limit (5 minutes is ~4-5 MB) -> 413;
// - not a job this link can log today -> 403; the day's limits (20 a link, DAILY_LOG_VOICE_DAY_MAX for everyone) -> 429;
//   voice off or a key missing -> 503 "type it instead".
// The reply comes inside the tunnel's 100 s (VOICE_TIMEOUTS). The audio is held in memory only and dropped once it's
// text. Never a dollar figure in the reply.
const inProgress = new Set<string>(); // link ids with a recording being worked on (this server)

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveLink((await paramsP).token);
  if (!link || !(await isPilotLink(link))) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  if (inProgress.has(link.id)) return NextResponse.json({ error: ONE_AT_A_TIME }, { status: 429 });
  inProgress.add(link.id);
  try {
    const length = req.headers.get("content-length");
    if (length == null || length === "" || !Number.isFinite(Number(length))) return NextResponse.json({ error: "The recording's size wasn't sent - try again." }, { status: 411 });
    if (Number(length) > VOICE_LIMITS.maxRequestBytes) return NextResponse.json({ error: TOO_LONG }, { status: 413 });
    const q = req.nextUrl.searchParams;
    const now = new Date();
    const pre = await voicePrecheck(link, q.get("jobId"), now);
    if (!("job" in pre)) return safe(pre.body, pre.status);
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "No recording came through - try again." }, { status: 400 });
    const seconds = q.get("seconds") == null ? null : Number(q.get("seconds"));
    const out = await handleVoice(link, pre.job, form, seconds, now);
    return safe(out.body, out.status);
  } finally {
    inProgress.delete(link.id);
  }
});

const safe = (body: unknown, status: number) =>
  linkSafe(body) ? NextResponse.json(body, { status }) : NextResponse.json({ error: "Something went wrong - type it instead." }, { status: 500 });
