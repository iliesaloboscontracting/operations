// Labour hire hours (Ilies, 11 Nov 2026: "a separate time sheet ... just for labour hire guys (Advanced Labour Hire) ...
// exported in the same format"; "yes, view and export, Managers + Admins + Alex"). Seeds the week of Mon 4 May 2020 (AEST,
// far from any live day and from every other check's weeks): hire sign-ins typed "Advanced Labour Hire", "advanced labour
// hire pty ltd", "Advanced" and "ALH" (joined only once the office maps it), plus another company, across 2 sites and 3
// days - one poster sign-in still TO_CONFIRM, one with no sign-out, one late sign-in, one REJECTED, one removed. Then:
// grouping and the company filter, hours = the Sign-ins page's (the staff rule), REJECTED / removed left out, the flags and
// the banner count, the export (the staff timesheet's columns, that company only, no $, formulas made safe, the file
// name), the role matrix, the company-name mapping (Managers / Admins; history on create, change and retire; never
// deleted) and the staff timesheet unchanged. WRITES on the test copy: two projects, three jobs, sign-ins, mappings.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";

const WEEK = "2020-05-04", MON = "2020-05-04", TUE = "2020-05-05", WED = "2020-05-06";
const aest = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 10, m)); };
const API = "/api/timesheets/labour-hire";
const STAFF_HEADER = "Employee,Role,Date,Day,Site / place,Sign in,Sign out,Unpaid break (min),Hours,Travel (h),Status,Notes";

