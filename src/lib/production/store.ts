// Production benchmarks (LCI 5b), server side: gathers the evidence (daily logs, the approved budget's
// quantities, weekly % complete, read tip dockets), works out the figures (./benchmarks.ts), and offers a
// code to Estimating when a named person taps Offer - then reads the estimator's decision back. Reads
// only, apart from BenchmarkOffer rows. Hours only, never money.
import { prisma } from "../prisma";
import { estimatingCall } from "../estimatingClient";
import { approvedBudgetFor, latestPct } from "../dailyLog/store";
import { buildSuggestion, combine, jobFigures, suggestionIsSafe, type CodeBenchmark, type EvidenceLog, type JobEvidence } from "./benchmarks";

type Problem = { error: string; status: number };

// ---------- the evidence ----------

export async function loadEvidence(): Promise<{ jobs: JobEvidence[]; estimatingDown: boolean }> {
  const logged = await prisma.dailyLog.findMany({ where: { projectId: { not: null } }, distinct: ["projectId"], select: { projectId: true } });
  const projects = await prisma.project.findMany({ where: { id: { in: logged.map((l) => l.projectId!) } }, select: { id: true, name: true, jobNo: true, quoteNo: true, status: true } });
  let estimatingDown = false;
  const jobs: JobEvidence[] = [];
  for (const p of projects) {
    const rows = await prisma.dailyLog.findMany({
      where: { projectId: p.id },
      orderBy: [{ jobId: "asc" }, { revision: "desc" }],
      select: {
        id: true, jobId: true, date: true, revision: true, crewOk: true,
        hours: { where: { kind: "LABOUR" }, select: { code: true, hours: true } },
        delays: { select: { hoursLost: true } },
        dockets: { select: { code: true, quantity: true, unit: true, docketNo: true } },
      },
    });
    const latest = new Map<string, (typeof rows)[number]>(); // a correction replaces, never adds
    for (const l of rows) if (!latest.has(l.jobId)) latest.set(l.jobId, l);
    const logs: EvidenceLog[] = [...latest.values()].map((l) => ({
      id: l.id, jobId: l.jobId, date: l.date, crewOk: l.crewOk, delayHours: l.delays.reduce((n, d) => n + (d.hoursLost ?? 0), 0),
      labour: l.hours, dockets: l.dockets,
    }));
    const budget = await approvedBudgetFor(p);
    if (budget.state === "DOWN") estimatingDown = true;
    // Read tip dockets from Receipts weigh in tonnes - they count towards DEM-10 (waste load-out), the
    // one docket code measured in tonnes (CIV-02 is m³).
    const receipts = await prisma.receipt.findMany({ where: { kind: "TIP", projectId: p.id, status: { in: ["READ", "CONFIRMED"] }, tonnes: { gt: 0 } }, select: { tonnes: true, docketNo: true, jobId: true, docketAt: true, sentAt: true } });
    jobs.push({
      projectId: p.id, projectName: p.name, jobRef: p.jobNo || p.name, finished: p.status === "COMPLETED", logs,
      packages: budget.state === "OK" ? budget.packages.map((x) => ({ packageId: x.packageId, code: x.code, qty: x.qty ?? 0, unit: x.unit ?? "", labourHrs: x.labourHrs })) : null,
      pct: await latestPct(p.id, null),
      receiptDockets: receipts.map((x) => ({ code: "DEM-10", quantity: x.tonnes!, unit: "t", docketNo: x.docketNo, jobId: x.jobId, day: (x.docketAt ?? x.sentAt).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }) })),
    });
  }
  return { jobs, estimatingDown };
}

// ---------- the page ----------

export type OfferDTO = {
  id: string; code: string; unit: string; labourHrsPerUnit: number; confidence: string; evidenceHash: string; offeredBy: string; createdAt: string;
  sentStatus: string; lastError: string | null; estimatingStatus: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
};
const offerDTO = (o: NonNullable<Awaited<ReturnType<typeof prisma.benchmarkOffer.findUnique>>>): OfferDTO => ({
  id: o.id, code: o.code, unit: o.unit, labourHrsPerUnit: o.labourHrsPerUnit, confidence: o.confidence, evidenceHash: o.evidenceHash, offeredBy: o.offeredBy,
  createdAt: o.createdAt.toISOString(), sentStatus: o.sentStatus, lastError: o.lastError, estimatingStatus: o.estimatingStatus, decidedBy: o.decidedBy,
  decidedAt: o.decidedAt?.toISOString() ?? null, decisionNote: o.decisionNote,
});

export async function productionView(): Promise<{ benchmarks: CodeBenchmark[]; offers: OfferDTO[]; estimatingDown: boolean }> {
  await refreshDecisions();
  const { jobs, estimatingDown } = await loadEvidence();
  const benchmarks = combine(jobs.flatMap(jobFigures));
  const offers = await prisma.benchmarkOffer.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return { benchmarks, offers: offers.map(offerDTO), estimatingDown };
}

// ---------- offering a code (a named person's deliberate tap) ----------

