// "Not in today" (Ilies, 23 Nov 2026: "this also needs a button that can let the system know that the someone if off
// sick today or not in"; "yes build it, alex can too"). On the Sign-ins page each person allocated and not signed in
// gets "Not in today": Sick or Not in, an optional note, per person per Sydney day (AttendanceAbsence, lib/absence).
//   (1) Who: Managers, Admins and the coordinator mark and undo; VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / YARD are
//       refused (403) and signed out is 401 - nothing written. Only a Labour-register person or a labour hire booking.
//   (2) One live mark per person per day (a duplicate is 409); a bad note (an amount, a TFN) is refused.
//   (3) The no-show counts drop: the Sign-ins strip's "no sign-in" (summary.noSignIn) and the card's unexplained list.
//       Marked but signed in elsewhere: the sign-in line is flagged MARKED_NOT_IN and its hours stand.
//   (4) Timesheets (/timesheets and accounts' copy), the CSV exports and accounts' Payroll show Sick / Not in with no
//       hours; the exports pass the payroll file check. Approving the week locks the marks into its snapshot.
//   (5) A locked week refuses marking and undoing; an Admin reopens it first.
//   (6) Undo needs a reason; the undone mark is kept (history) - nothing is deleted. No $ in any reply; no outbound call.
// WRITES (tagged "RC100 <tag>", test copy only): four people, a labour hire booking, a machine, two projects, two jobs on
// 7 Jul 2020 (a week no other check uses), one sign-in, the marks, and one approval of that week (reopened at the end).
import { readFileSync } from "node:fs";
import { noMoney } from "../lib/context.mjs";

