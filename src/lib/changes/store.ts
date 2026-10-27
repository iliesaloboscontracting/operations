// Controlled changes (LCI phase 4, A3), server side: propose, approve (which
// runs the change), reject, withdraw, undo, expire, and reading them back.
// The change itself goes through the same functions as the edit screens
// (lib/recordPatch.ts), run as the system actor "LCI" with the approver
// recorded. There is no "execute" call of its own: only Approve runs a change,
// and only after the fingerprint, the person and the "before" are checked.
// Rules: ./rules.ts, ./config.ts. Design: docs/lci/PHASE4-5-DESIGN.md §1.
import { createHash } from "crypto";
import { prisma } from "../prisma";
import { applyProjectPatch, applyResourcePatch } from "../recordPatch";
import { OPEN_STATUSES, requestNo } from "../requestTypes";
import { A3_RULES, type ChangeKind } from "./config";
import {
  SWITCHED_OFF, SYSTEM_ACTOR, canProposeKind, canViewKind, cannotApprove, expiryFor, fingerprintPayload, isExpired, isKind, kindEnabled,
  noChange, openKeyOf, parseAfter, parseSources, pickValue, proposalRef, samePerson, sameValue,
  type ChangeUser, type ChangeValue, type SourceRef,
} from "./rules";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const parse = <T>(s: string | null, d: T): T => { try { return s == null ? d : (JSON.parse(s) as T); } catch { return d; } };
type Problem = { error: string; status: number };
type Proposal = NonNullable<Awaited<ReturnType<typeof prisma.changeProposal.findUnique>>>;

// ---------- the record ----------

async function readRecord(kind: ChangeKind, recordId: string): Promise<{ name: string; value: ChangeValue } | { error: string }> {
  if (A3_RULES[kind].recordType === "Resource") {
    const r = await prisma.resource.findUnique({ where: { id: recordId } });
    if (!r || r.type !== "HIRE" || !r.active) return { error: "That hire item isn't in the hire register any more." };
    return { name: r.name, value: pickValue(kind, r as unknown as Record<string, unknown>) };
  }
  const p = await prisma.project.findUnique({ where: { id: recordId } });
  if (!p || p.archived) return { error: "That project isn't active in Operations any more." };
  return { name: p.name, value: pickValue(kind, p as unknown as Record<string, unknown>) };
}

// A job or quote number already on another project is refused (budget,
// tender, invoice and Xero matching all key on it).
async function numberTaken(kind: ChangeKind, recordId: string, after: ChangeValue): Promise<string | null> {
  if (kind !== "PROJECT_JOB_NO" && kind !== "PROJECT_QUOTE_NO") return null;
  const key = kind === "PROJECT_JOB_NO" ? "jobNo" : "quoteNo";
  const want = String(after[key] ?? "").trim().toUpperCase();
  const others = await prisma.project.findMany({
    where: { id: { not: recordId }, ...(key === "jobNo" ? { jobNo: { not: null } } : { quoteNo: { not: null } }) },
    select: { name: true, jobNo: true, quoteNo: true },
  });
  const hit = others.find((o) => String(o[key] ?? "").trim().toUpperCase() === want);
  return hit ? `${hit.name} already has ${A3_RULES[kind].label.toLowerCase()} ${want}.` : null;
}

// ---------- where it came from ----------

