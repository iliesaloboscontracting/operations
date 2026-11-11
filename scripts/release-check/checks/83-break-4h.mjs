// The over-4-hours lunch break (Ilies, 12 Nov 2026: "change it to over 4 hours from this week but adjust the hours on the
// new rule from last week aswell"; "Alex is on salary and therefore this rule wouldnt apply to him or anyone else on
// salary"; salaried: no break at all; labour hire: the same new rule). lib/dayHours.ts: from Mon 2 Nov 2026
// (BREAK_4H_FROM) the break comes off any day over 4 h with no floor; salaried staff (Resource.payRateBasis SALARY) lose
// none; 26 Oct - 1 Nov keeps the 5-hour rule (never below 5 h). Seeds two new Labour-register people (one SALARY), a
// hire worker, a project and jobs in the weeks of 8 and 15 Mar 2027 (AEDT, far from any live day and from the other
// checks' weeks) and on Fri 30 Oct 2026 (the 5-hour week - read on the Sign-ins page and the labour hire timesheet, which
// are always live, because that week may be approved on the copy). Then: Timesheets, its CSV, Sign-ins, Accounts payroll
// and the labour hire timesheet; and a locked week's snapshot unchanged. WRITES on the test copy: 2 people, a project,
// jobs, sign-ins, one approved timesheet week.
const W = "2027-03-08", TUE = "2027-03-09", WED = "2027-03-10", LW = "2027-03-15", LTUE = "2027-03-16", OCT = "2026-10-30";
// March 2027 and late Oct 2026 are AEDT (UTC+11).
const aedt = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 11, m)); };

