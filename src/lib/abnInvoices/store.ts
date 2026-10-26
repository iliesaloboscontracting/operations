// ABN worker invoices (Accounts stage 4, docs/accounts/STAGE4-DESIGN.md): an invoice from the invoices inbox,
// attached to a person, checked against their supervisor-approved hours (stage 2's payroll week, reused).
// Never a job cost; nothing here touches Tracking. Accounts screen only; the template is hours only.
import { prisma } from "@/lib/prisma";
import { payrollWeek } from "@/lib/payroll/store";
import { todaySydney } from "@/lib/today";
import { abnLooksValid, compareHours, gstFlag, GST_FLAG_TEXT, parseDays, weeksCovering, type ApprovedDay } from "./rules";

type Problem = { error: string; status: number };
type Who = { id: string; name: string };

export const ABN_SKIP_REASON = "ABN worker's invoice - checked against approved hours on Accounts -> Invoice checks. Own crew are costed from hours, never from the invoice.";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

// The period the invoice covers: as printed; else the days it lists; else the week before its date.
function periodOf(d: { periodFrom: string | null; periodTo: string | null; workDays: string | null; invoiceDate: string | null }) {
  if (d.periodFrom && d.periodTo) return { from: d.periodFrom, to: d.periodTo, guessed: false };
  const days = parseDays(d.workDays)?.map((x) => x.date).sort();
  if (days?.length) return { from: days[0], to: days[days.length - 1], guessed: false };
  const base = d.invoiceDate ?? todaySydney();
  return { from: addDays(base, -7), to: addDays(base, -1), guessed: true };
}

// Opens (or re-opens) the check for an inbox draft. Used by the inbox rules and by "attach" on Accounts.
export async function openAbnCheck(draftId: string, resourceId: string, by: string) {
  const [d, p] = await Promise.all([
    prisma.invoiceDraft.findUnique({ where: { id: draftId }, select: { periodFrom: true, periodTo: true, workDays: true, invoiceDate: true } }),
    prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true } }),
  ]);
  if (!d || !p) return null;
  const per = periodOf(d);
  const entry = { status: "TO_CHECK", note: `Attached to ${p.name}`, by, at: new Date().toISOString() };
  const existing = await prisma.abnInvoice.findUnique({ where: { draftId } });
  if (existing) {
    return prisma.abnInvoice.update({ where: { draftId }, data: { resourceId, personName: p.name, periodFrom: per.from, periodTo: per.to, status: "TO_CHECK", note: null, decidedBy: null, decidedAt: null, history: JSON.stringify([...JSON.parse(existing.history), entry]) } });
  }
  return prisma.abnInvoice.create({ data: { draftId, resourceId, personName: p.name, periodFrom: per.from, periodTo: per.to, attachedBy: by, history: JSON.stringify([entry]) } });
}

