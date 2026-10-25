// Tying Xero invoices to Operations jobs (G2, 25 Oct 2026) - options A-D from
// the plan, in this order, first match wins and the method is stored:
//   PERSON     a director's or accounts' earlier decision (XeroJobMatch)
//   TRACKING   A: the job tracking category's option = a project's job
//              number, quote number or name
//   REFERENCE  B: a job / quote number in the reference or line description
//   (XERO_PROJECT  C: API only - G3)
//   SITE_TEXT  D: a remembered site name or a project's name in the text -
//              only ever a SUGGESTION (projectId stays null, the suggestion
//              goes in matchNote) for a person to confirm.
// An invoice gets a job only when all its lines agree; otherwise MIXED and
// the lines carry the detail. Plain functions; `npm test` (xero.test.ts).
import { XERO_CONFIG } from "./config";
import type { ReadInvoice, ReadLine } from "./readers";

export type MatchMethod = "PERSON" | "TRACKING" | "REFERENCE" | "XERO_PROJECT" | "SITE_TEXT" | "MIXED" | "NONE";
export type JobRef = { id: string; name: string; jobNo: string | null; quoteNo: string | null; address?: string | null };
export type MatchContext = {
  projects: JobRef[];
  aliases: { text: string; projectId: string }[]; // SiteAlias (normalised text)
  person: Map<string, string | null>; // XeroJobMatch key -> projectId (null = not a job)
};
export type LineMatch = { projectId: string | null; method: MatchMethod; suggest: string | null };
export type InvoiceMatch = { projectId: string | null; method: MatchMethod; note: string | null; lines: LineMatch[] };

export const matchKey = (type: string, number: string) => `${type}|${number.trim().toUpperCase()}`;
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

function byNumber(projects: JobRef[]) {
  const m = new Map<string, string>();
  for (const p of projects) for (const k of [p.jobNo, p.quoteNo]) if (up(k) && !m.has(up(k))) m.set(up(k), p.id);
  return m;
}

function trackingJob(line: ReadLine, numbers: Map<string, string>, projects: JobRef[]): string | null {
  const cat = norm(XERO_CONFIG.jobTrackingCategory);
  for (const t of [line.tracking1, line.tracking2]) {
    if (!t) continue;
    const [name, ...rest] = t.split(":");
    const option = rest.length ? rest.join(":").trim() : name.trim();
    if (rest.length && norm(name) !== cat) continue;
    const viaNo = numbers.get(up(option));
    if (viaNo) return viaNo;
    const viaName = projects.find((p) => norm(p.name) === norm(option));
    if (viaName) return viaName.id;
  }
  return null;
}

function referenceJob(text: string, numbers: Map<string, string>): string | null {
  for (const m of text.matchAll(new RegExp(XERO_CONFIG.jobNumberPattern))) {
    const id = numbers.get(up(m[1]));
    if (id) return id;
  }
  return null;
}

function siteSuggestion(text: string, ctx: MatchContext): string | null {
  const t = norm(text);
  if (!t) return null;
  const alias = ctx.aliases.find((a) => a.text.length >= 4 && t.includes(a.text));
  if (alias) return alias.projectId;
  const named = ctx.projects.find((p) => norm(p.name).length >= 5 && t.includes(norm(p.name)));
  if (named) return named.id;
  const addr = ctx.projects.find((p) => norm(p.address).length >= 8 && t.includes(norm(p.address)));
  return addr?.id ?? null;
}

export function matchInvoice(inv: Pick<ReadInvoice, "type" | "number" | "reference" | "contact" | "lines">, ctx: MatchContext): InvoiceMatch {
  const person = ctx.person.get(matchKey(inv.type, inv.number));
  if (person !== undefined) {
    return { projectId: person, method: "PERSON", note: person ? null : "Not a job", lines: inv.lines.map(() => ({ projectId: person, method: "PERSON", suggest: null })) };
  }
  const numbers = byNumber(ctx.projects);
  const lines: LineMatch[] = inv.lines.map((l) => {
    const a = trackingJob(l, numbers, ctx.projects);
    if (a) return { projectId: a, method: "TRACKING", suggest: null };
    const b = referenceJob(`${inv.reference ?? ""} ${l.description ?? ""}`, numbers);
    if (b) return { projectId: b, method: "REFERENCE", suggest: null };
    const d = siteSuggestion(`${inv.reference ?? ""} ${l.description ?? ""} ${inv.contact}`, ctx);
    return { projectId: null, method: d ? "SITE_TEXT" : "NONE", suggest: d };
  });
  const jobs = new Set(lines.map((l) => l.projectId));
  if (jobs.size === 1 && lines[0]?.projectId) return { projectId: lines[0].projectId, method: lines[0].method, note: null, lines };
  if ([...jobs].filter(Boolean).length >= 1) return { projectId: null, method: "MIXED", note: "Lines on different jobs (or some not matched)", lines };
  const suggest = lines.find((l) => l.suggest)?.suggest ?? null;
  return { projectId: null, method: suggest ? "SITE_TEXT" : "NONE", note: suggest ? `suggest:${suggest}` : null, lines };
}

export const suggestionOf = (note: string | null) => (note?.startsWith("suggest:") ? note.slice(8) : null);
