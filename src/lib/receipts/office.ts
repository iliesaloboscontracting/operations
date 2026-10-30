// Receipts R2 - what an office person does with a reading (Manager+, /receipts): correct any field
// (each correction kept with who and when), confirm it, reject it (with a reason), or have it read
// again. Nothing here touches costs; R3 prices confirmed / read tip dockets onto Tracking.
import { claimFromOwnReceipt } from "../reimbursements/store";
import { prisma } from "../prisma";
import { jobLabel, signinDates } from "../signin";
import { ASBESTOS, docketDate, normDocket, normRego, num } from "./checks";
import { MAX_TRIES, logOf, readOdometer, readReceipt, readingEnabled, type ReadingLog } from "./runner";
import { syncTipMatchesSoon, truckRegos, vehicleForRego } from "./tipStore";

type Problem = { error: string; status: number };
type Who = { name: string };

// The fields a person can correct, and how each is read from the form.
const TEXT = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) || null : null);
const NUM = (v: unknown) => { if (v === "" || v == null) return null; const n = num(String(v)); return n != null && n >= 0 && n < 1e7 ? n : undefined; };
const WHEN = (v: unknown) => { if (v === "" || v == null) return null; return docketDate(String(v)) ?? undefined; }; // Sydney time from the form
const FIELDS: Record<"TIP" | "FUEL", Record<string, (v: unknown) => unknown>> = {
  TIP: { docketNo: TEXT, docketAt: WHEN, tipSite: TEXT, wasteType: TEXT, tonnes: NUM, priceExGst: NUM, priceIncGst: NUM, rego: (v) => normRego(String(v ?? "")) || null, asbestos: (v) => (v === true || v === false ? v : undefined) },
  FUEL: { litres: NUM, pricePerLitre: NUM, fuelTotal: NUM, station: TEXT, docketAt: WHEN, rego: (v) => normRego(String(v ?? "")) || null },
};
const same = (a: unknown, b: unknown) => JSON.stringify(a instanceof Date ? a.toISOString() : a) === JSON.stringify(b instanceof Date ? b.toISOString() : b);

