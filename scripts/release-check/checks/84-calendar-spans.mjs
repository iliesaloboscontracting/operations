// Project spans on the Calendar (Ilies, 12 Nov 2026: "show how the jobs [go] across the days or months pending how long
// the job is estimated to take"). /api/calendar/spans (lib/calendarSpans.ts) gives each project's planned span (start ->
// expected completion) that overlaps the range, plus the "No dates yet" list. Seeds six projects on the copy - active
// confirmed, tentative, finish TBC, past its finish, inactive recommencing next month (with an earlier crewed job, so
// "Recommences") and inactive with no dates - each with a contract value that must never come back. Then: the spans and
// their flags, the no-dates list, no money, read-only, and the same access as /api/calendar for every login (Viewer,
// Manager, Admin and the coordinator in; TIMESHEETS / ACCOUNTS / DIRECTOR / YARD / no login refused, as before).
// WRITES on the test copy: 6 projects, a person, one job with an assignment.
import { noMoney } from "../lib/context.mjs";

const plus = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nextMonthFirst = (iso) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };

export default {
  id: "calendar-spans", title: "Calendar project spans: start -> expected finish, tentative / TBC / past finish / recommences, no-dates list, no money, access unchanged",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/calendarSpans.ts") || "needs lib/calendarSpans.ts",
  async run(t, c) {
    const db = c.db, T = c.today, tag = Date.now().toString(36);
    const MONEY = 987654.32; // a contract value that must never appear in a reply
    const mk = (key, data) => db.project.create({ data: { name: `RC span ${key} ${tag}`, jobNo: `RC-${key}-${tag}`, contractValue: MONEY, ...data } });
    const recStart = nextMonthFirst(T);
    const P = {
      confirmed: await mk("confirmed", { status: "ACTIVE", startDate: plus(T, -7), startDateConfidence: "CONFIRMED", expectedCompletion: plus(T, 30) }),
      tentative: await mk("tentative", { status: "ACTIVE", startDate: plus(T, 10), startDateConfidence: "TENTATIVE", expectedCompletion: plus(T, 60) }),
      tbc: await mk("tbc", { status: "ACTIVE", startDate: plus(T, -3), expectedCompletion: "TBC" }),
      overdue: await mk("overdue", { status: "ACTIVE", startDate: plus(T, -40), startDateConfidence: "CONFIRMED", expectedCompletion: plus(T, -5) }),
      recommences: await mk("recommences", { status: "INACTIVE", startDate: recStart, expectedCompletion: plus(recStart, 30) }),
      nodates: await mk("nodates", { status: "INACTIVE" }),
    };
    // An earlier crewed job on the inactive project - our crew has been there, so it "Recommences" rather than "Starts".
    const person = await db.resource.create({ data: { type: "PERSONNEL", name: `RC span person ${tag}` } });
    const job = await db.job.create({ data: { projectId: P.recommences.id, title: P.recommences.name, date: new Date(`${plus(T, -20)}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    await db.assignment.create({ data: { jobId: job.id, resourceId: person.id, role: "Labourer" } });

    const from = T, to = plus(T, 90);
    const url = `/api/calendar/spans?from=${from}&to=${to}`;
    const r = await c.get(url, "MANAGER");
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch { /* */ }
    t.status(r, 200, "Manager: GET /api/calendar/spans");
    const span = (k) => (body?.spans ?? []).find((s) => s.projectId === P[k].id);

    // (1) The spans and their flags.
    const s1 = span("confirmed");
    t.ok(s1 && s1.start === plus(T, -7) && s1.finish === plus(T, 30) && s1.tentative === false && s1.finishTbc === false && s1.pastFinish === null,
      "active, confirmed: start -> finish, solid, not past finish", JSON.stringify(s1 && { tentative: s1.tentative, tbc: s1.finishTbc, past: s1.pastFinish }));
    t.ok(s1 && s1.from === T && s1.to === plus(T, 30) && s1.clippedStart === true && s1.clippedEnd === false, "...clipped to the range at its start, ends inside it");
    const s2 = span("tentative");
    t.ok(s2 && s2.tentative === true && s2.from === plus(T, 10) && s2.finish === plus(T, 60), "tentative start: flagged tentative", JSON.stringify(s2 && { tentative: s2.tentative, from: s2.from }));
    const s3 = span("tbc");
    t.ok(s3 && s3.finishTbc === true && s3.finish === null && s3.to === to && s3.clippedEnd === true && s3.pastFinish === null,
      "finish TBC: runs to the edge of the view, flagged TBC", JSON.stringify(s3 && { tbc: s3.finishTbc, to: s3.to }));
    const s4 = span("overdue");
    t.ok(s4 && s4.pastFinish?.reason === "STILL_ACTIVE" && s4.pastFinish?.until === T && s4.from === T && s4.to === T,
      "still active after its expected finish: past expected finish, the bar carries on to today", JSON.stringify(s4 && s4.pastFinish));
    const s5 = span("recommences");
    t.ok(s5 && s5.status === "INACTIVE" && s5.upcoming?.kind === "RECOMMENCES" && s5.upcoming?.date === recStart && s5.from === recStart,
      "inactive, starting next month after earlier crew days: 'Recommences <date>'", JSON.stringify(s5 && s5.upcoming));
    t.ok(!span("nodates"), "inactive with no dates: not drawn");

    // (2) The no-dates list.
    const nd = (body?.noDates ?? []).find((p) => p.projectId === P.nodates.id);
    t.ok(nd?.reason === "NO_START" && nd?.status === "INACTIVE", "inactive with no dates: listed under 'No dates yet'", JSON.stringify(nd ?? null));
    t.ok(!(body?.noDates ?? []).some((p) => [P.confirmed, P.tentative, P.tbc, P.overdue, P.recommences].some((x) => x.id === p.projectId)), "dated projects are not on the no-dates list");

    // (3) Outside the range: a range before every seeded span shows none of them.
    const early = (await c.json(`/api/calendar/spans?from=${plus(T, -400)}&to=${plus(T, -300)}`, "MANAGER")).body;
    t.ok(Array.isArray(early?.spans) && !early.spans.some((s) => Object.values(P).some((p) => p.id === s.projectId)), "a range a year back shows none of the seeded spans");
    t.status(await c.get(`/api/calendar/spans?from=${to}&to=${from}`, "MANAGER"), 400, "to before from: 400");
    t.status(await c.get(`/api/calendar/spans?from=${T}`, "MANAGER"), 400, "no to: 400");
    t.status(await c.get(`/api/calendar/spans?from=${T}&to=${plus(T, 500)}`, "MANAGER"), 400, "more than 400 days: 400");

    // (4) No money: no money field, no "$" + digit, the seeded contract value nowhere (Manager and the coordinator).
    const moneyKeys = /"(contractValue|contractValueNotes|costToDate|dailyRateExGst|rate|amountExGst)"/;
    t.ok(noMoney(text) && !moneyKeys.test(text) && !text.includes("987654"), "Manager reply: no money field, no $ figure, no contract value");
    const co = await c.get(url, "COORDINATOR");
    const coText = await co.text();
    t.ok(co.status === 200 && noMoney(coText) && !moneyKeys.test(coText) && !coText.includes("987654"), "Coordinator reply: 200, no money", co.status);
    const keys = new Set((body?.spans ?? []).flatMap((s) => Object.keys(s)));
    const allowed = ["projectId", "name", "jobNo", "status", "start", "finish", "finishTbc", "tentative", "pastFinish", "upcoming", "from", "to", "clippedStart", "clippedEnd"];
    t.ok([...keys].every((k) => allowed.includes(k)), "a span carries only names, dates and flags", [...keys].filter((k) => !allowed.includes(k)).join(","));

    // (5) Exactly the access /api/calendar has: the same answer for every login.
    const cal = `/api/calendar?from=${from}&to=${plus(T, 6)}`;
    for (const who of ["VIEWER", "MANAGER", "ADMIN", "COORDINATOR", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD", null]) {
      if (who && !c.users[who]) { t.note(`no ${who} test login - skipped`); continue; }
      const a = (await c.get(cal, who)).status, b = (await c.get(url, who)).status;
      const open = ["VIEWER", "MANAGER", "ADMIN", "COORDINATOR"].includes(who);
      const ok = open ? a === 200 && b === 200 : a === b && (a === 401 || a === 403);
      t.ok(ok, `${who ?? "no login"}: /api/calendar ${a}, /api/calendar/spans ${b} (want ${open ? "200" : "the same 401 / 403"} for both)`);
    }
    const v = await c.get(url, "VIEWER");
    const vText = await v.text();
    t.ok(noMoney(vText) && !moneyKeys.test(vText), "Viewer reply: no money");

    // (6) Read-only: no write method on the spans route; nothing changed on the seeded projects.
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      const w = await c.req(m, url, "ADMIN", {});
      t.ok(w.status >= 400, `${m} /api/calendar/spans refused`, w.status);
    }
    const after = await db.project.findMany({ where: { id: { in: Object.values(P).map((p) => p.id) } }, select: { id: true, startDate: true, expectedCompletion: true, status: true, updatedAt: true } });
    t.ok(after.length === 6 && after.every((a) => { const b = Object.values(P).find((p) => p.id === a.id); return b && a.startDate === b.startDate && a.expectedCompletion === b.expectedCompletion && a.status === b.status && +a.updatedAt === +b.updatedAt; }),
      "the seeded projects are unchanged after every read");

    // (7) The page itself still loads for a Viewer and the coordinator.
    for (const who of ["VIEWER", "COORDINATOR"]) {
      const pg = await c.text("/calendar", who);
      t.ok(pg.status === 200 && !/Application error/.test(pg.text), `page /calendar (${who})`, pg.status);
    }
  },
};