// A HIRE_EXTEND request ("still needed" from site) names its hire item; an
// answered QUERY carries the answer and who gave it (who then can't approve).
async function fromRequest(kind: ChangeKind, id: unknown, by: ChangeUser): Promise<{ recordId?: string; source: SourceRef; sourcePerson?: string | null } | { error: string } | null> {
  if (typeof id !== "string" || !id) return null;
  const r = await prisma.siteRequest.findUnique({ where: { id } });
  if (!r) return { error: "That request isn't there any more." };
  // A directors-only query: only someone who can see it may cite it, and its wording
  // isn't copied onto the proposal (Managers can see job-number proposals).
  const directorsOnly = r.audience === "DIRECTOR";
  if (directorsOnly && !by.directorAccess) return { error: "That request isn't there any more." };
  if (kind === "HIRE_OFF_HIRE_DATE") {
    // The item: the request's own hireResourceId, or - for requests raised before
    // that was recorded - the hire check answer that raised it.
    const itemId = r.hireResourceId ?? (await prisma.hireCheck.findFirst({ where: { requestId: r.id }, select: { resourceId: true } }))?.resourceId ?? null;
    if (r.kind !== "HIRE_EXTEND" || !itemId) return { error: "Only a \"still needed\" hire request can propose an off-hire date." };
    return { recordId: itemId, source: { type: "SiteRequest", id: r.id, label: `${requestNo(r.number)}: ${r.summary} (${r.requestedBy})` } };
  }
  if (r.kind !== "QUERY" || !r.answer) return { error: "Only an answered query can propose this change." };
  const who = r.assigneeName ?? null;
  const what = directorsOnly ? "information request" : r.summary.slice(0, 80);
  return { source: { type: "Query", id: r.id, label: `${requestNo(r.number)}: ${what}${who ? ` - answered by ${who}` : ""}` }, sourcePerson: who };
}

// An off-hire date proposal also cites the hire item's open overdue finding and
// any open "still needed" request, so the approver sees the whole picture.
async function linkedSources(kind: ChangeKind, recordId: string, skipId?: string): Promise<SourceRef[]> {
  if (kind !== "HIRE_OFF_HIRE_DATE") return [];
  // Requests raised before hireResourceId was recorded are found through the hire check answer that raised them.
  const viaChecks = (await prisma.hireCheck.findMany({ where: { resourceId: recordId, requestId: { not: null } }, select: { requestId: true } })).map((c) => c.requestId as string);
  const [finding, extend] = await Promise.all([
    prisma.finding.findFirst({ where: { ruleCode: "HIRE_OVERDUE", subjectId: recordId, openKey: { not: null } }, select: { id: true, title: true } }),
    prisma.siteRequest.findFirst({
      where: { kind: "HIRE_EXTEND", status: { in: OPEN_STATUSES }, OR: [{ hireResourceId: recordId }, { id: { in: viaChecks } }] },
      orderBy: { createdAt: "desc" }, select: { id: true, number: true, summary: true, requestedBy: true },
    }),
  ]);
  return [
    ...(finding ? [{ type: "Finding" as const, id: finding.id, label: finding.title.slice(0, 200) }] : []),
    ...(extend && extend.id !== skipId ? [{ type: "SiteRequest" as const, id: extend.id, label: `${requestNo(extend.number)}: ${extend.summary} (${extend.requestedBy})` }] : []),
  ];
}

// ---------- propose ----------