export async function receiptAction(who: Who, id: string, body: Record<string, unknown>): Promise<{ ok: true; status: string; id?: string } | Problem> {
  const op = String(body.op ?? "").toUpperCase();
  const isOdo = body.type === "ODOMETER";
  const row = isOdo ? await prisma.odometerReading.findUnique({ where: { id } }) : await prisma.receipt.findUnique({ where: { id } });
  if (!row) return { error: "Not found", status: 404 };
  // Own-money purchases belong to accounts (Reimbursements), never to the Operations receipts list.
  if (!isOdo && (row as { kind: string }).kind === "PURCHASE") return { error: "Not found", status: 404 };
  const log: ReadingLog = logOf(row.reading);
  const now = new Date();
  const save = (data: Record<string, unknown>) => (isOdo ? prisma.odometerReading.update({ where: { id }, data }) : prisma.receipt.update({ where: { id }, data }));

  if (op === "CORRECT") {
    // A photo that couldn't be read after three tries is typed in by a person instead.
    const unreadable = row.status === "SENT" && (log.tries ?? 0) >= MAX_TRIES;
    if ((row.status === "SENT" && !unreadable) || row.status === "SKIPPED") return { error: "It hasn't been read yet - correct it once it's read, or read it again.", status: 409 };
    const input = (body.fields && typeof body.fields === "object" ? body.fields : {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const corrections = [...(log.corrections ?? [])];
    const rules: Record<string, (v: unknown) => unknown> = isOdo ? { km: (v) => { const n = NUM(v); return typeof n === "number" ? Math.round(n) : n; } } : FIELDS[(row as { kind: "TIP" | "FUEL" }).kind];
    for (const [field, raw] of Object.entries(input)) {
      if (field === "jobId" && !isOdo && (row as { kind: string }).kind === "TIP") {
        if (raw === (row as { jobId: string | null }).jobId) continue;
        const job = typeof raw === "string" ? await prisma.job.findUnique({ where: { id: raw }, select: { id: true, projectId: true } }) : null;
        if (!job) return { error: "Pick a job.", status: 400 };
        corrections.push({ at: now.toISOString(), by: who.name, field: "jobId", before: (row as { jobId: string | null }).jobId, after: job.id });
        Object.assign(data, { jobId: job.id, projectId: job.projectId });
        continue;
      }
      if (field === "vehicleId" && !isOdo && (row as { kind: string }).kind === "FUEL") {
        if (raw === (row as { vehicleId: string | null }).vehicleId) continue;
        const truck = typeof raw === "string" ? await prisma.resource.findFirst({ where: { id: raw, type: { in: ["VEHICLE", "EQUIPMENT"] }, ownership: "OWNED" }, select: { id: true } }) : null;
        if (!truck) return { error: "Pick one of the Lobos trucks or machines.", status: 400 };
        corrections.push({ at: now.toISOString(), by: who.name, field: "vehicleId", before: (row as { vehicleId: string | null }).vehicleId, after: truck.id });
        data.vehicleId = truck.id;
        continue;
      }
      const parse = rules[field];
      if (!parse) return { error: `${field} can't be changed here.`, status: 400 };
      const value = parse(raw);
      if (value === undefined) return { error: `Check the ${field} - it doesn't look right.`, status: 400 };
      const before = (row as Record<string, unknown>)[field];
      if (same(before, value)) continue;
      corrections.push({ at: now.toISOString(), by: who.name, field, before: before instanceof Date ? before.toISOString() : before, after: value instanceof Date ? value.toISOString() : value });
      data[field] = value;
    }
    if (!Object.keys(data).length && body.confirm !== true) return { error: "Nothing changed.", status: 400 };
    // A corrected rego on a tip docket re-links it to our truck (or unlinks it).
    if (!isOdo && (row as { kind: string }).kind === "TIP" && "rego" in data) data.vehicleId = vehicleForRego(data.rego as string | null, await truckRegos());
    const confirm = body.confirm === true && row.status !== "REJECTED";
    // Typed in from an unreadable photo without confirming: it stays on the list to check.
    const status = confirm ? "CONFIRMED" : unreadable ? "CHECK" : row.status;
    await save({ ...data, ...(Object.keys(data).length ? { correctedBy: who.name, correctedAt: now, reading: JSON.stringify({ ...log, corrections }) } : {}), status });
    if (!isOdo) syncTipMatchesSoon();
    if (!isOdo && status === "CONFIRMED") await claimFromOwnReceipt(id); // "I paid this myself" -> the claim
    return { ok: true, status };
  }
  if (op === "ADD_DOCKET" && !isOdo) return addDocketFromPhoto(who, row as { id: string; kind: string; status: string; siteLinkId: string; sentBy: string; sentByResourceId: string | null; sentAt: Date; photoFromReceiptId: string | null; jobId: string | null; projectId: string | null }, body);
  if (op === "CONFIRM") {
    if (row.status !== "READ" && row.status !== "CHECK") return { error: row.status === "CONFIRMED" ? "Already confirmed." : "Only a read receipt can be confirmed.", status: 409 };
    await save({ status: "CONFIRMED" });
    if (!isOdo) syncTipMatchesSoon();
    if (!isOdo) await claimFromOwnReceipt(id); // "I paid this myself" -> the claim
    return { ok: true, status: "CONFIRMED" };
  }
  if (op === "REJECT") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (reason.length < 3) return { error: "Say why it's set aside.", status: 400 };
    if (row.status === "REJECTED") return { error: "Already set aside.", status: 409 };
    await save({ status: "REJECTED", reading: JSON.stringify({ ...log, rejected: { at: now.toISOString(), by: who.name, reason } }) });
    if (!isOdo) syncTipMatchesSoon(); // a docket set aside no longer counts towards an invoice
    return { ok: true, status: "REJECTED" };
  }
  if (op === "READ_AGAIN") {
    if (!readingEnabled()) return { error: "Reading is switched off (RECEIPT_READING=off).", status: 503 };
    if (log.corrections?.length) return { error: "Someone has corrected it - reading it again would undo that.", status: 409 };
    if (!["SENT", "CHECK", "READ"].includes(row.status)) return { error: "Only a receipt that's waiting, read, or to check can be read again.", status: 409 };
    await save({ status: "SENT", reading: JSON.stringify({ ...log, tries: 0, lastError: undefined }) });
    await (isOdo ? readOdometer(id) : readReceipt(id));
    const after = isOdo ? await prisma.odometerReading.findUnique({ where: { id } }) : await prisma.receipt.findUnique({ where: { id } });
    return { ok: true, status: after?.status ?? "SENT" };
  }
  return { error: "Correct, confirm, reject or read again.", status: 400 };
}

// Today's jobs for the "move to another job" picker on a tip docket (and the job it's on).
export async function jobsForCorrection(currentJobId: string | null) {
  const { today, yesterday } = signinDates();
  const from = new Date(new Date(`${yesterday}T00:00:00Z`).getTime() - 12 * 86_400_000);
  const jobs = await prisma.job.findMany({
    where: { OR: [{ date: { gte: from, lte: new Date(`${today}T00:00:00Z`) }, status: { not: "INACTIVE" } }, ...(currentJobId ? [{ id: currentJobId }] : [])] },
    select: { id: true, title: true, shift: true, date: true, project: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { title: "asc" }], take: 300,
  });
  return jobs.map((j) => ({ id: j.id, label: `${jobLabel(j)} · ${j.date.toISOString().slice(5, 10).split("-").reverse().join("/")}` }));
}

// One photo can hold two dockets (27 Oct 2026: Carlos's Sell & Parker photo also showed a BM Recycling docket).
// The office types the second one in: a new TIP receipt that shares the photo(s) - no copy of the file - and
// starts CONFIRMED, with "added by <name> from receipt <id>" in its log. Refused when that docket number is
// already in at that tip site (the same matching the tip invoices use). Nothing reaches a link but status.
const siteKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
async function addDocketFromPhoto(
  who: Who,
  src: { id: string; kind: string; status: string; siteLinkId: string; sentBy: string; sentByResourceId: string | null; sentAt: Date; photoFromReceiptId: string | null; jobId: string | null; projectId: string | null },
  body: Record<string, unknown>,
): Promise<{ ok: true; status: string; id: string } | Problem> {
  if (src.kind === "PURCHASE") return { error: "Not found", status: 404 };
  const photoOwner = src.photoFromReceiptId ?? src.id;
  if (!(await prisma.receiptPhoto.count({ where: { receiptId: photoOwner } }))) return { error: "That receipt has no photo to add a docket from.", status: 400 };
  const f = (body.fields && typeof body.fields === "object" ? body.fields : {}) as Record<string, unknown>;
  const p = FIELDS.TIP;
  const fields = { docketNo: p.docketNo(f.docketNo) as string | null, docketAt: p.docketAt(f.docketAt) as Date | null | undefined, tipSite: p.tipSite(f.tipSite) as string | null, wasteType: p.wasteType(f.wasteType) as string | null, tonnes: p.tonnes(f.tonnes) as number | null | undefined, rego: p.rego(f.rego) as string | null };
  const missing = [!fields.tipSite && "tip site", !fields.docketNo && "docket number", !fields.docketAt && "date and time", !(fields.tonnes != null && fields.tonnes > 0) && "tonnes"].filter(Boolean);
  if (fields.docketAt === undefined || fields.tonnes === undefined) return { error: "Check the date and the tonnes - they don't look right.", status: 400 };
  if (missing.length) return { error: `Fill in the ${missing.join(", ")}.`, status: 400 };
  const job = typeof f.jobId === "string" && f.jobId ? await prisma.job.findUnique({ where: { id: f.jobId }, select: { id: true, projectId: true } }) : null;
  // No job picked, from a docket for a site not running that day (project, no job): the new one goes on that same
  // project with no job (SEC-001). Otherwise a job is needed.
  const projectOnly = !job && !f.jobId && src.kind === "TIP" && !src.jobId && !!src.projectId;
  if (!job && !projectOnly) return { error: "Pick the job it's for.", status: 400 };
  // Same docket number at the same tip site already in -> refuse (normalised as the tip matching does).
  const key = normDocket(fields.docketNo), site = siteKey(fields.tipSite);
  const same = (await prisma.receipt.findMany({ where: { kind: "TIP", status: { not: "REJECTED" }, docketNo: { not: null } }, select: { id: true, docketNo: true, tipSite: true, sentBy: true } }))
    .find((r) => normDocket(r.docketNo) === key && siteKey(r.tipSite) === site);
  if (same) return { error: `Docket ${fields.docketNo} at ${fields.tipSite} is already in (sent by ${same.sentBy}).`, status: 409 };
  const asbestos = f.asbestos === true ? true : f.asbestos === false ? false : ASBESTOS.test(fields.wasteType ?? "");
  const now = new Date();
  const created = await prisma.receipt.create({
    data: {
      kind: "TIP", siteLinkId: src.siteLinkId, sentBy: src.sentBy, sentByResourceId: src.sentByResourceId, sentAt: src.sentAt,
      jobId: job ? job.id : null, projectId: job ? job.projectId : src.projectId, asbestos, status: "CONFIRMED", photoFromReceiptId: photoOwner,
      docketNo: fields.docketNo, docketAt: fields.docketAt, tipSite: fields.tipSite, wasteType: fields.wasteType, tonnes: fields.tonnes, rego: fields.rego,
      vehicleId: vehicleForRego(fields.rego, await truckRegos()),
      correctedBy: who.name, correctedAt: now,
      reading: JSON.stringify({ added: { at: now.toISOString(), by: who.name, fromReceiptId: src.id } } satisfies ReadingLog),
    },
  });
  syncTipMatchesSoon(); // it may be one a tip invoice already bills (R3)
  return { ok: true, status: "CONFIRMED", id: created.id };
}
