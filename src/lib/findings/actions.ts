// What people can do to a stored finding (Phase 2 step 4, 25 Oct 2026):
// acknowledge, give it an owner, resolve (with a note), dismiss (a false
// alarm, or an accepted risk until a date - with a reason), comment, and
// verify by hand one that was resolved while still firing. Plain rules, no
// database - the route (/api/findings/[id]) applies them and records a
// FindingEvent for every action. Design: PHASE2-FINDINGS-DESIGN.md §1.1-1.3.
//
// Who: the owner and director-access users act; Managers see OPERATIONAL and
// COMMERCIAL findings but can't act yet; Viewers see OPERATIONAL only;
// Timesheets / Accounts logins see none (the accounts login answers queries
// on her Invoices page, not findings).
import { isOwner } from "../owner";
import { screenFor } from "./config";

export type Actor = { id: string; name: string; email: string; role: string; directorAccess: boolean };
export type FindingAction = "ACKNOWLEDGE" | "ASSIGN" | "RESOLVE" | "DISMISS" | "COMMENT" | "VERIFY";
export const FINDING_ACTIONS: FindingAction[] = ["ACKNOWLEDGE", "ASSIGN", "RESOLVE", "DISMISS", "COMMENT", "VERIFY"];
const OPENISH = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];

// ---------- who sees and who acts ----------

export function audiencesFor(u: Pick<Actor, "email" | "role" | "directorAccess">): string[] {
  if (u.role === "TIMESHEETS" || u.role === "ACCOUNTS") return [];
  if (isOwner(u.email) || u.directorAccess || u.role === "DIRECTOR") return ["OPERATIONAL", "COMMERCIAL", "DIRECTOR"];
  if (u.role === "ADMIN" || u.role === "MANAGER") return ["OPERATIONAL", "COMMERCIAL"];
  if (u.role === "VIEWER") return ["OPERATIONAL"];
  return [];
}
export const canSeeFinding = (u: Pick<Actor, "email" | "role" | "directorAccess">, audience: string) => audiencesFor(u).includes(audience);

// Acting on findings and raising queries: the owner and director-access users.
export function canActOnFindings(u: Pick<Actor, "email" | "role" | "directorAccess">): boolean {
  if (u.role === "TIMESHEETS" || u.role === "ACCOUNTS") return false;
  return isOwner(u.email) || u.directorAccess || u.role === "DIRECTOR";
}

// Per finding (Task J): the screen it belongs on decides who sees and acts.
// Operations-screen findings (/attention): the owner, Admins and Managers act -
// Ilies runs operations - and a directors-only login never sees them.
// Directors-screen findings keep the rule above (owner + director access).
type FindingRef = { ruleCode: string; audience: string };
export function canSeeThisFinding(u: Pick<Actor, "email" | "role" | "directorAccess">, f: FindingRef): boolean {
  if (!canSeeFinding(u, f.audience)) return false;
  return !(u.role === "DIRECTOR" && screenFor(f) === "OPERATIONS");
}
export function canActOnThisFinding(u: Pick<Actor, "email" | "role" | "directorAccess">, f: FindingRef): boolean {
  if (screenFor(f) === "DIRECTORS") return canActOnFindings(u);
  return isOwner(u.email) || u.role === "ADMIN" || u.role === "MANAGER";
}

// ---------- one action ----------

export type FindingForAction = {
  status: string; severity: string; dedupeKey: string; signalClearedAt: Date | null;
  resolvedBy: string | null; resolvedWhileFiring: boolean; ownerUserId: string | null;
};
export type ActionResult =
  | { error: string }
  | { data: Record<string, unknown>; event: { action: string; fromValue?: string | null; toValue?: string | null; note?: string | null } };

