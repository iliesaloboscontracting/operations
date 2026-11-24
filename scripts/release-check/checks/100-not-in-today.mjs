// "Not in today" (Ilies, 23 Nov 2026: "this also needs a button that can let the system know that the someone if off
// sick today or not in"; "yes build it, alex can too"). On the Sign-ins page each person allocated and not signed in
// gets "Not in today": Sick or Not in, an optional note, per person per Sydney day (AttendanceAbsence, lib/absence).
// Security fixes NI-001..004 (Ilies approved 23 Nov 2026: "a + b + c", "Approve all three", "Yes, allow tomorrow",
// "No, summary only").
//   (1) Who: Managers, Admins and the coordinator mark and undo; VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / YARD are
//       refused (403) and signed out is 401 - nothing written.
//   (2) What (NI-002): only an active Labour-register person or a labour hire booking ON THAT DAY'S BOARD; from 14 days
//       back to tomorrow (40 days back and the day after tomorrow 400); tomorrow's crew can be marked ahead. One live
//       mark per person per day (409); a bad note (an amount, a TFN) 400.
//   (3) The no-show counts drop (summary.noSignIn, the card's unexplained list); marked but signed in elsewhere is
//       flagged MARKED_NOT_IN with the sign-in's hours unchanged.
//   (4) Timesheets / accounts' timesheets / Payroll show Sick / Not in with no hours; NI-001 c: the TIMESHEETS login's
//       timesheet carries no note; NI-001 b: the staff and accounts timesheet CSVs and the payroll summary CSV carry the
//       label but never the note; NI-003: a name that trips the file check becomes "Name to check" in the summary.
//   (5) A locked week refuses marking and undoing (NI-004's in-transaction re-check is source-tested in npm test);
//       approving a week locks its marks into the snapshot.
//   (6) Undo needs a reason; the undone mark is kept - nothing deleted. No $ in any reply; no outbound call.
// WRITES (tagged "RC100 <tag>", test copy only): made-up people, a labour hire booking, a machine, two projects with
// jobs today, tomorrow and last week, one sign-in today, the marks; one approval of the week of 6 Jul 2020 (a week no
// other check uses) and - only if last week isn't approved on the snapshot already - a lock row for last week; both
// reopened at the end.
import { readFileSync } from "node:fs";
import { noMoney } from "../lib/context.mjs";

