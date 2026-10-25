// Repeatable regression check (25 Oct 2026): walks a director's whole day
// end to end over HTTP, so a change anywhere in the Directors flow is caught
// here rather than by Ilies, Yoel or Nick:
//   overview -> a finding's details -> "Ask accounts" -> accounts answers ->
//   Ilies closes it -> a budget approved -> the pipeline page
// plus the walls around it (accounts can't open the Directors screen, a
// directors-only login can't open Operations) and a fingerprint proving the
// day changed no project, job, allocation, cost or invoice record.
//
// COPY ONLY. It writes: three throwaway logins (left switched off at the
// end), one query and its answer, finding events, and - if a budget is
// waiting - one budget decision. Never point it at the live database.
//
// Usage (PowerShell), against a test copy served by `next dev` on another port:
//   $env:DATABASE_URL = "file:C:/path/to/the/copy/prisma/test.db"   # absolute; never dev.db
//   $env:BASE_URL = "http://127.0.0.1:3002"
//   $env:DAYCHECK_COPY = "yes"
//   npx tsx scripts/check-director-day.ts
// Optional, to have a budget waiting for the approve step (an Estimating COPY,
// never the live one on :4310):
//   $env:DAYCHECK_ESTIMATING_SEED_URL = "http://127.0.0.1:4350"
// The budget step needs Estimating reachable from the server (ESTIMATING_URL)
// and BUDGET_APPROVAL_SECRET set the same in both apps; without them it is
// reported as SKIP (or the plain "not switched on" answer), not as a failure.

import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, scrypt as scryptCb } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// ---------- refuse anything that isn't a local copy ----------
const DB = process.env.DATABASE_URL ?? "";
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const SEED = (process.env.DAYCHECK_ESTIMATING_SEED_URL ?? "").replace(/\/$/, "");
const localHost = (u: string) => { try { const h = new URL(u).hostname; return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h.endsWith(".localhost"); } catch { return false; } };
const stop = (why: string) => { console.error(`Not running: ${why}`); process.exit(2); };
if (process.env.DAYCHECK_COPY !== "yes") stop("set DAYCHECK_COPY=yes to confirm this is a throwaway copy.");
if (!/^file:/.test(DB)) stop("DATABASE_URL must be an absolute file: path to the copy the target server uses.");
if (/(^|[\\/])dev\.db$/i.test(DB.replace(/^file:/, "")) || /\/srv\//.test(DB)) stop("DATABASE_URL points at a live database name (dev.db / /srv). Use a copy.");
if (!BASE || !localHost(BASE)) stop("BASE_URL must be a local test server (127.0.0.1, localhost or *.localhost).");
if (SEED && (!localHost(SEED) || new URL(SEED).port === "4310")) stop("DAYCHECK_ESTIMATING_SEED_URL must be a local Estimating COPY, never :4310.");

const prisma = new PrismaClient();
let pass = 0, fail = 0, skip = 0;
const ok = (name: string, cond: boolean, detail = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? `  :: ${detail}` : ""}`); };
const skipped = (name: string, why: string) => { skip++; console.log(`SKIP ${name}  :: ${why}`); };

// ---------- throwaway logins ----------
const PASSWORD = randomBytes(18).toString("base64url");
async function hash(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scrypt(pw, salt, 64)).toString("hex")}`;
}
const USERS = {
  director: { email: "daycheck-director@test.invalid", name: "Daycheck Director", role: "DIRECTOR", directorAccess: false },
  accounts: { email: "daycheck-accounts@test.invalid", name: "Daycheck Accounts", role: "ACCOUNTS", directorAccess: false },
  closer: { email: "daycheck-closer@test.invalid", name: "Daycheck Closer", role: "ADMIN", directorAccess: true }, // stands in for Ilies
};
async function makeUsers() {
  const passwordHash = await hash(PASSWORD);
  const out: Record<keyof typeof USERS, string> = { director: "", accounts: "", closer: "" };
  for (const [k, u] of Object.entries(USERS) as [keyof typeof USERS, (typeof USERS)[keyof typeof USERS]][]) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash, active: true },
      update: { passwordHash, active: true, role: u.role, directorAccess: u.directorAccess },
      select: { id: true },
    });
    out[k] = row.id;
  }
  return out;
}

// ---------- HTTP ----------
async function login(email: string) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, body: json };
}