export async function createProposal(
  by: ChangeUser,
  body: Record<string, unknown>,
  now = new Date(),
  extra: { undoOfId?: string } = {},
): Promise<{ proposal: Proposal } | Problem> {
  const kind = body.kind;
  if (!isKind(kind)) return { error: "Pick what to change.", status: 400 };
  if (!canProposeKind(by, kind)) return { error: "You can't propose that kind of change.", status: 403 };
  if (!kindEnabled(kind)) return { error: SWITCHED_OFF, status: 503 };
  // Raised from a request or an answered query: the server reads which record and
  // what the source is from the request itself, never from the browser.
  const from = await fromRequest(kind, body.fromRequestId, by);
  if (from && "error" in from) return { error: from.error, status: 400 };
  const recordId = from?.recordId ?? (typeof body.recordId === "string" ? body.recordId : "");
  const rec = await readRecord(kind, recordId);
  if ("error" in rec) return { error: rec.error, status: 404 };
  const parsed = parseAfter(kind, body);
  if ("error" in parsed) return { error: parsed.error, status: 400 };
  const after = parsed.value;
  // Nothing to propose when the value itself is already that (notes alone aren't a change).
  const field = A3_RULES[kind].field;
  if (noChange({ [field]: rec.value[field] ?? null }, { [field]: after[field] ?? null })) return { error: "That's already the value - nothing to change.", status: 400 };
  const taken = await numberTaken(kind, recordId, after);
  if (taken) return { error: taken, status: 409 };
  const given = parseSources(body.sources);
  const derived = [...(from?.source ? [from.source] : []), ...(await linkedSources(kind, recordId, from?.source?.id))];
  // The value needs a source of its own: the request or answer it was raised from, or one the
  // person types. Items linked automatically (an overdue finding) add context but don't count.
  if (!from?.source && "error" in given) return { error: given.error, status: 400 };
  const sources = [...derived, ...("error" in given ? [] : given)];
  // A new contract value with no notes typed gets "Per <where it came from>" - the project's old
  // notes describe the old figure, so they aren't carried over.
  if (kind === "PROJECT_CONTRACT_VALUE" && !("contractValueNotes" in body)) after.contractValueNotes = `Per ${sources[0].label}`.slice(0, 200);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (reason.length < 3) return { error: "Say why, in a few words.", status: 400 };
  const sourcePerson = from?.sourcePerson ?? (typeof body.sourcePerson === "string" && body.sourcePerson.trim() ? body.sourcePerson.trim().slice(0, 120) : null);

  const rule = A3_RULES[kind];
  const openKey = openKeyOf(rule.recordType, recordId, rule.field);
  const waiting = await prisma.changeProposal.findUnique({ where: { openKey }, select: { number: true } });
  if (waiting) return { error: `A change to this is already waiting: ${proposalRef(waiting.number)}.`, status: 409 };

  const expiresAt = expiryFor(kind, now);
  const fingerprint = sha(fingerprintPayload({ kind, recordType: rule.recordType, recordId, field: rule.field, before: rec.value, after, sourceRefs: sources, requestedBy: by.name, expiresAt }));
  const make = async () => {
    const last = await prisma.changeProposal.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
    return prisma.changeProposal.create({
      data: {
        number: (last?.number ?? 0) + 1, kind, recordType: rule.recordType, recordId, recordName: rec.name, field: rule.field,
        before: JSON.stringify(rec.value), after: JSON.stringify(after), reason, sourceRefs: JSON.stringify(sources), audience: rule.audience,
        requestedBy: by.name, requestedByUserId: by.id || null, sourcePerson, fingerprint, expiresAt, openKey, undoOfId: extra.undoOfId ?? null,
        events: { create: { action: "PROPOSED", by: by.name, byUserId: by.id || null, fingerprint, note: reason } },
      },
    });
  };
  try {
    return { proposal: await make() };
  } catch {
    // Two at once: a taken number retries once; a taken openKey means one is already waiting.
    if (await prisma.changeProposal.findUnique({ where: { openKey }, select: { id: true } })) return { error: "A change to this is already waiting.", status: 409 };
    return { proposal: await make() };
  }
}

// ---------- decide ----------

const refuse = async (p: Proposal, by: ChangeUser, note: string, fingerprint: string | null, status: number): Promise<Problem> => {
  await prisma.changeProposalEvent.create({ data: { proposalId: p.id, action: "REFUSED", by: by.name, byUserId: by.id, fingerprint, note } });
  return { error: note, status };
};

// The stored payload still gives the stored fingerprint (nothing edited the row).
const intact = (p: Proposal) =>
  sha(fingerprintPayload({
    kind: p.kind, recordType: p.recordType, recordId: p.recordId, field: p.field, before: parse<ChangeValue | null>(p.before, null),
    after: parse<ChangeValue>(p.after, {}), sourceRefs: parse<SourceRef[]>(p.sourceRefs, []), requestedBy: p.requestedBy, expiresAt: p.expiresAt,
  })) === p.fingerprint;

