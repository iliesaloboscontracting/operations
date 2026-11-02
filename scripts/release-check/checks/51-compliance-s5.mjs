// Accounts stage 5, compliance (was s5check.mjs): access, an expired ticket shows on the board as label + date only,
// a reminder exists, a TFN is refused, nothing leaks to links or /api/resources. Since 2 Nov 2026 also the upload
// limits of compliance files and the invoices inbox (7 MB a file, 413 for a body too big to read).
// WRITES one synthetic ticket, its files and synthetic invoice-inbox uploads.
export default {
  id: "compliance-s5", title: "Compliance: access, board flag only, TFN refused, no leak, upload limits",
  writes: true, timeoutMs: 180_000,
  async run(t, c) {
    for (const p of ["/api/compliance/workers", "/api/compliance/documents"]) {
      t.status(await c.get(p, "ACCOUNTS"), 200, `${p} as accounts`);
      t.status(await c.get(p, "MANAGER"), 403, `${p} as manager`);
      t.status(await c.get(p, null), 401, `${p} no login`);
    }
    t.status(await c.get("/api/compliance/flags", "MANAGER"), 200, "board flags as Manager");
    t.status(await c.get("/api/compliance/flags", null), 401, "board flags no login");
    for (const p of ["/accounts/compliance", "/accounts"]) { const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p}`, r.status); }
    const workers = (await c.json("/api/compliance/workers", "ACCOUNTS")).body;
    const w = (workers?.workers ?? workers?.people ?? (Array.isArray(workers) ? workers : []))[0];
    if (!w) return t.block("no workers on the snapshot");
    const num = `RC-WC-${Date.now() % 100000}`;
    const made = await c.post("/api/compliance/tickets", "ACCOUNTS", { resourceId: w.id, kind: "WHITE_CARD", number: num, issueDate: "2020-01-01", expiryDate: "2026-01-01" });
    t.status(made, [200, 201], "a ticket with a past expiry is saved");
    const ticketId = (await made.json().catch(() => ({}))).id;

    // Upload limits (2 Nov 2026, Ilies: "yes queue those two"): 7 MB a file - the most one save carries under Next's
    // 10 MB body limit; one byte over is refused in plain words; a body too big to read is 413, never "No file was sent".
    const MB = 1024 * 1024, TOO_LARGE = "Too large (7 MB per file) - send big files one at a time.";
    const pdf = (n) => `data:application/pdf;base64,${Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(n - 4)]).toString("base64")}`;
    const errOf = async (r) => (await r.json().catch(() => ({}))).error ?? "";
    if (t.ok(!!ticketId, "the new ticket's id comes back")) {
      t.status(await c.post("/api/compliance/files", "ACCOUNTS", { ticketId, dataUrl: pdf(7 * MB), originalName: "rc-card.pdf" }), 201, "compliance: a 7 MB file (at the limit) is kept");
      const over = await c.post("/api/compliance/files", "ACCOUNTS", { ticketId, dataUrl: pdf(7 * MB + 1), originalName: "rc-card-over.pdf" });
      t.ok(over.status === 400 && (await errOf(over)) === TOO_LARGE, "compliance: one byte over 7 MB is refused, in plain words", over.status);
      const huge = await c.post("/api/compliance/files", "ACCOUNTS", { ticketId, dataUrl: pdf(8 * MB), originalName: "rc-card-huge.pdf" });
      t.ok(huge.status === 413 && (await errOf(huge)) === TOO_LARGE, "compliance: a body over 10 MB is 413 'Too large', not a validation message", huge.status);
    }
    // The invoices inbox (its upload screen was removed 28 Oct 2026; the API still takes files). No AI key on the copy,
    // so an accepted file is just stored and marked "not set up" - nothing goes out.
    t.status(await c.post("/api/invoice-inbox", "ACCOUNTS", { dataUrl: pdf(7 * MB), name: "rc-invoice.pdf" }), 201, "invoices inbox: a 7 MB file (at the limit) is taken");
    const invOver = await c.post("/api/invoice-inbox", "ACCOUNTS", { dataUrl: pdf(7 * MB + 1), name: "rc-invoice-over.pdf" });
    t.ok(invOver.status === 400 && (await errOf(invOver)) === TOO_LARGE, "invoices inbox: one byte over 7 MB is refused, in plain words", invOver.status);
    const invHuge = await c.post("/api/invoice-inbox", "ACCOUNTS", { dataUrl: pdf(8 * MB), name: "rc-invoice-huge.pdf" });
    t.ok(invHuge.status === 413 && (await errOf(invHuge)) === TOO_LARGE, "invoices inbox: a body over 10 MB is 413 'Too large', never 'No file was sent'", invHuge.status);
    // Xero export uploads (2 Nov 2026, Ilies "Yes, both"): the same 7 MB. A 7 MB .csv is taken (it isn't a real export,
    // so it's kept as a FAILED import with the reason - nothing is added); one byte over 400; a body over 10 MB 413.
    const csv = (n) => `data:text/csv;base64,${Buffer.alloc(n, 0x41).toString("base64")}`;
    const xero = (n, name) => c.post("/api/xero/imports", "ACCOUNTS", { dataUrl: csv(n), originalName: name, kind: "INVOICES", asAt: c.today });
    const xAt = await xero(7 * MB, "rc-export.csv");
    t.ok(xAt.status === 200 && ["DONE", "FAILED"].includes((await xAt.json().catch(() => ({}))).status), "Xero export: a 7 MB file (at the limit) is taken and read", xAt.status);
    const xOver = await xero(7 * MB + 1, "rc-export-over.csv");
    t.ok(xOver.status === 400 && (await errOf(xOver)) === TOO_LARGE, "Xero export: one byte over 7 MB is refused, in plain words", xOver.status);
    const xHuge = await xero(8 * MB, "rc-export-huge.csv");
    t.ok(xHuge.status === 413 && (await errOf(xHuge)) === TOO_LARGE, "Xero export: a body over 10 MB is 413 'Too large', not a 500", xHuge.status);
    const flags = (await c.text("/api/compliance/flags", "MANAGER")).text;
    t.ok(flags.includes(w.id) && !flags.includes(num), "the board flag shows for that worker, without the ticket number");
    const todo = (await c.text("/api/accounts/pending", "ACCOUNTS")).text + (await c.text("/api/accounts/items", "ACCOUNTS")).text;
    t.ok(/RC-WC-|White card|Ticket/i.test(todo), "a reminder exists on the accounts calendar / to-do");
    const tfn = await c.put(`/api/compliance/workers/${w.id}`, "ACCOUNTS", { address: "1 Test St", notes: "TFN 123 456 789" });
    t.status(tfn, 400, "a TFN in onboarding notes is refused");
    if (c.links.sup) t.ok(!new RegExp(`${num}|ticket|onboarding`, "i").test((await c.text(c.site(c.links.sup), null)).text), "nothing about tickets on the supervisor link");
    t.ok(!new RegExp(`${num}|dateOfBirth|onboarding`, "i").test((await c.text("/api/resources", "MANAGER")).text), "no ticket numbers / onboarding in /api/resources");
  },
};
