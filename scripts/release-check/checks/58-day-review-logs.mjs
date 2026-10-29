// Day Review's site-log extras (30 Oct 2026): the all-logs summary at the top, "What was said" (each recording's raw
// transcript, money-free) and the full daily site report inline. Raw transcripts and the report are Managers and up
// only - refused (or left out) for VIEWER, TIMESHEETS, ACCOUNTS and DIRECTOR; a VIEWER still sees Day Review as
// before, plus the summary. Nothing goes out: no AI call is made here - the recording row is written on the copy.
// WRITES a job for today on the copy (the supervisor on it), one finished recording row and one site log.
import { makeLink } from "../lib/setup.mjs";

const sydneyDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const noMoney = (x) => !/\$\s?\d/.test(JSON.stringify(x ?? ""));
const SAID = "Strip-out on level two all day, skip bin was $650, Kobelco six hours";

export default {
  id: "day-review-logs", title: "Day Review site logs: summary, raw transcripts and the inline report - Manager+ only, no money",
  writes: true,
  applies: (c) => c.hasPath("src/lib/dailyLog/dayReview.ts") || "needs the Day Review site-log extras",
  async run(t, c) {
    const L = c.links;
    if (!L.sup) return t.block(L.missing.join("; "));
    const day = sydneyDay();
    const project = await c.db.project.findFirst({ where: { archived: false, jobs: { none: { date: new Date(`${day}T00:00:00Z`) } } }, select: { id: true, name: true } });
    if (!project) return t.block("no active project without a job today on the copy");
    const job = await c.db.job.create({ data: { title: project.name, projectId: project.id, date: new Date(`${day}T00:00:00Z`), shift: "DAY", startTime: "6:30am", endTime: "3pm" } });
    await c.db.assignment.create({ data: { jobId: job.id, resourceId: L.sup.resourceId } });
    // A fresh supervisor link, so the earlier checks' recordings on the shared one don't matter.
    const link = await makeLink(c.db, "SUPERVISOR", L.sup.resourceId);

    // Before the log: the summary lists the job, not logged yet.
    const before = await c.json(`/api/day-review/site-logs?date=${day}`, "MANAGER");
    t.status({ status: before.status }, 200, "a Manager opens Day Review's site logs");
    const row0 = (before.body?.summary ?? []).find((s) => s.jobId === job.id);
    t.ok(row0 && row0.state !== "LOGGED" && row0.supervisors.length > 0, "the summary lists today's job with its supervisor, not logged yet", JSON.stringify(row0));

    // A finished recording (written on the copy - no AI call) with an amount in it, used by the log.
    const voice = await c.db.dailyLogVoice.create({ data: {
      siteLinkId: link.id, jobId: job.id, day, status: "DONE", seconds: 95, transcript: SAID,
      cleaned: JSON.stringify({ sections: [{ heading: "Work done", text: "Strip-out on level 2 all day. Skip bin was $650." }], delays: [], checkThis: [], amountsRemoved: true }),
    } });
    const sent = await fetch(`${c.base}${c.site(link, "/log")}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, crewOk: false, crewNote: "Release check", handCrew: 2, handHours: 8, hours: [{ code: "STR-02", hours: 8 }], noDelays: true, noDockets: true, note: "Work done: Strip-out on level 2 all day.", voiceIds: [voice.id] }),
    });
    t.status(sent, 201, "the supervisor sends a log made from the recording");

    // Managers and Admins: the summary says voice, and "What was said" has the words - with the amount taken out.
    for (const who of ["MANAGER", "ADMIN"]) {
      const r = await c.json(`/api/day-review/site-logs?date=${day}`, who);
      t.status({ status: r.status }, 200, `${who}: Day Review's site logs open`);
      const s = (r.body?.summary ?? []).find((x) => x.jobId === job.id);
      t.ok(s?.state === "LOGGED" && s.byVoice === true && !!s.at, `${who}: the summary shows it logged, by voice, with the time`, JSON.stringify(s));
      const j = (r.body?.jobs ?? []).find((x) => x.jobId === job.id);
      const v = j?.transcripts?.[0];
      t.ok(j?.transcripts?.length === 1 && v.id === voice.id && v.seconds === 95, `${who}: "What was said" has the recording, with its length`, JSON.stringify(j?.transcripts ?? null).slice(0, 200));
      t.ok(v && /level two/.test(v.transcript) && !/650/.test(v.transcript) && /Strip-out/.test(v.tidied ?? ""), `${who}: ...word for word next to the tidied text, the amount taken out`, v?.transcript);
      t.ok(noMoney(r.body), `${who}: no dollar figure anywhere in the reply`);
    }

    // A VIEWER sees Day Review as before, plus the summary - never the raw words.
    const dr = await c.get(`/api/day-review?date=${day}`, "VIEWER");
    t.status(dr, 200, "VIEWER: Day Review still opens");
    const vr = await c.json(`/api/day-review/site-logs?date=${day}`, "VIEWER");
    t.status({ status: vr.status }, 200, "VIEWER: the site logs still open");
    const vj = (vr.body?.jobs ?? []).find((x) => x.jobId === job.id);
    t.ok(vj && !("transcripts" in vj), "VIEWER: the log is there, with no transcripts field", vj ? Object.keys(vj).join(",") : "no job");
    t.ok(!JSON.stringify(vr.body ?? {}).includes("level two"), "VIEWER: the recording's words are nowhere in the reply");
    t.ok(Object.keys(vr.body?.budgets ?? {}).length === 0, "VIEWER: still no hours-vs-budget tables");
    t.ok((vr.body?.summary ?? []).some((s) => s.jobId === job.id && s.state === "LOGGED"), "VIEWER: the summary is there");
    t.ok(noMoney(vr.body), "VIEWER: no dollar figure");

    // The inline report reads the office's report route: Manager+ only.
    const rep = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.ok(rep.status === 200 && rep.body?.report?.log && noMoney(rep.body), "a Manager gets the full report for the card, no dollar figure");
    t.status(await c.get(`/api/daily-report/${job.id}`, "VIEWER"), [401, 403], "VIEWER: the inline report is refused");
    for (const who of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) {
      t.status(await c.get(`/api/day-review/site-logs?date=${day}`, who), [401, 403], `${who}: Day Review's site logs (and their transcripts) are refused`);
      t.status(await c.get(`/api/day-review?date=${day}`, who), [401, 403], `${who}: Day Review is refused`);
      t.status(await c.get(`/api/daily-report/${job.id}`, who), [401, 403], `${who}: the inline report is refused`);
    }
    t.status(await c.get(`/api/day-review/site-logs?date=${day}`, null), [401, 403], "no login: refused");
  },
};
