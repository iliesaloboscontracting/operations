// Daily log voice entry and the written daily site report (29 Oct 2026; docs/lci/DAILY-LOG-VOICE-DESIGN.md).
// Voice: an office or driver link gets 404; a supervisor link with no job today 403; the 20-a-day limit gives 429
// (checked before "is voice available", so it's proven here with no AI keys); with no keys the route says
// "type it instead" (503) and the log screen hides the mic; every reply passes the money guard. No outbound call is
// possible here - the release check's .env has no OPENAI / ANTHROPIC key, and the no-outbound guard watches.
// Report: Manager+ and the directors' copy; never a dollar figure.
// WRITES a job for today on the copy (the supervisor on it) and 20 voice-limit rows.
import http from "node:http";
import { readFileSync } from "node:fs";
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
    // The job and length go in the address (SEC-003: checked before the recording is read); the form has the audio.
    const voice = (link, body) => {
      const form = new FormData();
      if (body.audio) form.append("audio", body.audio);
      return fetch(`${c.base}${c.site(link, "/log/voice")}?jobId=${encodeURIComponent(body.jobId ?? "")}&seconds=${body.seconds ?? 5}`, { method: "POST", body: form });
    };
    const audio = () => new Blob([new Uint8Array(2048)], { type: "audio/webm" });

    // Who can't use it.
    t.status(await voice(L.office, { jobId: "x", seconds: "5", audio: audio() }), 404, "an office link can't use voice");
    const driver = await makeLink(c.db, "DRIVER", L.sup.resourceId);
    t.status(await voice(driver, { jobId: "x", seconds: "5", audio: audio() }), 404, "a driver link can't use voice");
    t.status(await voice(L.sup, { jobId: "not-a-job", seconds: "5", audio: audio() }), 403, "a supervisor link: only a job they can log today");

    // A job today with the supervisor on it.
    const day = sydneyDay();
    // A project with no job today (one job per project, day and shift).
    const project = await c.db.project.findFirst({ where: { archived: false, jobs: { none: { date: new Date(`${day}T00:00:00Z`) } } }, select: { id: true, name: true } });
    if (!project) return t.block("no active project without a job today on the copy");
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

    // SEC-001: 25 at once on one link - never more than one worked on at a time, none slips through, rows counted right.
    const burst = await makeLink(c.db, "SUPERVISOR", L.sup.resourceId);
    const rowsBefore = await c.db.dailyLogVoice.count({ where: { siteLinkId: burst.id } });
    const results = await Promise.all(Array.from({ length: 25 }, () => voice(burst, { jobId: job.id, audio: audio() }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }))));
    const by = (s) => results.filter((x) => x.s === s).length;
    t.ok(results.every((x) => x.s === 429 || x.s === 503), "25 at once: every reply is 429 or 503 (voice off here) - none accepted", JSON.stringify(results.map((x) => x.s)));
    t.ok(by(429) >= 1 && results.filter((x) => x.s === 429).every((x) => /one recording at a time|most recordings/i.test(x.b.error ?? "")), "...the extra ones told 'one recording at a time'", `${by(429)} x 429`);
    t.ok((await c.db.dailyLogVoice.count({ where: { siteLinkId: burst.id } })) === rowsBefore, "...and no limit row written while voice is off");
    t.ok(results.every((x) => noMoney(x.b)), "...no dollar figure in any reply");

    // SEC-003: no Content-Length -> 411, too big -> 413 - both before the form is read.
    // A raw request (fetch always sets Content-Length itself); never left hanging - 20 s at most.
    const raw = (headers, body) => new Promise((resolve) => {
      const u = new URL(`${c.base}${c.site(burst, "/log/voice")}?jobId=${job.id}&seconds=5`);
      let done = false;
      const finish = (s) => { if (!done) { done = true; clearTimeout(timer); rq.destroy(); resolve(s); } };
      const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers }, (res) => { res.resume(); finish(res.statusCode); });
      const timer = setTimeout(() => finish(-2), 20_000);
      rq.on("error", () => finish(-1));
      if (body) rq.write(body);
      rq.end();
    });
    // SEC-011: a missing Content-Length isn't refused for that alone (the body is then read byte-counted, stopped at
    // 6.25 MB) - the checks before reading still come first: voice is off here, so 503.
    t.status({ status: await raw({ "content-type": "multipart/form-data; boundary=x", "transfer-encoding": "chunked" }, "--x--") }, 503, "no Content-Length: not refused for that - the pre-body checks answer (voice off -> 503)");
    const big = Buffer.alloc(7 * 1024 * 1024); // a real 7 MB body, so the request is whole
    t.status({ status: await raw({ "content-type": "multipart/form-data; boundary=x", "content-length": String(big.length) }, big) }, 413, "a Content-Length over 6.25 MB -> 413 before reading it");

    // Links that can't use it: revoked supervisor, expired hand-over; a hand-over sending another job.
    const revoked = await makeLink(c.db, "SUPERVISOR", L.sup.resourceId);
    await c.db.siteLink.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    t.status(await voice(revoked, { jobId: job.id, audio: audio() }), 404, "a revoked supervisor link -> 404");
    const expired = await makeLink(c.db, "HANDOVER", L.sup.resourceId, { jobId: job.id, expiresAt: new Date(Date.now() - 3600_000) });
    t.status(await voice(expired, { jobId: job.id, audio: audio() }), 404, "an expired hand-over link -> 404");
    const handover = await makeLink(c.db, "HANDOVER", L.sup.resourceId, { jobId: job.id, expiresAt: new Date(Date.now() + 3600_000) });
    const other = await c.db.job.findFirst({ where: { id: { not: job.id } }, select: { id: true } });
    t.status(await voice(handover, { jobId: other?.id ?? "x", audio: audio() }), 403, "a hand-over link sending another job's id -> 403");

    // SEC-010: a hire worker who signed in with company "$5 Labour" - the log screen and the report still open, no $.
    await c.db.siteAttendance.create({ data: { jobId: job.id, date: day, workerName: "Hire Worker $40", company: "$5 Labour", signInAt: new Date(Date.now() - 3 * 3600_000), signInMethod: "MANUAL", status: "CONFIRMED", allocated: false } });
    const hireView = await c.json(c.site(L.sup, "/log"), null);
    t.status({ status: hireView.status }, 200, "with a \"$5 Labour\" hire sign-in the log screen opens");
    t.ok(noMoney(hireView.body), "...with no dollar figure");
    const hireRep = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.status({ status: hireRep.status }, 200, "...and the daily site report opens");
    t.ok(noMoney(hireRep.body) && JSON.stringify(hireRep.body).includes("Labour"), "...with no dollar figure (the company shows as Labour)");

    // DLV-SEC-013: a company typed "$$$5 5 5" (saved as it was typed) - the log screen, the report and the supervisor's
    // "Approve hours" screen all still open, with no dollar figure.
    await c.db.siteAttendance.create({ data: { jobId: job.id, date: day, workerName: "Hire Two", company: "$$$5 5 5", signInAt: new Date(Date.now() - 2 * 3600_000), signInMethod: "MANUAL", status: "CONFIRMED", allocated: false } });
    const oddView = await c.json(c.site(L.sup, "/log"), null);
    t.status({ status: oddView.status }, 200, "with a \"$$$5 5 5\" company sign-in the log screen opens");
    t.ok(noMoney(oddView.body) && !JSON.stringify(oddView.body).includes("$"), "...with no $ anywhere");
    const oddRep = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.status({ status: oddRep.status }, 200, "...the daily site report opens");
    t.ok(noMoney(oddRep.body) && !JSON.stringify(oddRep.body).includes("$"), "...with no $ anywhere");
    const oddHours = await c.json(c.site(L.sup, `/hours?date=${day}`), null);
    t.status({ status: oddHours.status }, 200, "...and the supervisor's Approve hours screen opens (\"$5 Labour\" and \"$$$5 5 5\" saved before the fix)");
    t.ok(noMoney(oddHours.body) && !JSON.stringify(oddHours.body).includes("$"), "...with no $ anywhere");

    // SEC-002: a typed "$650" in the note is taken out - the screen and the report still open, with no dollar figure.
    const sent = await fetch(`${c.base}${c.site(L.sup, "/log")}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, crewOk: false, crewNote: "Nobody signed in - 2 of us, hire guy wanted $300", handCrew: 2, handHours: 8, hours: [{ code: "STR-02", hours: 8 }], noDelays: true, noDockets: true, note: "Skip lift was $650, call me" }),
    });
    const sentBody = await sent.json().catch(() => ({}));
    t.status(sent, 201, "a log with \"$650\" typed in the note is accepted");
    t.ok(noMoney(sentBody) && /tell the office/.test(sentBody.amountsNotice ?? ""), "...the amount taken out, and the supervisor told", JSON.stringify(sentBody).slice(0, 200));
    const after = await c.json(c.site(L.sup, "/log"), null);
    t.status({ status: after.status }, 200, "the log screen still opens");
    t.ok(noMoney(after.body), "...with no dollar figure");
    const repAfter = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.status({ status: repAfter.status }, 200, "the daily site report still opens");
    t.ok(noMoney(repAfter.body), "...with no dollar figure");

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

    // SEC-008: no link secret in the server's error log lines (an error on a site route logs /api/site/[link]).
    const secrets = [L.sup, L.office, driver, burst, revoked, expired, handover].map((l) => l.secret);
    let serverLog = "";
    try { serverLog = readFileSync(c.p.serverLog, "utf8"); } catch { /* no log yet */ }
    const apiLines = serverLog.split(/\r?\n/).filter((l) => l.includes("[api]"));
    t.ok(!apiLines.some((l) => secrets.some((s) => l.includes(s))), "no link secret in any [api] error line", `${apiLines.length} [api] lines`);
    t.ok(apiLines.filter((l) => l.includes("/api/site/")).every((l) => /\/api\/site\/(\[link\]|in\/\[code\])/.test(l)), "site routes are logged as /api/site/[link]");
  },
};
