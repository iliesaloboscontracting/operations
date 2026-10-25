// Daily log pilot report (Task K, piece 7). Read-only: it writes nothing.
// For the pilot supervisors (DAILY_LOG_PILOT_LINKS) over a date range:
//   - completeness: jobs logged ÷ jobs run, per supervisor and per day
//     (a job "ran" if anyone signed in or crew were on the board)
//   - when logs come in (on the day / next morning) and the median time to
//     fill one in (open -> Submit, the 60-second target)
//   - corrections (later versions), crew entered by hand
//   - activity codes used (labour hours), plant hours, tip dockets per job and
//     by waste class (asbestos counted on its own), delays and hours lost
// The phase-1 exit test is "pilot supervisors log 2 weeks; completeness measured".
//
// Usage (PowerShell), on a copy or - read-only - on the server:
//   $env:DATABASE_URL = "file:C:/path/to/prisma/test.db"
//   $env:DAILY_LOG_PILOT_LINKS = "<link id>,<link id>"
//   npx tsx scripts/daily-log-pilot-report.ts [--from 2026-10-26] [--to 2026-11-06] [--csv]
// Without --from/--to: the last 14 days to yesterday (Sydney).

import { PrismaClient } from "@prisma/client";
import { codeLabel } from "../src/lib/activityCodes";
import { pilotLinkIds } from "../src/lib/dailyLog/rules";
import { sydneyDay } from "../src/lib/dailyLog/checks";

