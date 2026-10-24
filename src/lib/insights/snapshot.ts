// Weekly Director Insights snapshot (24 Oct 2026, Ilies: "start now").
// Called from the one-minute tick in src/instrumentation.ts, but only looks
// at most once an hour: if this Monday-week has no KpiSnapshot rows yet, it
// works the overview out once and saves one row per KPI. So it runs once a
// week - the first check after Monday 00:00 Sydney - and once straight
// after the first deploy (marked partial, see snapshotRows).
//
// Append-only: rows are inserted, never updated or deleted. A week that's
// only partly written (the server restarted mid-write) gets just its missing
// KPIs on the next check; a row that already exists is never touched - the
// first value stands, and two checks racing hit the unique key and skip.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { startOfWeek } from "../dates";
import { loadDirectorOverview } from "./load";
import { SNAPSHOT_KPIS, snapshotRows } from "./kpis";

const CHECK_EVERY_MS = 60 * 60 * 1000;
let lastCheck = 0;
let running = false;

export async function recordWeeklySnapshot(opts: { force?: boolean } = {}): Promise<{ weekStart: string; written: number; skipped: number } | null> {
  if (running) return null;
  if (!opts.force && Date.now() - lastCheck < CHECK_EVERY_MS) return null;
  lastCheck = Date.now();
  running = true;
  try {
    const today = todaySydney();
    const weekStart = startOfWeek(today);
    const have = new Set((await prisma.kpiSnapshot.findMany({ where: { weekStart }, select: { kpi: true } })).map((r) => r.kpi));
    if (SNAPSHOT_KPIS.every((k) => have.has(k))) return { weekStart, written: 0, skipped: 0 };
    const { rows } = snapshotRows(await loadDirectorOverview(), today);
    let written = 0, skipped = 0;
    for (const r of rows) {
      if (have.has(r.kpi)) { skipped++; continue; }
      try {
        await prisma.kpiSnapshot.create({ data: { weekStart, ...r } });
        written++;
      } catch (e) {
        // Unique (weekStart, kpi) already there - keep the first value.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") skipped++;
        else throw e;
      }
    }
    return { weekStart, written, skipped };
  } finally {
    running = false;
  }
}
