// Site poster guard (Ilies, 11 Nov 2026: "do 1 and 2, deploy once it passes") + the "how they signed in / location"
// indicator on the Sign-ins page (Ilies, 11 Nov 2026).
//   1. A site poster sign-in with no location, or far from where the site's crew sign in, is accepted and flagged
//      (NO_LOCATION / FAR_FROM_SITE) - never blocked, hours unchanged; the supervisor's link shows the words and
//      "Confirm all" skips those.
//   2. A site poster sign-IN outside 1 h before the start .. 2 h after the finish is refused - nothing saved, no other
//      sign-in ended. Sign-out never; office / yard / truck points, the supervisor's QR, hand-overs, ticks and the
//      office's "Missed sign-in" never.
// Every job is on TODAY (the poster only opens today's jobs); the times are picked from the clock so "now" is inside
// one job's window and outside the other's - no fake clock. Made-up people, projects, a truck and links on the test
// copy only. WRITES: two projects + jobs, people, a truck, links, sign-ins.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const SITE = { lat: -33.871234, lng: 151.204567 }; // made up; ~111 m per 0.001 deg of latitude
const COORD_TEXT = /33\.87|151\.20|gpsLat|gpsLng|gpsAccuracy|"lat"|"lng"/;
const sydNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};
const ampm = (mins) => { const h = Math.floor(mins / 60) % 24, m = mins % 60; return `${h % 12 === 0 ? 12 : h % 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`; };