const OLD = "2020-07-07", OLD_WEEK = "2020-07-06"; // the snapshot path: a mark seeded straight into the copy, then the week approved
const at = (date) => new Date(`${date}T00:00:00.000Z`);
const addDays = (iso, n) => new Date(new Date(iso + "T12:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];
const fileSafe = (s) => noMoney(s) && !/\b(rate \$|bsb|account number|tfn|tax file|aba)\b/i.test(s);
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "not-in-today", title: "Not in today: Manager / Admin / coordinator mark Sick / Not in on that day's board (14 days back to tomorrow), counts drop, timesheets + exports show the label (never the note), locked week refused, undo kept, no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/absence/rules.ts") || "needs lib/absence/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const TODAY = c.today, TOMORROW = addDays(c.today, 1), LW = addDays(c.lastWeek, 1); // last week's Tuesday: 6-12 days back
    if (await db.job.count({ where: { date: at(OLD), cancelledAt: null } })) return t.block(`the snapshot already has job(s) on ${OLD}`);
    if (await db.timesheetWeek.count({ where: { weekStart: OLD_WEEK, reopenedAt: null } })) return t.block(`the week of ${OLD_WEEK} is already approved on the snapshot`);
    const net0 = netLines(c);
    const tag = Date.now().toString(36);
    const NOTE = `rang in ${tag}`;
    const replies = [];
    const keep = async (r) => { const text = await r.text().catch(() => ""); replies.push(text); let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body, text }; };
    const mark = async (who, body) => keep(await c.post("/api/attendance/absence", who, { date: TODAY, ...body }));
    const undo = async (who, id, body) => keep(await c.post(`/api/attendance/absence/${encodeURIComponent(id)}/cancel`, who, body));
    const view = async (who = "MANAGER", date = TODAY) => keep(await c.get(`/api/attendance?date=${date}`, who));

    // Seed: A (Sick, with a note), B (Not in, signs in on job K), C (never marked), I (switched off on the register),
    // H and N labour hire bookings (N's name trips the payroll file check) - all on job J today; T on job JT tomorrow;
    // U on no job; M a machine; A also on job JL last week.
    const mk = (name, extra = {}) => db.resource.create({ data: { name: `RC100 ${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", ...extra } });
    const A = await mk("Sick A"), B = await mk("Notin B"), C = await mk("Absent C"), T = await mk("Tomorrow T"), U = await mk("Unbooked U");
    const I = await mk("Inactive I", { active: false });
    const H = await mk("Hire H", { type: "HIRE", category: "LABOUR", ownership: "HIRED" });
    // N: a labour hire booking whose name trips the payroll file check ("Aba") - on Payroll's list of marks, not the staff
    // timesheet (so the accounts timesheet export isn't refused because of it).
    const N = await mk("Aba N", { type: "HIRE", category: "LABOUR", ownership: "HIRED" });
    const M = await mk("Machine M", { type: "EQUIPMENT", category: null, role: null });
    const P = await db.project.create({ data: { name: `RC100 Site ${tag}`, status: "ACTIVE" } });
    const P2 = await db.project.create({ data: { name: `RC100 Other site ${tag}`, status: "ACTIVE" } }); // one job per project, day and shift
    const job = (p, date) => db.job.create({ data: { projectId: p.id, title: p.name, date: at(date), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    const J = await job(P, TODAY), K = await job(P2, TODAY), JT = await job(P, TOMORROW), JL = await job(P, LW);
    for (const r of [A, B, C, N, I, H]) await db.assignment.create({ data: { jobId: J.id, resourceId: r.id } });
    await db.assignment.create({ data: { jobId: K.id, resourceId: B.id } });
    await db.assignment.create({ data: { jobId: JT.id, resourceId: T.id } });
    await db.assignment.create({ data: { jobId: JL.id, resourceId: A.id } });
    const now = Date.now();
    const signIn = await db.siteAttendance.create({ data: { jobId: K.id, date: TODAY, resourceId: B.id, workerName: B.name, allocated: true, signInMethod: "SUPERVISOR_QR", status: "CONFIRMED",
      signInAt: new Date(now - 61 * 60_000), signOutAt: new Date(now - 60_000), signOutMethod: "SUPERVISOR_QR" } });

    const card = (v, jobId) => v.body?.jobs?.find((j) => j.id === jobId);
    const ns = (v, id) => card(v, J.id)?.noShows?.find((n) => n.id === id);
    const v0 = await view();
    t.status(v0, 200, "a Manager reads today's sign-ins");
    const noSignIn0 = v0.body?.summary?.noSignIn ?? -1;
    t.ok(ns(v0, A.id)?.nowhere === true && ns(v0, C.id)?.nowhere === true && ns(v0, B.id)?.nowhere === false && !!ns(v0, H.id), "before: A and C have no sign-in anywhere, B signed in elsewhere, H's booking unfilled", JSON.stringify(card(v0, J.id)?.noShows ?? null).slice(0, 200));
    const hoursB0 = card(v0, K.id)?.rows?.find((r) => r.id === signIn.id)?.hours;
    t.ok(typeof hoursB0 === "number", "B's sign-in on the other job has hours", String(hoursB0));

    // (1) Who may. Every refused login (and no login) writes nothing.
    const ours = [A, B, C, N, T, U, I, H, M].map((r) => r.id);
    const count = () => db.attendanceAbsence.count({ where: { resourceId: { in: ours } } });
    for (const who of REFUSED) t.status(await mark(who, { resourceId: A.id, reason: "SICK" }), 403, `${who} marking someone not in`);
    t.status(await mark(null, { resourceId: A.id, reason: "SICK" }), 401, "signed out, marking someone not in");
    t.ok((await count()) === 0, "nothing was written by any of those");

    // (2) What and when (NI-002), and bad input.
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "HOLIDAY" }), 400, "a reason that isn't Sick / Not in");
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "SICK", note: "owes $50" }), 400, "a note with an amount");
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "SICK", note: "TFN 123 456 782" }), 400, "a note with a TFN");
    t.status(await mark("MANAGER", { resourceId: M.id, reason: "SICK" }), 400, "marking a machine");
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "SICK", date: addDays(TODAY, -40) }), 400, "a day 40 days back");
    t.status(await mark("MANAGER", { resourceId: T.id, reason: "SICK", date: addDays(TODAY, 2) }), 400, "the day after tomorrow");
    t.status(await mark("MANAGER", { resourceId: U.id, reason: "SICK" }), 400, "someone not on today's board");
    t.status(await mark("ADMIN", { resourceId: I.id, reason: "SICK" }), 400, "someone switched off on the register (though allocated)");
    t.status(await mark("MANAGER", { resourceId: T.id, reason: "SICK" }), 400, "T today - T is only on tomorrow's board");
    t.ok((await count()) === 0, "still nothing written");

    // Mark: a Manager (A, Sick, with a note), the coordinator (B, Not in), an Admin (H, the labour hire booking; N),
    // and T for tomorrow (a Manager).
    const mA = await mark("MANAGER", { resourceId: A.id, reason: "SICK", note: NOTE });
    t.status(mA, 201, "a Manager marks A Sick");
    t.status(await mark("ADMIN", { resourceId: A.id, reason: "NOT_IN" }), 409, "a second mark for A that day (an Admin) is refused");
    const mB = await mark("COORDINATOR", { resourceId: B.id, reason: "NOT_IN" });
    t.status(mB, 201, "the coordinator marks B Not in");
    t.status(await mark("ADMIN", { resourceId: H.id, reason: "NOT_IN" }), 201, "an Admin marks the labour hire booking Not in");
    t.status(await mark("ADMIN", { resourceId: N.id, reason: "SICK" }), 201, "an Admin marks booking N Sick");
    t.status(await mark("MANAGER", { resourceId: T.id, reason: "SICK", date: TOMORROW }), 201, "a Manager marks T Sick for tomorrow (on tomorrow's board)");
    t.ok((await db.attendanceAbsence.count({ where: { resourceId: A.id, date: TODAY, cancelledAt: null } })) === 1, "A has exactly one live mark today");
    const rowA = await db.attendanceAbsence.findUnique({ where: { id: mA.body?.id ?? "none" } });
    t.ok(rowA?.reason === "SICK" && rowA.note === NOTE && rowA.createdById === c.users.MANAGER.id, "A's mark is saved with the note and who marked it");
    const vt = await view("MANAGER", TOMORROW);
    const ahead = card(vt, JT.id)?.ahead ?? [];
    t.ok(ahead.find((p) => p.id === T.id)?.absence?.active?.label === "Sick" && (card(vt, JT.id)?.noShows ?? []).length === 0, "tomorrow's page lists T in the crew-ahead list as Sick - and nobody as a no-show", JSON.stringify(card(vt, JT.id) ?? null).slice(0, 200));

    // (3) The counts drop; B's sign-in is flagged and its hours stand.
    const v1 = await view();
    t.ok(v1.body?.summary?.noSignIn === noSignIn0 - 1, "the 'no sign-in' count drops by one (A); C still counts", `${noSignIn0} -> ${v1.body?.summary?.noSignIn}`);
    t.ok(ns(v1, A.id)?.absence?.active?.label === "Sick" && ns(v1, A.id)?.absence?.active?.note === NOTE, "A shows as Sick with the note (on the office's own screen)");
    t.ok(ns(v1, B.id)?.absence?.active?.label === "Not in" && ns(v1, B.id)?.absence?.signedIn === true, "B shows as Not in - and that they signed in");
    t.ok(ns(v1, H.id)?.absence?.active?.label === "Not in", "the labour hire booking shows as Not in");
    const unexplained = (card(v1, J.id)?.noShows ?? []).filter((n) => !n.absence?.active).map((n) => n.id).sort();
    t.ok(JSON.stringify(unexplained) === JSON.stringify([C.id, I.id].sort()), "only C (and I, switched off) are still unexplained on the card", JSON.stringify(unexplained));
    const rB = card(v1, K.id)?.rows?.find((r) => r.id === signIn.id);
    t.ok(rB?.flags?.includes("MARKED_NOT_IN") && /Marked Not in but signed in/.test(rB?.notes?.MARKED_NOT_IN ?? ""), "B's sign-in line is flagged 'Marked Not in but signed in'", JSON.stringify(rB?.flags));
    t.ok(rB?.hours === hoursB0, "and its hours stand", `${hoursB0} -> ${rB?.hours}`);
    const vc = await view("COORDINATOR");
    t.ok(vc.status === 200 && card(vc, J.id)?.noShows?.find((n) => n.id === A.id)?.absence?.active?.label === "Sick", "the coordinator sees the marks too");

    // (4) Timesheets: the label with no hours; NI-001 c: no note for the TIMESHEETS login.
    const ts = await keep(await c.get(`/api/timesheets?week=${TODAY}`, "MANAGER"));
    const pA = ts.body?.people?.find((p) => p.resourceId === A.id), pB = ts.body?.people?.find((p) => p.resourceId === B.id);
    t.ok(pA?.absences?.[TODAY]?.label === "Sick" && pA.total === 0, "the timesheet shows A Sick today with no hours", JSON.stringify(pA ?? null).slice(0, 200));
    t.ok(pB?.absences?.[TODAY]?.label === "Not in" && pB.total === hoursB0, "B: Not in shown, and the week total is the sign-in's hours", `${pB?.total}`);
    t.ok(!ts.body?.people?.some((p) => p.resourceId === H.id), "a labour hire booking isn't on the staff timesheet");
    const tsT = await keep(await c.get(`/api/timesheets?week=${TODAY}`, "TIMESHEETS"));
    const tA = tsT.body?.people?.find((p) => p.resourceId === A.id);
    t.ok(tsT.status === 200 && tA?.absences?.[TODAY]?.label === "Sick" && tA.absences[TODAY].note == null && !tsT.text.includes(NOTE), "NI-001 c: the TIMESHEETS login sees 'Sick' but no note", `${tsT.status} ${JSON.stringify(tA?.absences ?? null).slice(0, 120)}`);
    const tsAcc = await keep(await c.get(`/api/accounts/timesheets?week=${TODAY}`, "ACCOUNTS"));
    t.ok(tsAcc.body?.people?.find((p) => p.resourceId === A.id)?.absences?.[TODAY]?.label === "Sick", "accounts' view-only timesheet shows it");

    // NI-001 b: the CSVs carry the label with empty hours, never the note; they pass the payroll file check.
    // Columns are found by their header name (24 Nov 2026: travel pay added "Travel paid (h)" - positions moved), and a
    // Sick / Not in line must have every time and hours column empty: sign in / out, break, hours, tip run, travel, travel
    // paid. Returns the line's Notes (or undefined when there's no such line).
    const csvCells = (line) => {
      const out = []; let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const EMPTY_COLS = ["Sign in", "Sign out", "Unpaid break (min)", "Hours", "Of which tip run (h)", "Travel (h)", "Travel paid (h)"];
    const sickRow = (csv, who) => {
      const lines = csv.split(/\r?\n/);
      const hi = lines.findIndex((l) => l.startsWith("Employee,"));
      if (hi < 0) return undefined;
      const head = csvCells(lines[hi]);
      const col = (r, name) => r[head.indexOf(name)];
      if (EMPTY_COLS.some((n) => head.indexOf(n) < 0) || head.indexOf("Notes") < 0) return undefined;
      const row = lines.slice(hi + 1).map(csvCells).find((r) => col(r, "Employee") === who.name && col(r, "Date") === TODAY
        && /^(Sick|Not in)$/.test(col(r, "Site / place")) && col(r, "Status") === col(r, "Site / place") && EMPTY_COLS.every((n) => col(r, n) === ""));
      return row ? col(row, "Notes") : undefined;
    };
    for (const [pth, who, what] of [[`/api/timesheets/export?week=${TODAY}`, "MANAGER", "the staff timesheet CSV"], [`/api/accounts/timesheets/export?week=${TODAY}`, "ACCOUNTS", "the accounts timesheet CSV"]]) {
      const e = await keep(await c.get(pth, who));
      if (e.status === 409 && who === "ACCOUNTS") { t.note(`${what}: 409 on this copy - other sign-ins this week trip the file check (${e.text.slice(0, 100)})`); continue; }
      t.status(e, 200, `${what} downloads`);
      t.ok(!!sickRow(e.text, A) && /Sick - no hours; Marked by /.test(sickRow(e.text, A) ?? ""), `${what} has A's Sick line with empty hours and who marked it`, e.text.split(/\r?\n/).find((l) => l.includes(A.name))?.slice(0, 160));
      t.ok(!e.text.includes(NOTE), `${what} has no note text (NI-001 b)`);
      t.ok(/Marked Not in but signed in - check/.test(sickRow(e.text, B) ?? ""), `${what} flags B's mark for a check`);
      const ourLines = e.text.split(/\r?\n/).filter((l) => l.includes(tag)).join("\n");
      t.ok(fileSafe(ourLines) && (who === "ACCOUNTS" ? fileSafe(e.text) : true), `${what}: our lines pass the payroll file check`);
    }
    const pay = await keep(await c.get(`/api/accounts/payroll?week=${TODAY}`, "ACCOUNTS"));
    t.ok(pay.body?.absences?.some((a) => a.resourceId === A.id && a.label === "Sick") && pay.body?.people?.find((p) => p.personKey === B.id)?.absences?.[TODAY]?.signedIn === true, "accounts' Payroll lists the marks (B's on B's day, signed in)");
    t.ok(pay.body?.absences?.find((a) => a.resourceId === N.id)?.name?.startsWith("Name to check") && pay.body?.namesToCheck?.some((x) => x.attendanceId === pay.body.absences.find((a) => a.resourceId === N.id).id), "NI-003: N's name is shown as 'Name to check' and listed for the office");
    const sum = await keep(await c.get(`/api/accounts/payroll/export?week=${TODAY}&file=summary`, "ACCOUNTS"));
    if (sum.status !== 200) t.block(`the payroll summary CSV answered ${sum.status} on this copy (${sum.text.slice(0, 120)})`);
    else {
      t.ok(sum.text.includes("Sick / Not in - marked by the office, no hours") && sum.text.includes("Person,Date,Marked,Marked by,Check") && sum.text.includes(A.name), "the payroll summary CSV lists the marks, with no Note column");
      t.ok(!sum.text.includes(NOTE) && !sum.text.includes(N.name) && /Name to check/.test(sum.text) && fileSafe(sum.text), "no note, N swapped for 'Name to check', and it passes the file check (NI-001 b, NI-003)");
    }

    // (5) Locked weeks. Last week: locked on the snapshot already, or locked here with a lock row (test copy only).
    const lwStart = c.lastWeek;
    const already = await db.timesheetWeek.findFirst({ where: { weekStart: lwStart, reopenedAt: null } });
    const lockRow = already ? null : await db.timesheetWeek.create({ data: { weekStart: lwStart, approvedBy: `RC100 ${tag}`, snapshot: JSON.stringify({ weekStart: lwStart, lines: [] }), totalHours: 0, people: 0 } });
    const lwMark = await db.attendanceAbsence.create({ data: { resourceId: A.id, date: LW, reason: "SICK", createdBy: `RC100 ${tag}` } });
    try {
      t.status(await mark("MANAGER", { resourceId: A.id, reason: "NOT_IN", date: LW }), 409, "a mark in an approved week (last week)");
      t.status(await undo("ADMIN", lwMark.id, { reason: "RC100 locked undo" }), 409, "an undo in an approved week (even an Admin)");
      t.ok((await db.attendanceAbsence.findUnique({ where: { id: lwMark.id } }))?.cancelledAt == null, "that mark is unchanged");
    } finally {
      if (lockRow) await db.timesheetWeek.update({ where: { id: lockRow.id }, data: { reopenedAt: new Date(), reopenedBy: `RC100 ${tag}`, reopenReason: "RC100 put back" } });
    }
    // The snapshot: a mark seeded on 7 Jul 2020, then that week approved through the API.
    await db.attendanceAbsence.create({ data: { resourceId: A.id, date: OLD, reason: "SICK", note: NOTE, createdBy: `RC100 ${tag}` } });
    let locked = false;
    try {
      const ap = await keep(await c.post("/api/timesheets", "MANAGER", { week: OLD, action: "approve" }));
      locked = ap.status === 200;
      if (!locked) t.block(`the week of ${OLD_WEEK} couldn't be approved on this copy (${ap.status} ${ap.text.slice(0, 120)})`);
      else {
        const wk = await db.timesheetWeek.findFirst({ where: { weekStart: OLD_WEEK, reopenedAt: null }, orderBy: { approvedAt: "desc" } });
        t.ok((JSON.parse(wk?.snapshot ?? "{}").absences ?? []).some((a) => a.resourceId === A.id && a.label === "Sick"), "the approved week's snapshot holds A's Sick mark");
        const lv = await keep(await c.get(`/api/timesheets?week=${OLD}`, "MANAGER"));
        t.ok(lv.body?.people?.find((p) => p.resourceId === A.id)?.absences?.[OLD]?.label === "Sick", "the locked week shows the marks it was approved with");
        const lcsv = await keep(await c.get(`/api/timesheets/export?week=${OLD}`, "MANAGER"));
        t.ok(lcsv.status === 200 && !!sickRow(lcsv.text.replaceAll(OLD, TODAY), A) && !lcsv.text.includes(NOTE), "the approved week's CSV has the label and no note");
      }
    } finally {
      if (locked) t.status(await c.post("/api/timesheets", "ADMIN", { week: OLD, action: "reopen", reason: "RC100 not-in check - reopen" }), 200, "an Admin reopens the week of 6 Jul 2020");
    }

    // (6) Undo: refused logins and no reason refused; a Manager undoes with a reason; kept with history; a second undo
    // is refused; A can be marked again; nothing deleted.
    for (const who of [...REFUSED, null]) t.status(await undo(who, mA.body?.id, { reason: "RC100 not allowed" }), who ? 403 : 401, `${who ?? "signed out"} undoing a mark`);
    t.status(await undo("MANAGER", mA.body?.id, {}), 400, "undo with no reason");
    t.status(await undo("MANAGER", mA.body?.id, { reason: "RC100 marked the wrong person" }), 200, "a Manager undoes A's mark with a reason");
    t.status(await undo("COORDINATOR", mA.body?.id, { reason: "RC100 again" }), 409, "a second undo of the same mark");
    const gone = await db.attendanceAbsence.findUnique({ where: { id: mA.body?.id } });
    t.ok(!!gone && !!gone.cancelledAt && gone.cancelledBy && gone.cancelReason === "RC100 marked the wrong person" && gone.cancelledById === c.users.MANAGER.id, "the undone mark is kept, with who undid it, when and why");
    const v2 = await view();
    t.ok(v2.body?.summary?.noSignIn === noSignIn0, "A counts as 'no sign-in' again", `${v2.body?.summary?.noSignIn}`);
    t.ok(!ns(v2, A.id)?.absence?.active && ns(v2, A.id)?.absence?.cancelled?.[0]?.cancelReason === "RC100 marked the wrong person", "the card shows A's undone mark as history");
    t.status(await mark("COORDINATOR", { resourceId: A.id, reason: "NOT_IN" }), 201, "A can be marked again after the undo (the coordinator)");
    t.status(await undo("COORDINATOR", mB.body?.id, { reason: "RC100 coordinator undo" }), 200, "the coordinator undoes B's mark");
    t.ok((await count()) === 8, "every mark is still there (5 via the API today and tomorrow, 1 more after the undo, 2 seeded) - nothing deleted", String(await count()));
    t.ok((await db.attendanceAbsence.count({ where: { resourceId: A.id, date: TODAY } })) === 2 && (await db.attendanceAbsence.count({ where: { resourceId: A.id, date: TODAY, cancelledAt: null } })) === 1, "A today: two marks kept, one live");

    // No money in any reply; nothing called outside.
    const bad = replies.find((r) => !noMoney(r));
    t.ok(!bad, "no dollar figure in any reply read by this check", (bad ?? "").slice(0, 160));
    const net1 = netLines(c);
    t.ok(net1 === net0, "no outbound connection attempted during this check", `${net1 - net0} new blocked attempt(s)`);
  },
};
