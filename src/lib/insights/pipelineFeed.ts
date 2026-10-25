// Fetches Estimating's pipeline.v1 and won-tenders.v1 for the Directors
// screen and the findings engine (G5, 25 Oct 2026). Same server, over
// ESTIMATING_URL (lib/estimatingClient.ts). Short timeouts: the overview
// must load even when Estimating doesn't answer - it then says "Estimating
// not reachable" and shows no pipeline numbers. Server-only.
import { prisma } from "../prisma";
import { estimatingCall } from "../estimatingClient";
import { isPipelineV1, isWonTendersV1, matchWon, type PipelineState, type WonMatch, type WonTendersV1 } from "./pipeline";

const TIMEOUT_MS = 4_000;

function projectKeys() {
  return prisma.project.findMany({ select: { id: true, name: true, jobNo: true, quoteNo: true } });
}

// Won tenders matched to Operations projects, or null when Estimating didn't
// answer properly - the caller must then treat the won-tender check as "not
// looked at this time", never as "nothing found".
export async function loadWonMatches(): Promise<{ rows: WonMatch[]; feed: WonTendersV1 } | null> {
  const [r, projects] = await Promise.all([estimatingCall<WonTendersV1>("/api/tenders/won", { timeoutMs: TIMEOUT_MS }), projectKeys()]);
  if (r.status !== 200 || !isWonTendersV1(r.body)) return null;
  return { rows: matchWon(r.body.tenders, projects), feed: r.body };
}

export async function loadPipelineState(): Promise<PipelineState> {
  const [p, won] = await Promise.all([estimatingCall("/api/pipeline", { timeoutMs: TIMEOUT_MS }), loadWonMatches()]);
  if (p.status === 0) return { ok: false, reason: "UNREACHABLE" };
  if (p.status !== 200 || !isPipelineV1(p.body)) return { ok: false, reason: "BAD_FORMAT" };
  return { ok: true, pipeline: p.body, won: won?.rows ?? null };
}
