// The live read-only Xero connection (G3, 25 Oct 2026). Xero is MOCKED
// throughout - no test ever reaches Xero. Checks: OFF (no outbound call)
// until all three settings exist; read-only scopes only; the host allowlist;
// tokens encrypted at rest; PKCE and the signed state cookie; no token or
// secret in any error text; the new refresh token saved before use; and the
// API's invoices and P&L mapped like accounts' uploads. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { XERO_SCOPES, allowedHost, scrub, writeScopes, xeroSetup } from "./setup";
import { decryptToken, encryptToken, pkceChallenge, readState, signState } from "./secure";
import { authorizeUrl, refreshTokens, xeroCall, type Fetch } from "./client";
import { withAccessToken, type TokenDeps } from "./tokens";
import { apiInvoiceToRead, readApiPnl, type ApiReport } from "./api";
import { MAX_PAGES, finishConnect, mirrorWhere, nightlyXeroSync, pullAll, startConnect, syncXero } from "./service";
import { XERO_CONFIG } from "../config";

const KEY = randomBytes(32);
const ENV = { XERO_CLIENT_ID: "test-client-id", XERO_CLIENT_SECRET: "test-client-secret-abcdef", XERO_TOKEN_KEY: KEY.toString("base64") };
const setupOk = () => { const s = xeroSetup(ENV); if (!s.ok) throw new Error(s.reason); return s; };
const spyFetch = (reply: (url: string, body?: string) => { status: number; body: unknown }) => {
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
  const f: Fetch = async (url, init) => { calls.push({ url, method: init.method, body: init.body, headers: init.headers }); const r = reply(url, init.body); return { status: r.status, text: async () => JSON.stringify(r.body) }; };
  return { f, calls };
};
const owner = { id: "u-owner", email: "iliesa@loboscontracting.com.au", name: "Iliesa", role: "ADMIN" as const, directorAccess: true };

test("OFF until all three settings are there - and nothing at all goes out while OFF", async () => {
  for (const drop of ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_TOKEN_KEY"] as const) {
    const env = { ...ENV, [drop]: "" };
    const s = xeroSetup(env);
    assert.equal(s.ok, false, drop);
    if (!s.ok) assert.match(s.reason, /set up yet/);
  }
  const short = xeroSetup({ ...ENV, XERO_TOKEN_KEY: randomBytes(16).toString("base64") });
  assert.ok(!short.ok && short.missing.some((m) => /32 bytes/.test(m)));
  // The service with no settings in the environment: refused before any call.
  for (const k of Object.keys(ENV)) delete process.env[k];
  const { f, calls } = spyFetch(() => ({ status: 200, body: {} }));
  const sync = await syncXero({ name: "test", userId: null }, { force: true, f });
  assert.ok(!sync.ok && /set up yet/.test(sync.error));
  const fin = await finishConnect(owner, { code: "c", state: "s" }, undefined, "x".repeat(32), f);
  assert.ok(!fin.ok && /set up yet/.test(fin.error));
  const start = startConnect(owner, "x".repeat(32));
  assert.ok("error" in start && start.status === 400);
  assert.equal(await nightlyXeroSync(), null);
  assert.equal(calls.length, 0, "no outbound call while not set up");
});

test("read-only scopes only: any write scope refuses to start", () => {
  assert.deepEqual(writeScopes(XERO_SCOPES), []);
  assert.ok(XERO_SCOPES.includes("offline_access"));
  assert.deepEqual(writeScopes(["openid", "accounting.transactions", "accounting.invoices", "accounting.contacts.read"]), ["accounting.transactions", "accounting.invoices"]);
  const s = xeroSetup(ENV, [...XERO_SCOPES, "accounting.invoices"]);
  assert.ok(!s.ok && /could write/.test(s.reason));
});

