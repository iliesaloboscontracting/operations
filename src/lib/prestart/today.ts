// Pre-starts today (Ilies, 23 Nov 2026: "yes do 1 and 2") - the database side of two things:
//   1. whether a truck QR sign-in's pre-start is still REQUIRED (the truck has none yet today) - the phone then offers no
//      "Do it later" and takes the driver back to it on reopening (rules.ts truckPrestartRequired);
//   2. "Pre-start not done" for the office (Checks tab, Sign-ins), and the "Pre-starts today" card on the Allocations
//      board: each truck signed in today and each owned machine with a QR sticker or booked today, with its status.
// Words, names and times only - no money. The office side is behind guardFaults (the same people as the Checks tab).
import { prisma } from "../prisma";
import { fromSydneyLocal } from "../shiftTimes";
import { todaySydney } from "../today";
import { plantChecksForDay } from "./plant";
import {
  OPEN_STATUSES, PRESTART_NOT_DONE, PRIORITY_LABEL, cardCounts, isHookBin, machineCardStatus, noStickerCount, noStickerText, plantQrAllowed, signInPreStatus,
  truckCardStatus, truckPrestartRequired, worstPriority, type CardStatus, type FaultPriority,
} from "./rules";

const midnightOf = (day: string) => fromSydneyLocal(`${day}T00:00`)!;
const nextDay = (day: string) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// Is this sign-in's pre-start still required? Only a truck QR sign-in (POINT, VEHICLE), still open, not removed, with no
// pre-start of its own, on a truck with no pre-start yet on the sign-in's day (Sydney). Any doubt (not found) = not
// required. PT-003 (Ilies approved 23 Nov 2026): counted from midnight of the SIGN-IN's date (as preStatusFor does), not
// today's - a night sign-in still open after midnight on a truck checked that evening stays optional.
export async function truckPrestartPending(attendanceId: string): Promise<boolean> {
  const a = await prisma.siteAttendance.findUnique({
    where: { id: attendanceId },
    select: { id: true, place: true, vehicleId: true, signInMethod: true, signOutAt: true, removedAt: true, status: true, date: true },
  });
  if (!a || a.place !== "VEHICLE" || !a.vehicleId || a.removedAt || a.status === "REJECTED") return false;
  const [own, truckPreToday] = await Promise.all([
    prisma.prestartCheck.count({ where: { attendanceId: a.id, kind: "PRE" } }),
    prisma.prestartCheck.count({ where: { resourceId: a.vehicleId, kind: "PRE", createdAt: { gte: midnightOf(a.date) } } }),
  ]);
  return truckPrestartRequired({ fromQr: a.signInMethod === "POINT", signedOut: !!a.signOutAt, ownPreDone: own > 0, truckPreToday });
}

type TruckSignIn = { id: string; vehicleId: string | null; date: string; signInMethod: string; signOutAt: Date | null };
// For a day's truck sign-ins: the office's pre-start word for each (rules.ts signInPreStatus). A sign-in with no
// pre-start of its own is "not done" when the truck had no pre-start by the time it ended (or by now, if still open).
export async function preStatusFor(signIns: TruckSignIn[], own: Map<string, { faultCount: number }>, now = new Date()): Promise<Map<string, string>> {
  const trucks = [...new Set(signIns.map((s) => s.vehicleId).filter((x): x is string => !!x))];
  const days = [...new Set(signIns.map((s) => s.date))];
  const pres = trucks.length && days.length
    ? await prisma.prestartCheck.findMany({
      where: { resourceId: { in: trucks }, kind: "PRE", attendanceId: { not: null }, OR: days.map((d) => ({ createdAt: { gte: midnightOf(d), lt: midnightOf(nextDay(d)) } })) },
      select: { resourceId: true, createdAt: true },
    })
    : [];
  const out = new Map<string, string>();
  for (const s of signIns) {
    const end = (s.signOutAt ?? now).getTime();
    const from = midnightOf(s.date).getTime();
    const truckPreByEnd = !!s.vehicleId && pres.some((p) => p.resourceId === s.vehicleId && p.createdAt.getTime() >= from && p.createdAt.getTime() <= end);
    out.set(s.id, signInPreStatus({ pre: own.get(s.id) ?? null, fromQr: s.signInMethod === "POINT", truckPreByEnd }));
  }
  return out;
}

// The truck sign-ins of a day whose pre-start is not done - for the Sign-ins page's red flag.
export async function preNotDoneIds(signIns: (TruckSignIn & { place: string | null; status: string })[]): Promise<Set<string>> {
  const mine = signIns.filter((s) => s.place === "VEHICLE" && s.vehicleId && s.status !== "REJECTED");
  if (!mine.length) return new Set();
  const checks = await prisma.prestartCheck.findMany({ where: { attendanceId: { in: mine.map((s) => s.id) }, kind: "PRE" }, select: { attendanceId: true, faultCount: true } });
  const own = new Map(checks.map((c) => [c.attendanceId!, { faultCount: c.faultCount }]));
  const words = await preStatusFor(mine, own);
  return new Set([...words].filter(([, w]) => w === PRESTART_NOT_DONE).map(([id]) => id));
}

// ---------- the card ----------

export type CardRow = { id: string; name: string; status: CardStatus; label: string; worst: FaultPriority | null; worstLabel: string | null; href: string; note: string | null; needed: boolean };
export type PrestartTodayCard = {
  day: string;
  trucks: CardRow[];
  machines: CardRow[];
  counts: { trucks: ReturnType<typeof cardCounts>; machines: ReturnType<typeof cardCounts> };
  noSticker: number;
  noStickerText: string | null;
};
const checksHref = (day: string, row: string) => `/faults?tab=checks&date=${day}&row=${encodeURIComponent(row)}`;