// Each day of the period: everything signed, and what's approved - the supervisor's daily approval, or for an
// office / yard / truck sign-in (no supervisor step) the Manager's lock on that week.
export async function approvedDays(resourceId: string, from: string, to: string): Promise<{ days: ApprovedDay[]; weeks: { weekStart: string; locked: boolean; review: string | null }[]; sites: Record<string, string[]> }> {
  const days = new Map<string, ApprovedDay>();
  const sites: Record<string, string[]> = {};
  const weeks: { weekStart: string; locked: boolean; review: string | null }[] = [];
  for (const w of weeksCovering(from, to)) {
    const week = await payrollWeek(w);
    const me = week.people.find((p) => p.personKey === resourceId);
    weeks.push({ weekStart: w, locked: !!week.managerLock, review: me?.review?.status ?? null });
    for (const l of me ? Object.values(me.days).flat() : []) {
      if (l.date < from || l.date > to || l.hours == null) continue;
      const d = days.get(l.date) ?? { date: l.date, signed: 0, approved: 0 };
      d.signed += l.hours;
      if (l.dayState === "APPROVED" || (l.dayState === "NO_SUPERVISOR" && week.managerLock)) d.approved += l.hours;
      days.set(l.date, d);
      (sites[l.date] ??= []).includes(l.site) || sites[l.date].push(l.site);
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { days: [...days.values()].map((d) => ({ ...d, signed: r2(d.signed), approved: r2(d.approved) })).sort((a, b) => a.date.localeCompare(b.date)), weeks, sites };
}

export async function listAbnChecks() {
  const rows = await prisma.abnInvoice.findMany({ where: { status: { not: "DETACHED" } }, orderBy: { createdAt: "desc" }, take: 100 });
  const drafts = new Map((await prisma.invoiceDraft.findMany({ where: { id: { in: rows.map((r) => r.draftId) } }, include: { upload: { select: { originalName: true } } } })).map((d) => [d.id, d]));
  const people = new Map((await prisma.resource.findMany({ where: { id: { in: rows.map((r) => r.resourceId) } }, select: { id: true, gstRegistered: true } })).map((p) => [p.id, p]));
  const checks = [];
  for (const r of rows) {
    const d = drafts.get(r.draftId);
    if (!d) continue;
    const from = r.periodFrom ?? d.periodFrom ?? todaySydney(), to = r.periodTo ?? d.periodTo ?? todaySydney();
    const a = await approvedDays(r.resourceId, from, to);
    const hours = compareHours(parseDays(d.workDays), d.hoursTotal, a.days);
    const registered = people.get(r.resourceId)?.gstRegistered ?? null;
    const gst = gstFlag(d.gst, registered);
    const abnOk = abnLooksValid(d.supplierAbn);
    checks.push({
      id: r.id, draftId: r.draftId, resourceId: r.resourceId, personName: r.personName, status: r.status, note: r.note, decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null,
      history: JSON.parse(r.history) as { status: string; note: string | null; by: string; at: string }[],
      invoice: { supplier: d.supplier, invoiceNo: d.invoiceNo, invoiceDate: d.invoiceDate, periodFrom: from, periodTo: to, guessedPeriod: !d.periodFrom && !parseDays(d.workDays), amountExGst: d.amountExGst, gst: d.gst, totalIncGst: d.totalIncGst, supplierAbn: d.supplierAbn, file: d.upload.originalName, uploadId: d.uploadId },
      hours, weeks: a.weeks, gstRegistered: registered,
      flags: [...hours.flags, ...(gst ? [GST_FLAG_TEXT[gst]] : []), ...(abnOk === false ? ["The ABN on the invoice doesn't look valid"] : [])],
    });
  }
  // Inbox invoices that could be an ABN worker's (not on a job, not attached yet), and the people to attach to.
  const attached = new Set((await prisma.abnInvoice.findMany({ where: { status: { not: "DETACHED" } }, select: { draftId: true } })).map((x) => x.draftId));
  const candidates = await prisma.invoiceDraft.findMany({
    where: { status: { in: ["NEEDS_REVIEW", "NO_JOB"] }, createdAt: { gte: new Date(Date.now() - 120 * 86_400_000) }, OR: [{ category: { in: ["LABOUR_HIRE", "OTHER"] } }, { category: null }, { workDays: { not: null } }, { hoursTotal: { not: null } }] },
    select: { id: true, supplier: true, invoiceNo: true, invoiceDate: true, amountExGst: true, status: true, problem: true }, orderBy: { createdAt: "desc" }, take: 100,
  });
  const persons = await prisma.resource.findMany({ where: { type: "PERSONNEL", active: true }, select: { id: true, name: true, engagement: true, gstRegistered: true }, orderBy: { name: "asc" } });
  return { checks, candidates: candidates.filter((c) => !attached.has(c.id)), people: persons };
}

// Accounts attach an inbox invoice to a person: it's taken out of the job flow (not counted) and checked.
export async function attachDraft(who: Who, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const draftId = String(b.draftId ?? ""), resourceId = String(b.resourceId ?? "");
  const [d, p] = await Promise.all([prisma.invoiceDraft.findUnique({ where: { id: draftId } }), prisma.resource.findUnique({ where: { id: resourceId }, select: { type: true } })]);
  if (!d) return { error: "That invoice isn't in the inbox.", status: 404 };
  if (!p || p.type !== "PERSONNEL") return { error: "Pick the person.", status: 400 };
  if (d.status === "ADDED") return { error: "It's on a job - take it off the job in the inbox first.", status: 409 };
  await prisma.invoiceDraft.update({ where: { id: draftId }, data: { status: "SKIPPED", problem: ABN_SKIP_REASON, decidedBy: who.name, decidedAt: new Date() } });
  const row = await openAbnCheck(draftId, resourceId, who.name);
  return row ? { id: row.id } : { error: "Couldn't open the check.", status: 500 };
}

// Approve, query, or detach (wrong person / not an ABN invoice: it goes back to "needs you" in the inbox).
export async function decideAbnCheck(who: Who, id: string, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const r = await prisma.abnInvoice.findUnique({ where: { id } });
  if (!r || r.status === "DETACHED") return { error: "Not found.", status: 404 };
  const status = String(b.status ?? "").toUpperCase();
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  if (!["APPROVED", "QUERY", "DETACH"].includes(status)) return { error: "Approve, query or detach.", status: 400 };
  if (status !== "APPROVED" && (note?.length ?? 0) < 3) return { error: status === "QUERY" ? "Say what needs checking." : "Say why it's being detached.", status: 400 };
  const history = JSON.stringify([...JSON.parse(r.history), { status: status === "DETACH" ? "DETACHED" : status, note, by: who.name, at: new Date().toISOString() }]);
  if (status === "DETACH") {
    await prisma.abnInvoice.update({ where: { id }, data: { status: "DETACHED", note, decidedBy: who.name, decidedAt: new Date(), history } });
    await prisma.invoiceDraft.update({ where: { id: r.draftId }, data: { status: "NEEDS_REVIEW", problem: `Detached from ${r.personName}'s ABN check by ${who.name}: ${note} - decide again.`, decidedBy: who.name, decidedAt: new Date() } });
    return { ok: true };
  }
  await prisma.abnInvoice.update({ where: { id }, data: { status, note, decidedBy: who.name, decidedAt: new Date(), history } });
  return { ok: true };
}

// Whether an ABN worker is GST-registered (null = not recorded). Accounts set it here.
export async function setGstRegistered(b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const p = await prisma.resource.findUnique({ where: { id: String(b.resourceId ?? "") }, select: { id: true, type: true } });
  if (!p || p.type !== "PERSONNEL") return { error: "Pick the person.", status: 400 };
  const v = b.gstRegistered === true ? true : b.gstRegistered === false ? false : null;
  await prisma.resource.update({ where: { id: p.id }, data: { gstRegistered: v } });
  return { ok: true };
}

// The standard Lobos ABN invoice: the person's approved hours for a period, day by day. Hours only.
export async function templateFor(resourceId: string, from: string, to: string) {
  const p = await prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true, type: true } });
  if (!p || p.type !== "PERSONNEL") return null;
  const a = await approvedDays(resourceId, from, to);
  const days = a.days.filter((d) => d.approved > 0).map((d) => ({ date: d.date, site: (a.sites[d.date] ?? []).join(" / "), hours: d.approved }));
  return { name: p.name, from, to, days, total: Math.round(days.reduce((n, d) => n + d.hours, 0) * 100) / 100 };
}