const DAY = "2020-07-07"; // a Tuesday; its week is 6-12 Jul 2020
const WEEK = "2020-07-06";
const at = (date) => new Date(`${date}T00:00:00.000Z`);
const aest = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 10, m)); };
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];
const fileSafe = (s) => noMoney(s) && !/\b(rate \$|bsb|account number|tfn|tax file|aba)\b/i.test(s);
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "not-in-today", title: "Not in today: Manager / Admin / coordinator mark Sick / Not in (others refused), one a day, counts drop, timesheets + exports show it with no hours, locked week refused, undo kept, no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/absence/rules.ts") || "needs lib/absence/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    if (await db.job.count({ where: { date: at(DAY), cancelledAt: null } })) return t.block(`the snapshot already has job(s) on ${DAY}`);
    if (await db.timesheetWeek.count({ where: { weekStart: WEEK, reopenedAt: null } })) return t.block(`the week of ${WEEK} is already approved on the snapshot`);
    const net0 = netLines(c);
    const tag = Date.now().toString(36);
    const replies = [];
    const keep = async (r) => { const text = await r.text().catch(() => ""); replies.push(text); let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body, text }; };
    const mark = async (who, body) => keep(await c.post("/api/attendance/absence", who, { date: DAY, ...body }));
    const undo = async (who, id, body) => keep(await c.post(`/api/attendance/absence/${encodeURIComponent(id)}/cancel`, who, body));
    const view = async (who = "MANAGER") => keep(await c.get(`/api/attendance?date=${DAY}`, who));

    // Seed: A (will be Sick, no sign-in), B (Not in, but signs in on another job), C (no sign-in, never marked),
    // H a labour hire booking, M a machine; a project with job J (all of them) and job K (B signs in there).
    const mk = (name, extra = {}) => db.resource.create({ data: { name: `RC100 ${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", ...extra } });
    const A = await mk("Sick A"), B = await mk("Notin B"), C = await mk("Absent C");
    const H = await mk("Hire H", { type: "HIRE", category: "LABOUR", ownership: "HIRED" });
    const M = await mk("Machine M", { type: "EQUIPMENT", category: null, role: null });
    const P = await db.project.create({ data: { name: `RC100 Site ${tag}`, status: "ACTIVE" } });
    const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: at(DAY), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    // A second project for K: one job per project, day and shift (Job's unique key).
    const P2 = await db.project.create({ data: { name: `RC100 Other site ${tag}`, status: "ACTIVE" } });
    const K = await db.job.create({ data: { projectId: P2.id, title: P2.name, date: at(DAY), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    for (const r of [A, B, C, H]) await db.assignment.create({ data: { jobId: J.id, resourceId: r.id } });
    await db.assignment.create({ data: { jobId: K.id, resourceId: B.id } });
    const signIn = await db.siteAttendance.create({ data: { jobId: K.id, date: DAY, resourceId: B.id, workerName: B.name, allocated: true, signInMethod: "SUPERVISOR_QR", status: "CONFIRMED",
      signInAt: aest(DAY, "07:00"), signOutAt: aest(DAY, "15:30"), signOutMethod: "SUPERVISOR_QR" } });

    const card = (v, jobId) => v.body?.jobs?.find((j) => j.id === jobId);
    const ns = (v, id) => card(v, J.id)?.noShows?.find((n) => n.id === id);
    const v0 = await view();
    t.status(v0, 200, "a Manager reads the day's sign-ins");
    const noSignIn0 = v0.body?.summary?.noSignIn ?? -1;
    t.ok(ns(v0, A.id)?.nowhere === true && ns(v0, C.id)?.nowhere === true && ns(v0, B.id)?.nowhere === false && !!ns(v0, H.id), "before: A and C have no sign-in anywhere, B signed in elsewhere, H's booking unfilled", JSON.stringify(card(v0, J.id)?.noShows ?? null));
    const hoursB0 = card(v0, K.id)?.rows?.find((r) => r.id === signIn.id)?.hours;
    t.ok(typeof hoursB0 === "number" && hoursB0 > 0, "B's sign-in on the other job has hours", String(hoursB0));

    // (1) Who may. Every refused login (and no login) writes nothing.
    const count = () => db.attendanceAbsence.count({ where: { resourceId: { in: [A.id, B.id, C.id, H.id, M.id] } } });
    for (const who of REFUSED) t.status(await mark(who, { resourceId: A.id, reason: "SICK" }), 403, `${who} marking someone not in`);
    t.status(await mark(null, { resourceId: A.id, reason: "SICK" }), 401, "signed out, marking someone not in");
    t.ok((await count()) === 0, "nothing was written by any of those");
    // Bad input.
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "HOLIDAY" }), 400, "a reason that isn't Sick / Not in");
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "SICK", note: "owes $50" }), 400, "a note with an amount");
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "SICK", note: "TFN 123 456 782" }), 400, "a note with a TFN");
    t.status(await mark("MANAGER", { resourceId: M.id, reason: "SICK" }), 400, "marking a machine");
    t.status(await mark("MANAGER", { resourceId: A.id, reason: "SICK", date: "2099-01-01" }), 400, "a day in the future");
    t.ok((await count()) === 0, "still nothing written");

    // Mark: a Manager (A, Sick, with a note), the coordinator (B, Not in), an Admin (H, the labour hire booking).
    const mA = await mark("MANAGER", { resourceId: A.id, reason: "SICK", note: "rang in at 6am" });
    t.status(mA, 201, "a Manager marks A Sick");
    const dup = await mark("ADMIN", { resourceId: A.id, reason: "NOT_IN" });
    t.status(dup, 409, "a second mark for A that day (an Admin) is refused");
    const mB = await mark("COORDINATOR", { resourceId: B.id, reason: "NOT_IN" });
    t.status(mB, 201, "the coordinator marks B Not in");
    const mH = await mark("ADMIN", { resourceId: H.id, reason: "NOT_IN" });
    t.status(mH, 201, "an Admin marks the labour hire booking Not in");
    t.ok((await db.attendanceAbsence.count({ where: { resourceId: A.id, date: DAY, cancelledAt: null } })) === 1, "A has exactly one live mark");
    const rowA = await db.attendanceAbsence.findUnique({ where: { id: mA.body?.id ?? "none" } });
    t.ok(rowA?.reason === "SICK" && rowA.note === "rang in at 6am" && rowA.createdById === c.users.MANAGER.id, "A's mark is saved with the note and who marked it");

    // (3) The counts drop; B's sign-in is flagged and its hours stand.
    const v1 = await view();
    t.ok(v1.body?.summary?.noSignIn === noSignIn0 - 1, "the 'no sign-in' count drops by one (A); C still counts", `${noSignIn0} -> ${v1.body?.summary?.noSignIn}`);
    t.ok(ns(v1, A.id)?.absence?.active?.label === "Sick" && ns(v1, A.id)?.absence?.active?.note === "rang in at 6am", "A shows as Sick with the note");
    t.ok(ns(v1, B.id)?.absence?.active?.label === "Not in" && ns(v1, B.id)?.absence?.signedIn === true, "B shows as Not in - and that they signed in");
    t.ok(ns(v1, H.id)?.absence?.active?.label === "Not in", "the labour hire booking shows as Not in");
    const unexplained = (card(v1, J.id)?.noShows ?? []).filter((n) => !n.absence?.active).map((n) => n.id);
    t.ok(unexplained.length === 1 && unexplained[0] === C.id, "only C is still an unexplained no-show on the card", JSON.stringify(unexplained));
    const rB = card(v1, K.id)?.rows?.find((r) => r.id === signIn.id);
    t.ok(rB?.flags?.includes("MARKED_NOT_IN") && /Marked Not in but signed in/.test(rB?.notes?.MARKED_NOT_IN ?? ""), "B's sign-in line is flagged 'Marked Not in but signed in'", JSON.stringify(rB?.flags));
    t.ok(rB?.hours === hoursB0, "and its hours stand", `${hoursB0} -> ${rB?.hours}`);
    const vc = await view("COORDINATOR");
    t.ok(vc.status === 200 && vc.body?.jobs?.find((j) => j.id === J.id)?.noShows?.find((n) => n.id === A.id)?.absence?.active?.label === "Sick", "the coordinator sees the marks too");

    // (4) Timesheets: Sick / Not in with no hours; totals unchanged.
    const ts = await keep(await c.get(`/api/timesheets?week=${DAY}`, "MANAGER"));
    const pA = ts.body?.people?.find((p) => p.resourceId === A.id), pB = ts.body?.people?.find((p) => p.resourceId === B.id);
    t.ok(pA?.absences?.[DAY]?.label === "Sick" && pA.total === 0 && (pA.days?.[DAY] ?? []).length === 0, "the timesheet shows A Sick on the day with no hours", JSON.stringify(pA ?? null).slice(0, 200));
    t.ok(pB?.absences?.[DAY]?.label === "Not in" && pB.total === hoursB0, "B: Not in shown, and the week total is the sign-in's hours", `${pB?.total}`);
    t.ok(!ts.body?.people?.some((p) => p.resourceId === H.id), "a labour hire booking isn't on the staff timesheet");
    const tsAcc = await keep(await c.get(`/api/accounts/timesheets?week=${DAY}`, "ACCOUNTS"));
    t.ok(tsAcc.body?.people?.find((p) => p.resourceId === A.id)?.absences?.[DAY]?.label === "Sick", "accounts' view-only timesheet shows it too");
    const sickRow = (csv, who) => csv.split(/\r?\n/).find((l) => l.startsWith(`${who.name},`) && l.includes(`,${DAY},`) && /,(Sick|Not in),,,,,,,(Sick|Not in),/.test(l));
    for (const [pth, who, what] of [[`/api/timesheets/export?week=${DAY}`, "MANAGER", "the staff timesheet CSV"], [`/api/accounts/timesheets/export?week=${DAY}`, "ACCOUNTS", "the accounts timesheet CSV"]]) {
      const e = await keep(await c.get(pth, who));
      t.status(e, 200, `${what} downloads`);
      t.ok(!!sickRow(e.text, A), `${what} has A's Sick line with empty hours`, e.text.split(/\r?\n/).find((l) => l.includes(A.name))?.slice(0, 160));
      t.ok(/Marked Not in but signed in - check/.test(sickRow(e.text, B) ?? ""), `${what} flags B's mark for a check`);
      t.ok(fileSafe(e.text), `${what} passes the payroll file check (no $, bank, tax or rate)`);
    }
    const pay = await keep(await c.get(`/api/accounts/payroll?week=${DAY}`, "ACCOUNTS"));
    t.ok(pay.body?.absences?.some((a) => a.resourceId === A.id && a.label === "Sick") && pay.body?.people?.find((p) => p.personKey === B.id)?.absences?.[DAY]?.signedIn === true, "accounts' Payroll lists the marks (B's on B's day, signed in)");
    const sum = await keep(await c.get(`/api/accounts/payroll/export?week=${DAY}&file=summary`, "ACCOUNTS"));
    t.ok(sum.status === 200 && sum.text.includes("Sick / Not in - marked by the office, no hours") && sum.text.includes(A.name) && fileSafe(sum.text), "the payroll summary CSV lists them, and passes the file check", `${sum.status} ${sum.text.slice(0, 120)}`);

    // (5) Approve the week (a Manager): the marks are locked into the snapshot; marking and undoing are refused.
    let locked = false;
    try {
      const ap = await keep(await c.post("/api/timesheets", "MANAGER", { week: DAY, action: "approve" }));
      locked = ap.status === 200;
      if (!locked) t.block(`the week of ${WEEK} couldn't be approved on this copy (${ap.status} ${ap.text.slice(0, 120)})`);
      else {
        const wk = await db.timesheetWeek.findFirst({ where: { weekStart: WEEK, reopenedAt: null }, orderBy: { approvedAt: "desc" } });
        const snap = JSON.parse(wk?.snapshot ?? "{}");
        t.ok((snap.absences ?? []).some((a) => a.resourceId === A.id && a.label === "Sick"), "the approved week's snapshot holds A's Sick mark");
        t.status(await mark("MANAGER", { resourceId: C.id, reason: "SICK" }), 409, "marking in the locked week");
        t.status(await undo("ADMIN", mA.body?.id, { reason: "RC100 locked undo" }), 409, "undoing in the locked week (even an Admin)");
        t.ok((await db.attendanceAbsence.findUnique({ where: { id: mA.body?.id } }))?.cancelledAt == null, "A's mark is unchanged");
        const lockedView = await keep(await c.get(`/api/timesheets?week=${DAY}`, "MANAGER"));
        t.ok(lockedView.body?.people?.find((p) => p.resourceId === A.id)?.absences?.[DAY]?.label === "Sick", "the locked week shows the marks it was approved with");
      }
    } finally {
      if (locked) { t.status(await c.post("/api/timesheets", "ADMIN", { week: DAY, action: "reopen", reason: "RC100 not-in check - reopen" }), 200, "an Admin reopens the week"); locked = false; }
    }

    // (6) Undo: refused logins and no reason refused; a Manager undoes with a reason; kept, history shown; a second
    // undo is refused; A can be marked again; nothing deleted.
    for (const who of [...REFUSED, null]) t.status(await undo(who, mA.body?.id, { reason: "RC100 not allowed" }), who ? 403 : 401, `${who ?? "signed out"} undoing a mark`);
    t.status(await undo("MANAGER", mA.body?.id, {}), 400, "undo with no reason");
    t.status(await undo("MANAGER", mA.body?.id, { reason: "RC100 marked the wrong person" }), 200, "a Manager undoes A's mark with a reason");
    t.status(await undo("COORDINATOR", mA.body?.id, { reason: "RC100 again" }), 409, "a second undo of the same mark");
    const gone = await db.attendanceAbsence.findUnique({ where: { id: mA.body?.id } });
    t.ok(!!gone && !!gone.cancelledAt && gone.cancelledBy && gone.cancelReason === "RC100 marked the wrong person" && gone.cancelledById === c.users.MANAGER.id, "the undone mark is kept, with who undid it, when and why");
    const v2 = await view();
    t.ok(v2.body?.summary?.noSignIn === noSignIn0, "A counts as 'no sign-in' again", `${v2.body?.summary?.noSignIn}`);
    t.ok(!ns(v2, A.id)?.absence?.active && ns(v2, A.id)?.absence?.cancelled?.length === 1 && ns(v2, A.id)?.absence?.cancelled?.[0]?.cancelReason === "RC100 marked the wrong person", "the card shows A's undone mark as history");
    t.status(await mark("COORDINATOR", { resourceId: A.id, reason: "NOT_IN" }), 201, "A can be marked again after the undo (the coordinator)");
    t.status(await undo("COORDINATOR", mB.body?.id, { reason: "RC100 coordinator undo" }), 200, "the coordinator undoes B's mark");
    t.ok((await count()) === 4, "every mark is still there (3 made, 1 more after the undo) - nothing deleted", String(await count()));
    t.ok((await db.attendanceAbsence.count({ where: { resourceId: A.id, date: DAY } })) === 2 && (await db.attendanceAbsence.count({ where: { resourceId: A.id, date: DAY, cancelledAt: null } })) === 1, "A: two marks kept, one live");

    // No money in any reply; nothing called outside.
    const bad = replies.find((r) => !noMoney(r));
    t.ok(!bad, "no dollar figure in any reply read by this check", (bad ?? "").slice(0, 160));
    const net1 = netLines(c);
    t.ok(net1 === net0, "no outbound connection attempted during this check", `${net1 - net0} new blocked attempt(s)`);
  },
};
