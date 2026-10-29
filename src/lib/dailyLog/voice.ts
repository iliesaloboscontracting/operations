// Voice entry on the daily site log, server side (29 Oct 2026, Ilies "go"; docs/lci/DAILY-LOG-VOICE-DESIGN.md).
// A supervisor's recording -> OpenAI turns it into text (lib/voice/transcribe.ts) -> every dollar amount comes out ->
// Claude tidies it into headed notes and suggested delays (./voiceClean.ts) -> plain code checks it
// (./voiceRules.ts) -> back to the phone as suggestions the supervisor edits and taps to use. Nothing is sent or
// filled in without that tap. The audio is never written anywhere: it arrives in memory and is dropped after the
// call. The route did resolveLink and the Daily log rule (404), one-at-a-time and the size checks before this.
import { prisma } from "../prisma";
import type { ResolvedLink } from "../siteLinks";
import { CODES } from "../activityCodes";
import { isAllowedAudio, transcribe, type TranscribeResult } from "../voice/transcribe";
import { crewFor, loggableJobs, plantFor } from "./store";
import { DELAY_LABEL } from "./rules";
import { sydneyDay } from "./checks";
import { cleanTranscript, type Cleaner } from "./voiceClean";
import {
  AMOUNTS_NOTICE, FAILED_TO_TEXT, TOO_LONG, VOICE_CAP_REACHED, VOICE_LIMITS, VOICE_OFF, VOICE_TIMEOUTS, buildVocabulary, capTranscript,
  cleanBudgetMs, cleanContext, cleanedNote, overDayCeiling, overVoiceCap, stripMoney, voiceAvailable,
} from "./voiceRules";

export type VoiceReply = {
  voiceId: string; note: string; sections: { heading: string; text: string }[];
  delays: { delayCode: string; label: string; hoursLost: number | null; note: string }[];
  checkThis: string[]; amountsNotice: string | null;
};
type Out = { status: number; body: VoiceReply | { error: string } };
const fail = (status: number, error: string): Out => ({ status, body: { error } });
type Job = Awaited<ReturnType<typeof loggableJobs>>[number];

// Recordings made today (Sydney) - counted from the rows, so a restart doesn't reset it. REFUSED ones don't count.
const COUNTED = { status: { not: "REFUSED" } } as const;
export const voiceUsedToday = (siteLinkId: string, now: Date) => prisma.dailyLogVoice.count({ where: { siteLinkId, day: sydneyDay(now), ...COUNTED } });
const voiceUsedCompanyToday = (now: Date) => prisma.dailyLogVoice.count({ where: { day: sydneyDay(now), ...COUNTED } });

// The cheap checks, before the recording is read (SEC-003): a job this link can log today (403), the day's limits
// (429 - a read here; the row-first count below is the real one), voice on with both keys (503).
export async function voicePrecheck(link: ResolvedLink, jobId: string | null, now: Date): Promise<{ job: Job } | Out> {
  const job = (await loggableJobs(link, now)).find((j) => j.id === jobId);
  if (!job) return fail(403, "That job isn't one you can log today.");
  if (overVoiceCap(await voiceUsedToday(link.id, now)) || overDayCeiling(await voiceUsedCompanyToday(now))) return fail(429, VOICE_CAP_REACHED);
  if (!voiceAvailable()) return fail(503, VOICE_OFF);
  return { job };
}

export async function handleVoice(
  link: ResolvedLink, job: Job, form: FormData, seconds: number | null, now: Date,
  deps: { transcribe?: (audio: Blob, prompt: string) => Promise<TranscribeResult>; cleaner?: Cleaner } = {},
): Promise<Out> {
  // The recording itself. Its length from the phone is kept for information only (SEC-005) - the size cap is the limit.
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, "No recording came through - try again.");
  if (audio.size > VOICE_LIMITS.maxBytes) return fail(413, TOO_LONG);
  if (!isAllowedAudio(audio.type)) return fail(415, "That recording format isn't supported - type it instead.");

  // Counted from here, row first (SEC-001): the row is written, then this link's rows for the day up to and including
  // it are counted - and the company's. Over a limit -> this row is REFUSED (and doesn't count) and the answer is 429.
  // Several sent at once can't all slip under the limit. The reply's time budget starts now.
  const startedAt = Date.now();
  const day = sydneyDay(now);
  const secs = seconds != null && Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.round(seconds), 3600) : null;
  const row = await prisma.dailyLogVoice.create({ data: { siteLinkId: link.id, jobId: job.id, day, seconds: secs } });
  const upToMine = { day, ...COUNTED, OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lte: row.id } }] };
  const [mineToday, companyToday] = await Promise.all([
    prisma.dailyLogVoice.count({ where: { siteLinkId: link.id, ...upToMine } }),
    prisma.dailyLogVoice.count({ where: upToMine }),
  ]);
  if (mineToday > VOICE_LIMITS.perLinkPerDay || overDayCeiling(companyToday - 1)) {
    await prisma.dailyLogVoice.update({ where: { id: row.id }, data: { status: "REFUSED" } }).catch(() => null);
    return fail(429, VOICE_CAP_REACHED);
  }
  const finish = (status: "DONE" | "FAILED", data: { transcript?: string; cleaned?: string } = {}) =>
    prisma.dailyLogVoice.update({ where: { id: row.id }, data: { status, ...data } }).catch(() => null);

  // The names that help it hear and spell right - this job only, names only, each cleaned of any amount and capped
  // (SEC-004): the transcriber's hint and Claude get the same cleaned names.
  const [crew, plant, planned] = await Promise.all([
    crewFor(job.id, now), plantFor(job),
    prisma.assignment.findMany({ where: { jobId: job.id, resource: { type: "PERSONNEL" } }, select: { resource: { select: { name: true } } } }),
  ]);
  const ctx = cleanContext({
    site: job.project?.name ?? job.title,
    crew: [...new Set([...crew.people.map((p) => p.name), ...planned.map((a) => a.resource.name)])],
    plant: plant.map((p) => p.name),
  });
  const prompt = buildVocabulary({ ...ctx, codes: CODES.map((c) => c.name) });

  let heard: TranscribeResult;
  try {
    heard = await (deps.transcribe ?? ((a, p) => transcribe(a, { prompt: p, timeoutMs: VOICE_TIMEOUTS.transcribeMs })))(audio, prompt);
  } catch {
    heard = { error: VOICE_OFF, status: 503 };
  }
  if ("error" in heard) { await finish("FAILED"); return fail(heard.status, heard.status === 502 ? FAILED_TO_TEXT : heard.error); }
  const stripped = stripMoney(heard.text);
  if (!stripped.text.trim()) { await finish("FAILED"); return fail(422, FAILED_TO_TEXT); }
  // At most 9000 characters go to Claude (5 minutes of fast talk); beyond that, "Check this" says the end may be missing.
  const capped = capTranscript(stripped.text);

  const cleaned = await cleanTranscript(capped.text, ctx, stripped.removed, deps.cleaner, cleanBudgetMs(Date.now() - startedAt));
  if (capped.cut) cleaned.checkThis.unshift(capped.notice);
  await finish("DONE", { transcript: capped.text, cleaned: JSON.stringify(cleaned) });
  return {
    status: 200,
    body: {
      voiceId: row.id, note: cleanedNote(cleaned), sections: cleaned.sections,
      delays: cleaned.delays.map((d) => ({ ...d, label: DELAY_LABEL[d.delayCode] })),
      checkThis: cleaned.checkThis, amountsNotice: cleaned.amountsRemoved ? AMOUNTS_NOTICE : null,
    },
  };
}
