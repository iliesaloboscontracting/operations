// Accounts stage 6 (was s6check.mjs): the purchase chain - asked on an OFFICE link, approved by a DIRECTOR (since
// 28 Oct 2026 straight to the approvers - accounts no longer check first), then ordered by accounts with an optional
// price. Since 2 Nov 2026 (Ilies): a request is a purchase or a hire, its description and its suppliers' quotes carry
// prices, the approver picks the quote to go with, and the OFFICE link's purchase screens are the ONE link place a
// dollar figure may reach - every other link kind and every other OFFICE-link screen stays money-free. Accounts' own
// amount still never reaches the link or a Manager. Assets screen access.
// PQ-005 (security review, Ilies approved 2 Nov 2026): no silent passes; every other link kind and a shared OFFICE link
// refused on every purchase route; a second OFFICE link can't reach another's request or file; who opens a quote file
// in-app and its headers; no change after approval; no stale approval; the 30 MB budget; the change history (PQ-002).
// WRITES synthetic purchase requests (with quote files) and synthetic site links to the copy.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const pdf = (extra = 0) => `data:application/pdf;base64,${Buffer.concat([Buffer.from("%PDF-1.4\n% release check quote\n"), Buffer.alloc(Math.floor(extra))]).toString("base64")}`;
const PDF = pdf();
const MB = 1024 * 1024;
export const AMOUNT = 4321.98; // accounts' own amount - 63-coordinator checks it never reaches the coordinator