test("the server may call only Xero's identity and API hosts, over https", async () => {
  for (const ok of ["https://identity.xero.com/connect/token", "https://api.xero.com/connections", "https://api.xero.com/api.xro/2.0/Invoices"]) assert.ok(allowedHost(ok), ok);
  for (const bad of ["http://api.xero.com/x", "https://api.xero.com.evil.com/x", "https://evil.com/api.xero.com", "https://api.xero.com:8443/x", "https://user:pw@api.xero.com/x", "https://login.xero.com/identity", "https://xero.com", "not a url"]) assert.ok(!allowedHost(bad), bad);
  const { f, calls } = spyFetch(() => ({ status: 200, body: {} }));
  const r = await xeroCall(f, "https://example.com/steal", { method: "GET" }, []);
  assert.ok(!r.ok && /Refused/.test(r.error));
  const w = await xeroCall(f, "https://api.xero.com/api.xro/2.0/Invoices", { method: "POST", body: "{}" }, []);
  assert.ok(!w.ok && /only reads/.test(w.error));
  assert.equal(calls.length, 0);
});

test("refresh token encrypted at rest: round trip, and tampering or the wrong key fails", () => {
  const enc = encryptToken("refresh-token-value-123", KEY);
  assert.ok(!enc.includes("refresh-token-value"));
  assert.equal(decryptToken(enc, KEY), "refresh-token-value-123");
  const b = Buffer.from(enc, "base64"); b[b.length - 1] ^= 1;
  assert.throws(() => decryptToken(b.toString("base64"), KEY));
  assert.throws(() => decryptToken(enc, randomBytes(32)));
  assert.notEqual(encryptToken("same", KEY), encryptToken("same", KEY)); // fresh IV each time
});

test("PKCE S256 (RFC 7636 example) and the signed ten-minute state cookie", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const secret = "s".repeat(32), now = 1_800_000_000_000;
  const c = signState({ state: "st", verifier: "v", uid: "u1" }, secret, now);
  assert.equal(readState(c, secret, now + 60_000)?.state, "st");
  assert.equal(readState(c, secret, now + 11 * 60_000), null, "expired");
  assert.equal(readState(c, "t".repeat(32), now), null, "wrong secret");
  assert.equal(readState(c.replace(/^./, (x) => (x === "e" ? "f" : "e")), secret, now), null, "altered");
  assert.equal(readState(undefined, secret, now), null);
});

test("the owner's browser is sent to Xero with read-only scopes, PKCE and state; the server fetches nothing for it", () => {
  const u = new URL(authorizeUrl(setupOk(), "STATE1", "CHALLENGE1"));
  assert.equal(u.hostname, "login.xero.com");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), "STATE1");
  assert.equal(u.searchParams.get("redirect_uri"), "https://ops.lobostools.com.mx/api/directors/xero/callback");
  assert.deepEqual(writeScopes(u.searchParams.get("scope")!.split(" ")), []);
});

test("no token, code or secret ever appears in an error", async () => {
  const s = setupOk();
  const leaky = spyFetch(() => ({ status: 400, body: { error: "invalid_request", refresh_token: "LEAKED-RT-999", access_token: "LEAKED-AT-999" } }));
  const r = await refreshTokens(leaky.f, s, "MY-REFRESH-TOKEN-777");
  assert.ok(!r.ok);
  const text = JSON.stringify(r);
  for (const secret of ["LEAKED-RT-999", "LEAKED-AT-999", "MY-REFRESH-TOKEN-777", s.clientSecret]) assert.ok(!text.includes(secret), secret);
  // the request itself carried the secret only in the Authorization header, never in the URL
  assert.ok(!leaky.calls[0].url.includes(s.clientSecret));
  const down: Fetch = async () => { throw new Error("connect ECONNREFUSED with Bearer abc.def.ghi"); };
  const d = await xeroCall(down, "https://api.xero.com/connections", { method: "GET" }, []);
  assert.ok(!d.ok && !/abc\.def\.ghi/.test(d.error));
  assert.equal(scrub('{"access_token":"xyz123456","client_secret":"shh123456"} Bearer tok.en.here'), '{"access_token":"[hidden]","client_secret":"[hidden]"} Bearer [hidden]');
});