async function close(p: Proposal, status: string, event: { action: string; by: string; byUserId?: string | null; note?: string | null; valueAtExec?: string | null; fingerprint?: string | null }) {
  await prisma.$transaction([
    prisma.changeProposal.update({ where: { id: p.id }, data: { status, openKey: null } }),
    prisma.changeProposalEvent.create({ data: { proposalId: p.id, ...event } }),
  ]);
}

export async function decide(by: ChangeUser, id: string, body: Record<string, unknown>, now = new Date()): Promise<{ proposal: Proposal } | Problem> {
  const p = await prisma.changeProposal.findUnique({ where: { id } });
  if (!p || !isKind(p.kind) || !canViewKind(by, p.kind)) return { error: "Not found", status: 404 };
  const kind = p.kind;
  const action = String(body.action ?? "").toUpperCase();
  const seen = typeof body.fingerprint === "string" ? body.fingerprint : null;

  if (action === "UNDO") return undo(by, p, now);
  if (p.status !== "PROPOSED") return refuse(p, by, `This change is already ${p.status.toLowerCase()}.`, seen, 409);
  if (isExpired(p, now)) {
    await close(p, "EXPIRED", { action: "EXPIRED", by: "System", note: "Not decided in time." });
    return refuse(p, by, "This proposal has expired - propose it again if it's still needed.", seen, 409);
  }

  if (action === "WITHDRAW") {
    if (!samePerson(by.name, p.requestedBy)) return refuse(p, by, "Only the person who proposed it can withdraw it.", seen, 403);
    await close(p, "WITHDRAWN", { action: "WITHDRAWN", by: by.name, byUserId: by.id, note: typeof body.reason === "string" ? body.reason.slice(0, 300) : null });
    return { proposal: (await prisma.changeProposal.findUnique({ where: { id } }))! };
  }

  const why = cannotApprove(by, { kind, requestedBy: p.requestedBy, requestedByUserId: p.requestedByUserId, sourcePerson: p.sourcePerson });
  if (action === "REJECT") {
    if (why) return refuse(p, by, why, seen, 403);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (reason.length < 3) return { error: "Say why it's rejected.", status: 400 };
    await close(p, "REJECTED", { action: "REJECTED", by: by.name, byUserId: by.id, note: reason });
    return { proposal: (await prisma.changeProposal.findUnique({ where: { id } }))! };
  }
  if (action !== "APPROVE") return { error: "Approve, reject or withdraw.", status: 400 };

  // ---- approve = run the change ----
  if (!kindEnabled(kind)) return refuse(p, by, SWITCHED_OFF, seen, 503);
  if (why) return refuse(p, by, why, seen, 403);
  if (!seen || seen !== p.fingerprint) return refuse(p, by, "This proposal isn't the one you were looking at - reload and check it again.", seen, 409);
  if (!intact(p)) return refuse(p, by, "This proposal's details don't match its fingerprint - it can't be approved. Propose it again.", seen, 409);

  // Claim it (one approval only, even if two people tap at once) and record the approval first.
  const claimed = await prisma.changeProposal.updateMany({ where: { id, status: "PROPOSED" }, data: { status: "APPROVED", openKey: null } });
  if (claimed.count !== 1) return refuse(p, by, "Someone else has just decided this change.", seen, 409);
  await prisma.changeProposalEvent.create({ data: { proposalId: id, action: "APPROVED", by: by.name, byUserId: by.id, fingerprint: seen } });

  const before = parse<ChangeValue | null>(p.before, null);
  const after = parse<ChangeValue>(p.after, {});
  const stale = async (note: string, valueAtExec: ChangeValue | null) => {
    await prisma.$transaction([
      prisma.changeProposal.update({ where: { id }, data: { status: "STALE" } }),
      prisma.changeProposalEvent.create({ data: { proposalId: id, action: "STALE", by: "LCI", note, valueAtExec: valueAtExec ? JSON.stringify(valueAtExec) : null } }),
    ]);
    return { error: note, status: 409 };
  };

  // Re-check at execution: the record is still there and still says what it said when proposed.
  const rec = await readRecord(kind, p.recordId);
  if ("error" in rec) return stale(`${rec.error} Nothing was changed.`, null);
  if (!sameValue(rec.value, before)) return stale("It has been changed since this was proposed - nothing was changed. Propose again if it's still needed.", rec.value);
  const taken = await numberTaken(kind, p.recordId, after);
  if (taken) return stale(`${taken} Nothing was changed.`, rec.value);

  // The same code as the edit screens, as the system actor.
  const out = A3_RULES[kind].recordType === "Resource" ? await applyResourcePatch(p.recordId, after, { role: null }) : await applyProjectPatch(p.recordId, after);
  if ("error" in out) return stale(`${out.error} Nothing was changed.`, rec.value);
  const nowValue = pickValue(kind, ("resource" in out ? out.resource : out.project) as unknown as Record<string, unknown>);
  await prisma.$transaction([
    prisma.changeProposal.update({ where: { id }, data: { status: "EXECUTED" } }),
    prisma.changeProposalEvent.create({
      data: {
        proposalId: id, action: "EXECUTED", by: "LCI", valueAtExec: JSON.stringify(nowValue),
        note: `Applied as approved by ${by.name}. To roll back: "Propose undo" sets it back to ${describe(kind, before)}.`,
      },
    }),
  ]);
  return { proposal: (await prisma.changeProposal.findUnique({ where: { id } }))! };
}

