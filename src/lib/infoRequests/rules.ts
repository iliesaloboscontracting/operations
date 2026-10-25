// Information requests (Task I, 25 Oct 2026; Ilies: "yes build it"): plain
// questions to accounts, Nick or Yoel that aren't tied to a finding - e.g.
// "Where is the master tender register? Please upload it as CSV." They ride
// the same QUERY requests as finding questions (kind QUERY, no finding), so
// answering, files and closing work the same. These are the plain rules -
// what a question needs, the draft file format, who a draft's "to" means.
// No server imports; `npm test` (infoRequests.test.ts).

export const INFO_TYPES = ["QUESTION", "FYI"] as const; // QUESTION needs an answer; FYI is just marked read
export type InfoType = (typeof INFO_TYPES)[number];

export type InfoItem = { infoType: InfoType; title: string; question: string; need: string | null; why: string | null; dueDate: string | null };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

// One question as typed or drafted -> checked fields, or what's wrong.
export function parseInfoItem(b: Record<string, unknown>, today: string): InfoItem | { error: string } {
  const infoType = String(b.type ?? b.infoType ?? "QUESTION").toUpperCase() as InfoType;
  if (!INFO_TYPES.includes(infoType)) return { error: "Type must be QUESTION or FYI." };
  const title = text(b.title, 120);
  const question = text(b.question, 2000);
  if (title.length < 3) return { error: "Give it a short title." };
  if (question.length < 5) return { error: infoType === "FYI" ? "Write the note to pass on." : "Write the question." };
  const dueRaw = text(b.dueDate ?? b.due, 10);
  if (dueRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) return { error: "Due date must be a date (YYYY-MM-DD)." };
  if (dueRaw && dueRaw < today) return { error: "The due date has already passed." };
  return { infoType, title, question, need: text(b.need, 500) || null, why: text(b.why, 500) || null, dueDate: dueRaw || null };
}

// ---------- the draft file (the lead's docs/info-requests/batch-NN.json) ----------

export type DraftFileItem = { to: string; item: InfoItem } | { to: string; error: string };

export function parseDraftFile(json: unknown, today: string): { batch: string; items: DraftFileItem[] } | { error: string } {
  const f = json as { batch?: unknown; items?: unknown };
  if (!f || typeof f !== "object" || !Array.isArray(f.items)) return { error: "Not a draft file - it needs { batch, items: [...] }." };
  if (f.items.length === 0 || f.items.length > 100) return { error: "A draft file holds 1 to 100 questions." };
  const batch = text(f.batch, 200) || `Drafts ${today}`;
  return {
    batch,
    items: f.items.map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const to = text(r.to, 120);
      const item = parseInfoItem(r, today);
      if (!to) return { to: "", error: "Missing who it's to." };
      return "error" in item ? { to, error: item.error } : { to, item };
    }),
  };
}

// ---------- who "to" means ----------

export type Askable = { id: string; name: string; email: string; role: string; directorAccess: boolean; active: boolean };

// The people these questions go to: the accounts login, a director login,
// or anyone with director access - never the owner (he asks), never switched off.
export const canBeAsked = (u: Askable, ownerEmail: string) =>
  u.active && u.email.toLowerCase() !== ownerEmail.toLowerCase() && (u.role === "ACCOUNTS" || u.role === "DIRECTOR" || u.directorAccess);

// "Nick Giannopoulos" -> his DIRECTOR login first (he also has an ADMIN one),
// then a director-access login; "Accounts" -> the ACCOUNTS login; an email
// matches exactly. Ambiguous or unknown -> null (shown as "can't send").
export function resolveTo(to: string, users: Askable[], ownerEmail: string): Askable | null {
  const t = to.trim().toLowerCase();
  if (!t) return null;
  const pool = users.filter((u) => canBeAsked(u, ownerEmail));
  const byEmail = pool.filter((u) => u.email.toLowerCase() === t);
  if (byEmail.length === 1) return byEmail[0];
  if (t === "accounts") {
    const acc = pool.filter((u) => u.role === "ACCOUNTS");
    return acc.length === 1 ? acc[0] : acc.find((u) => u.email.toLowerCase().startsWith("accounts@")) ?? null;
  }
  const named = pool.filter((u) => u.name.trim().toLowerCase() === t);
  const rank = (u: Askable) => (u.role === "DIRECTOR" ? 0 : u.directorAccess ? 1 : 2);
  const best = named.sort((a, b) => rank(a) - rank(b));
  if (best.length === 0) return null;
  if (best.length > 1 && rank(best[0]) === rank(best[1])) return null; // two equally good logins: a person must choose
  return best[0];
}

// ---------- reading them back ----------

export type InfoDetails = { question: string; need?: string; why?: string; infoType?: InfoType; batch?: string };
export const readDetails = (details: string | null): InfoDetails => { try { return JSON.parse(details || "{}"); } catch { return { question: "" }; } };

export const OPEN_STATUSES = ["SENT", "SEEN", "TODO", "NEEDS_INFO"]; // waiting on the person asked
export const daysWaiting = (since: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));

// Why a drafted "to" doesn't resolve - said plainly on the draft list.
export function whyUnresolved(to: string, users: Askable[], ownerEmail: string): string {
  const t = to.trim().toLowerCase();
  if (!t) return "No name given.";
  if (t === "accounts") {
    return users.some((u) => u.role === "ACCOUNTS" && u.active) ? "More than one Accounts login - choose one." : "No Accounts login yet: create it on Users.";
  }
  const named = users.filter((u) => u.name.trim().toLowerCase() === t || u.email.toLowerCase() === t);
  if (!named.length) return `No login called "${to}" - choose who it's for.`;
  if (named.some((u) => u.email.toLowerCase() === ownerEmail.toLowerCase())) return "That's the owner - questions go to accounts or the directors.";
  const askable = named.filter((u) => canBeAsked(u, ownerEmail));
  if (!askable.length) return `${to} has no director login (or director tick) yet - set it on Users, or choose who it's for.`;
  return "More than one login matches - choose who it's for.";
}