const prisma = new PrismaClient();
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const r1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const today = sydneyDay(new Date());
  const to = arg("--to") ?? addDays(today, -1);
  const from = arg("--from") ?? addDays(to, -13);
  const csv = process.argv.includes("--csv");
  const ids = [...pilotLinkIds()];
  if (!ids.length) throw new Error("DAILY_LOG_PILOT_LINKS is empty - set it to the pilot supervisors' link ids.");
  const links = await prisma.siteLink.findMany({ where: { id: { in: ids }, kind: "SUPERVISOR" }, select: { id: true, resource: { select: { id: true, name: true } } } });
  const people = new Map(links.filter((l) => l.resource).map((l) => [l.resource!.id, l.resource!.name]));
  if (!people.size) throw new Error("None of those ids is a supervisor link with a person.");

  const jobs = await prisma.job.findMany({
    where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, status: { notIn: ["INACTIVE", "STOOD_DOWN"] }, assignments: { some: { resourceId: { in: [...people.keys()] } } } },
    select: {
      id: true, date: true, shift: true, title: true, project: { select: { name: true } },
      assignments: { select: { resourceId: true, resource: { select: { type: true } } } },
      _count: { select: { attendances: { where: { status: { not: "REJECTED" } } } } },
      dailyLogs: { orderBy: { revision: "asc" }, include: { hours: true, delays: true, dockets: true } },
    },
    orderBy: [{ date: "asc" }],
  });
  const ran = jobs.filter((j) => j._count.attendances > 0 || j.assignments.some((a) => a.resource.type === "PERSONNEL"));

  // Per supervisor, per day.
  type Tally = { run: number; logged: number; onDay: number; nextDay: number };
  const bySup = new Map<string, Tally>(), byDay = new Map<string, Tally>();
  const bump = (m: Map<string, Tally>, k: string, logged: boolean, onDay: boolean) => {
    const t = m.get(k) ?? { run: 0, logged: 0, onDay: 0, nextDay: 0 };
    t.run++; if (logged) { t.logged++; if (onDay) t.onDay++; else t.nextDay++; }
    m.set(k, t);
  };
  const durations: number[] = [], submitMinutes: number[] = [];
  let corrections = 0, byHand = 0;
  const codes = new Map<string, number>(), plantHours = new Map<string, number>();
  const docketsByClass = new Map<string, { n: number; qty: Map<string, number> }>(), delays = new Map<string, { n: number; lost: number }>();
  let docketJobs = 0, docketCount = 0;

  for (const j of ran) {
    const day = j.date.toISOString().slice(0, 10);
    const first = j.dailyLogs[0], latest = j.dailyLogs[j.dailyLogs.length - 1];
    const onDay = !!first && sydneyDay(first.createdAt) === day;
    for (const p of j.assignments.filter((a) => people.has(a.resourceId))) bump(bySup, people.get(p.resourceId)!, !!first, onDay);
    bump(byDay, day, !!first, onDay);
    if (!first) continue;
    corrections += j.dailyLogs.length - 1;
    if (first.durationSec != null) durations.push(first.durationSec);
    const hm = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(first.createdAt).split(":").map(Number);
    submitMinutes.push(hm[0] * 60 + hm[1]);
    if (!latest.crewOk) byHand++;
    for (const h of latest.hours) (h.kind === "LABOUR" ? codes : plantHours).set(h.code, r1(((h.kind === "LABOUR" ? codes : plantHours).get(h.code) ?? 0) + h.hours));
    if (latest.dockets.length) docketJobs++;
    docketCount += latest.dockets.length;
    for (const d of latest.dockets) {
      const c = docketsByClass.get(d.wasteClass) ?? { n: 0, qty: new Map() };
      c.n++; c.qty.set(d.unit, r1((c.qty.get(d.unit) ?? 0) + d.quantity)); docketsByClass.set(d.wasteClass, c);
    }
    for (const d of latest.delays) { const x = delays.get(d.delayCode) ?? { n: 0, lost: 0 }; x.n++; x.lost = r1(x.lost + (d.hoursLost ?? 0)); delays.set(d.delayCode, x); }
  }

  const loggedJobs = ran.filter((j) => j.dailyLogs.length).length;
  const medSubmit = median(submitMinutes);
  if (csv) {
    console.log("supervisor,jobs_run,logged,completeness,on_the_day,next_morning");
    for (const [name, t] of bySup) console.log([name, t.run, t.logged, pct(t.logged, t.run), t.onDay, t.nextDay].join(","));
    console.log("\ndate,jobs_run,logged,completeness");
    for (const [d, t] of [...byDay].sort()) console.log([d, t.run, t.logged, pct(t.logged, t.run)].join(","));
    return;
  }
  console.log(`# Daily log pilot report, ${from} to ${to}`);
  console.log(`Pilot supervisors: ${[...people.values()].join(", ")}\n`);
  console.log(`## Completeness: ${loggedJobs} of ${ran.length} jobs run were logged (${pct(loggedJobs, ran.length)})`);
  for (const [name, t] of bySup) console.log(`- ${name}: ${t.logged}/${t.run} (${pct(t.logged, t.run)}) - ${t.onDay} on the day, ${t.nextDay} next morning`);
  console.log("\nBy day:");
  for (const [d, t] of [...byDay].sort()) console.log(`- ${d}: ${t.logged}/${t.run}`);
  console.log(`\n## Time`);
  console.log(`- Median time to fill in: ${median(durations) != null ? `${Math.round(median(durations)!)} s` : "-"} (target about 60 s; ${durations.length} timed)`);
  console.log(`- Median submit time: ${medSubmit != null ? `${String(Math.floor(medSubmit / 60)).padStart(2, "0")}:${String(Math.round(medSubmit % 60)).padStart(2, "0")}` : "-"}`);
  console.log(`- Corrections (later versions): ${corrections} · crew entered by hand: ${byHand}`);
  console.log(`\n## Activity codes (labour hours, latest versions)`);
  for (const [c, h] of [...codes].sort((a, b) => b[1] - a[1])) console.log(`- ${codeLabel(c)}: ${h} h`);
  if (plantHours.size) { console.log(`\nPlant hours by code:`); for (const [c, h] of [...plantHours].sort((a, b) => b[1] - a[1])) console.log(`- ${c}: ${h} h`); }
  console.log(`\n## Tip dockets: ${docketCount} on ${docketJobs} of ${loggedJobs} logged jobs (${loggedJobs ? r1(docketCount / loggedJobs) : 0} per logged job)`);
  for (const [w, c] of [...docketsByClass].sort((a, b) => b[1].n - a[1].n)) console.log(`- ${w}: ${c.n} (${[...c.qty].map(([u, q]) => `${q} ${u}`).join(", ")})`);
  console.log(`\n## Delays`);
  if (!delays.size) console.log("- none");
  for (const [d, x] of [...delays].sort((a, b) => b[1].n - a[1].n)) console.log(`- ${d}: ${x.n} (about ${x.lost} h lost)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