// Today's state, for the Allocations board. Trucks: each truck signed in today (one row a truck; the row opens its first
// sign-in on the Checks tab, where the photos are). Machines: each owned machine with a switched-on QR sticker, booked on
// the board today, or checked today. A fault = an open fault on the machine reported or confirmed "still there" today.
export async function prestartToday(day = todaySydney()): Promise<PrestartTodayCard> {
  const from = midnightOf(day), to = midnightOf(nextDay(day));
  const [signIns, plant, stickers, owned] = await Promise.all([
    prisma.siteAttendance.findMany({
      where: { place: "VEHICLE", date: day, removedAt: null, status: { not: "REJECTED" }, vehicleId: { not: null } },
      select: { id: true, vehicleId: true, placeLabel: true, signInAt: true, signOutAt: true, signInMethod: true, date: true },
      orderBy: { signInAt: "asc" },
      take: 500,
    }),
    plantChecksForDay(day),
    prisma.siteLink.findMany({ where: { kind: "PLANT", revokedAt: null, resourceId: { not: null } }, select: { resourceId: true } }),
    prisma.resource.findMany({
      where: { type: "EQUIPMENT", ownership: "OWNED", active: true },
      select: { id: true, name: true, type: true, ownership: true, active: true, category: true, role: true },
    }),
  ]);
  const stickered = new Set(stickers.map((s) => s.resourceId!));
  const checks = signIns.length
    ? await prisma.prestartCheck.findMany({ where: { attendanceId: { in: signIns.map((s) => s.id) } }, select: { attendanceId: true, kind: true } })
    : [];
  const truckIds = [...new Set(signIns.map((s) => s.vehicleId!))];
  // Hook bins (rules.ts isHookBin, 23 Nov 2026) never get a sticker or a pre-start: a booked one isn't listed - only if it
  // somehow has a sticker or a check today.
  const plantIds = plant.map((m) => m.machineId);
  const bins = new Set(
    (await (plantIds.length ? prisma.resource.findMany({ where: { id: { in: plantIds } }, select: { id: true, name: true, category: true, role: true } }) : Promise.resolve([])))
      .filter(isHookBin).map((r) => r.id),
  );
  const machineIds = new Set<string>([
    ...plant.filter((m) => !bins.has(m.machineId) || m.checks.length > 0 || stickered.has(m.machineId)).map((m) => m.machineId),
    ...owned.filter((m) => plantQrAllowed(m) && stickered.has(m.id)).map((m) => m.id),
  ]);
  const faults = await prisma.assetFault.findMany({
    where: {
      resourceId: { in: [...truckIds, ...machineIds] }, status: { in: OPEN_STATUSES },
      OR: [{ reportedAt: { gte: from, lt: to } }, { lastSeenAt: { gte: from, lt: to } }],
    },
    select: { resourceId: true, priority: true },
  });
  const worstOf = (id: string) => worstPriority(faults.filter((f) => f.resourceId === id).map((f) => f.priority));
  const withWorst = (worst: FaultPriority | null) => ({ worst, worstLabel: worst ? PRIORITY_LABEL[worst] : null });

  const trucks: CardRow[] = truckIds.map((vid) => {
    const mine = signIns.filter((s) => s.vehicleId === vid);
    const kinds = checks.filter((c) => mine.some((s) => s.id === c.attendanceId)).map((c) => c.kind);
    const worst = worstOf(vid);
    const st = truckCardStatus({ preDone: kinds.includes("PRE"), postDone: kinds.includes("POST"), worstFault: worst });
    // The row opens the sign-in that matters: the first with no pre-start while it's not done, else the first.
    const pick = st.status === "NOT_DONE" ? mine.find((s) => !checks.some((c) => c.attendanceId === s.id && c.kind === "PRE")) ?? mine[0] : mine[0];
    const open = mine.filter((s) => !s.signOutAt).length;
    return {
      id: vid, name: mine[0].placeLabel ?? "Truck", ...st, ...withWorst(worst), href: checksHref(day, pick.id), needed: true,
      note: `${mine.length} sign-in${mine.length === 1 ? "" : "s"}${open ? ` · ${open} still on` : ""}`,
    };
  }).sort((a, b) => Number(a.status !== "NOT_DONE") - Number(b.status !== "NOT_DONE") || a.name.localeCompare(b.name));

  const nameOf = new Map([...owned.map((m) => [m.id, m.name] as const), ...plant.map((m) => [m.machineId, m.machine] as const)]);
  const machines: CardRow[] = [...machineIds].map((id) => {
    const p = plant.find((m) => m.machineId === id);
    const worst = worstOf(id);
    const st = machineCardStatus({ preDone: p?.preStatus === "Done", worstFault: worst });
    const booked = !!p?.booked;
    // A machine with a sticker that isn't booked and wasn't checked isn't counted as missing a pre-start.
    const needed = booked || st.status !== "NOT_DONE";
    return {
      id, name: nameOf.get(id) ?? "Machine", ...st, ...withWorst(worst), href: checksHref(day, id), needed,
      note: booked ? null : stickered.has(id) ? "Not booked today" : null,
    };
  }).sort((a, b) => Number(b.needed) - Number(a.needed) || Number(a.status !== "NOT_DONE") - Number(b.status !== "NOT_DONE") || a.name.localeCompare(b.name));

  const noSticker = noStickerCount(owned, stickered);
  return {
    day, trucks, machines,
    counts: { trucks: cardCounts(trucks), machines: cardCounts(machines) },
    noSticker, noStickerText: noStickerText(noSticker),
  };
}
