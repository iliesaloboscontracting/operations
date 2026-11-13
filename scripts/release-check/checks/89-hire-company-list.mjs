// The labour hire sign-in company list (Ilies, 13 Nov 2026: "lets only put a list for when the guys are asked.. Advanced
// labour hire shows only.. with the potential to add more if we find another labour hire company"; answers: a list plus
// "Other - subcontractor" that types the name and is marked for the office; Managers + Admins add companies; deploy once
// it passes). Checks: a scanned sign-in QR lists Advanced Labour Hire first (names only); only Managers / Admins add or
// take off a company; refusals (already listed, Lobos, an amount, no reason); history on every change; nothing deleted;
// the Labour hire timesheet marks a company typed under "Other" as not listed, and follows the list as it changes.
// WRITES on the test copy: an office sign-in point, two hire sign-ins in the week of Mon 1 Jun 2020, list companies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const WEEK = "2020-06-01";
const API = "/api/timesheets/labour-hire";
const LIST = `${API}/aliases`;

export default {
  id: "hire-company-list", title: "Labour hire sign-in company list: Advanced built in, Other typed, office adds / takes off",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/labourHire/rules.ts") && c.hasPath("prisma/schema.prisma") || "needs lib/labourHire",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    if (!db.labourHireCompany) return t.block("the copy's Prisma client has no LabourHireCompany (schema not pushed)");
    if (await db.siteAttendance.count({ where: { date: { gte: WEEK, lte: "2020-06-07" }, resourceId: null } }))
      return t.block(`the copy already holds hire sign-ins in the week of ${WEEK}`);

    // (1) A scanned sign-in QR carries the list - Advanced Labour Hire first, company names only.
    const point = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const scan = () => c.json(`/api/site/in/${encodeURIComponent(point.secret)}`, null);
    const s1 = await scan();
    t.ok(s1.status === 200 && Array.isArray(s1.body?.hireCompanies) && s1.body.hireCompanies[0] === "Advanced Labour Hire", "a scanned QR lists Advanced Labour Hire first", JSON.stringify(s1.body?.hireCompanies));
    t.ok((s1.body?.hireCompanies ?? []).every((x) => typeof x === "string") && noMoney(JSON.stringify(s1.body ?? {})), "the list is names only (no ids, no amounts)");

    // (2) Who may change the list.
    const name = `RC Listco${tag} Pty Ltd`;
    for (const who of ["COORDINATOR", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"])
      t.status(await c.post(LIST, who, { action: "list-add", name }), 403, `adding a company refused for ${who}`);
    t.status(await c.post(LIST, null, { action: "list-add", name }), 401, "adding a company refused with no login");

    // (3) Refusals.
    t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: "advanced labour hire pty ltd" }), 409, "Advanced Labour Hire (any spelling) is already on the list");
    t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: "Lobos Hire" }), 400, "Lobos is refused - staff pick their own name");
    t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: "Co $500" }), 400, "an amount in the name is refused");
    t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: "x" }), 400, "a one-letter name is refused");

    // (4) A Manager adds one: on the scan, with history; adding it twice is refused.
    const add = await c.post(LIST, "MANAGER", { action: "list-add", name });
    t.status(add, 200, "a Manager adds a company");
    const row = await db.labourHireCompany.findFirst({ where: { name } });
    t.ok(!!row && !row.retiredAt, "the company is stored, on");
    const s2 = await scan();
    t.ok((s2.body?.hireCompanies ?? []).includes(name) && s2.body.hireCompanies[0] === "Advanced Labour Hire", "the scan now lists it after Advanced", JSON.stringify(s2.body?.hireCompanies));
    t.status(await c.post(LIST, "ADMIN", { action: "list-add", name }), 409, "adding the same company again is refused");
    const hist = () => db.recordChange.findMany({ where: { model: "LabourHireCompany", recordId: row?.id ?? "-" }, orderBy: { changedAt: "asc" } });
    t.ok((await hist()).length >= 1, "adding it is in the change history");

    // (5) The timesheet: a company on the list vs one typed under Other.
    const att = (workerName, company, date) => db.siteAttendance.create({ data: {
      jobId: null, place: "OFFICE", placeLabel: "Office", date, resourceId: null, workerName, company, allocated: true, status: "CONFIRMED", signInMethod: "POINT",
      signInAt: new Date(`${date}T21:00:00.000Z`), signOutAt: new Date(`${date}T23:00:00.000Z`), signOutMethod: "POINT",
    } });
    await att(`RC Lister ${tag}`, `rc listco${tag}`, "2020-06-02");
    await att(`RC Subbie ${tag}`, `RC Subbieco${tag}`, "2020-06-03");
    const lkey = `rc listco${tag}`, skey = `rc subbieco${tag}`;
    const week = async () => (await c.json(`${API}?week=${WEEK}&company=all`, "MANAGER")).body;
    const w1 = await week();
    t.ok(w1?.companies?.find((x) => x.key === lkey)?.listed === true, "a company on the list is marked listed", JSON.stringify(w1?.companies?.map((x) => [x.key, x.listed])));
    t.ok(w1?.companies?.find((x) => x.key === lkey)?.name === name, "...and shown by its listed name");
    t.ok(w1?.companies?.find((x) => x.key === skey)?.listed === false, "a company typed under Other is marked not listed");
    t.ok((w1?.signInList ?? []).some((x) => x.builtIn && x.name === "Advanced Labour Hire") && (w1?.signInList ?? []).some((x) => x.id === row?.id), "the page gets the list (built-in and the office's)");
    const co = (await c.json(`${API}?week=${WEEK}`, "COORDINATOR")).body;
    t.ok(Array.isArray(co?.signInList) && co?.canMap === false, "the coordinator sees the list but can't change it");

    // (6) Taking it off: a reason is needed; kept, not deleted; off the scan; its lines then show not listed.
    t.status(await c.post(LIST, "MANAGER", { action: "list-retire", id: row?.id, reason: "" }), 400, "taking a company off needs a reason");
    t.status(await c.post(LIST, "COORDINATOR", { action: "list-retire", id: row?.id, reason: "no longer used" }), 403, "the coordinator can't take one off");
    t.status(await c.post(LIST, "MANAGER", { action: "list-retire", id: row?.id, reason: "no longer used" }), 200, "a Manager takes it off with a reason");
    const after = await db.labourHireCompany.findUnique({ where: { id: row?.id ?? "-" } });
    t.ok(!!after?.retiredAt && after?.retireReason === "no longer used", "the row is kept, switched off, with the reason");
    t.ok(!((await scan()).body?.hireCompanies ?? []).includes(name), "it is off the scanned list");
    t.ok((await week())?.companies?.find((x) => x.key === lkey)?.listed === false, "its lines now show not listed");
    t.status(await c.post(LIST, "ADMIN", { action: "list-add", name }), 200, "an Admin puts it back");
    t.ok(((await scan()).body?.hireCompanies ?? []).includes(name) && (await db.labourHireCompany.count({ where: { key: row?.key ?? "-" } })) === 1, "back on the list, the same row");
    t.ok((await hist()).length >= 3, "add, take off and put back are all in the history", (await hist()).length);

    // (6b) PS-069: hidden characters stripped; a name with no real letters or digits, or the Other choice, is refused.
    const ZW = String.fromCharCode(0x200b), BEL = String.fromCharCode(7);
    const zwName = `RC Zero width${tag} Co`;
    t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: `RC Zero${ZW}width${tag}${BEL} Co` }), 200, "a name with hidden characters is taken...");
    const zwRow = await db.labourHireCompany.findFirst({ where: { name: zwName } });
    t.ok(!!zwRow && !zwRow.name.includes(ZW) && !zwRow.name.includes(BEL), "...and stored without them", JSON.stringify(zwRow?.name));
    const OTHER_NAME = "Other – subcontractor / another company";
    for (const bad of ["--", " . ", ZW + ZW + ZW, BEL + BEL, `a${ZW}`, `-${ZW}-`, OTHER_NAME, "other subcontractor another company"])
      t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: bad }), 400, `refused: ${JSON.stringify(bad)}`);
    t.status(await c.post(LIST, "MANAGER", { action: "list-retire", id: zwRow?.id, reason: "test - off before filling" }), 200, "the hidden-character one is taken off again");

    // (6c) PS-068: the sign-in list stops at 25 companies (built-in ones included); taking one off makes room.
    const room = 25 - ((await scan()).body?.hireCompanies ?? []).length;
    const filler = [];
    for (let i = 0; i < room; i++) {
      const n = `RC Fill${tag} ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
      const r = await c.post(LIST, "MANAGER", { action: "list-add", name: n });
      if (r.status !== 200) { t.ok(false, `filling the list: ${n} -> ${r.status}`); break; }
      filler.push(n);
    }
    t.ok(((await scan()).body?.hireCompanies ?? []).length === 25, "the list fills to 25", room);
    const over = await c.post(LIST, "MANAGER", { action: "list-add", name: `RC Overflow${tag} Pty` });
    t.status(over, 409, "a 26th company is refused");
    const overBody = await over.json().catch(() => ({}));
    t.ok(/full \(25\)/.test(JSON.stringify(overBody)), "...saying the list is full", JSON.stringify(overBody));
    t.status(await c.post(LIST, "ADMIN", { action: "list-add", name: zwName }), 409, "putting a switched-off company back is refused too while the list is full");
    const firstFill = await db.labourHireCompany.findFirst({ where: { name: filler[0] ?? "-" } });
    t.status(await c.post(LIST, "MANAGER", { action: "list-retire", id: firstFill?.id, reason: "make room" }), 200, "taking one off...");
    t.status(await c.post(LIST, "MANAGER", { action: "list-add", name: `RC Overflow${tag} Pty` }), 200, "...makes room for another");
    t.ok(((await scan()).body?.hireCompanies ?? []).length === 25, "the scan never lists more than 25");
    // Tidy: switch off what this check added so later checks see the usual short list.
    for (const r of await db.labourHireCompany.findMany({ where: { retiredAt: null, name: { contains: tag } } }))
      await c.post(LIST, "MANAGER", { action: "list-retire", id: r.id, reason: "release check tidy-up" });

    // (7) The sign-in page: the list, plus Other with a box; the sign route still takes any company (never stopped).
    let page = "", sign = "";
    try {
      page = readFileSync(path.join(c.p.appDir, "src", "app", "site", "in", "[code]", "page.tsx"), "utf8");
      sign = readFileSync(path.join(c.p.appDir, "src", "app", "api", "site", "in", "sign", "route.ts"), "utf8");
    } catch { /* missing */ }
    t.ok(page.includes("[...companies, OTHER_COMPANY]") && page.includes("Type your company's name"), "the sign-in page shows the list and Other with a box to type in");
    t.ok(!/signInCompanies|labourHireCompany/.test(sign), "the sign route doesn't check the list - a worker under Other still signs in");
  },
};