const deps = (over: Partial<TokenDeps> = {}) => {
  const order: string[] = [];
  let saved = "";
  const d: TokenDeps = {
    key: KEY,
    load: async () => ({ tenantId: "t1", refreshTokenEnc: encryptToken("old-rt", KEY), status: "ACTIVE" }),
    saveRotated: async (enc) => { order.push("save"); saved = enc; },
    markReauth: async () => { order.push("reauth"); },
    refresh: async (rt) => { order.push(`refresh:${rt}`); return { ok: true, data: { access_token: "AT", refresh_token: "new-rt", expires_in: 1800 } }; },
    ...over,
  };
  return { d, order, saved: () => saved };
};

test("the new refresh token is saved (encrypted) before the access token is used", async () => {
  const x = deps();
  const r = await withAccessToken(x.d, async (at, tenant) => { x.order.push(`use:${at}:${tenant}`); return 1; });
  assert.ok(r.ok);
  assert.deepEqual(x.order, ["refresh:old-rt", "save", "use:AT:t1"]);
  assert.equal(decryptToken(x.saved(), KEY), "new-rt");
  const failSave = deps({ saveRotated: async () => { throw new Error("disk full"); } });
  let used = false;
  await assert.rejects(withAccessToken(failSave.d, async () => { used = true; }));
  assert.equal(used, false, "nothing is read if the new token couldn't be saved");
});

test("invalid_grant -> needs connecting again (Ilies alerted); a passing failure keeps the connection", async () => {
  const gone = deps({ refresh: async () => ({ ok: false, status: 400, error: "Xero said: invalid_grant", invalidGrant: true }) });
  const r = await withAccessToken(gone.d, async () => assert.fail("must not be used"));
  assert.ok(!r.ok && r.reauth);
  assert.ok(gone.order.includes("reauth"));
  const blip = deps({ refresh: async () => ({ ok: false, status: 503, error: "Xero said: HTTP 503" }) });
  const b = await withAccessToken(blip.d, async () => assert.fail("must not be used"));
  assert.ok(!b.ok && !b.reauth && !blip.order.includes("reauth"));
  const notActive = deps({ load: async () => ({ tenantId: "t", refreshTokenEnc: "x", status: "NEEDS_REAUTH" }) });
  assert.ok(!(await withAccessToken(notActive.d, async () => 1)).ok);
  assert.ok(!notActive.order.some((o) => o.startsWith("refresh")), "never refreshes a connection that isn't active");
  const unreadable = deps({ load: async () => ({ tenantId: "t", refreshTokenEnc: encryptToken("rt", randomBytes(32)), status: "ACTIVE" }) });
  const u = await withAccessToken(unreadable.d, async () => 1);
  assert.ok(!u.ok && u.reauth);
});

test("API invoices map like uploads: ex GST either way, credits, tracking, Xero ids", () => {
  const exc = apiInvoiceToRead({ InvoiceID: "id-1", Type: "ACCREC", InvoiceNumber: "INV-1", Reference: "26_312 Claim 2", Contact: { Name: "Builder" }, DateString: "2026-10-10T00:00:00", DueDateString: "2026-10-20T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive", SubTotal: 1500, TotalTax: 150, Total: 1650, AmountDue: 1650, AmountPaid: 0, LineItems: [{ Description: "A", LineAmount: 1000, TaxAmount: 100, Tracking: [{ Name: "Job", Option: "26_312" }] }, { Description: "B", LineAmount: 500, TaxAmount: 50 }] })!;
  assert.deepEqual([exc.type, exc.totalExGst, exc.date, exc.dueDate, exc.xeroId, exc.lines.map((l) => l.amountExGst), exc.lines[0].tracking1], ["SALE", 1500, "2026-10-10", "2026-10-20", "id-1", [1000, 500], "Job: 26_312"]);
  const inc = apiInvoiceToRead({ Type: "ACCREC", InvoiceNumber: "INV-2", DateString: "2026-09-01T00:00:00", LineAmountTypes: "Inclusive", SubTotal: 1000, TotalTax: 100, Total: 1100, LineItems: [{ LineAmount: 1100, TaxAmount: 100 }] })!;
  assert.deepEqual(inc.lines.map((l) => l.amountExGst), [1000]);
  const cn = apiInvoiceToRead({ CreditNoteID: "cn", Type: "ACCRECCREDIT", CreditNoteNumber: "CN-1", DateString: "2026-10-12T00:00:00", SubTotal: 200, TotalTax: 20, Total: 220, RemainingCredit: 0, LineItems: [] })!;
  assert.deepEqual([cn.type, cn.number, cn.amountDue, cn.lines[0].amountExGst], ["SALE_CREDIT", "CN-1", 0, 200]);
  assert.equal(apiInvoiceToRead({ Type: "ACCPAY", InvoiceNumber: "B1", DateString: "2026-10-01T00:00:00", Total: 110, TotalTax: 10 })!.type, "BILL");
  assert.equal(apiInvoiceToRead({ Type: "SOMETHING", InvoiceNumber: "X", DateString: "2026-10-01T00:00:00" }), null);
});

