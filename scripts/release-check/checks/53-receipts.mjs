// Receipts (was rcptcheck.mjs + adcheck.mjs): a DRIVER link is receipts-only; a supervisor sends a tip docket (the
// asbestos tap is required, a spoofed price is ignored); no price or tonnes ever go back to the link; the office list;
// an office user adds a second docket from the same photo (no photo copied, duplicates refused).
// A tip docket for a site not running today (30 Oct 2026; SEC-001..004): only a listed site (not archived, a board day in
// -120..+30, not running today); it goes on the project with no job; the options carry id and label only; the 40-a-day
// cap holds on that path; a "$5" in a project name is taken out (never a 500); a second docket from its photo stays
// on the project with no job.
// WRITES: DRIVER links, tip dockets with a 1x1 photo, added dockets, one job on an archived project, 40 synthetic
// receipts for one link - all on the copy. A project name is changed for one step and put back.
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

    // ---- a tip docket for a site not running today (a bin picked up between stages) ----
    const dayAt = (n) => new Date(new Date(`${c.today}T00:00:00.000Z`).getTime() + n * 86_400_000);
    const tipFor = async (link, projectId) => {
      const p = await (await c.post(c.site(link, "/receipts/photos"), null, { dataUrl: JPEG })).json().catch(() => ({}));
      return c.post(c.site(link, "/receipts"), null, { kind: "TIP", photoIds: [p.id], projectId, asbestos: false });
    };
    const sites = opt?.options?.sites ?? [];
    t.ok(Array.isArray(sites) && sites.every((x) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify(["id", "label"])), "every other-site option carries only id and label", JSON.stringify(sites.slice(0, 2)));
    t.ok(sites.length <= 200, "at most 200 other sites", sites.length);
    // A project running today - pick today's job instead.
    const todayJob = await c.db.job.findUnique({ where: { id: jobId }, select: { projectId: true } });
    if (todayJob?.projectId) t.status(await tipFor(L.sup, todayJob.projectId), 400, "a project running today is refused on the site path (pick today's job)");
    // An archived project, even with a board day in range.
    const archived = await c.db.project.findFirst({ where: { archived: true }, select: { id: true, name: true } });
    if (archived) {
      await c.db.job.create({ data: { title: archived.name, projectId: archived.id, date: dayAt(5), shift: "DAY", startTime: "7am", endTime: "3pm" } });
      t.status(await tipFor(L.sup, archived.id), 400, "an archived project is refused");
    } else t.note("no archived project on the copy - archived case not run");
    // A project with no board day from -120 to +30 days.
    const idle = await c.db.project.findFirst({ where: { archived: false, jobs: { none: { date: { gte: dayAt(-120), lte: dayAt(30) } } } }, select: { id: true } });
    if (idle) t.status(await tipFor(L.sup, idle.id), 400, "a project with no board day in -120..+30 days is refused");
    else t.note("every active project has a board day in range - that case not run");
    // A listed site: saved on the project, no job.
    const site = sites[0];
    if (!site) { t.note("no other site on the copy - the site cases need one"); return; }
    const okSite = await tipFor(L.sup, site.id);
    t.status(okSite, 201, "a tip docket for a listed site not running today is sent");
    const siteRow = await c.db.receipt.findFirst({ where: { kind: "TIP", projectId: site.id, jobId: null }, orderBy: { sentAt: "desc" } });
    t.ok(siteRow && siteRow.jobId === null && siteRow.projectId === site.id, "...saved on that project with no job", JSON.stringify(siteRow ? { jobId: siteRow.jobId, projectId: siteRow.projectId } : null));
    // SEC-001: a second docket from its photo, no job picked -> the same project, no job.
    if (siteRow) {
      const add2 = await c.post(`/api/receipts/${siteRow.id}`, "MANAGER", { op: "ADD_DOCKET", fields: { ...F, jobId: "", docketNo: `RC-S-${Date.now() % 1000000}` } });
      const a2 = await add2.json().catch(() => ({}));
      const nw2 = a2.id ? await c.db.receipt.findUnique({ where: { id: a2.id } }) : null;
      t.ok([200, 201].includes(add2.status) && nw2 && nw2.jobId === null && nw2.projectId === site.id, "a second docket from a project-only docket stays on that project with no job", add2.status);
      const office2 = (await c.json("/api/receipts", "MANAGER")).body;
      const listed = JSON.stringify(office2 ?? {});
      t.ok(listed.includes("not on that day"), "the office list shows '<site> - not on that day'");
    }
    // The 41st receipt from one link in 24 hours - on the site path too.
    const capLink = await makeLink(c.db, "DRIVER", person.id);
    await c.db.receipt.createMany({ data: Array.from({ length: 40 }, () => ({ kind: "TIP", siteLinkId: capLink.id, sentBy: "release check", sentByResourceId: person.id, jobId: null, projectId: site.id, asbestos: false, status: "REJECTED" })) });
    t.status(await tipFor(capLink, site.id), 429, "the 41st receipt from one link in a day is refused (site path)");
    // SEC-002: a "$5" in a project name is taken out - the link's receipts screen still opens.
    const proj = await c.db.project.findUnique({ where: { id: site.id }, select: { name: true } });
    await c.db.project.update({ where: { id: site.id }, data: { name: "$5 Bins RC stage 2" } });
    try {
      const g = await c.json(c.site(L.sup, "/receipts"), null);
      t.status({ status: g.status }, 200, "a project named with '$5': the receipts screen still opens (200)");
      const body = JSON.stringify(g.body ?? {});
      t.ok(!/\$\s?\d/.test(body) && body.includes("Bins RC stage 2"), "...with the amount taken out of the label");
      const gd = await c.json(c.site(drv, "/receipts"), null);
      t.ok(gd.status === 200 && !/\$\s?\d/.test(JSON.stringify(gd.body ?? {})), "...and on a driver link", gd.status);
    } finally {
      await c.db.project.update({ where: { id: site.id }, data: { name: proj?.name ?? "Project" } });
    }
  },
};