export default {
  id: "labour-hire-timesheet", title: "Labour hire hours: by company, staff-rule hours, flags, export, mappings, roles",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/labourHire/rules.ts") || "needs lib/labourHire/rules.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    if (await db.siteAttendance.count({ where: { date: { gte: MON, lte: "2020-05-10" }, resourceId: null } }))
      return t.block(`the copy already holds hire sign-ins in the week of ${WEEK}`);

    // The staff timesheet before anything is seeded.
    const staffBefore = await c.json(`/api/timesheets?week=${WEEK}`, "MANAGER");
    const staffCsvBefore = await c.text(`/api/timesheets/export?week=${WEEK}`, "MANAGER");
    t.ok(staffBefore.status === 200 && staffCsvBefore.status === 200, "the staff timesheet and its export answer before seeding", `${staffBefore.status}/${staffCsvBefore.status}`);

    // Seed: two sites (30 and 45 min breaks), three days.
    const pA = await db.project.create({ data: { name: `RC LH A ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 30 } });
    const pB = await db.project.create({ data: { name: `RC LH B ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 45 } });
    const job = (p, date) => db.job.create({ data: { projectId: p.id, title: p.name, date: new Date(`${date}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    const [jMon, jTue, jWed] = [await job(pA, MON), await job(pA, TUE), await job(pB, WED)];
    const sam = `RC Sam ${tag}`, kim = `RC Kim ${tag}`, joe = `RC Joe ${tag}`, ann = `RC Ann ${tag}`, eve = `=RC Eve ${tag}`;
    const other = `RC Otherco${tag} Pty Ltd`;
    const att = (j, date, workerName, company, from, to, o = {}) => db.siteAttendance.create({ data: {
      jobId: j.id, date, resourceId: null, workerName, company, allocated: true, status: "CONFIRMED", signInMethod: "SUPERVISOR_QR",
      signInAt: aest(date, from), ...(to ? { signOutAt: aest(date, to), signOutMethod: "SUPERVISOR_QR" } : {}), ...o,
    } });
    const L = {
      sam1: await att(jMon, MON, sam, "Advanced Labour Hire", "07:00", "15:30"), // 8.0
      sam2: await att(jTue, TUE, sam.toLowerCase().replace(" ", "  "), "advanced labour hire pty ltd", "06:58", "15:31"), // 8.0
      eve: await att(jMon, MON, eve, "Advanced", "07:00", "15:30", { deviceId: `rc-eve-${tag}` }), // 8.0
      kimPoster: await att(jTue, TUE, kim, "Advanced", "07:00", "15:30", { signInMethod: "POSTER", signOutMethod: "POSTER", status: "TO_CONFIRM" }), // 8.0, to confirm
      kimOpen: await att(jWed, WED, kim, "Advanced", "07:00", null), // no sign-out
      joe: await att(jWed, WED, joe, "ALH", "07:00", "17:00"), // 10h less 45 min = 9.25
      ann: await att(jMon, MON, ann, other, "09:30", "14:30"), // 5.0, no break (not over 5h), LATE_IN
      rejected: await att(jWed, WED, sam, "Advanced Labour Hire", "07:00", "15:30", { status: "REJECTED" }),
      removed: await att(jMon, MON, joe, "ALH", "07:00", "15:30", { status: "REJECTED", removedAt: new Date(), removedBy: "release-check" }),
    };
    const expectHours = { sam1: 8, sam2: 8, eve: 8, kimPoster: 8, kimOpen: null, joe: 9.25, ann: 5 };

    // (1) Grouping (before any mapping): Advanced's spellings together; ALH and the other company apart.
    const all = await c.json(`${API}?week=${WEEK}&company=all`, "MANAGER");
    const cos = all.body?.companies ?? [];
    const adv = cos.find((x) => x.key === "advanced");
    t.ok(all.status === 200 && adv?.name === "Advanced Labour Hire", "'Advanced Labour Hire', 'advanced labour hire pty ltd' and 'Advanced' are one company, Advanced Labour Hire", JSON.stringify(cos.map((x) => x.key)));
    t.ok(adv && ["Advanced Labour Hire", "advanced labour hire pty ltd", "Advanced"].every((s) => adv.typed.some((x) => x.text === s)), "...listing every spelling typed");
    t.ok(adv?.workers === 3 && adv?.hours === 32, "Advanced: 3 workers (Sam typed two ways is one), 32h", JSON.stringify({ w: adv?.workers, h: adv?.hours }));
    t.ok(cos.some((x) => x.key === "alh") && cos.some((x) => x.key === `rc otherco${tag}`), "'ALH' and the other company are their own groups until mapped");
    const lines = (body) => (body?.people ?? []).flatMap((p) => Object.values(p.days ?? {}).flat());
    const allLines = lines(all.body);
    t.ok(!allLines.some((l) => l.attendanceId === L.rejected.id || l.attendanceId === L.removed.id), "REJECTED and removed sign-ins are left out");
    t.ok(Object.keys(expectHours).every((k) => allLines.some((l) => l.attendanceId === L[k].id)), "every other seeded line is there", allLines.length);
    t.ok(all.body?.unfinished === 2 && all.body?.banner === "2 lines not finished – check before sending", "banner: 2 lines not finished (the poster one to confirm, the one with no sign-out)", JSON.stringify({ u: all.body?.unfinished, b: all.body?.banner }));
    t.ok(all.body?.flagged === 1, "1 line flagged (the late sign-in)", all.body?.flagged);

    // (2) The company filter.
    const one = await c.json(`${API}?week=${WEEK}&company=advanced`, "MANAGER");
    const names = (one.body?.people ?? []).map((p) => p.name);
    t.ok(one.status === 200 && one.body?.company === "advanced" && names.length === 3 && !names.includes(joe) && !names.includes(ann), "company=advanced: only its 3 workers", JSON.stringify(names.length));
    t.ok((one.body?.people ?? []).find((p) => p.name.toLowerCase() === sam.toLowerCase())?.total === 16, "Sam's week: 16h over both spellings");
    t.ok(one.body?.totalHours === 32 && one.body?.unfinished === 2, "the filtered week's total 32h, 2 not finished", JSON.stringify({ h: one.body?.totalHours, u: one.body?.unfinished }));
    t.ok((one.body?.people ?? []).every((p) => p.role === "Advanced Labour Hire"), "each worker shows the company");

    // (3) Hours: the expected values, and exactly what the Sign-ins page shows for the same lines (the staff rule).
    const byId = new Map(allLines.map((l) => [l.attendanceId, l]));
    t.ok(Object.entries(expectHours).every(([k, h]) => byId.get(L[k].id)?.hours === h), "hours: 8 / 8 / 8 / 8 / none / 9.25 / 5 (break only over 5h, the project's break)", JSON.stringify(Object.fromEntries(Object.keys(expectHours).map((k) => [k, byId.get(L[k].id)?.hours]))));
    t.ok(byId.get(L.joe.id)?.breakMinutes === 45 && byId.get(L.ann.id)?.breakMinutes === 0, "the break is the project's (45 min), none on a 5h day");
    let same = true;
    for (const d of [MON, TUE, WED]) {
      const a = await c.json(`/api/attendance?date=${d}`, "MANAGER");
      for (const r of (a.body?.jobs ?? []).flatMap((j) => j.rows ?? [])) if (byId.has(r.id) && byId.get(r.id).hours !== r.hours) same = false;
    }
    t.ok(same, "every line's hours equal the Sign-ins page's");

    // (4) Flags.
    const kp = byId.get(L.kimPoster.id), ko = byId.get(L.kimOpen.id), an = byId.get(L.ann.id);
    t.ok(kp?.status === "TO_CONFIRM" && ko?.out === null && ko?.hours === null, "the poster line is to confirm; the open line has no sign-out and no hours");
    t.ok((an?.flagNotes ?? []).includes("Signed in 9:30am – job starts 7am"), "the late sign-in carries the Sign-ins page's words", JSON.stringify(an?.flagNotes ?? null));

    // (5) The export: the staff timesheet's columns, that company only, no $, formulas made safe, the file name.
    const ex = await c.get(`${API}/export?week=${WEEK}&company=advanced`, "MANAGER");
    const csv = await ex.text();
    const rows = csv.replace(/^﻿/, "").split("\r\n");
    t.status(ex, 200, "export (Manager)");
    t.ok(/filename="Advanced-Labour-Hire_week-2020-05-04\.csv"/.test(ex.headers.get("content-disposition") ?? ""), "file name Advanced-Labour-Hire_week-2020-05-04.csv", ex.headers.get("content-disposition"));
    const staffHeader = staffCsvBefore.text.replace(/^﻿/, "").split("\r\n")[3];
    t.ok(rows[3] === STAFF_HEADER && rows[3] === staffHeader, "the same header row as the staff timesheet export");
    t.ok(csv.toLowerCase().includes(sam.toLowerCase()) && csv.includes(kim) && !csv.includes(joe) && !csv.includes(ann), "only that company's workers");
    t.ok(!csv.includes("$") && noMoney(csv), "no $ in the file");
    t.ok(csv.includes(`"'=RC Eve ${tag}"`) && !/(^|,)=/m.test(csv), "a name starting with = is made text (formula escaping)");
    t.ok(/WEEK TOTAL/.test(csv) && /COMPANY TOTAL/.test(csv) && /No sign-out/.test(csv) && /Waiting for supervisor/.test(csv), "week totals, the company total and the unfinished notes");
    const exAll = await c.get(`${API}/export?week=${WEEK}&company=all`, "MANAGER");
    t.ok(exAll.status === 200 && /filename="All-companies_week-2020-05-04\.csv"/.test(exAll.headers.get("content-disposition") ?? ""), "All companies exports as All-companies_week-...");

    // (6) Roles.
    for (const who of ["MANAGER", "ADMIN", "COORDINATOR"]) {
      t.status(await c.get(`${API}?week=${WEEK}`, who), 200, `labour hire hours for ${who}`);
      t.status(await c.get(`${API}/export?week=${WEEK}&company=advanced`, who), 200, `export for ${who}`);
    }
    for (const who of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"]) {
      t.status(await c.get(`${API}?week=${WEEK}`, who), 403, `labour hire hours refused for ${who}`);
      t.status(await c.get(`${API}/export?week=${WEEK}`, who), 403, `export refused for ${who}`);
    }
    t.status(await c.get(`${API}?week=${WEEK}`, null), 401, "no login refused");
    const co = await c.json(`${API}?week=${WEEK}`, "COORDINATOR");
    t.ok(co.body?.canMap === false && all.body?.canMap === true, "the coordinator sees the mappings but can't make them; a Manager can");
    t.ok(noMoney(JSON.stringify(all.body ?? {})) && noMoney(JSON.stringify(co.body ?? {})), "no dollar figure in the replies");
    t.status(await c.get(`/timesheets/labour-hire`, "MANAGER"), 200, "the page loads");
    let src = "";
    try { src = readFileSync(path.join(c.p.appDir, "src", "lib", "roles.ts"), "utf8") + readFileSync(path.join(c.p.appDir, "src", "components", "TopNav.tsx"), "utf8"); } catch { /* missing */ }
    t.ok(/"\/timesheets\/labour-hire"/.test(src) && (src.match(/\/timesheets\/labour-hire/g) ?? []).length >= 3, "on the coordinator's pages and in the nav");

    // (7) Company-name mapping: Managers / Admins only; history on every change; never deleted.
    const ALIASES = `${API}/aliases`;
    for (const who of ["COORDINATOR", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"])
      t.status(await c.post(ALIASES, who, { action: "map", typed: "ALH", company: "Advanced Labour Hire" }), 403, `mapping refused for ${who}`);
    t.status(await c.post(ALIASES, "MANAGER", { action: "map", typed: "ALH", company: "Advanced $50" }), 400, "a mapping with an amount refused");
    const mapped = await c.post(ALIASES, "MANAGER", { action: "map", typed: "ALH", company: "Advanced Labour Hire" });
    const mj = await mapped.json().catch(() => ({}));
    t.status(mapped, 200, "a Manager maps ALH -> Advanced Labour Hire");
    const hist = () => db.recordChange.findMany({ where: { model: "LabourHireCompanyAlias", recordId: mj.id ?? "-" }, orderBy: { changedAt: "asc" } });
    const h1 = await hist();
    t.ok(h1.some((r) => r.field === "company" && r.before === null && r.after === "Advanced Labour Hire") && h1.some((r) => r.field === "aliasText" && r.after === "ALH"), "creating the mapping writes history", h1.length);
    const after = await c.json(`${API}?week=${WEEK}&company=advanced`, "MANAGER");
    t.ok((after.body?.people ?? []).some((p) => p.name === joe) && !(after.body?.companies ?? []).some((x) => x.key === "alh"), "ALH's worker now counts under Advanced Labour Hire");
    t.ok(after.body?.totalHours === 41.25, "Advanced's week is now 41.25h", after.body?.totalHours);
    const ex2 = await c.text(`${API}/export?week=${WEEK}&company=advanced`, "MANAGER");
    t.ok(ex2.text.includes(joe), "...and in its export");
    t.status(await c.post(ALIASES, "ADMIN", { action: "map", typed: "ALH", company: `RC Otherco${tag}` }), 200, "an Admin points ALH at another company");
    const h2 = await hist();
    t.ok(h2.some((r) => r.field === "company" && r.before === "Advanced Labour Hire" && r.after === `RC Otherco${tag}`), "the change is in the history (before -> after)");
    t.status(await c.post(ALIASES, "MANAGER", { action: "retire", id: mj.id }), 400, "retire without a reason refused");
    t.status(await c.post(ALIASES, "COORDINATOR", { action: "retire", id: mj.id, reason: "wrong" }), 403, "retire refused for the coordinator");
    t.status(await c.post(ALIASES, "MANAGER", { action: "retire", id: mj.id, reason: "Not that company" }), 200, "a Manager retires it with a reason");
    t.status(await c.post(ALIASES, "MANAGER", { action: "retire", id: mj.id, reason: "again" }), 409, "retiring twice 409");
    const row = await db.labourHireCompanyAlias.findUnique({ where: { id: mj.id ?? "-" } });
    t.ok(row && row.retiredAt && row.retireReason === "Not that company", "the retired mapping is kept (who / when / why)");
    t.ok((await hist()).some((r) => r.field === "retiredAt" && r.before === null && r.after), "retiring is in the history");
    const back = await c.json(`${API}?week=${WEEK}&company=all`, "MANAGER");
    t.ok((back.body?.companies ?? []).some((x) => x.key === "alh"), "a retired mapping no longer applies (ALH is its own again)");
    t.ok((back.body?.aliases ?? []).some((a) => a.id === mj.id && a.retiredAt), "the page still lists it, retired");
    const del = await c.del(ALIASES, "ADMIN", { id: mj.id });
    t.ok([404, 405].includes(del.status) && (await db.labourHireCompanyAlias.count({ where: { id: mj.id ?? "-" } })) === 1, "no way to delete a mapping", del.status);
    const again = await (await c.post(ALIASES, "MANAGER", { action: "map", typed: "alh", company: "Advanced Labour Hire" })).json().catch(() => ({}));
    const rowAgain = await db.labourHireCompanyAlias.findUnique({ where: { id: mj.id ?? "-" } });
    t.ok(again.id === mj.id && rowAgain && !rowAgain.retiredAt && rowAgain.company === "Advanced Labour Hire", "mapping the same name again brings the same row back");
    const hApi = await c.json(`/api/history?model=LabourHireCompanyAlias&id=${mj.id}`, "MANAGER");
    t.ok(hApi.status === 200 && (hApi.body?.changes ?? []).length >= 5, "a Manager reads the mapping's history", hApi.status);
    t.status(await c.get(`/api/history?model=LabourHireCompanyAlias&id=${mj.id}`, "COORDINATOR"), 403, "the coordinator can't read change history");

    // (8) The staff timesheet is unchanged by any of it.
    const staffAfter = await c.json(`/api/timesheets?week=${WEEK}`, "MANAGER");
    const staffCsvAfter = await c.text(`/api/timesheets/export?week=${WEEK}`, "MANAGER");
    const pick = (b) => JSON.stringify({ people: b?.people, totalHours: b?.totalHours, issues: b?.issues, approval: b?.approval });
    t.ok(pick(staffAfter.body) === pick(staffBefore.body), "the staff timesheet shows exactly what it did before");
    t.ok(staffCsvAfter.text === staffCsvBefore.text, "the staff export is byte-for-byte the same");
    t.ok(!lines(staffAfter.body).some((l) => Object.values(L).some((x) => x.id === l.attendanceId)), "no hire line on the staff timesheet");
  },
};
