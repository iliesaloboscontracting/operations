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

// Everything from the fixed mirror start (stage 4, 30 Oct 2026) - no longer a rolling 1 July.
export function mirrorWhere(from: string = XERO_CONFIG.mirrorFrom) {
  const [y, m, d] = from.split("-");
  return encodeURIComponent(`Date>=DateTime(${Number(y)},${m},${d})`);
}

export async function pullAll(f: Fetch, token: string, tenant: string, resource: "Invoices" | "CreditNotes") {
  const where = mirrorWhere();
  const out: ApiInvoice[] = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`More than ${MAX_PAGES * PAGE} ${resource === "Invoices" ? "invoices" : "credit notes"} since ${XERO_CONFIG.mirrorFrom} - the read stopped rather than leave some out.`);
    const r = await accountingGet<Record<string, ApiInvoice[]>>(f, token, tenant, `${resource}?page=${page}&pageSize=${PAGE}&where=${where}`);
    if (!r.ok) throw new Error(r.error);
    const rows = r.data?.[resource] ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function syncXero(by: { name: string; userId: string | null }, opts: { force?: boolean; f?: Fetch } = {}): Promise<{ ok: true; invoices: number; bills: number; pnlLines: number } | { ok: false; error: string; status: number }> {
  const s = xeroSetup();
  if (!s.ok) return { ok: false, error: s.reason, status: 400 };
  const c = await prisma.xeroConnection.findFirst({ where: { status: "ACTIVE" } });
  if (!c) return { ok: false, error: "Xero isn't connected.", status: 409 };
  if (!opts.force && c.lastSyncAt && Date.now() - c.lastSyncAt.getTime() < REFRESH_EVERY_MIN * 60_000) return { ok: false, error: `Xero was read less than ${REFRESH_EVERY_MIN} minutes ago - try again shortly.`, status: 429 };
  if (running) return { ok: false, error: "A Xero read is already running.", status: 409 };
  running = true;
  const f = opts.f ?? realFetch;
  const today = todaySydney();
  try {
    const r = await withAccessToken(tokenDeps(s, f, c.id), async (token, tenant) => {
      const [inv, cn] = [await pullAll(f, token, tenant, "Invoices"), await pullAll(f, token, tenant, "CreditNotes")];
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
let lastNightlyAttempt = 0;
export async function nightlyXeroSync(now = new Date()) {
  if (!xeroSetup().ok) return null;
  if (now.getTime() - lastNightlyAttempt < 60 * 60_000) return null; // a failed night retries hourly, never every minute
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 2) return null;
  const c = await prisma.xeroConnection.findFirst({ where: { status: "ACTIVE" } });
  if (!c) return null;
  const today = todaySydney();
  const lastDay = c.lastSyncAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(c.lastSyncAt) : null;
  if (lastDay === today) return null;
  lastNightlyAttempt = now.getTime();
  return syncXero({ name: "nightly", userId: null }, { force: true });
}

export { NOT_SET_UP };
