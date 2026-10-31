// The live read-only Xero connection, server side (G3, 25 Oct 2026).
// Outbound connection #5 (Xero, read-only). Every entry point checks the
// setup first: without XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_TOKEN_KEY
// it is OFF ("not set up yet") and makes no outbound call. Only the owner
// connects or disconnects; director access sees the status and can ask for a
// refresh (at most every 15 minutes). A sync writes ordinary XeroImport rows
// (source API) through the same writers as accounts' uploads, so the
// Directors tiles, matching and the review list work unchanged. The fetch is
// passed in (tests and the copy use a mock; never real Xero there).
import { prisma } from "../../prisma";
import { todaySydney } from "../../today";
import type { AuthUser } from "../../auth";
import { isOwner } from "../../owner";
import { writeInvoices, writePnl } from "../imports";
import { XERO_CONFIG } from "../config";
import { xeroSetup, scrub, NOT_SET_UP, type XeroSetup } from "./setup";
import { encryptToken, decryptToken, newState, pkcePair, readState, signState } from "./secure";
import { accountingGet, authorizeUrl, exchangeCode, listConnections, realFetch, refreshTokens, revokeToken, type Fetch } from "./client";
import { withAccessToken } from "./tokens";
import { apiInvoiceToRead, readApiPnl, type ApiInvoice, type ApiReport } from "./api";

type Ok = Extract<XeroSetup, { ok: true }>;
const REFRESH_EVERY_MIN = 15;
const PAGE = 100;
// 10,000 a kind from the fixed start (XERO_CONFIG.mirrorFrom) - years of room. Reaching it fails the read loudly
// rather than quietly leaving invoices out.
export const MAX_PAGES = 100;

export async function xeroStatus(user: AuthUser) {
  const setup = xeroSetup();
  const c = await prisma.xeroConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  return {
    setUp: setup.ok,
    setupMessage: setup.ok ? null : setup.reason,
    canConnect: isOwner(user.email) && setup.ok,
    connection: c ? { tenantName: c.tenantName, status: c.status, connectedBy: c.connectedBy, connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt, lastError: c.lastError } : null,
  };
}

// ---------- connect (owner only) ----------

export function startConnect(user: AuthUser, authSecret: string): { error: string; status: number } | { redirect: string; cookie: string } {
  if (!isOwner(user.email)) return { error: "Only Iliesa connects Xero.", status: 403 };
  const s = xeroSetup();
  if (!s.ok) return { error: s.reason, status: 400 };
  const { verifier, challenge } = pkcePair();
  const state = newState();
  return { redirect: authorizeUrl(s, state, challenge), cookie: signState({ state, verifier, uid: user.id }, authSecret) };
}

export async function finishConnect(
  user: AuthUser, q: { code?: string | null; state?: string | null; error?: string | null }, cookie: string | undefined, authSecret: string, f: Fetch = realFetch,
): Promise<{ ok: true; tenantName: string } | { ok: false; error: string }> {
  if (!isOwner(user.email)) return { ok: false, error: "Only Iliesa connects Xero." };
  const s = xeroSetup();
  if (!s.ok) return { ok: false, error: s.reason };
  if (q.error) return { ok: false, error: q.error === "access_denied" ? "Xero access wasn't allowed - nothing was connected." : "Xero didn't complete the sign-in." };
  const st = readState(cookie, authSecret);
  if (!st || !q.state || st.state !== q.state || st.uid !== user.id || !q.code) return { ok: false, error: "That Xero sign-in link is old or wasn't started here - start again from Accounts data." };
  const t = await exchangeCode(f, s, q.code, st.verifier);
  if (!t.ok) return { ok: false, error: t.error };
  const granted = (t.data.scope ?? s.scopes.join(" ")).split(/\s+/).filter(Boolean);
  if (granted.some((g) => !/\.read$/.test(g) && !["openid", "profile", "email", "offline_access"].includes(g))) {
    await revokeToken(f, s, t.data.refresh_token);
    return { ok: false, error: "Xero granted more than read-only access, so the connection was refused and revoked." };
  }
  const tenants = await listConnections(f, t.data.access_token);
  if (!tenants.ok) return { ok: false, error: tenants.error };
  const orgs = tenants.data.filter((x) => x.tenantType === "ORGANISATION").sort((a, b) => String(b.updatedDateUtc ?? "").localeCompare(String(a.updatedDateUtc ?? "")));
  const org = orgs[0];
  if (!org) return { ok: false, error: "No Xero organisation was shared - choose the Lobos organisation when Xero asks." };
  await prisma.$transaction([
    // Only one connection: any other organisation's row is switched off.
    prisma.xeroConnection.updateMany({ where: { tenantId: { not: org.tenantId } }, data: { status: "DISCONNECTED", refreshTokenEnc: "" } }),
    prisma.xeroConnection.upsert({
      where: { tenantId: org.tenantId },
      create: { tenantId: org.tenantId, tenantName: org.tenantName, scopes: granted.join(" "), refreshTokenEnc: encryptToken(t.data.refresh_token, s.key), status: "ACTIVE", connectedBy: user.name, connectedByUserId: user.id, lastRefreshAt: new Date() },
      update: { tenantName: org.tenantName, scopes: granted.join(" "), refreshTokenEnc: encryptToken(t.data.refresh_token, s.key), status: "ACTIVE", connectedBy: user.name, connectedByUserId: user.id, connectedAt: new Date(), lastRefreshAt: new Date(), lastError: null },
    }),
  ]);
  return { ok: true, tenantName: org.tenantName };
}