test("API Profit and Loss report reads like the exported one (Xero's sections and summary rows)", () => {
  const report: ApiReport = { Reports: [{ Rows: [
    { RowType: "Header", Cells: [{ Value: "" }, { Value: "31 Oct 26" }, { Value: "30 Sep 26" }] },
    { RowType: "Section", Title: "Income", Rows: [{ RowType: "Row", Cells: [{ Value: "Sales" }, { Value: "1000.00" }, { Value: "900.00" }] }, { RowType: "SummaryRow", Cells: [{ Value: "Total Income" }, { Value: "1000.00" }, { Value: "900.00" }] }] },
    { RowType: "Section", Title: "Less Operating Expenses", Rows: [{ RowType: "Row", Cells: [{ Value: "Rent" }, { Value: "100.00" }, { Value: "100.00" }] }] },
    { RowType: "Section", Title: "", Rows: [{ RowType: "Row", Cells: [{ Value: "Net Profit" }, { Value: "900.00" }, { Value: "-50.00" }] }] },
  ] }] };
  const r = readApiPnl(report);
  if ("error" in r) assert.fail(r.error);
  assert.deepEqual(r.months, ["2026-09", "2026-10"]);
  assert.equal(r.lines.find((l) => l.account === "Rent")!.section, "Less Operating Expenses");
  assert.equal(r.lines.find((l) => l.account === "Net Profit" && l.month === "2026-09")!.amount, -50);
  assert.equal(r.lines.find((l) => l.account === "Total Income")!.section, "Summary");
});

test("a connection needing re-authorising is a CRITICAL directors-only finding (Ilies's phone); nothing otherwise", async () => {
  const { xeroReauthSignal } = await import("../../findings/signals");
  const s = xeroReauthSignal({ status: "NEEDS_REAUTH", tenantName: "Lobos", lastError: "ended", lastSyncAt: null });
  assert.deepEqual([s.length, s[0].severity, s[0].audience, s[0].dedupeKey], [1, "CRITICAL", "DIRECTOR", "XERO_REAUTH:COMPANY:xero-connection"]);
  assert.deepEqual(xeroReauthSignal({ status: "ACTIVE", tenantName: "Lobos", lastError: null, lastSyncAt: null }), []);
  assert.deepEqual(xeroReauthSignal(null), []);
});

test("tiles from the live connection: live and confident when fresh, Stale and LOW after 36 hours", async () => {
  const { revenueSummary, revenueTile, cashTile } = await import("../summary");
  const s = revenueSummary([{ type: "SALE", status: "AUTHORISED", date: "2026-10-01", dueDate: "2026-12-01", totalExGst: 1000, amountDue: 1100, matchMethod: "TRACKING", lines: [{ amountExGst: 1000, projectId: "p", matchMethod: "TRACKING" }] }], "2026-10-25");
  const info = { asAt: "2026-10-25", uploadedBy: "Xero (nightly)", createdAt: "2026-10-25T00:00:00.000Z", source: "API" };
  const fresh = revenueTile({ info, s }, null, new Date("2026-10-25T05:00:00.000Z"))!;
  assert.deepEqual([fresh.statusWord, fresh.confidence, fresh.source, fresh.missing], ["Live from Xero", "HIGH", "Xero, read-only connection", null]);
  assert.equal(cashTile({ info, s }, new Date("2026-10-25T05:00:00.000Z"))!.confidence, "HIGH");
  const old = revenueTile({ info, s }, null, new Date("2026-10-27T00:00:00.000Z"))!;
  assert.match(old.statusWord, /^Stale - last read/);
  assert.deepEqual([old.status, old.confidence], ["WATCH", "LOW"]);
  const manual = revenueTile({ info: { ...info, source: "UPLOAD", uploadedBy: "Accounts" }, s }, null)!;
  assert.deepEqual([manual.statusWord, manual.confidence], ["Manual upload", "LOW"]);
});

