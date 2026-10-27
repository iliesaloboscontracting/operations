// Receipts (was rcptcheck.mjs + adcheck.mjs): a DRIVER link is receipts-only; a supervisor sends a tip docket (the
// asbestos tap is required, a spoofed price is ignored); no price or tonnes ever go back to the link; the office list;
// an office user adds a second docket from the same photo (no photo copied, duplicates refused).
// WRITES: a DRIVER link, one tip docket with a 1x1 photo, one added docket - all synthetic.
import { makeLink } from "../lib/setup.mjs";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";

export default {
  id: "receipts", title: "Receipts: driver link receipts-only, tip docket rules, no price on links, add docket",
  writes: true,
  async run(t, c) {
    const L = c.links;
    if (!L.sup) return t.block(L.missing.join("; "));
    const person = await c.db.resource.findFirst({ where: { active: true, type: "PERSONNEL" }, select: { id: true } });
    if (!person) return t.block("no active resource for a driver link");
    const drv = await makeLink(c.db, "DRIVER", person.id);
    const home = (await c.json(c.site(drv), null)).body;
    t.ok(home?.kind === "DRIVER", "a driver link opens (receipts only)");
    for (const p of ["requests", "hire", "signin", "log", "todo"]) t.status(await c.get(c.site(drv, `/${p}`), null), [404, 405], `driver link refused on ${p}`);

    const opt = (await c.json(c.site(L.sup, "/receipts"), null)).body;
    t.ok(!!opt?.options, "supervisor receipt options load");
    const ph = await (await c.post(c.site(L.sup, "/receipts/photos"), null, { dataUrl: JPEG })).json().catch(() => ({}));
    t.ok(!!ph.id, "a photo uploads");
    const jobId = opt?.options?.jobs?.[0]?.id ?? opt?.options?.job?.id;
    if (!jobId) { t.note("the supervisor has no job today - the send / add-docket steps need one"); return t.block("no job on the supervisor's link today (data-dependent)"); }
    t.status(await c.post(c.site(L.sup, "/receipts"), null, { kind: "TIP", photoIds: [ph.id], jobId }), 400, "a tip is refused without the asbestos tap");
    const sent = await c.post(c.site(L.sup, "/receipts"), null, { kind: "TIP", photoIds: [ph.id], jobId, asbestos: false, priceExGst: 999 });
    t.status(sent, 201, "tip docket sent");
    const row = await c.db.receipt.findFirst({ where: { kind: "TIP", jobId }, orderBy: { sentAt: "desc" } });
    t.ok(row && row.priceExGst == null, "a spoofed price is ignored");
    if (!row) return;
    await c.db.receipt.update({ where: { id: row.id }, data: { priceExGst: 412.5, tonnes: 7.2 } });
    const mine = JSON.stringify((await c.json(c.site(L.sup, "/receipts"), null)).body);
    t.ok(!/412|7\.2|price|tonnes|\$/i.test(mine), "no price or tonnes on the link");
    const office = (await c.text("/api/receipts", "MANAGER")).text;
    t.ok(office.includes(row.id), "the office list shows it");
    t.status(await c.get("/receipts", "MANAGER"), 200, "Receipts page");
    t.status(await c.get("/api/receipts", null), 401, "office list refused when signed out");

    // A second docket from the same photo (office, Manager).
    const before = await c.db.receiptPhoto.count();
    const F = { jobId, tipSite: "Release Check Tip", docketNo: `RC-${Date.now() % 1000000}`, docketAt: `${c.today}T09:30`, wasteType: "Clean Heavies", tonnes: 2.5, rego: "RCTEST1", asbestos: false };
    const add = (fields) => c.post(`/api/receipts/${row.id}`, "MANAGER", { op: "ADD_DOCKET", fields });
    const r = await add(F); const rj = await r.json().catch(() => ({}));
    t.status(r.status, [200, 201], "a second docket is added from the photo");
    const nw = rj.id ? await c.db.receipt.findUnique({ where: { id: rj.id } }) : null;
    t.ok(nw?.status === "CONFIRMED" && nw?.projectId === row.projectId && nw?.photoFromReceiptId === row.id && nw?.sentBy === row.sentBy, "confirmed, same job, sharing the photo, same sender");
    t.ok((await c.db.receiptPhoto.count()) === before, "no photo copied");
    t.status(await add({ ...F, docketNo: F.docketNo.toLowerCase().replace("-", " ") }), 409, "the same docket again is refused");
    t.status(await add({ ...F, docketNo: F.docketNo + "X", tonnes: "" }), 400, "missing tonnes refused");
    t.ok(!/\$\s?\d/.test((await c.text(c.site(L.sup, "/receipts"), null)).text), "the supervisor link still has no $");
  },
};
