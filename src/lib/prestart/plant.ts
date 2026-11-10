// Stage 2 - plant QR stickers (Ilies approved 10 Nov 2026). A Lobos-owned machine (Resource EQUIPMENT, OWNED) gets a
// QR sticker: a SiteLink of its own kind, PLANT, with resourceId = the machine. Being its own kind (not a POSTER) is
// what keeps it out of sign-in: resolvePoster, resolveLink and resolveReceiptLink all check the kind, so a plant QR can
// never sign anyone in, and a sign-in QR can never start a plant check.
//   Scan  -> GET /api/site/plant/:code   a 15-minute plant ticket (QR + machine), the machine's name, the operators.
//   Name  -> the phone remembers it (localStorage, as sign-in does); hire workers give name + company.
//   Start -> POST /api/site/plant/start   Start of shift (PRE) / End of shift (POST) -> a check session (who, kind,
//            Sydney day, phone) and a 2-hour check token tied to it. Limited per QR and per phone a day.
//   Check -> the same PrestartCheck screen and /api/site/in/prestart* routes as trucks (store.ts plantContext): plant
//            checklist, walk-around on the day's first pre-start, the hour meter (photo + hours) on every check.
// No money anywhere; nothing here signs in, changes a sign-in or touches a timesheet.
import { prisma } from "../prisma";
import { makePlantCheckToken, makePlantTicket, readPlantTicket, sydneyTime, type PrestartKind } from "../signin";
import { hashSecret, newLinkSecret, siteUrl } from "../siteLinks";
import { linkLabel, nameWithoutAmounts } from "../dailyLog/money";
import { looksLikeLobos } from "../staffMatch";
import { todaySydney } from "../today";
import { LIMITS, PRIORITY_LABEL, STATUS_LABEL, cleanText, plantQrAllowed, sessionRefusal, type FaultPriority, type FaultStatus } from "./rules";
import { slotLabel } from "./checklists";
import { oneAtATime, TX } from "./queue";

type Problem = { error: string; status: number };
const problem = (error: string, status = 400): Problem => ({ error, status });

// ---------- the office: print / reprint / switch off a machine's QR (Manager+) ----------

export async function plantQrs() {
  const links = await prisma.siteLink.findMany({
    where: { kind: "PLANT", revokedAt: null },
    select: { resourceId: true, createdAt: true, createdBy: true },
  });
  return links.map((l) => ({ resourceId: l.resourceId, createdAt: l.createdAt.toISOString(), createdBy: l.createdBy }));
}

// A new QR switches the old one off at once (a reprint); { off } just switches it off. Owned plant only.
export async function makePlantQr(resourceId: unknown, off: boolean, by: string | null, origin: string) {
  if (typeof resourceId !== "string") return problem("Pick a machine.");
  // PS-021 (10 Nov 2026): switching off works for any machine with a QR on - sold, archived or now hired too.
  if (off) {
    await prisma.siteLink.updateMany({ where: { kind: "PLANT", resourceId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true as const };
  }
  const m = await prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true, name: true, type: true, ownership: true, active: true, identifier: true } });
  if (!m || !plantQrAllowed(m)) return problem("Pre-start QRs are for Lobos-owned plant only - not attachments or hired plant.");
  const revokeOld = prisma.siteLink.updateMany({ where: { kind: "PLANT", resourceId: m.id, revokedAt: null }, data: { revokedAt: new Date() } });
  const secret = newLinkSecret();
  await prisma.$transaction([
    revokeOld,
    prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), kind: "PLANT", resourceId: m.id, label: m.name, createdBy: by } }),
  ]);
  return { url: siteUrl(`plant/${secret}`, origin), title: m.name, subtitle: m.identifier ? `Asset ${m.identifier}` : null };
}

// ---------- the phone ----------

// The QR (switched on, kind PLANT) -> its machine, still Lobos-owned plant.
async function resolvePlantQr(secret: unknown) {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const link = await prisma.siteLink.findUnique({ where: { tokenHash: hashSecret(secret) }, select: { id: true, kind: true, revokedAt: true, resourceId: true } });
  if (!link || link.kind !== "PLANT" || link.revokedAt || !link.resourceId) return null;
  const m = await prisma.resource.findUnique({ where: { id: link.resourceId }, select: { id: true, name: true, type: true, ownership: true, active: true } });
  return m && plantQrAllowed(m) ? { linkId: link.id, machine: m } : null;
}