export async function disconnect(user: AuthUser, f: Fetch = realFetch): Promise<{ ok: true } | { error: string; status: number }> {
  if (!isOwner(user.email)) return { error: "Only Iliesa disconnects Xero.", status: 403 };
  const c = await prisma.xeroConnection.findFirst({ where: { status: { not: "DISCONNECTED" } } });
  if (!c) return { ok: true };
  const s = xeroSetup();
  if (s.ok && c.refreshTokenEnc) {
    try { await revokeToken(f, s, decryptToken(c.refreshTokenEnc, s.key)); } catch { /* unreadable token: nothing to revoke */ }
  }
  await prisma.xeroConnection.update({ where: { id: c.id }, data: { status: "DISCONNECTED", refreshTokenEnc: "", lastError: null } });
  return { ok: true };
}

// ---------- sync ----------

let running = false;

function tokenDeps(s: Ok, f: Fetch, id: string) {
  return {
    key: s.key,
    load: () => prisma.xeroConnection.findUnique({ where: { id }, select: { tenantId: true, refreshTokenEnc: true, status: true } }),
    saveRotated: async (refreshTokenEnc: string, at: Date) => { await prisma.xeroConnection.update({ where: { id }, data: { refreshTokenEnc, lastRefreshAt: at } }); },
    markReauth: async (error: string) => { await prisma.xeroConnection.update({ where: { id }, data: { status: "NEEDS_REAUTH", lastError: error } }); },
    refresh: (rt: string) => refreshTokens(f, s, rt),
  };
}

// Everything from the fixed mirror start (stage 4, 30 Oct 2026) - no longer a rolling 1 July. A Xero type narrows it
// (CLM-002: sales from the mirror start, bills over a shorter window - the same endpoints and scopes).
export function mirrorWhere(from: string = XERO_CONFIG.mirrorFrom, type?: string) {
  const [y, m, d] = from.split("-");
  return encodeURIComponent(`${type ? `Type=="${type}" AND ` : ""}Date>=DateTime(${Number(y)},${m},${d})`);
}
// Bills are a cross-check only (never job cost): from 1 July of the previous financial year, as the read always was.
export function billsFrom(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return `${(m >= 7 ? y : y - 1) - 1}-07-01`;
}

// Gentle on Xero (CLM-002): about a second between pages, and a 429 waits as long as Xero asks (up to two minutes) and
// tries that page again, up to 3 times. Reaching MAX_PAGES stops the read (PageLimitError) - no more tries that day.
export const PAGE_PAUSE_MS = 1000;
const TRIES_429 = 3;
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class PageLimitError extends Error {}