// The shared key Estimating checks (ACTUALS_SECRET, at least 16 characters) - server only.
export const actualsSecret = (env: Record<string, string | undefined> = process.env) => ((env.ACTUALS_SECRET ?? "").length >= 16 ? env.ACTUALS_SECRET! : null);
export const KEY_NOT_SET = "Offering isn't switched on yet: the key Estimating checks (ACTUALS_SECRET) hasn't been set on the server. Nothing was offered.";
export const ESTIMATING_DOWN = "Estimating isn't running on the server right now. Nothing was offered - try again later.";

export async function offer(who: { id: string; name: string; directorAccess: boolean }, b: Record<string, unknown>): Promise<{ offer: OfferDTO } | Problem> {
  if (!who.directorAccess) return { error: "Only the owner or someone with director access offers a benchmark to Estimating.", status: 403 };
  const code = String(b.code ?? ""), unit = String(b.unit ?? "");
  const { jobs } = await loadEvidence();
  const bench = combine(jobs.flatMap(jobFigures)).find((x) => x.code === code && x.unit === unit);
  if (!bench) return { error: "That code has no figures.", status: 404 };
  if (!bench.confidence || !bench.evidenceHash) return { error: "Not enough evidence yet - it can't be offered until a job clears the bar.", status: 409 };

  // The same evidence twice: already offered (a failed send is retried on its own row, same id).
  const existing = await prisma.benchmarkOffer.findUnique({ where: { evidenceHash: bench.evidenceHash } });
  if (existing?.sentStatus === "SENT") return { error: "This evidence has already been offered - it changes as more logs come in.", status: 409 };
  const row = existing ?? await prisma.benchmarkOffer.create({
    data: {
      code, unit, labourHrsPerUnit: bench.hrsPerUnit!, budgetHrsPerUnit: bench.budgetHrsPerUnit, confidence: bench.confidence, evidenceHash: bench.evidenceHash,
      sample: JSON.stringify({ jobs: bench.jobs, logs: bench.logs, from: bench.from, to: bench.to, delayHours: bench.delayHours }),
      payload: "{}", offeredBy: who.name, offeredById: who.id, sentStatus: "FAILED", lastError: "Not sent yet.",
    },
  });
  const suggestion = buildSuggestion(bench, row.id)!;
  if (!suggestionIsSafe(suggestion)) {
    await prisma.benchmarkOffer.update({ where: { id: row.id }, data: { payload: JSON.stringify(suggestion), lastError: "The offer had a word Estimating treats as money (e.g. in a job name) - not sent." } });
    return { error: "The offer had a word Estimating treats as money (e.g. in a job name) - nothing was sent.", status: 422 };
  }
  const payload = JSON.stringify(suggestion);
  const fail = async (lastError: string, status: number) => {
    const o = await prisma.benchmarkOffer.update({ where: { id: row.id }, data: { payload, sentStatus: "FAILED", lastError, offeredBy: who.name, offeredById: who.id } });
    return { error: lastError, status, offer: offerDTO(o) };
  };
  const secret = actualsSecret();
  if (!secret) return fail(KEY_NOT_SET, 503);
  const r = await estimatingCall<{ duplicate: boolean; status: { status: string } }>("/api/production-suggestions", { method: "POST", headers: { "content-type": "application/json", "x-lobos-actuals": secret }, body: payload }, who.name);
  if (r.status === 0) return fail(ESTIMATING_DOWN, 502);
  if (r.status === 403) return fail("Estimating didn't accept the key - the two servers' keys don't match. Nothing was offered.", 502);
  if (r.status !== 200 && r.status !== 201) return fail(`Estimating refused it: ${r.body?.error ?? `status ${r.status}`}`, r.status === 409 ? 409 : 400);
  const o = await prisma.benchmarkOffer.update({
    where: { id: row.id },
    data: { payload, sentStatus: "SENT", lastError: null, estimatingStatus: r.body?.status?.status ?? "PENDING", checkedAt: new Date(), offeredBy: who.name, offeredById: who.id },
  });
  return { offer: offerDTO(o) };
}

// ---------- the estimator's decision, read back ----------

let lastRefresh = 0;
// Reads PENDING offers' status from Estimating (at most every 5 minutes; force for a test).
export async function refreshDecisions(force = false): Promise<number> {
  if (!force && Date.now() - lastRefresh < 5 * 60_000) return 0;
  lastRefresh = Date.now();
  const open = await prisma.benchmarkOffer.findMany({ where: { sentStatus: "SENT", OR: [{ estimatingStatus: null }, { estimatingStatus: "PENDING" }] }, take: 50 });
  let n = 0;
  for (const o of open) {
    const r = await estimatingCall<{ status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null }>(`/api/production-suggestions/${encodeURIComponent(o.id)}`);
    if (r.status !== 200 || !r.body) continue;
    await prisma.benchmarkOffer.update({
      where: { id: o.id },
      data: { estimatingStatus: r.body.status, decidedBy: r.body.decided_by, decidedAt: r.body.decided_at ? new Date(r.body.decided_at) : null, decisionNote: r.body.decision_note, checkedAt: new Date() },
    });
    n++;
  }
  return n;
}
