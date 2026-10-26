// Receipts R4 - indicators, the plain maths (design §Indicators). No database: ./indicatorStore.ts
// loads. Per job: loads, tonnes, tip cost, $/tonne, asbestos loads. Per truck: km per day (odometer),
// litres and fuel $ per day and per week, L/100 km (fuel bought between two odometer readings), and
// the flags - consumption more than 25% above the truck's own 8-week average, and a tip site not used
// on that job before (information only). Fuel is never a job cost (Ilies) - it's per truck only.

const DAY = 86_400_000;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
export const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
// Monday of the Sydney week a day falls in.
export function weekOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}

// ---------- per job ----------

export type JobDocket = { id: string; day: string; tipSite: string | null; tonnes: number | null; asbestos: boolean | null; amount: number | null };
export type JobTipIndicators = { loads: number; tonnes: number; tipCost: number; perTonne: number | null; asbestosLoads: number; unpriced: number };

// Tip cost is what's priced (printed price or tonnes × rate); $/tonne is over the priced loads with
// a weight only, so an unpriced load never drags it down.
export function jobTips(dockets: JobDocket[]): JobTipIndicators {
  const priced = dockets.filter((d) => d.amount != null);
  const pricedWithWeight = priced.filter((d) => (d.tonnes ?? 0) > 0);
  const t = pricedWithWeight.reduce((n, d) => n + (d.tonnes ?? 0), 0);
  return {
    loads: dockets.length,
    tonnes: round(dockets.reduce((n, d) => n + (d.tonnes ?? 0), 0)),
    tipCost: round(priced.reduce((n, d) => n + (d.amount ?? 0), 0)),
    perTonne: t > 0 ? round(pricedWithWeight.reduce((n, d) => n + (d.amount ?? 0), 0) / t) : null,
    asbestosLoads: dockets.filter((d) => d.asbestos).length,
    unpriced: dockets.length - priced.length,
  };
}

// Dockets from a tip site the job hadn't used before (information only). The job's first site is
// never "new" - only a site that turns up after the job has already used another one.
export function newTipSites(dockets: JobDocket[]): { id: string; day: string; tipSite: string }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  const out: { id: string; day: string; tipSite: string }[] = [];
  for (const d of [...dockets].filter((x) => x.tipSite).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))) {
    const k = norm(d.tipSite!);
    if (seen.size > 0 && !seen.has(k)) out.push({ id: d.id, day: d.day, tipSite: d.tipSite! });
    seen.add(k);
  }
  return out;
}

// ---------- per truck ----------

export type Odo = { at: Date; km: number };
export type FuelBuy = { at: Date; litres: number | null; total: number | null };
export type Interval = { from: Date; to: Date; km: number; litres: number; per100: number };
export type TruckIndicators = {
  lastKm: number | null; lastKmAt: string | null;
  kmPerDay: number | null; // over the last 8 weeks of readings
  fuelByDay: { day: string; litres: number; dollars: number }[]; // last 14 days with fuel
  fuelByWeek: { week: string; litres: number; dollars: number }[]; // last 8 weeks with fuel
  latestPer100: number | null; avgPer100: number | null; // L/100 km: the latest interval, and the 8 weeks before it
  highConsumption: boolean; // latest > 25% above the truck's own 8-week average
  intervals: number;
};
export const HIGH_CONSUMPTION = 1.25;
export const WINDOW_DAYS = 56; // 8 weeks

// L/100 km between consecutive odometer readings: the fuel bought after one reading, up to and
// including the next. Intervals with no distance or no fuel are skipped (nothing to divide).
export function intervals(odos: Odo[], fuel: FuelBuy[]): Interval[] {
  const r = [...odos].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Interval[] = [];
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    const km = b.km - a.km;
    if (km <= 0) continue;
    const litres = fuel.filter((f) => f.at > a.at && f.at <= b.at).reduce((n, f) => n + (f.litres ?? 0), 0);
    if (litres <= 0) continue;
    out.push({ from: a.at, to: b.at, km, litres: round(litres), per100: round((litres / km) * 100, 1) });
  }
  return out;
}

export function truckIndicators(odos: Odo[], fuel: FuelBuy[], now = new Date()): TruckIndicators {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const sorted = [...odos].sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = sorted[sorted.length - 1] ?? null;
  // km per day: distance over the readings in the window, divided by the days between the first and last.
  const inWindow = sorted.filter((o) => o.at >= since);
  const span = inWindow.length >= 2 ? (inWindow[inWindow.length - 1].at.getTime() - inWindow[0].at.getTime()) / DAY : 0;
  const kmPerDay = span >= 1 && inWindow[inWindow.length - 1].km > inWindow[0].km ? round((inWindow[inWindow.length - 1].km - inWindow[0].km) / span, 0) : null;

  const byDay = new Map<string, { litres: number; dollars: number }>();
  const byWeek = new Map<string, { litres: number; dollars: number }>();
  for (const f of fuel.filter((x) => x.at >= since)) {
    const day = sydneyDay(f.at), week = weekOf(day);
    for (const [m, k] of [[byDay, day], [byWeek, week]] as const) {
      const v = m.get(k) ?? { litres: 0, dollars: 0 };
      v.litres += f.litres ?? 0; v.dollars += f.total ?? 0;
      m.set(k, v);
    }
  }
  const dayCut = sydneyDay(new Date(now.getTime() - 14 * DAY));
  const all = intervals(sorted, fuel);
  const latest = all[all.length - 1] ?? null;
  const before = latest ? all.filter((iv) => iv !== latest && iv.to >= since) : [];
  const bKm = before.reduce((n, iv) => n + iv.km, 0), bL = before.reduce((n, iv) => n + iv.litres, 0);
  const avgPer100 = before.length >= 2 && bKm > 0 ? round((bL / bKm) * 100, 1) : null; // needs a history to compare with
  return {
    lastKm: last?.km ?? null, lastKmAt: last ? last.at.toISOString() : null,
    kmPerDay,
    fuelByDay: [...byDay].filter(([d]) => d >= dayCut).sort(([a], [b]) => b.localeCompare(a)).map(([day, v]) => ({ day, litres: round(v.litres), dollars: round(v.dollars) })),
    fuelByWeek: [...byWeek].sort(([a], [b]) => b.localeCompare(a)).map(([week, v]) => ({ week, litres: round(v.litres), dollars: round(v.dollars) })),
    latestPer100: latest && latest.to >= since ? latest.per100 : null,
    avgPer100,
    highConsumption: !!(latest && latest.to >= since && avgPer100 && latest.per100 > avgPer100 * HIGH_CONSUMPTION),
    intervals: all.length,
  };
}
