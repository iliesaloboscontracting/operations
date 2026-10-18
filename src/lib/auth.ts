import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { prisma } from "./prisma";
import { SESSION_COOKIE, sessionMaxAgeFor, signSession, verifySession } from "./session";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Role = "ADMIN" | "MANAGER" | "VIEWER";
export const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER"];
const RANK: Record<Role, number> = { VIEWER: 1, MANAGER: 2, ADMIN: 3 };

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

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

// Only allow same-site relative redirects after login.
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/command";
}