// The scan: a ticket, the machine, and the operators to pick from first (role / category "Operator").
export async function scanPlant(secret: unknown) {
  const q = await resolvePlantQr(secret);
  if (!q) return problem("This pre-start QR isn't active. Ask the office.", 404);
  const operators = await prisma.resource.findMany({
    where: { type: "PERSONNEL", active: true, OR: [{ role: { contains: "Operator" } }, { category: { contains: "Operator" } }] },
    select: { id: true, name: true }, orderBy: { name: "asc" }, take: 40,
  });
  await prisma.siteLink.update({ where: { id: q.linkId }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { ticket: makePlantTicket(q.linkId, q.machine.id), machine: linkLabel(q.machine.name, "Machine"), crew: operators };
}

// Not on the operators' list: names from the Personnel register (3+ letters, at most 6), with a valid plant ticket.
export async function searchPlantPeople(ticket: unknown, q: string) {
  if (!readPlantTicket(ticket)) return problem("Scan the QR again.", 401);
  if (q.trim().length < 3) return [];
  return prisma.resource.findMany({ where: { type: "PERSONNEL", active: true, name: { contains: q.trim() } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 6 });
}

const clean = (v: unknown) => (typeof v === "string" ? nameWithoutAmounts(v.replace(/\s+/g, " ").trim()).slice(0, 60) : "");

// Start of shift (PRE) / End of shift (POST): a check session and its token. The QR must still be on and still this
// machine; at most 40 sessions a QR and 12 a phone a Sydney day.
export async function startPlantCheck(body: Record<string, unknown>) {
  const t = readPlantTicket(body.ticket);
  if (!t) return problem("That scan has expired - scan the QR again.", 401);
  const kind = body.kind === "PRE" || body.kind === "POST" ? (body.kind as PrestartKind) : null;
  if (!kind) return problem("Pick start of shift or end of shift.");
  const link = await prisma.siteLink.findUnique({ where: { id: t.linkId }, select: { kind: true, revokedAt: true, resourceId: true } });
  const m = link?.resourceId ? await prisma.resource.findUnique({ where: { id: link.resourceId }, select: { id: true, type: true, ownership: true, active: true } }) : null;
  if (!link || link.kind !== "PLANT" || link.revokedAt || link.resourceId !== t.resourceId || !m || !plantQrAllowed(m)) return problem("This pre-start QR isn't active any more.", 404);
  let who: { personId: string | null; personName: string; company: string | null };
  if (typeof body.resourceId === "string" && body.resourceId) {
    const p = await prisma.resource.findUnique({ where: { id: body.resourceId }, select: { id: true, name: true, type: true } });
    if (!p || p.type !== "PERSONNEL") return problem("Pick your name again.");
    who = { personId: p.id, personName: p.name, company: null };
  } else {
    const hire = (body.hire && typeof body.hire === "object" ? body.hire : {}) as Record<string, unknown>;
    const name = clean(hire.name), company = clean(hire.company);
    if (name.length < 2 || company.length < 2) return problem("Enter your full name and the company you're from.");
    if (looksLikeLobos(company)) return problem("You're Lobos staff - pick your name instead (tap \"I'm not on this list\" to search).");
    who = { personId: null, personName: name, company };
  }
  const deviceId = typeof body.deviceId === "string" && body.deviceId ? body.deviceId.slice(0, 64) : null;
  const day = todaySydney();
  // PS-018 (10 Nov 2026): the session is written first, through the one-at-a-time queue, and then counted with it in the
  // same transaction - so parallel starts can't all slip under the 40 a QR. Over it: undone, 429. (The 12 a phone is a
  // hint - the phone names itself.)
  class Over extends Error { constructor(public p: Problem) { super(p.error); } }
  try {
    const id = await oneAtATime(() => prisma.$transaction(async (tx) => {
      const s = await tx.plantCheckSession.create({ data: { linkId: t.linkId, resourceId: m.id, kind, day, deviceId, ...who } });
      const [qrToday, deviceToday] = await Promise.all([
        tx.plantCheckSession.count({ where: { linkId: t.linkId, day } }),
        deviceId ? tx.plantCheckSession.count({ where: { deviceId, day } }) : Promise.resolve(0),
      ]);
      const refused = sessionRefusal({ qrToday: qrToday - 1, deviceToday: deviceId ? deviceToday - 1 : 0 });
      if (refused) throw new Over(refused);
      return s.id;
    }, TX));
    return { token: makePlantCheckToken(id, kind), kind };
  } catch (e) {
    if (e instanceof Over) return e.p;
    throw e;
  }
}

// ---------- the office: the Checks tab's Plant section ----------

const METHOD = "Plant QR";
export const plantSource = async (sessionIds: string[]) => {
  const ss = sessionIds.length ? await prisma.plantCheckSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, personId: true, company: true, resourceId: true } }) : [];
  const names = new Map((await prisma.resource.findMany({ where: { id: { in: ss.map((s) => s.resourceId) } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
  return new Map(ss.map((s) => [s.id, { staff: !!s.personId, company: s.company, method: METHOD, point: names.get(s.resourceId) ?? null, runBy: null }]));
};

// That Sydney day: every Lobos-owned machine booked on the board (an allocation on a job that day), with "No pre-start"
// when it has none, and every machine checked that day (booked or not) - who did each check, the walk-around and
// hour-meter photos, the hours (flagged when lower than before) and the answers.
export async function plantChecksForDay(day: string) {
  const [booked, sessions] = await Promise.all([
    prisma.assignment.findMany({
      where: { job: { date: new Date(`${day}T00:00:00.000Z`) }, resource: { type: "EQUIPMENT", ownership: "OWNED" } },
      select: { resourceId: true, resource: { select: { name: true } }, job: { select: { title: true, project: { select: { name: true } } } } },
    }),
    prisma.plantCheckSession.findMany({ where: { day }, select: { id: true, resourceId: true, personName: true, company: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const checks = sessions.length
    ? await prisma.prestartCheck.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      include: { faults: { select: { id: true, itemLabel: true, priority: true, status: true } } },
      orderBy: { createdAt: "asc" },
    })
    : [];
  const media = checks.length
    ? await prisma.assetFaultMedia.findMany({ where: { checkId: { in: checks.map((c) => c.id) }, role: { in: ["WALKAROUND", "METER"] } }, select: { id: true, checkId: true, role: true, slot: true }, orderBy: { createdAt: "asc" } })
    : [];
  const ids = [...new Set([...booked.map((b) => b.resourceId), ...checks.map((c) => c.resourceId)])];
  const names = new Map((await prisma.resource.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
  const sessionOf = new Map(sessions.map((s) => [s.id, s]));
  return ids.map((id) => {
    const mine = checks.filter((c) => c.resourceId === id);
    const sites = [...new Set(booked.filter((b) => b.resourceId === id).map((b) => b.job.project?.name ?? b.job.title))];
    return {
      machineId: id, machine: names.get(id) ?? mine[0]?.resourceName ?? "Machine", booked: sites.length > 0, sites,
      preStatus: mine.some((c) => c.kind === "PRE") ? "Done" : "No pre-start",
      postStatus: mine.some((c) => c.kind === "POST") ? "Done" : "No post-check",
      checks: mine.map((c) => {
        const s = c.sessionId ? sessionOf.get(c.sessionId) : undefined;
        const meter = media.find((m) => m.checkId === c.id && m.role === "METER");
        return {
          id: c.id, kind: c.kind, at: sydneyTime(c.createdAt), person: s?.company ? `${c.personName} (${s.company})` : c.personName, staff: !!c.personId,
          checklist: c.checklist, answers: JSON.parse(c.answers) as { key: string; label: string; answer: string }[],
          walkaround: c.walkaround,
          walkaroundPhotos: media.filter((m) => m.checkId === c.id && m.role === "WALKAROUND").map((m) => ({ id: m.id, slot: m.slot, label: slotLabel(m.slot, "EQUIPMENT") })),
          hourMeter: c.hourMeter, hourMeterPrev: c.hourMeterPrev, hourMeterFlag: c.hourMeterFlag, meterPhotoId: meter?.id ?? null,
          hourMeterWrong: c.hourMeterWrongAt ? { at: c.hourMeterWrongAt.toISOString(), by: c.hourMeterWrongBy, note: c.hourMeterWrongNote } : null,
          faultCount: c.faultCount, seenCount: c.seenCount,
          faults: c.faults.map((f) => ({ id: f.id, itemLabel: f.itemLabel, priority: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority, status: STATUS_LABEL[f.status as FaultStatus] ?? f.status })),
        };
      }),
    };
  }).sort((a, b) => Number(b.booked) - Number(a.booked) || a.machine.localeCompare(b.machine));
}

// PS-019 (10 Nov 2026): the office marks a plant check's hour-meter reading wrong - who, when and why, in an event too.
// Nothing is deleted: the reading stays (shown struck through with the note) and is left out of "the last reading".
// Once only (conditional, so two people can't both do it).
export async function markHourMeterWrong(checkId: string, noteRaw: unknown, by: string) {
  const note = cleanText(noteRaw, LIMITS.note);
  if (note.length < LIMITS.minFixNote) return problem("Say why the reading is wrong.");
  const c = await prisma.prestartCheck.findUnique({ where: { id: checkId }, select: { id: true, sessionId: true, hourMeter: true } });
  if (!c || !c.sessionId || c.hourMeter == null) return problem("That check has no hour-meter reading.", 404);
  class Done extends Error { constructor(public p: Problem) { super(p.error); } }
  try {
    await oneAtATime(() => prisma.$transaction(async (tx) => {
      const n = await tx.prestartCheck.updateMany({ where: { id: c.id, hourMeterWrongAt: null }, data: { hourMeterWrongAt: new Date(), hourMeterWrongBy: by, hourMeterWrongNote: note } });
      if (n.count !== 1) throw new Done(problem("It's already marked wrong.", 409));
      await tx.hourMeterEvent.create({ data: { checkId: c.id, action: "WRONG", by, note } });
    }, TX));
  } catch (e) {
    if (e instanceof Done) return e.p;
    throw e;
  }
  return { ok: true as const };
}
