// Owner-only "Change email" on the Users page (Ilies, 27 Nov 2026: "Add 'change email' to Users" - first use: the yard
// computer's login becomes yard@loboscontracting.com.au instead of iliesa+yard@). The rules are plain code here so the
// route, the page and the tests share them. No server imports - the Users page uses this too.
import { OWNER_EMAIL, isOwner } from "./owner";
import { BUILDING_AGENT_EMAIL } from "./session";
import { plainEmail } from "./samePerson";

// Cloudflare Access ("Lobos staff" policy) only lets emails ending in this domain into the office address, so a login
// with any other address could never get in.
export const LOGIN_EMAIL_DOMAIN = "@loboscontracting.com.au";

export const EMAIL_CHANGE_NOTICE = "They'll be signed out everywhere and must sign in with the new email.";

const isAgent = (email: string | null | undefined) => (email ?? "").trim().toLowerCase() === BUILDING_AGENT_EMAIL;

// Which logins the owner may change the email of: every login except the owner's own (that would lock the owner out -
// the owner is known by this email, lib/owner.ts) and the Building Agent's (it is known by its email, lib/session.ts).
export const emailChangeable = (target: { email: string }) => !isOwner(target.email) && !isAgent(target.email);

// The page shows the button only to the owner, and never on those two logins.
export const mayChangeEmail = (actorEmail: string | null | undefined, target: { email: string }) =>
  isOwner(actorEmail) && emailChangeable(target);

export type EmailChangeResult = { ok: true; email: string } | { ok: false; status: number; error: string };

// Checks an email change. `others` = every OTHER login's email (any case) - an address can only belong to one login.
export function checkEmailChange(
  actorEmail: string | null | undefined,
  target: { id: string; email: string },
  raw: unknown,
  others: { id: string; email: string }[],
): EmailChangeResult {
  const no = (status: number, error: string): EmailChangeResult => ({ ok: false, status, error });
  if (!isOwner(actorEmail)) return no(403, "Only Iliesa can change a login's email.");
  if (isOwner(target.email)) return no(400, "The owner's own email can't be changed here - it could lock the owner out.");
  if (isAgent(target.email)) return no(400, "The Building Agent's email can't be changed - the app knows that login by its email.");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return no(400, "Enter a valid email address.");
  if (!plainEmail(email)) return no(400, "Use a plain email address (no accents, spaces or special letters, at most 120 characters).");
  if (!email.endsWith(LOGIN_EMAIL_DOMAIN) || email.indexOf("@") !== email.length - LOGIN_EMAIL_DOMAIN.length) {
    return no(400, `The email must end ${LOGIN_EMAIL_DOMAIN} - Cloudflare Access only lets those addresses into the office address, so any other email could never sign in.`);
  }
  if (email === OWNER_EMAIL) return no(400, "That's the owner's email - it can't go on another login.");
  if (email === BUILDING_AGENT_EMAIL) return no(400, "That's the Building Agent's email - it can't go on another login.");
  if (email === target.email.trim().toLowerCase()) return no(400, "That's already this login's email.");
  if (others.some((u) => u.id !== target.id && u.email.trim().toLowerCase() === email)) return no(409, "Another login already uses that email.");
  return { ok: true, email };
}
