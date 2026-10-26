// Receipts R4 - indicators, server side: per job (tip loads, tonnes, cost, $/t, asbestos, new tip
// sites) and per truck (km a day, fuel by day and week, L/100 km and the 25% flag, tip loads it
// carried). Office side, Manager+ (they have money). Day Review gets a money-free count per job.
// Maths: ./indicators.ts. Nothing here writes.
import { prisma } from "../prisma";
import { assertNoMoney } from "../moneyGuard";
import { lobosTrucks } from "./store";
import { tipDocketsByProject } from "./tipStore";
import { jobTips, newTipSites, truckIndicators, WINDOW_DAYS, type JobTipIndicators, type TruckIndicators } from "./indicators";

const COUNTED = ["READ", "CONFIRMED"];

export type JobIndicatorDTO = JobTipIndicators & { projectId: string; projectName: string; lastDay: string | null; newSites: { id: string; day: string; tipSite: string }[] };
export async function jobIndicators(projectId?: string): Promise<JobIndicatorDTO[]> {
  const byProject = await tipDocketsByProject();
  const ids = projectId ? [projectId] : [...byProject.keys()];
  const names = new Map((await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return ids.filter((id) => byProject.has(id)).map((id) => {
    const d = byProject.get(id)!;
    return { projectId: id, projectName: names.get(id) ?? "a job", ...jobTips(d), lastDay: d.map((x) => x.day).sort().pop() ?? null, newSites: newTipSites(d) };
  }).sort((a, b) => (b.lastDay ?? "").localeCompare(a.lastDay ?? ""));
}

export type TruckIndicatorDTO = TruckIndicators & { vehicleId: string; name: string; tipLoads: number; tipTonnes: number };
export async function truckIndicatorList(vehicleId?: string, now = new Date()): Promise<TruckIndicatorDTO[]> {
  const since = new Date(now.getTime() - 4 * WINDOW_DAYS * 86_400_000); // enough history for the 8-week average
  const window = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const trucks = (await lobosTrucks()).filter((t) => !vehicleId || t.id === vehicleId);
  const ids = trucks.map((t) => t.id);
  const [odos, fuel, tips] = await Promise.all([
    prisma.odometerReading.findMany({ where: { vehicleId: { in: ids }, status: { in: COUNTED }, km: { not: null }, sentAt: { gte: since } }, select: { vehicleId: true, km: true, sentAt: true } }),
    prisma.receipt.findMany({ where: { kind: "FUEL", vehicleId: { in: ids }, status: { in: COUNTED }, sentAt: { gte: since } }, select: { vehicleId: true, litres: true, fuelTotal: true, docketAt: true, sentAt: true } }),
    prisma.receipt.findMany({ where: { kind: "TIP", vehicleId: { in: ids }, status: { in: COUNTED }, sentAt: { gte: window } }, select: { vehicleId: true, tonnes: true } }),
  ]);
  return trucks.map((t) => {
    const ind = truckIndicators(
      odos.filter((o) => o.vehicleId === t.id).map((o) => ({ at: o.sentAt, km: o.km! })),
      fuel.filter((f) => f.vehicleId === t.id).map((f) => ({ at: f.docketAt ?? f.sentAt, litres: f.litres, total: f.fuelTotal })),
      now,
    );
    const mine = tips.filter((x) => x.vehicleId === t.id);
    return { vehicleId: t.id, name: t.name, ...ind, tipLoads: mine.length, tipTonnes: Math.round(mine.reduce((n, x) => n + (x.tonnes ?? 0), 0) * 100) / 100 };
  });
}

// Day Review (Viewer+, operational): tip dockets sent for each job that day - count, tonnes read so
// far, asbestos loads. Never a price.
export type DayDocketsDTO = { jobs: { jobId: string; dockets: number; tonnes: number; asbestos: number; toCheck: number }[] };
export async function docketsForDay(date: string): Promise<DayDocketsDTO> {
  const jobs = await prisma.job.findMany({ where: { date: new Date(`${date}T00:00:00.000Z`) }, select: { id: true } });
  const rows = jobs.length
    ? await prisma.receipt.findMany({ where: { kind: "TIP", jobId: { in: jobs.map((j) => j.id) }, status: { not: "REJECTED" } }, select: { jobId: true, tonnes: true, asbestos: true, status: true } })
    : [];
  const out = new Map<string, DayDocketsDTO["jobs"][number]>();
  for (const r of rows) {
    const v = out.get(r.jobId!) ?? { jobId: r.jobId!, dockets: 0, tonnes: 0, asbestos: 0, toCheck: 0 };
    v.dockets++;
    if (COUNTED.includes(r.status)) v.tonnes = Math.round((v.tonnes + (r.tonnes ?? 0)) * 100) / 100;
    if (r.asbestos) v.asbestos++;
    if (r.status === "CHECK" || r.status === "SENT") v.toCheck++;
    out.set(r.jobId!, v);
  }
  const dto = { jobs: [...out.values()] };
  if (!assertNoMoney(JSON.stringify(dto))) throw new Error("money in the Day Review dockets");
  return dto;
}

