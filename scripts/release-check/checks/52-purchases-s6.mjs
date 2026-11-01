// Accounts stage 6 (was s6check.mjs): the purchase chain - asked on an OFFICE link, approved by a DIRECTOR (since
// 28 Oct 2026 straight to the approvers - accounts no longer check first), then ordered by accounts with an optional
// price. Since 2 Nov 2026 (Ilies): a request is a purchase or a hire, its description and its suppliers' quotes carry
// prices, the approver picks the quote to go with, and the OFFICE link's purchase screens are the ONE link place a
// dollar figure may reach - every other link kind and every other OFFICE-link screen stays money-free. Accounts' own
// amount still never reaches the link or a Manager. Assets screen access.
// WRITES synthetic purchase requests (with a quote file) to the copy.
import { noMoney } from "../lib/context.mjs";

const PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n% release check quote\n").toString("base64")}`;

export default {
  id: "purchases-s6", title: "Purchases & assets: quotes and prices, director pick, the link money exception, accounts' amount wall",
  writes: true,
  async run(t, c) {
    const L = c.links;
    if (!L.office || !L.sup) return t.block(L.missing.join("; "));
    const AMOUNT = 4321.98, WHAT = `Release check - 2 jackhammers ${Date.now() % 100000}`;
    const quotes = [
      { supplier: "RC Tools A", priceExGst: "1,180.00", details: "Two TE 1000s, delivery $60", file: { dataUrl: PDF, name: "quote-a.pdf" } },
      { supplier: "RC Tools B", priceExGst: 1095.5, details: "Pick-up only", linkUrl: "https://example.test/quote/b" },
    ];
    t.status(await c.post(c.site(L.office, "/purchases"), null, { what: WHAT, why: "Release check - quoted about $1,100 each", qty: "2", kind: "PURCHASE", quotes }), [200, 201],
      "an OFFICE-link request with prices in the description and two quotes (one with a PDF)");
    t.status(await c.post(c.site(L.office, "/purchases"), null, { what: "RC bad file", quotes: [{ supplier: "RC X", file: { dataUrl: `data:application/pdf;base64,${Buffer.from("MZ-not-a-pdf").toString("base64")}`, name: "x.pdf" } }] }), 400,
      "a quote file that isn't really a PDF is refused");
    t.status(await c.get(c.site(L.sup, "/purchases"), null), 404, "a supervisor link can't use purchases");
    t.status(await c.post(c.site(L.sup, "/purchases"), null, { what: "RC from a supervisor" }), 404, "nor raise one");

    const dirList = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    const drow = Object.values(dirList ?? {}).flat().find((r) => r?.what === WHAT);
    if (!t.ok(!!drow, "the request goes straight to the directors")) return;
    const id = drow.id;
    t.ok(drow.quotes?.length === 2 && drow.quotes.some((q) => q.priceExGst === 1180 && q.file) && drow.kind === "PURCHASE", "the directors see both quotes with their prices and the file");
    const fileQuote = drow.quotes.find((q) => q.file);
    const before = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    t.ok(!(before?.toOrder ?? []).some((r) => r.id === id), "accounts don't see it to order before it's approved");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "APPROVE" }), 400, "accounts can't approve");
    t.status(await c.post(`/api/directors/purchases/${id}`, "MANAGER", { action: "APPROVE" }), 403, "a Manager can't approve");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", version: drow.version }), 400, "two quotes: approving without picking one is refused");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", chosenQuoteId: "not-a-quote", version: drow.version }), 400, "a quote from elsewhere is refused");
    const pick = drow.quotes.find((q) => q.supplier === "RC Tools B");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", chosenQuoteId: pick.id, note: "ok up to $2,300", version: drow.version }), 200, "the director picks a quote and approves (a $ in the note is fine now)");
    const list = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    const row = (list?.toOrder ?? []).find((r) => r.id === id);
    if (!t.ok(!!row, "accounts see it approved, to order")) return;
    t.ok(row.chosenQuoteId === pick.id && row.chosenBy, "accounts see which quote to order from, and who chose it");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "MANAGER", { action: "ORDERED" }), 403, "a Manager can't mark it ordered");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "ORDERED", amountExGst: AMOUNT, note: "rc note", version: row.version }), 200, "accounts order it with their own amount");

    // The link: its own request with every price - never accounts' amount or note.
    const linkView = (await c.text(c.site(L.office, "/purchases"), null)).text;
    t.ok(linkView.includes(WHAT) && /1180|1,180/.test(linkView) && linkView.includes("$1,100"), "the OFFICE link shows its request with the quotes' prices and the description");
    t.ok(!linkView.includes(String(AMOUNT)) && !/amountExGst|accountsNote|rc note/.test(linkView), "the link never shows accounts' amount or note");
    t.ok(/ORDERED|Ordered/.test(linkView), "the link shows it ordered");
    if (fileQuote) {
      const f = await c.get(c.site(L.office, `/purchases/quotes/${fileQuote.id}/file`), null);
      t.ok(f.status === 200 && (f.headers.get("content-type") ?? "").includes("pdf") && /no-store/.test(f.headers.get("cache-control") ?? ""), "the OFFICE link opens its own quote file (not cached)", f.status);
      t.status(await c.get(c.site(L.sup, `/purchases/quotes/${fileQuote.id}/file`), null), 404, "a supervisor link can't open it");
      t.status(await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, "MANAGER"), 200, "a Manager opens it in-app");
      t.status(await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, "VIEWER"), 404, "a Viewer can't");
      t.status(await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, null), 401, "no login can't");
    }

    // The money exception is the OFFICE link's purchase screens only: every other screen of every link stays $-free.
    const other = [c.site(L.office), c.site(L.office, "/todo"), c.site(L.office, "/requests"), c.site(L.sup), c.site(L.sup, "/requests"), c.site(L.sup, "/hire"), c.site(L.sup, `/log?date=${c.today}`)];
    for (const pth of other) {
      const r = await c.text(pth, null);
      t.ok(noMoney(r.text), `no "$" + digit on ${pth.replace(/\/api\/site\/[^/]+/, "/api/site/<link>")} (${r.status})`);
    }

    // Managers see every request with its quotes (Ilies, 2 Nov 2026: "ALL requests, read-only") - not accounts' amount.
    const mgr = (await c.json("/api/purchases", "MANAGER")).body;
    const seen = (mgr?.others ?? []).find((r) => r.id === id);
    t.ok(seen && seen.quotes?.length === 2 && seen.canEdit === false, "a Manager sees the link's request, with its quotes, read-only");
    const mgrText = JSON.stringify(mgr ?? {});
    t.ok(!mgrText.includes(String(AMOUNT)) && !/amountExGst|accountsNote/.test(mgrText), "a Manager never sees accounts' amount or note");
    t.status(await c.post(`/api/purchases/${id}`, "MANAGER", { action: "ADD_QUOTE", quote: { supplier: "RC sneaky" } }), 404, "a Manager can't add a quote to someone else's request");
    const dirAfter = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    t.ok(JSON.stringify(dirAfter).includes(String(AMOUNT)), "the director sees the amount accounts added");

    // The requester never approves their own - the owner's request goes to the directors.
    const OWN = `RC owner's own - ${Date.now() % 100000}`;
    if (c.users.OWNER) {
      t.status(await c.post("/api/purchases", "OWNER", { what: OWN, kind: "HIRE", why: "3 days, $350/day", quotes: [{ supplier: "RC Hire Co", priceExGst: 1050 }] }), 201, "the owner raises a hire request in-app");
      const mine = ((await c.json("/api/purchases", "OWNER")).body?.requests ?? []).find((r) => r.what === OWN);
      if (t.ok(mine && mine.kind === "HIRE" && mine.canEdit, "it's on his own list as a hire request he can still change")) {
        t.status(await c.post(`/api/purchases/${mine.id}`, "OWNER", { action: "ADD_QUOTE", quote: { supplier: "RC Hire Two", priceExGst: "990" }, version: mine.version }), 200, "the requester adds another supplier");
        const again = ((await c.json("/api/purchases", "OWNER")).body?.requests ?? []).find((r) => r.id === mine.id);
        t.status(await c.post(`/api/purchases/${mine.id}`, "OWNER", { action: "EDIT", why: "4 days now, about $340/day", version: again?.version }), 200, "and edits the description");
        const dr = Object.values((await c.json("/api/directors/purchases", "OWNER")).body ?? {}).flat().find((r) => r?.id === mine.id);
        t.status(await c.post(`/api/directors/purchases/${mine.id}`, "OWNER", { action: "APPROVE", chosenQuoteId: dr?.quotes?.[0]?.id, version: dr?.version }), 403, "the owner can't approve his own request");
      }
    }

    t.status(await c.get("/api/accounts/assets", "ACCOUNTS"), 200, "assets as accounts");
    t.status(await c.get("/api/accounts/assets", "MANAGER"), 403, "assets as manager");
    for (const p of ["/accounts/assets", "/accounts/purchases"]) { const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p}`, r.status); }
    t.status(await c.get("/directors/purchases", "DIRECTOR"), 200, "page /directors/purchases as director");
    t.status(await c.get("/purchases", "MANAGER"), 200, "page /purchases as a Manager");
  },
};