export default {
  id: "poster-guard", title: "Site poster guard (no location / far flags, sign-in window) + how they signed in / location on Sign-ins",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/posterGuard/rules.ts") || "needs lib/posterGuard/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const today = c.today;
    const linkText = [];
    const keep = async (r) => { const text = await r.text().catch(() => ""); linkText.push(text); let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body }; };

    const before = (await c.json(`/api/attendance?date=${today}`, "MANAGER")).body;
    t.ok(typeof before?.summary?.location === "number", "the Sign-ins summary strip carries a 'no location / far' count", JSON.stringify(before?.summary ?? null));

    // Seed. P: a day job whose window includes now. P2: a day job whose window is closed now.
    const now = sydNow();
    const pStart = Math.max(0, Math.floor((now - 60) / 60) * 60), pEnd = Math.min(now + 60, 23 * 60 + 59);
    const [qStart, qEnd] = now >= 12 * 60 ? ["1am", "2am"] : ["9pm", "10pm"];
    const P = await db.project.create({ data: { name: `RC poster guard ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 30 } });
    const P2 = await db.project.create({ data: { name: `RC poster closed ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 30 } });
    const day = new Date(`${today}T00:00:00.000Z`);
    const job = await db.job.create({ data: { projectId: P.id, title: P.name, date: day, shift: "DAY", status: "ACTIVE", startTime: ampm(pStart), endTime: ampm(pEnd) } });
    const shut = await db.job.create({ data: { projectId: P2.id, title: P2.name, date: day, shift: "DAY", status: "ACTIVE", startTime: qStart, endTime: qEnd } });
    const person = (n) => db.resource.create({ data: { type: "PERSONNEL", name: `Rcposter${n} Tester ${tag}` } });
    const [S, A, B, F, N, C, W, O, Q, M, H, H2, HT, X, Y, T, Z] = await Promise.all(
      ["s", "a", "b", "f", "n", "c", "w", "o", "q", "m", "h", "h2", "ht", "x", "y", "t", "z"].map(person));
    for (const r of [S, A, B, F, N, C]) await db.assignment.create({ data: { jobId: job.id, resourceId: r.id, ...(r === S ? { role: "Supervisor" } : {}) } });
    for (const r of [S, W, O, Q, M, H, H2, HT]) await db.assignment.create({ data: { jobId: shut.id, resourceId: r.id, ...(r === S ? { role: "Supervisor" } : {}) } });
    const hourAgo = new Date(Date.now() - 3_600_000);
    // The site's crew: 3 confirmed GPS sign-ins at the same spot from 2 people.
    const fixRow = (r, i) => db.siteAttendance.create({ data: {
      jobId: job.id, date: today, resourceId: r.id, workerName: r.name, allocated: true, signInMethod: "SUPERVISOR_QR", status: "CONFIRMED",
      signInAt: new Date(hourAgo.getTime() + i * 60_000), ...(i === 0 ? { signOutAt: new Date(hourAgo.getTime() + 30 * 60_000), signOutMethod: "SUPERVISOR_QR" } : {}),
      gpsStatus: "OK", gpsLat: SITE.lat + i * 0.00002, gpsLng: SITE.lng, gpsAccuracyM: 15 } });
    await fixRow(A, 0); await fixRow(A, 1); await fixRow(B, 2);
    const poster = await makeLink(db, "POSTER", null, { projectId: P.id });
    const posterShut = await makeLink(db, "POSTER", null, { projectId: P2.id });
    const office = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const yard = await makeLink(db, "POSTER", null, { place: "YARD" });
    const truck = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC poster truck ${tag}`, identifier: `RCPG${tag}`.slice(0, 12), ownership: "OWNED", status: "AVAILABLE" } });
    const truckQr = await makeLink(db, "POSTER", truck.id, { place: "VEHICLE" });
    const sup = await makeLink(db, "SUPERVISOR", S.id);
    const hand = await makeLink(db, "HANDOVER", H.id, { jobId: shut.id, expiresAt: new Date(Date.now() + 6 * 3_600_000) });

    const scan = async (code) => keep(await c.get(`/api/site/in/${encodeURIComponent(code)}`, null));
    const sign = async (code, jobId, action, who, gps) => {
      const s = await scan(code);
      const r = await keep(await c.post("/api/site/in/sign", null, { ticket: s.body?.ticket, jobId, action, resourceId: who.id, deviceId: `rc81-${who.id}`, ...(gps ? { gps } : {}) }));
      return { ...r, scan: s };
    };
    const at = (lat, accuracy = 20) => ({ status: "OK", lat, lng: SITE.lng, accuracy });

    // (1) Flags - accepted, never blocked.
    const far = await sign(poster.secret, job.id, "IN", F, at(SITE.lat + 0.0162));
    t.ok(far.status === 200 && !far.scan.body?.jobs?.some((j) => j.signInClosed), "a poster sign-in 1.8 km away is accepted (the window is open)", far.status);
    const denied = await sign(poster.secret, job.id, "IN", N, { status: "DENIED" });
    t.status({ status: denied.status }, 200, "a poster sign-in with location refused is accepted");
    const clean = await sign(poster.secret, job.id, "IN", C, at(SITE.lat + 0.0003, 10));
    t.status({ status: clean.status }, 200, "a poster sign-in on site is accepted");
    const view = await c.json(`/api/attendance?date=${today}`, "MANAGER");
    const g = view.body?.jobs?.find((j) => j.id === job.id);
    const rowOf = (r, grp = g) => grp?.rows?.find((x) => x.resourceId === r.id);
    t.ok(rowOf(F)?.flags?.includes("FAR_FROM_SITE") && rowOf(F)?.notes?.FAR_FROM_SITE === "1.8 km from site", "FAR_FROM_SITE '1.8 km from site' on the Sign-ins page", JSON.stringify(rowOf(F)?.notes ?? null));
    t.ok(rowOf(N)?.flags?.includes("NO_LOCATION") && rowOf(N)?.notes?.NO_LOCATION === "No location shared", "NO_LOCATION 'No location shared'", JSON.stringify(rowOf(N)?.notes ?? null));
    t.ok(!rowOf(C)?.flags?.some((f) => f === "FAR_FROM_SITE" || f === "NO_LOCATION"), "on site: no location flag");
    t.ok(![A, B].some((r) => rowOf(r)?.flags?.some((f) => f === "FAR_FROM_SITE" || f === "NO_LOCATION")), "supervisor QR lines never get a poster flag");
    t.ok((view.body?.summary?.location ?? NaN) - (before?.summary?.location ?? NaN) === 2, "the summary strip: +2 no location / far", JSON.stringify(view.body?.summary ?? null));
    t.ok(rowOf(F)?.status === "TO_CONFIRM" && rowOf(N)?.status === "TO_CONFIRM", "flags change nothing - both still wait for the supervisor");

    // (2) The window - poster sign-IN only.
    await db.siteAttendance.create({ data: { place: "OFFICE", placeLabel: "Office", date: today, resourceId: W.id, workerName: W.name, allocated: true, signInMethod: "POINT", status: "CONFIRMED", signInAt: hourAgo } });
    const wScan = await scan(posterShut.secret);
    const closedJob = wScan.body?.jobs?.find((j) => j.id === shut.id);
    t.ok(/^This site's sign-in QR works from \d{1,2}:\d{2}(am|pm) to \d{1,2}:\d{2}(am|pm)( the next morning)?\. If you're on site now, see your supervisor\.$/.test(closedJob?.signInClosed ?? ""),
      "the scan already says the poster's sign-in is closed (before a name is picked)", closedJob?.signInClosed ?? "(none)");
    const status = await keep(await c.post("/api/site/in/sign", null, { ticket: wScan.body?.ticket, jobId: shut.id, action: "STATUS", resourceId: W.id }));
    t.ok(status.status === 200 && status.body?.signInClosed === closedJob?.signInClosed, "STATUS says so too", status.status);
    const refused = await keep(await c.post("/api/site/in/sign", null, { ticket: wScan.body?.ticket, jobId: shut.id, action: "IN", resourceId: W.id, deviceId: `rc81-${W.id}`, gps: at(SITE.lat) }));
    t.ok(refused.status === 403 && refused.body?.error === closedJob?.signInClosed, "a poster sign-in outside the window is refused with the window in words", refused.status);
    t.ok((await db.siteAttendance.count({ where: { jobId: shut.id, resourceId: W.id } })) === 0, "...no sign-in row was made");
    const wOffice = await db.siteAttendance.findFirst({ where: { resourceId: W.id, place: "OFFICE", date: today } });
    t.ok(wOffice && !wOffice.signOutAt && !wOffice.signOutMethod, "...and their open office sign-in was NOT ended");
    // Sign-out at any time.
    await db.siteAttendance.create({ data: { jobId: shut.id, date: today, resourceId: O.id, workerName: O.name, allocated: true, signInMethod: "POSTER", status: "TO_CONFIRM", signInAt: new Date(Date.now() - 2 * 3_600_000), gpsStatus: "OK", gpsLat: SITE.lat, gpsLng: SITE.lng, gpsAccuracyM: 10 } });
    const out = await sign(posterShut.secret, shut.id, "OUT", O);
    t.ok(out.status === 200 && !!(await db.siteAttendance.findFirst({ where: { jobId: shut.id, resourceId: O.id } }))?.signOutAt, "a poster sign-OUT outside the window is allowed", out.status);

    // Every other way in is unaffected on the same closed job / at any time.
    const supView = await keep(await c.get(c.site(sup, "/signin"), null));
    const code = (j) => decodeURIComponent((j?.qrUrl ?? "").split("/in/").pop() ?? "");
    const qr = await sign(code(supView.body?.jobs?.find((j) => j.id === shut.id)), shut.id, "IN", Q, { status: "UNAVAILABLE" });
    t.ok(qr.status === 200 && qr.scan.body?.method === "SUPERVISOR_QR", "the supervisor's QR on the closed job still signs in", qr.status);
    const handView = await keep(await c.get(c.site(hand, "/signin"), null));
    const hq = await sign(code(handView.body?.jobs?.[0]), shut.id, "IN", H2, { status: "OK", lat: SITE.lat, lng: SITE.lng, accuracy: 12 });
    t.status({ status: hq.status }, 200, "a hand-over QR on the closed job still signs in");
    t.status(await c.post(c.site(hand, "/signin"), null, { action: "MANUAL_IN", jobId: shut.id, resourceId: HT.id }), 200, "a hand-over tick still signs in");
    t.status(await c.post(c.site(sup, "/signin"), null, { action: "MANUAL_IN", jobId: shut.id, resourceId: M.id }), 200, "a supervisor tick still signs in");
    const missed = await c.post("/api/attendance", "MANAGER", { jobId: shut.id, resourceId: Z.id, signInAt: hourAgo.toISOString(), reason: "RC 81 missed sign-in" });
    t.ok(missed.status === 200 || missed.status === 201, "the office's 'Missed sign-in' still adds one", missed.status);
    const off = await sign(office.secret, office.id, "IN", X, { status: "DENIED" });
    const yd = await sign(yard.secret, yard.id, "IN", Y, { status: "OK", lat: SITE.lat, lng: SITE.lng, accuracy: 30 });
    const tr = await sign(truckQr.secret, truckQr.id, "IN", T, { status: "TIMEOUT" });
    t.ok(off.status === 200 && yd.status === 200 && tr.status === 200 && ![off, yd, tr].some((x) => x.scan.body?.jobs?.some((j) => j.signInClosed)),
      "office, yard and truck QRs sign in as before (never windowed)", [off.status, yd.status, tr.status].join(","));
    const qId = (await db.siteAttendance.findFirst({ where: { jobId: shut.id, resourceId: Q.id } }))?.id;
    t.status(await c.post(c.site(sup, "/signin"), null, { action: "MANUAL_OUT", attendanceId: qId }), 200, "the supervisor signs the QR person out");

    // (3) The supervisor's link: words beside the name, "Confirm all" skips the flagged ones.
    const link = await keep(await c.get(c.site(sup, "/signin"), null));
    const tc = link.body?.jobs?.find((j) => j.id === job.id)?.toConfirm ?? [];
    const w = (r) => tc.find((x) => x.name === r.name)?.warning;
    t.ok(w(F) === "1.8 km from site" && w(N) === "No location shared" && w(C) == null, "the link's 'to confirm' list shows 'No location shared' / '1.8 km from site' beside the name");
    const all = await keep(await c.post(c.site(sup, "/signin"), null, { action: "CONFIRM_ALL", jobId: job.id }));
    t.ok(all.status === 200 && all.body?.confirmed === 1 && all.body?.skipped === 2 && all.body?.message === "2 need checking – confirm or reject each.",
      "Confirm all: confirms the clean one, skips the 2 with a warning and says so", JSON.stringify({ s: all.status, c: all.body?.confirmed, k: all.body?.skipped }));
    const st = async (r) => (await db.siteAttendance.findFirst({ where: { jobId: job.id, resourceId: r.id } }))?.status;
    t.ok((await st(C)) === "CONFIRMED" && (await st(F)) === "TO_CONFIRM" && (await st(N)) === "TO_CONFIRM", "...in the database too");
    const fId = (await db.siteAttendance.findFirst({ where: { jobId: job.id, resourceId: F.id } }))?.id;
    const nId = (await db.siteAttendance.findFirst({ where: { jobId: job.id, resourceId: N.id } }))?.id;
    t.status(await c.post(c.site(sup, "/signin"), null, { action: "CONFIRM", attendanceId: fId }), 200, "the supervisor can still confirm a flagged one by itself");
    t.status(await c.post(c.site(sup, "/signin"), null, { action: "REJECT", attendanceId: nId }), 200, "...or reject it");
    let src = "";
    try { src = readFileSync(path.join(c.p.appDir, "src", "components", "site", "SignInCrew.tsx"), "utf8"); } catch { /* missing */ }
    t.ok(/CONFIRM_ALL/.test(src) && /need.*checking – confirm or reject each/.test(src), "the link's screen sends CONFIRM_ALL and says how many need checking");
    const allLink = linkText.join("\n");
    t.ok(noMoney(allLink), "no dollar figure on any link reply");
    t.ok(!COORD_TEXT.test(allLink), "no coordinates on any link reply (words and distances only)");

    // (4) The indicator: how they signed in, and the location status - words only, never the position.
    const v2 = await c.json(`/api/attendance?date=${today}`, "MANAGER");
    const all2 = [...(v2.body?.jobs ?? []), ...(v2.body?.points ?? [])].flatMap((x) => x.rows ?? []);
    const r2 = (r) => all2.filter((x) => x.resourceId === r.id).at(-1);
    const want = [
      [F, "Site poster", "Location shared"], [N, "Site poster", "Location refused"], [A, "Supervisor's QR", "Location shared"],
      [Q, "Supervisor's QR", "Location unavailable"], [H2, "Hand-over QR", "Location shared"], [HT, "Hand-over tick", "Location not asked"],
      [M, "Supervisor tick", "Location not asked"], [Z, "Office - missed sign-in", "Location not asked"], [X, "Office QR", "Location refused"],
      [Y, "Yard QR", "Location shared"], [T, "Truck QR", "Location unavailable"],
    ];
    for (const [r, how, loc] of want) t.ok(r2(r)?.how === how && r2(r)?.location === loc, `the line shows '${how}' and '${loc}'`, JSON.stringify({ how: r2(r)?.how, loc: r2(r)?.location }));
    t.ok(r2(Q)?.howOut === "out: supervisor" && r2(O)?.howOut == null && r2(F)?.howOut == null, "the sign-out way shows only when it differs ('out: supervisor')", JSON.stringify([r2(Q)?.howOut, r2(O)?.howOut]));
    t.ok(r2(T)?.gpsStatus === "TIMEOUT" && r2(X)?.gpsStatus === "DENIED" && r2(M)?.gpsStatus == null, "the status itself (gpsStatus) is in the line");
    for (const who of ["MANAGER", "COORDINATOR"]) {
      const v = await c.json(`/api/attendance?date=${today}`, who);
      const text = JSON.stringify(v.body ?? {});
      t.ok(v.status === 200 && !/gpsLat|gpsLng|gpsAccuracy/.test(text) && !/33\.87\d|151\.20\d/.test(text), `${who}: no gpsLat / gpsLng / accuracy anywhere in /api/attendance`, v.status);
      // A Manager sees free text as typed (another check seeds a hire company with an amount in it); the coordinator never.
      if (who === "COORDINATOR") t.ok(noMoney(text), "COORDINATOR: no dollar figure in /api/attendance");
    }

    // (5) Nobody new sees any of it.
    for (const who of ["VIEWER", "TIMESHEETS", "ACCOUNTS"]) t.status(await c.get(`/api/attendance?date=${today}`, who), 403, `Sign-ins still refused for ${who}`);
    const NEW = /NO_LOCATION|FAR_FROM_SITE|from site|Location (shared|refused|unavailable|not asked)|gpsStatus|gpsLat|"how"/;
    const tsT = await c.json(`/api/timesheets?week=${c.thisWeek}`, "TIMESHEETS");
    t.ok(tsT.status === 200 && !NEW.test(JSON.stringify(tsT.body ?? {})) && !("signInFlags" in (tsT.body ?? {})), "TIMESHEETS: the week as before - no location words, no flag counts", tsT.status);
    t.status(await c.get(`/api/timesheets?week=${c.thisWeek}`, "VIEWER"), 403, "Operations timesheets still refused for VIEWER");
    const acc = await c.json(`/api/accounts/timesheets?week=${c.thisWeek}`, "ACCOUNTS");
    t.ok(acc.status === 200 && !/NO_LOCATION|FAR_FROM_SITE|from site|Location (shared|refused|unavailable|not asked)|"how"/.test(JSON.stringify(acc.body ?? {})), "ACCOUNTS' timesheets: as before, nothing new", acc.status);

    t.ok(r2(F)?.status === "CONFIRMED" && r2(N)?.status === "REJECTED", "the individual confirm / reject went through");
  },
};