export async function pullAll(f: Fetch, token: string, tenant: string, resource: "Invoices" | "CreditNotes", opts: { where?: string; sleep?: Sleep } = {}) {
  const where = opts.where ?? mirrorWhere();
  const sleep = opts.sleep ?? realSleep;
  const out: ApiInvoice[] = [];
  let pages = 0;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new PageLimitError(`More than ${MAX_PAGES * PAGE} ${resource === "Invoices" ? "invoices" : "credit notes"} since ${XERO_CONFIG.mirrorFrom} - the read stopped rather than leave some out.`);
    if (page > 1) await sleep(PAGE_PAUSE_MS);
    let r = await accountingGet<Record<string, ApiInvoice[]>>(f, token, tenant, `${resource}?page=${page}&pageSize=${PAGE}&where=${where}`);
    for (let tries = 1; !r.ok && r.status === 429 && tries < TRIES_429; tries++) {
      await sleep(Math.min(Math.max(r.retryAfter ?? 5, 1), 120) * 1000);
      r = await accountingGet<Record<string, ApiInvoice[]>>(f, token, tenant, `${resource}?page=${page}&pageSize=${PAGE}&where=${where}`);
    }
    if (!r.ok) throw new Error(r.error);
    const rows = r.data?.[resource] ?? [];
    out.push(...rows);
    pages = page;
    if (rows.length < PAGE) break;
  }
  console.log(`xero read: ${resource} ${pages} page${pages === 1 ? "" : "s"}`); // counts only - never data
  return out;
}

// When a read may start (CLM-002) - on the last ATTEMPT, not the last success, so a failing read can't be hammered.
// A page-limit stop means no more tries that day, even forced (the nightly).
let lastAttemptAt = 0;
let pageLimitDay: string | null = null;
export function refreshRefusal(x: { now: number; lastAttemptAt: number; lastSyncAt: number | null; force: boolean; pageLimitDay: string | null; today: string }): string | null {
  if (x.pageLimitDay === x.today) return "The Xero read stopped at its page limit today - it will try again tomorrow. Tell the office if it keeps happening.";
  if (x.force) return null;
  const last = Math.max(x.lastAttemptAt, x.lastSyncAt ?? 0);
  return last && x.now - last < REFRESH_EVERY_MIN * 60_000 ? `Xero was read less than ${REFRESH_EVERY_MIN} minutes ago - try again shortly.` : null;
}
export function nightlyDue(x: { now: number; lastAttemptAt: number; hour: number; lastSyncDay: string | null; today: string; pageLimitDay: string | null }) {
  return x.now - x.lastAttemptAt >= 60 * 60_000 && x.hour >= 2 && x.lastSyncDay !== x.today && x.pageLimitDay !== x.today;
}