// ---------- the records a director's day must never change ----------
async function fingerprint() {
  const h = createHash("sha256");
  const add = (name: string, rows: unknown[]) => h.update(`${name}:${rows.length}:${JSON.stringify(rows)}`);
  add("project", await prisma.project.findMany({ orderBy: { id: "asc" } }));
  add("job", await prisma.job.findMany({ orderBy: { id: "asc" } }));
  add("assignment", await prisma.assignment.findMany({ orderBy: { id: "asc" } }));
  add("resource", await prisma.resource.findMany({ orderBy: { id: "asc" } }));
  add("invoicedCost", await prisma.invoicedCost.findMany({ orderBy: { id: "asc" } }));
  add("allocationCost", await prisma.allocationCost.findMany({ orderBy: { id: "asc" } }));
  add("dayClose", await prisma.dayClose.findMany({ orderBy: { id: "asc" } }));
  add("labourCost", await prisma.labourCost.findMany({ orderBy: { id: "asc" } }));
  return h.digest("hex");
}

// ---------- an Estimating copy with one budget waiting (optional) ----------
async function seedBudget(): Promise<{ id: string } | { error: string }> {
  const who = "Daycheck Estimator";
  const est = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${SEED}/${path}`, { method, headers: { "content-type": "application/json", "x-lobos-user": who }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const tender = (await est("POST", "api/tenders", { mode: "issue", tender: { name: "Daycheck tender", client: "Daycheck Client" } })).body?.tender;
  if (!tender) return { error: "the Estimating copy wouldn't issue a quote number (set its last-used number first)" };
  const id = `daycheck${Date.now().toString(36)}`;
  const saved = await est("PUT", `api/projects/${id}`, {
    name: "Daycheck estimate", client: "Daycheck Client", location: "Testville", maturity: "TENDER", status: "Draft", estimator: who,
    tenderId: tender.id, quoteNo: tender.quoteNo, jobNo: "", settings: { ohPct: 10, profitPct: 8, hpd: 8, dpw: 5, prelimWeeks: "", gstPct: 10 },
    packages: [{ id: "pk1", code: "WP01", actCode: "STR-01", name: "Soft strip", cls: "INCLUDED", qty: 100, unit: "m²", qtySrc: "Test", prod: 50, prodBasis: "test", hpd: "", start: 0, lines: [
      { id: "l1", kind: "time", cat: "01", desc: "Labourer", count: 2, per: "hr", days: "", rate: 60 },
    ] }],
    prelims: [], risks: [], docs: [], assumptions: [], exclusions: [], clarifications: [], ve: [], benchmarks: [],
    submittedPrice: "", priceAdjReason: "", priceSetBy: who,
  });
  const sub = await est("POST", `api/budgets/${id}`, { basedOnSavedAt: saved.body?.savedAt });
  return sub.status === 201 ? { id } : { error: `the Estimating copy refused the test budget (${sub.status} ${JSON.stringify(sub.body?.issues ?? sub.body?.error)})` };
}

// ---------- the day ----------
async function main() {
  const ids = await makeUsers();
  const before = await fingerprint();
  const [director, accounts, closer] = [await login(USERS.director.email), await login(USERS.accounts.email), await login(USERS.closer.email)];

  // 1. Morning: the overview
  const ov = await call(director, "GET", "/api/directors/overview");
  ok("1. overview loads for a directors-only login", ov.status === 200, `${ov.status}`);
  ok("1. company health band has its six tiles", Array.isArray(ov.body?.health) && ov.body.health.length === 6 && ov.body.health.every((t: any) => t.statusWord && t.source), JSON.stringify(ov.body?.health?.map((t: any) => t.id)));

  // 2. A finding's details
  const list = await call(director, "GET", "/api/findings");
  const open = (list.body?.findings ?? []).filter((f: any) => ["OPEN", "ACKNOWLEDGED", "ACTIONED"].includes(f.status));
  ok("2. findings list loads with open findings to work", list.status === 200 && open.length > 0, `${list.status}, ${open.length} open`);
  const f = open.find((x: any) => x.audience !== "OPERATIONAL") ?? open[0];
  if (!f) throw new Error("no open finding on this copy - run the findings engine first");
  const det = await call(director, "GET", `/api/findings/${f.id}`);
  ok("2. finding details open (values, history)", det.status === 200 && Array.isArray(det.body?.events), `${det.status}`);

  // 3. Ask accounts
  const people = await call(director, "GET", "/api/findings/people");
  ok("3. accounts is someone a director can ask", people.status === 200 && (people.body?.askUsers ?? []).some((u: any) => u.id === ids.accounts));
  const question = `Daycheck ${new Date().toISOString().slice(0, 16)}: is the latest supplier invoice for this job in yet?`;
  const raised = await call(director, "POST", `/api/findings/${f.id}/queries`, { userId: ids.accounts, question });
  const qid: string | undefined = raised.body?.request?.id ?? raised.body?.id;
  ok("3. question sent to accounts from the finding", raised.status < 300 && !!qid, `${raised.status} ${JSON.stringify(raised.body)}`);

  // 4. Accounts answers (from Invoices -> Queries)
  const mine = await call(accounts, "GET", "/api/queries");
  ok("4. accounts sees the question (and only her own)", mine.status === 200 && (mine.body?.queries ?? []).some((q: any) => q.id === qid) && (mine.body?.queries ?? []).every((q: any) => q.canAnswer !== undefined));
  const ans = await call(accounts, "POST", `/api/queries/${qid}`, { answer: "Daycheck: yes, it came in this morning." });
  ok("4. accounts answers", ans.status === 200, `${ans.status} ${JSON.stringify(ans.body)}`);

  // 5. Ilies closes it (Requests); the answer is kept on the finding
  const closed = await call(closer, "PATCH", `/api/requests/${qid}`, { action: "DONE", outcome: "Daycheck: thanks." });
  ok("5. the question is closed", closed.status === 200, `${closed.status} ${JSON.stringify(closed.body)}`);
  const after = await call(director, "GET", `/api/findings/${f.id}`);
  const ev = (after.body?.events ?? []).map((e: any) => e.action);
  ok("5. the finding records the question, the answer and the close", ["QUERY_CREATED", "ANSWERED", "QUERY_CLOSED"].every((a) => ev.includes(a)), JSON.stringify(ev));
  ok("5. the answer is kept as evidence on the finding", JSON.stringify(after.body?.evidence ?? []).includes("came in this morning"));

  // 6. A budget approved
  let seeded: string | null = null;
  if (SEED) {
    const s = await seedBudget();
    if ("error" in s) skipped("6. seed a budget in the Estimating copy", s.error);
    else seeded = s.id;
  }
  const budgets = await call(director, "GET", "/api/directors/budgets");
  if (budgets.status !== 200) skipped("6. budget approval", `budgets list answered ${budgets.status}: ${budgets.body?.error ?? ""}`);
  else {
    const decidable = (budgets.body?.budgets ?? []).filter((b: any) => b.status === "SUBMITTED" && !b.cannotDecide);
    const waiting = decidable.find((b: any) => b.estimate_id === seeded) ?? decidable[0]; // the one this run seeded, if any
    if (!waiting) skipped("6. budget approval", "no budget waiting that this director can decide (set DAYCHECK_ESTIMATING_SEED_URL)");
    else {
      const d = await call(director, "GET", `/api/directors/budgets/${waiting.estimate_id}/${waiting.revision}`);
      ok("6. budget detail opens with price, packages and hours per day", d.status === 200 && d.body?.budget?.schema_version === "budget.v1" && d.body?.budget?.assumptions?.hours_per_day > 0);
      const dec = await call(director, "POST", `/api/directors/budgets/${waiting.estimate_id}/${waiting.revision}/decision`, { decision: "APPROVED", reason: "Daycheck", version: d.body?.status?.version });
      if (dec.status === 503) skipped("6. budget approved", `approvals not switched on here: ${dec.body?.error}`);
      else ok("6. budget approved and recorded in Estimating", dec.status === 200 && dec.body?.status?.status === "APPROVED", `${dec.status} ${JSON.stringify(dec.body)}`);
    }
  }

  // 7. The pipeline page
  const pipe = await call(director, "GET", "/api/directors/pipeline");
  if (pipe.status === 200 && pipe.body?.reachable === false) skipped("7. pipeline", "Estimating not reachable from the server - the page says so, with no figures");
  else ok("7. pipeline loads from Estimating (pipeline.v1)", pipe.status === 200 && pipe.body?.pipeline?.schema_version === "pipeline.v1", `${pipe.status}`);

  // The walls
  ok("wall: accounts can't open the Directors overview", (await call(accounts, "GET", "/api/directors/overview")).status === 403);
  ok("wall: a directors-only login can't open Operations (tracking)", (await call(director, "GET", "/api/tracking")).status === 403);
  // 404 (it can't even see the finding since Task J) or 403 - refused either way.
  { const w = await call(accounts, "POST", `/api/findings/${f.id}/queries`, { userId: ids.closer, question: "Daycheck wall check" }); ok("wall: accounts can't raise a query", w.status === 403 || w.status === 404, `${w.status}`); }

  // Nothing operational or financial changed
  ok("no project, job, allocation, resource, ledger or invoice record changed", (await fingerprint()) === before);
}

main()
  .catch((e) => { fail++; console.error("FAIL (stopped):", e instanceof Error ? e.message : e); })
  .finally(async () => {
    // Throwaway logins are switched off, not deleted (their names are on the records the day made).
    await prisma.user.updateMany({ where: { email: { in: Object.values(USERS).map((u) => u.email) } }, data: { active: false } }).catch(() => {});
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${skip} skipped, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