export default {
  id: "purchases-s6", title: "Purchases & assets: quotes and prices, director pick, the link money exception, accounts' amount wall",
  writes: true, timeoutMs: 300_000,
  async run(t, c) {
    const L = c.links;
    if (!L.office || !L.sup) return t.block(L.missing.join("; "));
    if (!c.users.OWNER) return t.block("no owner login on the copy - the requester-can't-approve and 30 MB checks need it");
    const job = await c.db.job.findFirst({ select: { id: true }, orderBy: { date: "desc" } });
    const other = await c.db.resource.findFirst({ where: { type: "PERSONNEL", active: true, id: { not: L.office.resourceId } }, select: { id: true } });
    if (!job || !other) return t.block("no job or no second person on the copy - the synthetic links can't be made");
    // Every other link kind, a shared OFFICE link (no person) and a second person's OFFICE link - synthetic, copy only.
    const refusedLinks = {
      SUPERVISOR: L.sup,
      HANDOVER: await makeLink(c.db, "HANDOVER", L.sup.resourceId, { jobId: job.id, expiresAt: new Date(Date.now() + 3600_000) }),
      DRIVER: await makeLink(c.db, "DRIVER", L.sup.resourceId),
      POSTER: await makeLink(c.db, "POSTER", null, { place: "YARD" }),
      "shared OFFICE": await makeLink(c.db, "OFFICE", null),
    };
    const office2 = await makeLink(c.db, "OFFICE", other.id);

    const WHAT = `Release check - 2 jackhammers ${Date.now() % 100000}`;
    const quotes = [
      { supplier: "RC Tools A", priceExGst: "1,180.00", details: "Two TE 1000s, delivery $60", file: { dataUrl: PDF, name: "quote-a.pdf" } },
      { supplier: "RC Tools B", priceExGst: 1095.5, details: "Pick-up only", linkUrl: "https://example.test/quote/b" },
    ];
    t.status(await c.post(c.site(L.office, "/purchases"), null, { what: WHAT, why: "Release check - quoted about $1,100 each", qty: "2", kind: "PURCHASE", quotes }), [200, 201],
      "an OFFICE-link request with prices in the description and two quotes (one with a PDF)");
    t.status(await c.post(c.site(L.office, "/purchases"), null, { what: "RC bad file", quotes: [{ supplier: "RC X", file: { dataUrl: `data:application/pdf;base64,${Buffer.from("MZ-not-a-pdf").toString("base64")}`, name: "x.pdf" } }] }), 400,
      "a quote file that isn't really a PDF is refused");

    const dirList = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    const drow = Object.values(dirList ?? {}).flat().find((r) => r?.what === WHAT);
    if (!t.ok(!!drow, "the request goes straight to the directors")) return;
    const id = drow.id;
    t.ok(drow.quotes?.length === 2 && drow.quotes.some((q) => q.priceExGst === 1180 && q.file) && drow.kind === "PURCHASE", "the directors see both quotes with their prices and the file");
    const fileQuote = drow.quotes?.find((q) => q.file);
    if (!t.ok(!!fileQuote, "the quote with the PDF is there")) return;
    const fileOf = (link) => c.site(link, `/purchases/quotes/${fileQuote.id}/file`);

    // Every other link kind and the shared OFFICE link: 404 on the list, a request and a file.
    for (const [kind, link] of Object.entries(refusedLinks)) {
      t.status(await c.get(c.site(link, "/purchases"), null), 404, `a ${kind} link: the purchases list`);
      t.status(await c.post(c.site(link, "/purchases"), null, { what: "RC from the wrong link" }), 404, `a ${kind} link: raising one`);
      t.status(await c.post(c.site(link, `/purchases/${id}`), null, { action: "CANCEL" }), 404, `a ${kind} link: acting on a request`);
      t.status(await c.get(fileOf(link), null), 404, `a ${kind} link: a quote file`);
    }
    // A second person's OFFICE link: its own (empty) list, never another link's request or file (IDOR).
    const o2 = await c.text(c.site(office2, "/purchases"), null);
    t.ok(o2.status === 200 && !o2.text.includes(WHAT), "a second OFFICE link sees its own list, not the first link's request", o2.status);
    for (const body of [{ action: "CANCEL" }, { action: "EDIT", why: "rc" }, { action: "ADD_QUOTE", quote: { supplier: "RC sneaky" } }])
      t.status(await c.post(c.site(office2, `/purchases/${id}`), null, body), 404, `a second OFFICE link can't ${body.action} another link's request`);
    t.status(await c.get(fileOf(office2), null), 404, "a second OFFICE link can't open another link's quote file");

    // The first link's own file, and who opens it in-app - with its headers.
    const f = await c.get(fileOf(L.office), null);
    const hdr = (r, h) => r.headers.get(h) ?? "";
    t.ok(f.status === 200 && hdr(f, "content-type").includes("pdf") && /no-store/.test(hdr(f, "cache-control")), "the OFFICE link opens its own quote file (not cached)", f.status);
    t.ok(hdr(f, "x-content-type-options") === "nosniff" && /^inline; filename="[\w .-]+"$/.test(hdr(f, "content-disposition")), "the file reply: nosniff and a clean Content-Disposition", `${hdr(f, "x-content-type-options")} | ${hdr(f, "content-disposition")}`);
    for (const who of ["MANAGER", "ADMIN_PLAIN", "ACCOUNTS", "DIRECTOR", "COORDINATOR"]) {
      const r = await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, who);
      t.ok(r.status === 200 && hdr(r, "x-content-type-options") === "nosniff" && /^inline; filename=/.test(hdr(r, "content-disposition")), `${who} opens it in-app (nosniff, inline)`, r.status);
    }
    t.status(await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, "VIEWER"), 404, "a Viewer can't");
    t.status(await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, "TIMESHEETS"), 404, "a Timesheets login can't");
    t.status(await c.get(`/api/purchases/quotes/${fileQuote.id}/file`, null), 401, "no login can't");

    // PQ-003: no stale approval. The director loaded version v; the requester then changes a quote; v is now stale.
    const before = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    t.ok(!(before?.toOrder ?? []).some((r) => r.id === id), "accounts don't see it to order before it's approved");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "APPROVE" }), 400, "accounts can't approve");
    t.status(await c.post(`/api/directors/purchases/${id}`, "MANAGER", { action: "APPROVE" }), 403, "a Manager can't approve");
    const pick = drow.quotes.find((q) => q.supplier === "RC Tools B");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", chosenQuoteId: pick.id }), 400, "PQ-003: approving without the version is refused");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "DECLINE", note: "rc decline" }), 400, "PQ-003: declining without the version is refused");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "ASK_INFO", question: "rc question" }), 400, "PQ-003: asking without the version is refused");
    const linkRow = ((await c.json(c.site(L.office, "/purchases"), null)).body?.requests ?? []).find((r) => r.id === id);
    t.status(await c.post(c.site(L.office, `/purchases/${id}`), null, { action: "EDIT_QUOTE", quoteId: fileQuote.id, quote: { priceExGst: "1,150", file: { dataUrl: PDF, name: "quote-a2.pdf" } }, version: linkRow?.version }), 200,
      "the requester changes a quote's price and file on their link");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", chosenQuoteId: pick.id, version: drow.version }), 409, "PQ-003: approving the version seen before that change is refused (stale)");
    const fresh = Object.values((await c.json("/api/directors/purchases", "DIRECTOR")).body ?? {}).flat().find((r) => r?.id === id);
    const changed = (fresh?.events ?? []).find((e) => e.action === "EDIT_QUOTE");
    const stored = String.raw`\d+-[0-9a-f]{16}\.pdf`;
    t.ok(changed && /price \$1,180\.00 -> \$1,150\.00/.test(changed.note ?? "") && new RegExp(`file quote-a\\.pdf \\(${stored}\\) -> quote-a2\\.pdf \\(${stored}\\)`).test(changed.note ?? ""),
      "PQ-002 / PQ-010: the history says what changed, before -> after - the file by its original and stored names", changed?.note);
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", version: fresh?.version }), 400, "two quotes: approving without picking one is refused");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", chosenQuoteId: "not-a-quote", version: fresh?.version }), 400, "a quote from elsewhere is refused");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", chosenQuoteId: pick.id, note: "ok up to $2,300", version: fresh?.version }), 200, "the director picks a quote and approves (a $ in the note is fine now)");

    // Nothing changes once it's approved.
    const afterRow = ((await c.json(c.site(L.office, "/purchases"), null)).body?.requests ?? []).find((r) => r.id === id);
    t.status(await c.post(c.site(L.office, `/purchases/${id}`), null, { action: "EDIT", why: "rc after approval", version: afterRow?.version }), 409, "after approval: the description can't change");
    t.status(await c.post(c.site(L.office, `/purchases/${id}`), null, { action: "ADD_QUOTE", quote: { supplier: "RC late" }, version: afterRow?.version }), 409, "after approval: no more quotes");

    const list = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    const row = (list?.toOrder ?? []).find((r) => r.id === id);
    if (!t.ok(!!row, "accounts see it approved, to order")) return;
    t.ok(row.chosenQuoteId === pick.id && row.chosenBy, "accounts see which quote to order from, and who chose it");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "MANAGER", { action: "ORDERED" }), 403, "a Manager can't mark it ordered");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "ORDERED", amountExGst: AMOUNT, note: "rc note", version: row.version }), 200, "accounts order it with their own amount");

    // The link: its own request with every price - never accounts' amount or note.
    const linkView = (await c.text(c.site(L.office, "/purchases"), null)).text;
    t.ok(linkView.includes(WHAT) && /1150|1,150/.test(linkView) && linkView.includes("$1,100"), "the OFFICE link shows its request with the quotes' prices and the description");
    t.ok(!linkView.includes(String(AMOUNT)) && !/amountExGst|accountsNote|rc note/.test(linkView), "the link never shows accounts' amount or note");
    t.ok(/ORDERED|Ordered/.test(linkView), "the link shows it ordered");

    // The money exception is the OFFICE link's purchase screens only: every other screen of every link stays $-free.
    const screens = [c.site(L.office), c.site(L.office, "/todo"), c.site(L.office, "/requests"), c.site(L.sup), c.site(L.sup, "/requests"), c.site(L.sup, "/hire"), c.site(L.sup, `/log?date=${c.today}`),
      ...Object.values(refusedLinks).map((l) => c.site(l)), c.site(office2), c.site(office2, "/todo")];
    for (const pth of screens) {
      const r = await c.text(pth, null);
      t.ok(noMoney(r.text), `no "$" + digit on ${pth.replace(/\/api\/site\/[^/]+/, "/api/site/<link>")} (${r.status})`);
    }

    // Managers see every request with its quotes (Ilies, 2 Nov 2026: "ALL requests, read-only") - not accounts' amount.
    const mgr = (await c.json("/api/purchases", "MANAGER")).body;
    t.ok(Array.isArray(mgr?.others), "a Manager's list has everyone else's requests");
    const seen = (mgr?.others ?? []).find((r) => r.id === id);
    t.ok(seen && seen.quotes?.length === 2 && seen.canEdit === false, "a Manager sees the link's request, with its quotes, read-only");
    const mgrText = JSON.stringify(mgr ?? {});
    t.ok(!mgrText.includes(String(AMOUNT)) && !/amountExGst|accountsNote/.test(mgrText), "a Manager never sees accounts' amount or note");
    t.status(await c.post(`/api/purchases/${id}`, "MANAGER", { action: "ADD_QUOTE", quote: { supplier: "RC sneaky" } }), 404, "a Manager can't add a quote to someone else's request");
    const dirAfter = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    t.ok(JSON.stringify(dirAfter).includes(String(AMOUNT)), "the director sees the amount accounts added");

    // The requester never approves their own - the owner's request goes to the directors.
    const OWN = `RC owner's own - ${Date.now() % 100000}`;
    t.status(await c.post("/api/purchases", "OWNER", { what: OWN, kind: "HIRE", why: "3 days, $350/day", quotes: [{ supplier: "RC Hire Co", priceExGst: 1050 }] }), 201, "the owner raises a hire request in-app");
    const mine = ((await c.json("/api/purchases", "OWNER")).body?.requests ?? []).find((r) => r.what === OWN);
    if (!t.ok(mine && mine.kind === "HIRE" && mine.canEdit, "it's on his own list as a hire request he can still change")) return;
    t.status(await c.post(`/api/purchases/${mine.id}`, "OWNER", { action: "ADD_QUOTE", quote: { supplier: "RC Hire Two", priceExGst: "990" }, version: mine.version }), 200, "the requester adds another supplier");
    const again = ((await c.json("/api/purchases", "OWNER")).body?.requests ?? []).find((r) => r.id === mine.id);
    t.status(await c.post(`/api/purchases/${mine.id}`, "OWNER", { action: "EDIT", why: "4 days now, about $340/day", version: again?.version }), 200, "and edits the description");
    const dr = Object.values((await c.json("/api/directors/purchases", "OWNER")).body ?? {}).flat().find((r) => r?.id === mine.id);
    t.status(await c.post(`/api/directors/purchases/${mine.id}`, "OWNER", { action: "APPROVE", chosenQuoteId: dr?.quotes?.[0]?.id, version: dr?.version }), 403, "the owner can't approve his own request");

    // PQ-001 + option A (Ilies, 2 Nov 2026: 7 MB a file): one save carries one file of up to 7 MB (Next cuts a body to
    // 10 MB); the request's 30 MB lifetime budget is reached a file at a time - four 7 MB files fit, the fifth doesn't,
    // and a replacement counts too. A body too big to read is 413 with plain words.
    const SEVEN = 7 * MB - 64; // a 7 MB file, the header included
    const BIG = `RC big quotes - ${Date.now() % 100000}`;
    t.status(await c.post("/api/purchases", "OWNER", { what: BIG, kind: "HIRE" }), 201, "a request to take big quote files");
    const bigRow = ((await c.json("/api/purchases", "OWNER")).body?.requests ?? []).find((r) => r.what === BIG);
    if (!t.ok(!!bigRow, "the big request is listed")) return;
    for (const n of [1, 2, 3, 4]) {
      const r = await c.post(`/api/purchases/${bigRow.id}`, "OWNER", { action: "ADD_QUOTE", quote: { supplier: `RC Big ${n}`, file: { dataUrl: pdf(SEVEN), name: `big-${n}.pdf` } } });
      t.status(r, 200, `a 7 MB quote file (${n} of 4) fits - one per save`);
    }
    const fifth = await c.post(`/api/purchases/${bigRow.id}`, "OWNER", { action: "ADD_QUOTE", quote: { supplier: "RC Big 5", file: { dataUrl: pdf(SEVEN), name: "big-5.pdf" } } });
    t.ok(fifth.status === 400 && /too large/i.test(await fifth.text()), "PQ-001: the fifth 7 MB file goes over 30 MB - refused, 'too large'", fifth.status);
    const firstBig = (await c.db.purchaseQuote.findFirst({ where: { requestId: bigRow.id }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
    t.status(await c.post(`/api/purchases/${bigRow.id}`, "OWNER", { action: "EDIT_QUOTE", quoteId: firstBig, quote: { file: { dataUrl: pdf(2.5 * MB), name: "big-1b.pdf" } } }), 400,
      "PQ-001: replacing a file counts the old one too - 28 + 2.5 MB is refused");
    const overOne = await c.post(`/api/purchases/${bigRow.id}`, "OWNER", { action: "ADD_QUOTE", quote: { supplier: "RC Over", file: { dataUrl: pdf(7 * MB + 1024), name: "over.pdf" } } });
    t.ok(overOne.status === 400 && /up to 7 MB/.test(await overOne.text()), "a single file over 7 MB is refused, in plain words", overOne.status);
    t.ok((await c.db.purchaseQuote.count({ where: { requestId: bigRow.id } })) === 4, "only the four that fit were added");
    const unreadable = await c.post(`/api/purchases/${bigRow.id}`, "OWNER", { action: "ADD_QUOTE", quote: { supplier: "RC Huge", file: { dataUrl: pdf(8 * MB), name: "huge.pdf" } } });
    const ut = await unreadable.text();
    t.ok(unreadable.status === 413 && /^\{"error":"Too large: send big quote files one at a time with Add another supplier \(7 MB each\)/.test(ut) && !/Say what you need/.test(ut),
      "a body over Next's 10 MB limit is 413 'Too large' - never 'Say what you need'", `${unreadable.status} ${ut.slice(0, 80)}`);
    const linkHuge = await c.post(c.site(L.office, "/purchases"), null, { what: "RC huge from the link", quotes: [{ supplier: "RC Huge", file: { dataUrl: pdf(8 * MB), name: "huge.pdf" } }] });
    t.status(linkHuge, 413, "the same 413 on the OFFICE link");

    t.status(await c.get("/api/accounts/assets", "ACCOUNTS"), 200, "assets as accounts");
    t.status(await c.get("/api/accounts/assets", "MANAGER"), 403, "assets as manager");
    for (const p of ["/accounts/assets", "/accounts/purchases"]) { const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p}`, r.status); }
    t.status(await c.get("/directors/purchases", "DIRECTOR"), 200, "page /directors/purchases as director");
    t.status(await c.get("/purchases", "MANAGER"), 200, "page /purchases as a Manager");
  },
};