export default {
  id: "break-4h", title: "Lunch break over 4h from 2 Nov 2026 (no floor), none for salaried staff, 5h rule kept for 26 Oct - 1 Nov, locked weeks unchanged",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/dayHours.ts") || "needs lib/dayHours.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    if (await db.timesheetWeek.count({ where: { weekStart: { in: [W, LW] } } })) return t.block(`the copy already holds an approved timesheet week of ${W} or ${LW}`);
    if (await db.siteAttendance.count({ where: { date: { gte: W, lte: "2027-03-21" } } })) return t.block(`the copy already holds sign-ins in the weeks of ${W} / ${LW}`);

    // Seed: an hourly person, a salaried person, a hire worker; a 30-minute-break project with a job on each day.
    const O = await db.resource.create({ data: { type: "PERSONNEL", name: `RC Hourly ${tag}`, payRateBasis: "HOURLY" } });
    const S = await db.resource.create({ data: { type: "PERSONNEL", name: `RC Salary ${tag}`, payRateBasis: "SALARY" } });
    const hireName = `RC Hire ${tag}`, hireCo = `RC Break4 ${tag} Labour`;
    const proj = await db.project.create({ data: { name: `RC break4h ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 30 } });
    const jobs = {};
    for (const d of [TUE, WED, LTUE, OCT]) jobs[d] = await db.job.create({ data: { projectId: proj.id, title: proj.name, date: new Date(`${d}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    const add = (who, date, from, to, o = {}) => db.siteAttendance.create({ data: {
      jobId: jobs[date].id, date, resourceId: who?.id ?? null, workerName: who?.name ?? hireName, company: who ? null : hireCo, allocated: true,
      status: "CONFIRMED", signInMethod: "OFFICE", signInAt: aedt(date, from), signOutAt: aedt(date, to), ...o,
    } });
    const L = {
      o401: await add(O, TUE, "07:00", "11:01"), // 4:01 -> 3.5 (break off, no floor)
      o400: await add(O, WED, "07:00", "11:00"), // 4:00 -> 4.0 (no break)
      s830: await add(S, TUE, "07:00", "15:30"), // salaried 8:30 -> 8.5 (no break)
      s401: await add(S, WED, "07:00", "11:01"), // salaried 4:01 -> 4.0
      h401: await add(null, TUE, "07:00", "11:01", { deviceId: `rc-b4-${tag}` }), // hire 4:01 -> 3.5
      h503: await add(null, WED, "07:00", "12:03", { deviceId: `rc-b4-${tag}` }), // hire 5:03 -> 4.5
      oOct: await add(O, OCT, "07:00", "12:10"), // 30 Oct, the 5-hour rule: 5:10 -> 5.0 (never below 5)
      sOct: await add(S, OCT, "07:00", "15:30"), // 30 Oct: salaried keeps the break -> 8.0
      hOct: await add(null, OCT, "07:00", "12:10", { deviceId: `rc-b4-${tag}` }), // 30 Oct hire: 5.0
    };

    // (1) Timesheets (Manager): the 4-hour rule and the salaried person.
    const ts = (await c.json(`/api/timesheets?week=${W}`, "MANAGER")).body;
    const line = (body, id) => (body?.people ?? []).flatMap((p) => Object.values(p.days ?? {}).flat()).find((l) => l.attendanceId === id);
    const tl = (id) => line(ts, id);
    t.ok(!ts?.approval, `the week of ${W} is not approved - it is worked out live`);
    t.ok(tl(L.o401.id)?.hours === 3.5 && tl(L.o401.id)?.breakMinutes === 30, "Timesheets: a 4:01 day loses its 30 min break -> 3.5h (no 5-hour floor)", JSON.stringify(tl(L.o401.id) ?? null));
    t.ok(tl(L.o400.id)?.hours === 4 && tl(L.o400.id)?.breakMinutes === 0, "Timesheets: exactly 4:00 -> no break, 4.0h", JSON.stringify(tl(L.o400.id) ?? null));
    t.ok(tl(L.s830.id)?.hours === 8.5 && tl(L.s830.id)?.breakMinutes === 0, "Timesheets: a SALARY person's 8:30 day -> 8.5h, break 0", JSON.stringify(tl(L.s830.id) ?? null));
    t.ok(tl(L.s401.id)?.hours === 4 && tl(L.s401.id)?.breakMinutes === 0, "Timesheets: a SALARY person's 4:01 day -> 4.0h, break 0");
    const sp = (ts?.people ?? []).find((p) => p.resourceId === S.id), op = (ts?.people ?? []).find((p) => p.resourceId === O.id);
    t.ok(sp?.total === 12.5 && op?.total === 7.5, "week totals: salaried 8.5 + 4 = 12.5h, hourly 3.5 + 4 = 7.5h", `${sp?.total} / ${op?.total}`);
    t.ok(!line(ts, L.h401.id), "hire workers are not on the staff timesheet");

    // (2) The timesheet CSV (Manager and Accounts): "Unpaid break (min)" is what came off - 0 for the salaried person.
    for (const [who, pth] of [["MANAGER", `/api/timesheets/export?week=${W}`], ["ACCOUNTS", `/api/accounts/timesheets/export?week=${W}`]]) {
      const r = await c.text(pth, who);
      const rows = r.text.replace(/^﻿/, "").split("\r\n").map((x) => x.split(","));
      const head = rows.find((x) => x[0] === "Employee");
      const bi = head?.indexOf("Unpaid break (min)") ?? -1, hi = head?.indexOf("Hours") ?? -1;
      const row = (name, date) => rows.find((x) => x[0] === name && x[2] === date);
      const s = row(S.name, TUE), o = row(O.name, TUE), o2 = row(O.name, WED);
      t.ok(r.status === 200 && bi > 0 && s?.[bi] === "0" && s?.[hi] === "8.5", `${who} timesheet CSV: the salaried line shows break 0, 8.5h`, JSON.stringify(s ?? null));
      t.ok(o?.[bi] === "30" && o?.[hi] === "3.5" && o2?.[bi] === "0" && o2?.[hi] === "4", `${who} timesheet CSV: 4:01 shows break 30, 3.5h; 4:00 shows break 0, 4h`, JSON.stringify([o, o2]));
    }

    // (3) Sign-ins page: the same hours, and the break taken.
    const att = (await c.json(`/api/attendance?date=${TUE}`, "MANAGER")).body;
    const row = (id) => [...(att?.jobs ?? []), ...(att?.points ?? [])].flatMap((j) => j.rows ?? []).find((r) => r.id === id);
    t.ok(row(L.s830.id)?.hours === 8.5 && (row(L.s830.id)?.breakTaken ?? 0) === 0, "Sign-ins: the salaried person 8.5h, no break", JSON.stringify(row(L.s830.id) ? { h: row(L.s830.id).hours, b: row(L.s830.id).breakTaken } : null));
    t.ok(row(L.o401.id)?.hours === 3.5 && row(L.o401.id)?.breakTaken === 30, "Sign-ins: the 4:01 day 3.5h, 30 min break");
    t.ok(row(L.h401.id)?.hours === 3.5, "Sign-ins: the hire worker's 4:01 day 3.5h (the same new rule)", row(L.h401.id)?.hours);

    // (4) Accounts payroll: the same hours.
    const pay = (await c.json(`/api/accounts/payroll?week=${W}`, "ACCOUNTS")).body;
    const payOf = (key) => (pay?.people ?? []).find((x) => x.personKey === key)?.hours;
    t.ok(payOf(S.id) === 12.5 && payOf(O.id) === 7.5, "Accounts payroll: salaried 12.5h, hourly 7.5h (the same as Timesheets)", `${payOf(S.id)} / ${payOf(O.id)}`);
    const hirePay = (pay?.people ?? []).find((x) => x.name === hireName);
    t.ok(hirePay?.hours === 8, "Accounts payroll: the hire worker 3.5 + 4.5 = 8h", hirePay?.hours);

    // (5) The labour hire timesheet: the same new rule.
    const lh = (await c.json(`/api/timesheets/labour-hire?week=${W}&company=all`, "MANAGER")).body;
    t.ok(line(lh, L.h401.id)?.hours === 3.5 && line(lh, L.h503.id)?.hours === 4.5, "labour hire timesheet: 4:01 -> 3.5h, 5:03 -> 4.5h", JSON.stringify([line(lh, L.h401.id)?.hours, line(lh, L.h503.id)?.hours]));
    t.ok(line(lh, L.h401.id)?.breakMinutes === 30, "...with the 30 min break shown");

    // (6) 26 Oct - 1 Nov 2026 keeps the 5-hour rule (never below 5 h), salaried staff included.
    const octAtt = (await c.json(`/api/attendance?date=${OCT}`, "MANAGER")).body;
    const orow = (id) => [...(octAtt?.jobs ?? []), ...(octAtt?.points ?? [])].flatMap((j) => j.rows ?? []).find((r) => r.id === id);
    t.ok(orow(L.oOct.id)?.hours === 5, "Fri 30 Oct 2026, Sign-ins: 5:10 -> 5.0h (the 5-hour rule, never below 5)", orow(L.oOct.id)?.hours);
    t.ok(orow(L.sOct.id)?.hours === 8 && orow(L.sOct.id)?.breakTaken === 30, "Fri 30 Oct 2026: the salaried person still loses the break -> 8.0h (no change before 2 Nov)", orow(L.sOct.id)?.hours);
    const lhOct = (await c.json(`/api/timesheets/labour-hire?week=2026-10-26&company=all`, "MANAGER")).body;
    t.ok(line(lhOct, L.hOct.id)?.hours === 5, "Fri 30 Oct 2026, labour hire timesheet: 5:10 -> 5.0h", line(lhOct, L.hOct.id)?.hours);

    // (7) A locked week keeps its snapshot: approved on 5-hour-rule figures, a live line under the new rule changes nothing.
    const snap = JSON.stringify({ weekStart: LW, lines: [{ attendanceId: `rc-b4-locked-${tag}`, date: LTUE, resourceId: O.id, name: O.name, role: null, site: proj.name, in: "7:00 am", out: "12:10 pm", breakMinutes: 10, hours: 5, status: "CONFIRMED", allocated: true, changedByOffice: null }], travel: [] });
    const lock = await db.timesheetWeek.create({ data: { weekStart: LW, approvedBy: "Release check", totalHours: 5, people: 1, snapshot: snap } });
    const live = await add(O, LTUE, "07:00", "12:10"); // live it would be 4.75h
    const lw = (await c.json(`/api/timesheets?week=${LW}`, "MANAGER")).body;
    const lwa = (await c.json(`/api/accounts/timesheets?week=${LW}`, "ACCOUNTS")).body;
    const lwp = (lw?.people ?? []).find((p) => p.resourceId === O.id);
    t.ok(lw?.totalHours === 5 && lwp?.total === 5 && !line(lw, live.id) && lwa?.totalHours === 5, "a locked week shows its snapshot (5h), not the live 4-hour-rule figure", `${lw?.totalHours} / ${lwp?.total} / ${lwa?.totalHours}`);
    const lcsv = await c.text(`/api/timesheets/export?week=${LW}`, "MANAGER");
    const lrow = lcsv.text.split("\r\n").map((x) => x.split(",")).find((x) => x[0] === O.name && x[2] === LTUE);
    t.ok(lcsv.status === 200 && lrow?.[7] === "10" && lrow?.[8] === "5", "the locked week's CSV is the snapshot's (break 10, 5h)", JSON.stringify(lrow ?? null));
    t.ok((await db.timesheetWeek.findUnique({ where: { id: lock.id } }))?.snapshot === snap, "the stored snapshot is byte-for-byte unchanged");
  },
};
