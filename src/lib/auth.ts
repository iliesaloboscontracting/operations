import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { prisma } from "./prisma";
import { SESSION_COOKIE, sessionMaxAgeFor, signSession, verifySession } from "./session";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// TIMESHEETS (22 Oct 2026): review-only access to the weekly timesheets and
// nothing else (Alex). It ranks below VIEWER, so every guard() in the app
// refuses it; only guardTimesheetViewer() below lets it in.
// ACCOUNTS (24 Oct 2026): the invoices inbox and nothing else - accounts
// upload supplier invoices. Same idea: below VIEWER, only guardInvoiceInbox()
// lets it in.
export type Role = "ADMIN" | "MANAGER" | "VIEWER" | "TIMESHEETS" | "ACCOUNTS";
export const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS"];
const RANK: Record<Role, number> = { TIMESHEETS: 0, ACCOUNTS: 0, VIEWER: 1, MANAGER: 2, ADMIN: 3 };

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
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
  const token = await signSession(userId, maxAge);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export function endSession() {
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// The signed-in user (fresh from the DB), or null. Inactive users are treated as signed out.
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const u = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!u || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role };
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

// Where a role lands after signing in - the limited roles only have one page.
export function homeFor(role: Role) {
  return role === "TIMESHEETS" ? "/timesheets" : role === "ACCOUNTS" ? "/invoices" : "/command";
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

// Only allow same-site relative redirects after login.
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/command";
}