test("stage 4: the read starts at the fixed mirror start (not a rolling 1 July), pages on, and stops loudly at MAX_PAGES", async () => {
  assert.equal(XERO_CONFIG.mirrorFrom, "2025-07-01");
  assert.equal(decodeURIComponent(mirrorWhere()), "Date>=DateTime(2025,07,01)");
  // Mocked Xero: two full pages then a short one - same endpoint, same host, the date in every filter.
  let page = 0;
  const { f, calls } = spyFetch(() => ({ status: 200, body: { Invoices: Array.from({ length: page++ < 2 ? 100 : 3 }, (_, i) => ({ InvoiceID: `inv-${page}-${i}` })) } }));
  const rows = await pullAll(f, "test-access-token", "test-tenant", "Invoices");
  assert.equal(rows.length, 203);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.ok(c.url.startsWith("https://api.xero.com/api.xro/2.0/Invoices?"), c.url);
    assert.ok(decodeURIComponent(c.url).includes("where=Date>=DateTime(2025,07,01)"), c.url);
    assert.equal(c.method, "GET");
  }
  // A read that would need more than MAX_PAGES stops with a plain error rather than leave invoices out.
  const always = spyFetch(() => ({ status: 200, body: { CreditNotes: Array.from({ length: 100 }, (_, i) => ({ CreditNoteID: `cn-${i}` })) } }));
  await assert.rejects(pullAll(always.f, "test-access-token", "test-tenant", "CreditNotes"), /the read stopped rather than leave some out/);
  assert.equal(always.calls.length, MAX_PAGES);
});

test("CLM-001: API lines keep their sign - a retention line comes off; inclusive lines with a negative line come out right", async () => {
  const { claimsByJob, linesOff } = await import("../../insights/claims");
  const exclusive = apiInvoiceToRead({ InvoiceID: "i1", Type: "ACCREC", InvoiceNumber: "INV-1", DateString: "2026-10-10T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Exclusive", SubTotal: 950, TotalTax: 95, Total: 1045,
    LineItems: [{ Description: "Claim 4", LineAmount: 1000, TaxAmount: 100 }, { Description: "Retention", LineAmount: -50, TaxAmount: -5 }] })!;
  assert.deepEqual([exclusive.totalExGst, exclusive.lines.map((l) => l.amountExGst)], [950, [1000, -50]]);
  const inclusive = apiInvoiceToRead({ InvoiceID: "i2", Type: "ACCREC", InvoiceNumber: "INV-2", DateString: "2026-10-11T00:00:00", Status: "AUTHORISED", LineAmountTypes: "Inclusive", SubTotal: 900, TotalTax: 90, Total: 990,
    LineItems: [{ Description: "Works", LineAmount: 1100, TaxAmount: 100 }, { Description: "Discount", LineAmount: -110, TaxAmount: -10 }] })!;
  assert.deepEqual([inclusive.totalExGst, inclusive.lines.map((l) => l.amountExGst)], [900, [1000, -100]]);
  const asClaim = (i: typeof exclusive, projectId: string) => ({ ...i, matchMethod: "TRACKING", lines: i.lines.map((l) => ({ amountExGst: l.amountExGst, projectId, matchMethod: "TRACKING" })) });
  const c = claimsByJob([asClaim(exclusive, "jobA"), asClaim(inclusive, "jobB")], "2026-10-30");
  assert.equal(c.byJob.get("jobA")?.claimed, 950, "+1000 / -50 retention, SubTotal 950 -> claimed 950");
  assert.equal(c.byJob.get("jobB")?.claimed, 900);
  assert.equal(linesOff([asClaim(exclusive, "jobA"), asClaim(inclusive, "jobB")], "2026-10-30").count, 0, "both add up to their totals");
});
