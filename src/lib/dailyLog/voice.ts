// Voice entry on the daily site log, server side (29 Oct 2026, Ilies "go"; docs/lci/DAILY-LOG-VOICE-DESIGN.md).
// A supervisor's recording -> OpenAI turns it into text (lib/voice/transcribe.ts) -> every dollar amount comes out ->
// Claude tidies it into headed notes and suggested delays (./voiceClean.ts) -> plain code checks it
// (./voiceRules.ts) -> back to the phone as suggestions the supervisor edits and taps to use. Nothing is sent or
// filled in without that tap. The audio is never written anywhere: it arrives in memory and is dropped after the
// call. The route did resolveLink and the Daily log rule (404) before this.
import { prisma } from "../prisma";
import type { ResolvedLink } from "../siteLinks";
import { CODES } from "../activityCodes";
import { isAllowedAudio, transcribe, type TranscribeResult } from "../voice/transcribe";
import { crewFor, loggableJobs, plantFor } from "./store";
import { DELAY_LABEL } from "./rules";
import { sydneyDay } from "./checks";
import { cleanTranscript, type Cleaner } from "./voiceClean";
import {
  AMOUNTS_NOTICE, FAILED_TO_TEXT, VOICE_CAP_REACHED, VOICE_LIMITS, VOICE_OFF, buildVocabulary, cleanedNote, overVoiceCap, stripMoney, voiceAvailable,
} from "./voiceRules";

export type VoiceReply = {
  voiceId: string; note: string; sections: { heading: string; text: string }[];
  delays: { delayCode: string; label: string; hoursLost: number | null; note: string }[];
  checkThis: string[]; amountsNotice: string | null;
};
type Out = { status: number; body: VoiceReply | { error: string } };
const fail = (status: number, error: string): Out => ({ status, body: { error } });

// Recordings this link has made today (Sydney) - counted from the rows, so a restart doesn't reset it.
export const voiceUsedToday = (siteLinkId: string, now: Date) => prisma.dailyLogVoice.count({ where: { siteLinkId, day: sydneyDay(now) } });

export async function handleVoice(
  link: ResolvedLink, form: FormData, now: Date,
  deps: { transcribe?: (audio: Blob, prompt: string) => Promise<TranscribeResult>; cleaner?: Cleaner } = {},
): Promise<Out> {
  // 1. A job this link can log today.
  const job = (await loggableJobs(link, now)).find((j) => j.id === form.get("jobId"));
  if (!job) return fail(403, "That job isn't one you can log today.");
  // 2. The day's limit - before anything else, so it can be checked with voice off.
  if (overVoiceCap(await voiceUsedToday(link.id, now))) return fail(429, VOICE_CAP_REACHED);
  // 3. Voice on, and both keys there.
  if (!voiceAvailable()) return fail(503, VOICE_OFF);
  // 4. The recording itself.
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, "No recording came through - try again.");
  if (audio.size > VOICE_LIMITS.maxBytes) return fail(413, "That recording is too long - keep it under 2 minutes.");
  if (!isAllowedAudio(audio.type)) return fail(415, "That recording format isn't supported - type it instead.");
  const seconds = Number(form.get("seconds"));
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > VOICE_LIMITS.maxSeconds + 2) return fail(400, "Recordings are up to 2 minutes.");

  // 5. Counted from here (the row is the limit's counter), then heard.
  const row = await prisma.dailyLogVoice.create({ data: { siteLinkId: link.id, jobId: job.id, day: sydneyDay(now), seconds: Math.round(seconds) } });
  const finish = (status: "DONE" | "FAILED", data: { transcript?: string; cleaned?: string } = {}) =>
    prisma.dailyLogVoice.update({ where: { id: row.id }, data: { status, ...data } }).catch(() => null);

  // The names that help it hear right - this job only, names only.
  const [crew, plant, planned] = await Promise.all([
    crewFor(job.id, now), plantFor(job),
    prisma.assignment.findMany({ where: { jobId: job.id, resource: { type: "PERSONNEL" } }, select: { resource: { select: { name: true } } } }),
  ]);
  const crewNames = [...new Set([...crew.people.map((p) => p.name), ...planned.map((a) => a.resource.name)])];
  const plantNames = plant.map((p) => p.name);
  const site = job.project?.name ?? job.title;
  const prompt = buildVocabulary({ site, crew: crewNames, plant: plantNames, codes: CODES.map((c) => c.name) });

  let heard: TranscribeResult;
  try {
    heard = await (deps.transcribe ?? ((a, p) => transcribe(a, { prompt: p })))(audio, prompt);
  } catch {
    heard = { error: VOICE_OFF, status: 503 };
  }
  if ("error" in heard) { await finish("FAILED"); return fail(heard.status, heard.status === 502 ? FAILED_TO_TEXT : heard.error); }
  const stripped = stripMoney(heard.text);
  if (!stripped.text.trim()) { await finish("FAILED"); return fail(422, FAILED_TO_TEXT); }

  const cleaned = await cleanTranscript(stripped.text, { site, crew: crewNames, plant: plantNames }, stripped.removed, deps.cleaner);
  await finish("DONE", { transcript: stripped.text.slice(0, 8000), cleaned: JSON.stringify(cleaned) });
  return {
    status: 200,
    body: {
      voiceId: row.id, note: cleanedNote(cleaned), sections: cleaned.sections,
      delays: cleaned.delays.map((d) => ({ ...d, label: DELAY_LABEL[d.delayCode] })),
      checkThis: cleaned.checkThis, amountsNotice: cleaned.amountsRemoved ? AMOUNTS_NOTICE : null,
    },
  };
}

