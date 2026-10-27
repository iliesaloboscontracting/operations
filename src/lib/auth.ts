import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { prisma } from "./prisma";
import { SESSION_COOKIE, sessionMaxAgeFor, signSession, verifySession } from "./session";
import { isOwner } from "./owner";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// TIMESHEETS (22 Oct 2026): review-only access to the weekly timesheets and
// nothing else (Alex). It ranks below VIEWER, so every guard() in the app
// refuses it; only guardTimesheetViewer() below lets it in.
// ACCOUNTS (24 Oct 2026): the invoices inbox and nothing else - accounts
// upload supplier invoices. Same idea: below VIEWER, only guardInvoiceInbox()
// lets it in.
// DIRECTOR (25 Oct 2026, Ilies: directors get their own screen and no
// Operations access): the Directors pages and nothing else. Same pattern -
// below VIEWER, only guardDirector() lets it in. Only the owner sets it.
export type Role = "ADMIN" | "MANAGER" | "VIEWER" | "TIMESHEETS" | "ACCOUNTS" | "DIRECTOR";
export const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"];
const RANK: Record<Role, number> = { TIMESHEETS: 0, ACCOUNTS: 0, DIRECTOR: 0, VIEWER: 1, MANAGER: 2, ADMIN: 3 };

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  directorAccess: boolean; // sees /directors - see hasDirectorAccess()
}

// Director Insights (24 Oct 2026): the director tick, or the owner. Never the
// one-page roles, even if ticked by mistake.
export function hasDirectorAccess(u: { email: string; role: string; directorAccess: boolean }) {
  if (u.role === "TIMESHEETS" || u.role === "ACCOUNTS") return false;
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
  if (RANK[user.role] < RANK[min]) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// Looking at timesheets: Managers and Admins, plus the review-only
// TIMESHEETS role. Approving, reopening and exporting stay guard("MANAGER").
export async function guardTimesheetViewer(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "TIMESHEETS" && RANK[user.role] < RANK.MANAGER) {
    return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  }
  return null;
}

// The invoices inbox: the ACCOUNTS role, plus Managers and Admins.
export async function guardInvoiceInbox(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (user.role !== "ACCOUNTS" && RANK[user.role] < RANK.MANAGER) {
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

// Where a role lands after signing in - the limited roles only have one page.
export function homeFor(role: Role) {
  return role === "TIMESHEETS" ? "/timesheets" : role === "ACCOUNTS" ? "/accounts" : role === "DIRECTOR" ? "/directors" : "/command";
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

// Only allow same-site relative redirects after login.
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/command";
}