// Undo an executed change: a NEW proposal with the old value, through the same approval.
async function undo(by: ChangeUser, p: Proposal, now: Date): Promise<{ proposal: Proposal } | Problem> {
  if (p.status !== "EXECUTED" || !isKind(p.kind)) return { error: "Only a change that went in can be undone.", status: 409 };
  const before = parse<ChangeValue | null>(p.before, null);
  const main = before?.[A3_RULES[p.kind].field];
  if (main == null || main === "") return { error: "It was empty before - clear it by hand on the record if it must go.", status: 409 };
  return createProposal(by, {
    kind: p.kind, recordId: p.recordId, ...before, reason: `Undo ${proposalRef(p.number)}`,
    sources: [{ type: "Other", id: p.id, label: `Undo of ${proposalRef(p.number)}` }],
  }, now, { undoOfId: p.id });
}

export function describe(kind: ChangeKind, v: ChangeValue | null): string {
  if (!v) return "empty";
  if (kind === "PROJECT_CONTRACT_VALUE") return v.contractValue == null ? "no contract value" : `$${Number(v.contractValue).toLocaleString("en-AU")}${v.contractValueNotes ? ` (${v.contractValueNotes})` : ""}`;
  const x = Object.values(v)[0];
  return x == null || x === "" ? "empty" : String(x);
}

// ---------- the system's own proposals (4e) ----------

// A supervisor answered the hire check "Still needed - until about <date>":
// the system proposes that off-hire date, citing the HIRE_EXTEND request, for
// an Admin to approve. Switched off, already waiting, or not a valid date ->
// nothing is proposed (the request still reaches the office as before).
export async function proposeFromHireCheck(requestId: string, neededUntil: string, supervisor: string, now = new Date()): Promise<{ proposal: Proposal } | Problem> {
  return createProposal(SYSTEM_ACTOR, {
    kind: "HIRE_OFF_HIRE_DATE", fromRequestId: requestId, offHireDate: neededUntil,
    reason: `${supervisor} says it's still needed until about ${neededUntil} (site hire check).`,
  }, now);
}

// ---------- expiry (instrumentation tick) ----------

