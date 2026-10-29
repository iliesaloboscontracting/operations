// Daily log voice entry and the written daily site report (29 Oct 2026; docs/lci/DAILY-LOG-VOICE-DESIGN.md).
// Voice: an office or driver link gets 404; a supervisor link with no job today 403; the 20-a-day limit gives 429
// (checked before "is voice available", so it's proven here with no AI keys); with no keys the route says
// "type it instead" (503) and the log screen hides the mic; every reply passes the money guard. No outbound call is
// possible here - the release check's .env has no OPENAI / ANTHROPIC key, and the no-outbound guard watches.
// Report: Manager+ and the directors' copy; never a dollar figure.
// WRITES a job for today on the copy (the supervisor on it) and 20 voice-limit rows.
import { makeLink } from "../lib/setup.mjs";

const sydneyDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const noMoney = (x) => !/\$\s?\d/.test(JSON.stringify(x ?? ""));

export default {
  id: "daily-log-voice", title: "Daily log voice and the written daily site report: links, limit, voice off, money guard",
  writes: true,
  applies: (c) => c.hasPath("src/app/api/site/[token]/log/voice/route.ts") || "needs the daily log voice route",
  async run(t, c) {
    const L = c.links;
    if (!L.sup || !L.office) return t.block(L.missing.join("; "));
    const voice = (link, body) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(body)) form.append(k, v);
      return fetch(`${c.base}${c.site(link, "/log/voice")}`, { method: "POST", body: form });
    };
    const audio = () => new Blob([new Uint8Array(2048)], { type: "audio/webm" });

    // Who can't use it.
    t.status(await voice(L.office, { jobId: "x", seconds: "5", audio: audio() }), 404, "an office link can't use voice");
    const driver = await makeLink(c.db, "DRIVER", L.sup.resourceId);
    t.status(await voice(driver, { jobId: "x", seconds: "5", audio: audio() }), 404, "a driver link can't use voice");
    t.status(await voice(L.sup, { jobId: "not-a-job", seconds: "5", audio: audio() }), 403, "a supervisor link: only a job they can log today");

    // A job today with the supervisor on it.
    const day = sydneyDay();
    const project = await c.db.project.findFirst({ where: { archived: false }, select: { id: true, name: true } });
    const job = await c.db.job.create({ data: { title: project?.name ?? "Release check job", projectId: project?.id ?? null, date: new Date(`${day}T00:00:00Z`), shift: "DAY", startTime: "6:30am", endTime: "3pm" } });
    await c.db.assignment.create({ data: { jobId: job.id, resourceId: L.sup.resourceId } });

    const view = await c.json(c.site(L.sup, "/log"), null);
    t.status({ status: view.status }, 200, "the supervisor's log screen opens (DAILY_LOG_PILOT_LINKS=all)");
    t.ok(view.body?.voice === false, "no AI keys here: the screen hides the mic", `voice: ${view.body?.voice}`);
    t.ok(noMoney(view.body), "the log screen carries no dollar figure");
    t.ok((view.body?.jobs ?? []).some((j) => j.jobId === job.id), "today's job is on it");

    const off = await voice(L.sup, { jobId: job.id, seconds: "5", audio: audio() });
    const offBody = await off.json().catch(() => ({}));
    t.status(off, 503, "voice unavailable (no keys): 503");
    t.ok(/type it instead/i.test(offBody.error ?? ""), "...saying to type it instead", offBody.error);
    t.ok(noMoney(offBody), "...and no dollar figure");

    // The day's limit, counted in the database: 20 used -> the 21st is refused, before anything is heard.
    await c.db.dailyLogVoice.createMany({ data: Array.from({ length: 20 }, () => ({ siteLinkId: L.sup.id, jobId: job.id, day, status: "DONE" })) });
    const capped = await voice(L.sup, { jobId: job.id, seconds: "5", audio: audio() });
    const capBody = await capped.json().catch(() => ({}));
    t.status(capped, 429, "the 21st recording today is refused");
    t.ok(/most recordings/i.test(capBody.error ?? "") && noMoney(capBody), "...with a plain message", capBody.error);

    // The written daily site report.
    const rep = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.status({ status: rep.status }, 200, "a Manager opens the daily site report");
    t.ok(rep.body?.report?.jobId === job.id && noMoney(rep.body), "...for that job, with no dollar figure");
    // The office's copy: Manager+ only (it isn't on the photos tunnel - behind Access plus the login).
    for (const who of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) {
      t.status(await c.get(`/api/daily-report/${job.id}`, who), [401, 403], `${who} can't open the office's copy`);
      t.status(await c.get(`/api/daily-report?projectId=${project?.id ?? "x"}`, who), [401, 403], `${who} can't list the office's reports`);
    }
    t.status(await c.get(`/api/daily-report/${job.id}`, null), [401, 403], "no login, no report");
    const dir = await c.json(`/api/directors/daily-report/${job.id}`, "DIRECTOR");
    t.status({ status: dir.status }, 200, "a DIRECTOR login opens the directors' copy");
    t.ok(noMoney(dir.body), "...with no dollar figure");
    // The directors' copy: director access only.
    for (const who of ["MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS"]) {
      t.status(await c.get(`/api/directors/daily-report/${job.id}`, who), [401, 403], `${who} can't open the directors' copy`);
      t.status(await c.get(`/api/directors/daily-report/photo?log=x&file=y`, who), [401, 403], `${who} can't fetch a directors'-copy photo`);
    }
  },
};