export async function syncXero(by: { name: string; userId: string | null }, opts: { force?: boolean; f?: Fetch } = {}): Promise<{ ok: true; invoices: number; bills: number; pnlLines: number } | { ok: false; error: string; status: number }> {
  const s = xeroSetup();
  if (!s.ok) return { ok: false, error: s.reason, status: 400 };
  const c = await prisma.xeroConnection.findFirst({ where: { status: "ACTIVE" } });
  if (!c) return { ok: false, error: "Xero isn't connected.", status: 409 };
  const today = todaySydney();
  const refused = refreshRefusal({ now: Date.now(), lastAttemptAt, lastSyncAt: c.lastSyncAt?.getTime() ?? null, force: !!opts.force, pageLimitDay, today });
  if (refused) return { ok: false, error: refused, status: 429 };
  if (running) return { ok: false, error: "A Xero read is already running.", status: 409 };
  running = true;
  lastAttemptAt = Date.now();
  const f = opts.f ?? realFetch;
  try {
    const r = await withAccessToken(tokenDeps(s, f, c.id), async (token, tenant) => {
      // Sales from the fixed mirror start; bills over the shorter window (a cross-check only). One after another.
      const salesFrom = XERO_CONFIG.mirrorFrom, billsStart = billsFrom(today);
      const inv = [...await pullAll(f, token, tenant, "Invoices", { where: mirrorWhere(salesFrom, "ACCREC") }), ...await pullAll(f, token, tenant, "Invoices", { where: mirrorWhere(billsStart, "ACCPAY") })];
      const cn = [...await pullAll(f, token, tenant, "CreditNotes", { where: mirrorWhere(salesFrom, "ACCRECCREDIT") }), ...await pullAll(f, token, tenant, "CreditNotes", { where: mirrorWhere(billsStart, "ACCPAYCREDIT") })];
      const now = new Date(today.slice(0, 4) + "-" + today.slice(5, 7) + "-01T00:00:00Z");
      const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const pnl = await accountingGet<ApiReport>(f, token, tenant, `Reports/ProfitAndLoss?fromDate=${today.slice(0, 8)}01&toDate=${lastDay}&periods=11&timeframe=MONTH`);
      if (!pnl.ok) throw new Error(pnl.error);
      return { rows: [...inv, ...cn].map(apiInvoiceToRead).filter((x): x is NonNullable<typeof x> => x != null), pnl: readApiPnl(pnl.data) };
    });
    if (!r.ok) {
      // A re-authorise keeps the detailed reason markReauth wrote; a passing failure records its own.
      if (!r.reauth) await prisma.xeroConnection.update({ where: { id: c.id }, data: { lastError: r.error } });
      return { ok: false, error: r.error, status: r.reauth ? 409 : 502 };
    }
    const sales = r.value.rows.filter((x) => x.type === "SALE" || x.type === "SALE_CREDIT");
    const bills = r.value.rows.filter((x) => x.type === "BILL" || x.type === "BILL_CREDIT");
    const base = { source: "API", asAt: today, uploadedBy: `Xero (${by.name})`, byUserId: by.userId, originalName: `Xero: ${c.tenantName}` };
    const iImp = await prisma.xeroImport.create({ data: { ...base, kind: "INVOICES" } });
    await writeInvoices(iImp.id, sales);
    const bImp = await prisma.xeroImport.create({ data: { ...base, kind: "BILLS" } });
    await writeInvoices(bImp.id, bills);
    let pnlLines = 0;
    if (!("error" in r.value.pnl)) {
      const pImp = await prisma.xeroImport.create({ data: { ...base, kind: "PNL" } });
      await writePnl(pImp.id, r.value.pnl.lines, r.value.pnl.months);
      pnlLines = r.value.pnl.lines.length;
    }
    await prisma.xeroConnection.update({ where: { id: c.id }, data: { lastSyncAt: new Date(), lastError: null } });
    return { ok: true, invoices: sales.length, bills: bills.length, pnlLines };
  } catch (e) {
    if (e instanceof PageLimitError) pageLimitDay = today; // no more tries today (CLM-002)
    // Xero errors arrive already scrubbed; a database error could echo the values
    // being written (the encrypted token), so it's never shown or logged as is.
    const raw = e instanceof Error ? e.message : "";
    const error = !raw ? "The Xero read failed." : /prisma|invocation/i.test(raw) ? "A database problem stopped the Xero read." : scrub(raw);
    await prisma.xeroConnection.update({ where: { id: c.id }, data: { lastError: error.slice(0, 300) } }).catch(() => {});
    console.error("xero sync failed:", error); // already scrubbed - never a token
    return { ok: false, error, status: 502 };
  } finally {
    running = false;
  }
}

// From the instrumentation tick: once a day, after the 1:30am backup window
// (from 2am Sydney). Nothing at all while Xero isn't set up or connected.
// A failed night retries hourly - an hour after the last attempt of any kind (CLM-002), never every minute.
export async function nightlyXeroSync(now = new Date()) {
  if (!xeroSetup().ok) return null;
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(now));
  if (!nightlyDue({ now: now.getTime(), lastAttemptAt, hour, lastSyncDay: null, today: todaySydney(), pageLimitDay })) return null;
  const c = await prisma.xeroConnection.findFirst({ where: { status: "ACTIVE" } });
  if (!c) return null;
  const today = todaySydney();
  const lastDay = c.lastSyncAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(c.lastSyncAt) : null;
  if (!nightlyDue({ now: now.getTime(), lastAttemptAt, hour, lastSyncDay: lastDay, today, pageLimitDay })) return null;
  return syncXero({ name: "nightly", userId: null }, { force: true });
}

export { NOT_SET_UP };