const text = (x: unknown, max = 500) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function applyFindingAction(
  f: FindingForAction,
  action: string,
  body: Record<string, unknown>,
  ctx: { actor: Actor; now: Date; today: string; owner?: { id: string; name: string } | null },
): ActionResult {
  const { actor, now, today } = ctx;
  const open = OPENISH.includes(f.status);
  switch (action) {
    case "ACKNOWLEDGE": {
      if (!open) return { error: "This finding is closed." };
      if (f.status !== "OPEN") return { error: "It's already been picked up." };
      return {
        data: { status: "ACKNOWLEDGED", ...(f.ownerUserId ? {} : { ownerUserId: actor.id, ownerName: actor.name }) },
        event: { action: "ACKNOWLEDGED", fromValue: f.status, toValue: "ACKNOWLEDGED", note: f.ownerUserId ? null : `Owner: ${actor.name}` },
      };
    }
    case "ASSIGN": {
      if (!open) return { error: "This finding is closed." };
      if (!ctx.owner) return { error: "Pick who owns it." };
      return {
        data: { ownerUserId: ctx.owner.id, ownerName: ctx.owner.name, ...(f.status === "OPEN" ? { status: "ACKNOWLEDGED" } : {}) },
        event: { action: "ASSIGNED", toValue: ctx.owner.name, note: text(body.note) || null },
      };
    }
    case "RESOLVE": {
      if (!open) return { error: "This finding is already closed." };
      const note = text(body.note);
      if (note.length < 2) return { error: "Say how it was resolved." };
      // Still firing? Then it's the person's call and it's never verified automatically.
      const whileFiring = !f.signalClearedAt;
      return {
        data: { status: "RESOLVED", openKey: null, resolvedAt: now, resolvedBy: actor.name, resolution: note, resolvedWhileFiring: whileFiring },
        event: { action: "RESOLVED", fromValue: f.status, toValue: "RESOLVED", note: whileFiring ? `${note} (resolved while the rule still fires - a person verifies it)` : note },
      };
    }
    case "DISMISS": {
      if (!open) return { error: "This finding is already closed." };
      const kind = String(body.kind ?? "");
      const reason = text(body.reason);
      if (kind !== "FALSE_ALARM" && kind !== "ACCEPTED_RISK") return { error: "Pick false alarm or accepted risk." };
      if (reason.length < 2) return { error: "Say why it's being dismissed." };
      let until: string | null = null;
      if (kind === "ACCEPTED_RISK") {
        until = typeof body.until === "string" && ISO.test(body.until) ? body.until : null;
        if (!until) return { error: "Pick the date to look at it again." };
        if (until <= today) return { error: "Pick a date after today." };
      }
      return {
        data: { status: "DISMISSED", openKey: null, dismissedAt: now, dismissedBy: actor.name, dismissKind: kind, dismissReason: reason, suppressUntil: until, signalClearedAt: null },
        event: { action: "DISMISSED", fromValue: f.status, toValue: kind, note: until ? `${reason} (until ${until})` : reason },
      };
    }
    case "COMMENT": {
      const note = text(body.note, 1000);
      if (note.length < 2) return { error: "Type the comment." };
      return { data: {}, event: { action: "COMMENT", note } };
    }
    case "VERIFY": {
      if (f.status !== "RESOLVED") return { error: "Only a resolved finding can be verified." };
      if (!f.resolvedWhileFiring) return { error: "This one verifies itself once the rule has stayed clear." };
      // Separation of duties on the serious ones.
      if ((f.severity === "CRITICAL" || f.severity === "HIGH") && f.resolvedBy === actor.name) {
        return { error: "Someone other than the person who resolved it verifies a high or critical finding." };
      }
      const result = body.result === "NOT_EFFECTIVE" ? "NOT_EFFECTIVE" : "EFFECTIVE";
      const note = text(body.note);
      if (result === "NOT_EFFECTIVE") {
        // It didn't work: back to open on the same finding.
        return {
          data: { status: "OPEN", openKey: f.dedupeKey, outcomeResult: "NOT_EFFECTIVE", outcome: note || null, resolvedWhileFiring: false },
          event: { action: "NOT_FIXED", fromValue: "RESOLVED", toValue: "OPEN", note: note || "Verified as not effective" },
        };
      }
      return {
        data: { status: "VERIFIED", verifiedAt: now, verifiedBy: actor.name, outcomeResult: "EFFECTIVE", outcome: note || null },
        event: { action: "VERIFIED", fromValue: "RESOLVED", toValue: "VERIFIED", note: note || "Verified by hand" },
      };
    }
    default:
      return { error: "Unknown action." };
  }
}
