// Repeatable regression check (Phase 2b, 2026-09-28): confirms a Viewer
// login can never pull a pay rate, hire rate, cost or contract figure out
// of the API - the class of leak Phase 1 closed and the Operation Analyst
// Agent later caught this route missing it on (/api/projects). Run this
// after any change that touches a route a Viewer can call, so a
// regression is caught here instead of in someone's dev tools.
//
// Usage (PowerShell), against the real app running on port 3000:
//   $env:DATABASE_URL = "file:C:/Users/ilies/Documents/operations/prisma/dev.db"
//   npx tsx scripts/check-viewer-safety.ts
// Or against a throwaway copy on another port:
//   $env:DATABASE_URL = "file:C:/Users/ilies/Documents/operations/prisma/dev.verify.db"
//   $env:BASE_URL = "http://localhost:3001"
//   npx tsx scripts/check-viewer-safety.ts
//
// DATABASE_URL must be set explicitly (an absolute file: path) - there is
// no default, so this never silently runs against the wrong database.
// Creates one throwaway VIEWER user, logs in over HTTP to get a session
// cookie, hits every route a Viewer can reach, and deletes the throwaway
// user again before exiting either way.

import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCb } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set - point it at the exact database the target server is using (an absolute file: path) and try again.");
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

// Any of these keys appearing anywhere in a Viewer-visible JSON response is
// a fail - pay rates, hire rates, and cost/contract figures never belong
// there, no matter how deeply nested.
const FORBIDDEN_KEYS = new Set([
  "rate", "dailyRateExGst", "hireRate", "hireRateUnit",
  "payRateBasis", "annualSalary", "ordinaryRate", "nightRate", "travelRate",
  "regionalDayRate", "regionalNightRate", "saturdayRate", "sundayRate",
  "payRateConfirmed", "payRateNotes",
  "contractValue", "contractValueNotes", "costToDate",
  "totalCost", "byCode", "invoicedTotal", "invoiced", "labourTotal", "labour",
  "hireLabourEstimateTotal", "hireLabourEstimate", "recordedCost", "estimatedCost",
  "idleCost", "rateUsed", "amountExGst", "gst", "totalIncGst",
]);

function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const hits: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) hits.push(`${path}.${k}`);
      hits.push(...findForbiddenKeys(v, `${path}.${k}`));
    }
    return hits;
  }
  return [];
}

type Check = { name: string; ok: boolean; detail?: string };

async function main() {
  const checks: Check[] = [];
  const email = `viewer-safety-check-${Date.now()}@local.test`;
  const password = randomBytes(16).toString("hex");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;

  const viewer = await prisma.user.create({
    data: { email, name: "Viewer Safety Check", passwordHash, role: "VIEWER" },
  });

  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];
    if (!loginRes.ok || !cookie) {
      console.error(`Could not log in as the throwaway Viewer against ${BASE_URL} - is the server running there?`);
      process.exit(1);
    }

    async function get(path: string) {
      const res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookie! } });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* non-JSON response */ }
      return { status: res.status, body };
    }

    async function checkClean(name: string, path: string) {
      const { status, body } = await get(path);
      if (status !== 200) {
        checks.push({ name, ok: false, detail: `expected 200, got ${status}` });
        return;
      }
      const hits = findForbiddenKeys(body);
      checks.push({ name, ok: hits.length === 0, detail: hits.length ? `leaked: ${hits.join(", ")}` : undefined });
    }

    async function checkDenied(name: string, path: string) {
      const { status } = await get(path);
      checks.push({ name, ok: status === 401 || status === 403, detail: status !== 401 && status !== 403 ? `expected 401/403, got ${status}` : undefined });
    }

    const today = new Date().toISOString().slice(0, 10);
    await checkClean("GET /api/jobs", `/api/jobs?date=${today}`);
    await checkClean("GET /api/jobs/completed", "/api/jobs/completed");
    await checkClean("GET /api/calendar", `/api/calendar?from=${today}&to=${today}`);
    await checkClean("GET /api/resources", "/api/resources");
    await checkClean("GET /api/projects", "/api/projects");
    await checkClean("GET /api/day-review", `/api/day-review?date=${today}`);
    await checkClean("GET /api/day-close", `/api/day-close?date=${today}`);
    await checkClean("GET /api/day-review/site-logs", `/api/day-review/site-logs?date=${today}`); // daily site log (Task K)
    await checkDenied("GET /api/tracking (should be Manager+ only)", "/api/tracking");
    // Accounts stage 5: compliance data never reaches a Viewer (board flag = Manager+, the rest accounts + Admins).
    await checkDenied("GET /api/compliance/flags (should be Manager+ only)", "/api/compliance/flags");
    await checkDenied("GET /api/compliance/workers (accounts + Admins only)", "/api/compliance/workers");
    await checkDenied("GET /api/compliance/documents (accounts + Admins only)", "/api/compliance/documents");
    // Accounts stage 6: assets (service amounts) and purchases (amounts) - accounts / directors; in-app asking is Manager+.
    await checkDenied("GET /api/accounts/assets (accounts + Admins only)", "/api/accounts/assets");
    await checkDenied("GET /api/accounts/assets/invoices (accounts + Admins only)", "/api/accounts/assets/invoices");
    await checkDenied("GET /api/accounts/purchases (accounts + Admins only)", "/api/accounts/purchases");
    await checkDenied("GET /api/directors/purchases (director access only)", "/api/directors/purchases");
    await checkDenied("GET /api/purchases (Manager+ / accounts only)", "/api/purchases");
    await checkDenied("GET /api/assets/dates (D4: Managers read asset expiry dates; Viewers nothing)", "/api/assets/dates");

    // The Project File (brief 11): every project's page data, as a Viewer -
    // no money keys, no internal notes, and only crew-visible contacts.
    const projectList = await get("/api/projects");
    const projectIds = Array.isArray(projectList.body) ? (projectList.body as { id: string }[]).map((p) => p.id) : [];
    const fileLeaks: string[] = [];
    for (const id of projectIds) {
      const { status, body } = await get(`/api/projects/${id}`);
      if (status !== 200) { fileLeaks.push(`${id}: expected 200, got ${status}`); continue; }
      fileLeaks.push(...findForbiddenKeys(body).map((h) => `${id} ${h}`));
      const b = body as { notes?: unknown; contacts?: { visibleTo: string }[] };
      if ("notes" in b) fileLeaks.push(`${id} $.notes (internal notes)`);
      for (const c of b.contacts ?? []) if (c.visibleTo !== "CREW") fileLeaks.push(`${id} contact visibleTo=${c.visibleTo}`);
    }
    checks.push({
      name: `GET /api/projects/:id (all ${projectIds.length} projects)`,
      ok: projectIds.length > 0 && fileLeaks.length === 0,
      detail: fileLeaks.length ? `leaked: ${fileLeaks.slice(0, 10).join(", ")}` : projectIds.length ? undefined : "no projects to check",
    });
    // /api/jobs/:id and /api/resources/:id have no GET handler (PATCH/DELETE
    // only) - a Viewer reaches a resource's full record only through the
    // list endpoints above, already covered.
  } finally {
    await prisma.user.delete({ where: { id: viewer.id } });
    await prisma.$disconnect();
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main();
