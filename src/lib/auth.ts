import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNext as safeNextPath } from "./safeNext";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { prisma } from "./prisma";
import { SESSION_COOKIE, sessionMaxAgeFor, signSession, verifySession } from "./session";
import { isOwner } from "./owner";
import { coordinatorOr, faultsWorker, NO_DIRECTOR_ACCESS_ROLES, toolsWorkerOr, yardOr, type Role } from "./roles";
import { UNKNOWN_RANK, rankAtLeast, rankOf } from "./roleRank";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// The roles and the one-page logins (TIMESHEETS, ACCOUNTS, DIRECTOR, COORDINATOR, YARD) are in lib/roles.ts; their ranks in
// lib/roleRank.ts, which fail closed (CO-001): a role the code doesn't know is refused everywhere.
export { ROLES, homeFor, type Role } from "./roles";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  directorAccess: boolean; // sees /directors - see hasDirectorAccess()
}

// Director Insights (24 Oct 2026): the director tick, or the owner. Never the
// one-page roles, even if ticked by mistake - and never a role the code doesn't know, whatever its tick says
// (CO-001-R1, Ilies approved 2 Nov 2026).
export function hasDirectorAccess(u: { email: string; role: string; directorAccess: boolean }) {
  if (rankOf(u.role) === UNKNOWN_RANK) return false;
  if (NO_DIRECTOR_ACCESS_ROLES.includes(u.role)) return false;
  return u.role === "DIRECTOR" || isOwner(u.email) || u.directorAccess;
}

// ---------- passwords ----------
export const MIN_PASSWORD = 8;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash to compare against when the email doesn't exist, so login takes the
// same time either way (no account-enumeration by timing).
let dummy: Promise<string> | null = null;
export function dummyHash() {
  return (dummy ??= hashPassword("not-a-real-password"));
}

// ---------- sessions ----------
export async function startSession(userId: string, email?: string | null) {
  const maxAge = sessionMaxAgeFor(email);
  // SEC-001: the cookie carries the user's current sessionVersion; bumping it signs out every older cookie.
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  const token = await signSession(userId, maxAge, u?.sessionVersion ?? 0);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

// SEC-001: bump a user's sessionVersion - every session they have, on every device, stops working.
export async function revokeSessions(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

export async function endSession() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// The signed-in user (fresh from the DB), or null. Inactive users are treated as signed out.
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const u = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!u || !u.active) return null;
  // SEC-001: a cookie from before a password change, reset, role change, deactivation or sign-out is dead.
  if (session.sv !== u.sessionVersion) return null;
  const base = { id: u.id, email: u.email, name: u.name, role: u.role as Role, directorAccess: u.directorAccess };
  return { ...base, directorAccess: hasDirectorAccess(base) };
}

// Use at the top of an API handler:
//   const denied = await guard("MANAGER"); if (denied) return denied;
// Returns a 401/403 response, or null when the caller is allowed.
export async function guard(min: Role = "VIEWER"): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!rankAtLeast(user.role, min)) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// The coordinator's pages (2 Nov 2026): `min` and up, as guard(min) does, plus the COORDINATOR login - for the
// routes in lib/roles.ts COORDINATOR_PAGES only, never by loosening guard() itself. Where he may only look, this
// guards the GET and the writes keep guard("MANAGER").
export async function guardOrCoordinator(min: Role): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!coordinatorOr(user.role, min)) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// The yard computer's own routes (Ilies, 4 Nov 2026 - /yard, the yard jobs under /api/yard/*): `min` and up, as
// guard(min) does, plus the YARD login - never by loosening guard() itself.
export async function guardOrYard(min: Role): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!yardOr(user.role, min)) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// The Tools routes (register, photos, plate reading, faults, toolbox contents and checks): `min` and up, plus the
// coordinator (2 Nov 2026) and the yard computer (Ilies, 4 Nov 2026), who work tools the same way. Creating, renaming,
// re-supervising and retiring a toolbox stay guard("MANAGER") (/api/toolboxes POST, /api/toolboxes/[id]).
export async function guardTools(min: Role): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!toolsWorkerOr(user.role, min)) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// Vehicle & plant faults and pre-start checks (/faults, /api/faults/*, 8 Nov 2026 - Ilies): Managers, Admins, the
// coordinator and the yard computer, exactly (lib/roles.ts faultsWorker). Returns the user, whose name goes on the
// fault's history. Never by loosening guard() itself.
export async function guardFaults(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!faultsWorker(user.role)) return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  return { user };
}

// Looking at timesheets: Managers and Admins, plus the review-only
// TIMESHEETS role and the COORDINATOR login (2 Nov 2026). Approving, reopening and exporting stay guard("MANAGER").
export async function guardTimesheetViewer(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "TIMESHEETS" && !coordinatorOr(user.role, "MANAGER")) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// The invoices inbox: the ACCOUNTS role, plus Managers and Admins.
export async function guardInvoiceInbox(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (user.role !== "ACCOUNTS" && !rankAtLeast(user.role, "MANAGER")) {
    return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  }
  return { user };
}

// The Directors overview (/api/directors/*): director access only - checked
// against the database on every call, so unticking someone takes effect at once.
export async function guardDirector(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.directorAccess) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  return null;
}

// Xero exports (G2, 25 Oct 2026): the ACCOUNTS login uploads them and ties
// invoices to jobs; director access does the same and sees the figures.
// Never Managers, Viewers or Timesheets - revenue is directors-only.
export async function guardXeroUpload(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (user.role !== "ACCOUNTS" && !user.directorAccess) {
    return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  }
  return { user };
}

// Controlled changes (LCI phase 4, 25 Oct 2026): Managers and Admins, plus
// director access (directors propose from answered queries and approve
// contract values). Which kinds each may see or approve is decided per
// proposal in lib/changes/rules.ts. Never Viewers, Timesheets or Accounts.
export async function guardChanges(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (user.role !== "ADMIN" && user.role !== "MANAGER" && !user.directorAccess) {
    return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  }
  return { user };
}

// The Accounts screen (/accounts, 26 Oct 2026 - Victoria's list, Ilies:
// "a separate log in for accounts and separate to operations"): the ACCOUNTS
// login, plus Admins (Ilies, Nick's ops login) to look in. Never Managers.
export async function guardAccounts(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (user.role !== "ACCOUNTS" && user.role !== "ADMIN") {
    return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  }
  return { user };
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

// Only allow same-site relative redirects after login.
// SEC-006: same-site paths only (backslashes, control characters, encoded tricks and other origins refused).
export function safeNext(next: string | null | undefined) {
  return safeNextPath(next, "https://app.invalid", "/command");
}
