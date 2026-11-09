import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink, linkLogView, submitLog } from "@/lib/dailyLog/store";
import { linkSafe } from "@/lib/dailyLog/rules";
import { AMOUNTS_NOTICE } from "@/lib/dailyLog/money";
import { readJsonBody } from "@/lib/jsonBody";

// The daily site log from a pilot supervisor's link (Task K, 25 Oct 2026).
// GET  -> the jobs they can log now, each with the crew and signed hours (from
//         sign-ins), the plant on the board, suggested codes and the latest
//         log; plus this week's % complete forms.
// POST { jobId, hours[], plant[], delays[], dockets[], note, photos[], noDelays,
//        noDockets, crewOk, crewNote, handCrew, handHours, durationSec } -> a new
//        version of that job's log.
// Not on the pilot (DAILY_LOG_PILOT_LINKS) -> 404, as for a link that isn't
// active. Never a dollar figure: every response passes the money guard.
async function linkFor(token: string) {
  const link = await resolveLink(token);
  if (!link || !(await isPilotLink(link))) return { res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  return { link };
}
const safe = (body: unknown, status = 200) =>
  linkSafe(body) ? NextResponse.json(body, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const { link, res } = await linkFor((await paramsP).token);
  if (!link) return res;
  return safe(await linkLogView(link, new Date()));
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const { link, res } = await linkFor((await paramsP).token);
  if (!link) return res;
  // A log over Next's 10 MB limit (lots of photos) arrives cut short - say so, rather than "not one you can log today"
  // (Villi, 9 Nov 2026).
  const read = await readJsonBody(req, "This log is too big to send - take a photo or two out and send again.");
  if ("denied" in read) return read.denied;
  const out = await submitLog(link, read.b, new Date());
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return safe({ log: out.log, amountsNotice: out.amountsRemoved ? AMOUNTS_NOTICE : null }, 201);
});