export async function expireProposals(now = new Date()): Promise<number> {
  const due = await prisma.changeProposal.findMany({ where: { status: "PROPOSED", expiresAt: { lte: now } } });
  for (const p of due) await close(p, "EXPIRED", { action: "EXPIRED", by: "System", note: "Not decided in time." });
  return due.length;
}

// ---------- reading ----------

export type ChangeDTO = {
  id: string; ref: string; kind: ChangeKind; label: string; recordType: string; recordId: string; recordName: string;
  before: string; after: string; reason: string; sources: SourceRef[]; requestedBy: string; sourcePerson: string | null;
  status: string; createdAt: string; expiresAt: string; fingerprint: string; alsoMoves: string; undoOf: string | null;
  canApprove: boolean; whyNot: string | null; canWithdraw: boolean; canUndo: boolean;
  events: { action: string; by: string; note: string | null; at: string }[];
};

export async function listChanges(by: ChangeUser, opts: { open?: boolean; recordId?: string; audience?: string } = {}): Promise<ChangeDTO[]> {
  const rows = await prisma.changeProposal.findMany({
    where: { ...(opts.open ? { status: "PROPOSED" } : {}), ...(opts.recordId ? { recordId: opts.recordId } : {}), ...(opts.audience ? { audience: opts.audience } : {}) },
    orderBy: { number: "desc" }, take: opts.open ? 200 : 300, include: { events: { orderBy: { at: "asc" } } },
  });
  const numbers = new Map(rows.map((r) => [r.id, r.number]));
  return rows.filter((p) => isKind(p.kind) && canViewKind(by, p.kind)).map((p) => {
    const kind = p.kind as ChangeKind;
    const whyNot = p.status === "PROPOSED" ? cannotApprove(by, { kind, requestedBy: p.requestedBy, requestedByUserId: p.requestedByUserId, sourcePerson: p.sourcePerson }) : null;
    return {
      id: p.id, ref: proposalRef(p.number), kind, label: A3_RULES[kind].label, recordType: p.recordType, recordId: p.recordId, recordName: p.recordName,
      before: describe(kind, parse<ChangeValue | null>(p.before, null)), after: describe(kind, parse<ChangeValue>(p.after, {})),
      reason: p.reason, sources: parse<SourceRef[]>(p.sourceRefs, []), requestedBy: p.requestedBy, sourcePerson: p.sourcePerson,
      status: p.status, createdAt: p.createdAt.toISOString(), expiresAt: p.expiresAt.toISOString(), fingerprint: p.fingerprint,
      alsoMoves: A3_RULES[kind].alsoMoves, undoOf: p.undoOfId ? (numbers.has(p.undoOfId) ? proposalRef(numbers.get(p.undoOfId)!) : "an earlier change") : null,
      canApprove: p.status === "PROPOSED" && !whyNot && kindEnabled(kind), whyNot,
      canWithdraw: p.status === "PROPOSED" && samePerson(by.name, p.requestedBy),
      canUndo: p.status === "EXECUTED" && canProposeKind(by, kind),
      events: p.events.map((e) => ({ action: e.action, by: e.by, note: e.note, at: e.at.toISOString() })),
    };
  });
}

// Waiting proposals this person could approve (the nav badge).
export async function countToApprove(by: ChangeUser, now = new Date()): Promise<number> {
  const open = await prisma.changeProposal.findMany({ where: { status: "PROPOSED", expiresAt: { gt: now } }, select: { kind: true, requestedBy: true, requestedByUserId: true, sourcePerson: true } });
  return open.filter((p) => isKind(p.kind) && canViewKind(by, p.kind) && kindEnabled(p.kind) && !cannotApprove(by, { kind: p.kind, requestedBy: p.requestedBy, requestedByUserId: p.requestedByUserId, sourcePerson: p.sourcePerson })).length;
}

// Projects to pick from when proposing a project change (names and numbers only).
export const projectsForPicker = () =>
  prisma.project.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, jobNo: true, quoteNo: true } });
