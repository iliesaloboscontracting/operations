// Stage 2 - plant QR stickers (Ilies approved 10 Nov 2026). A Lobos-owned machine's pre-start QR (SiteLink kind PLANT)
// is never a sign-in and a sign-in QR never starts a plant check; Managers+ print it for owned plant only; scan -> name
// -> Start of shift (pre-start) / End of shift (post-check) -> the truck check screen: the walk-around on the machine's
// first pre-start of the day, the hour meter (photo + hours) on every check (lower than last: kept and flagged), faults
// (Do not use = Down + an alert decision), still there, one machine's token can't touch another, a reprinted QR stops
// its scans and checks, the caps and the session limits hold, the Checks tab's Plant section, no $ on the link.
// WRITES on the test copy: plant, people, a project + job with bookings, QRs, check sessions, checks, faults, photos.
import { makeLink } from "../lib/setup.mjs";
import { noMoney } from "../lib/context.mjs";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const uniqPng = () => `data:image/png;base64,${Buffer.concat([PNG_BYTES, randomBytes(16)]).toString("base64")}`;
const PRE = ["walk-around", "hoses", "tracks", "fluids", "greased", "hitch", "rops", "seatbelt", "lights", "controls", "e-stop", "extinguisher", "warning-lights"];
const POST = ["damage", "parked", "fuel"];
const SLOTS = ["FRONT", "BACK", "LEFT", "RIGHT", "CAB"];
const allOk = (keys) => Object.fromEntries(keys.map((k) => [k, "OK"]));

export default {
  id: "plant-prestart", title: "Plant QR stickers: never a sign-in, owned plant only, walk-around + hour meter, faults, limits, Checks tab, no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/prestart/plant.ts") || "the candidate has no plant pre-start QRs",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const made = { res: [], links: [] };
    const linkBodies = [];
    const mkPlant = async (n, extra = {}) => {
      const r = await db.resource.create({ data: { type: "EQUIPMENT", category: "Plant", role: "Plant", name: `RC plant ${n} ${tag}`, ownership: "OWNED", status: "AVAILABLE", ...extra } });
      made.res.push(r.id);
      return r;
    };
    const mkPerson = async (n, role = "General labour") => {
      const r = await db.resource.create({ data: { type: "PERSONNEL", category: "Labourer", role, name: `Rcop${n} Tester ${tag}` } });
      made.res.push(r.id);
      return r;
    };
    const keep = async (r) => {
      const text = await r.text().catch(() => "");
      linkBodies.push(text);
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: j };
    };
    const secretOf = (url) => (url ?? "").match(/\/site\/plant\/([^/?#]+)$/)?.[1] ?? "none";
    const printQr = async (resourceId, who = "MANAGER") => keep(await c.post("/api/plant/qr", who, { resourceId }));
    const scan = (secret) => c.get(`/api/site/plant/${encodeURIComponent(secret)}`, null).then(keep);
    const start = async (ticket, kind, who, deviceId) => keep(await c.post("/api/site/plant/start", null, { ticket, kind, resourceId: who.id, deviceId }));
    const view = async (token) => keep(await c.req("GET", "/api/site/in/prestart", null, undefined, { "x-prestart-token": token }));
    const photo = async (token, slot) => keep(await c.post("/api/site/in/prestart/photo", null, { token, photo: uniqPng(), ...(slot ? { slot } : {}) }));
    const submit = async (token, body) => keep(await c.post("/api/site/in/prestart", null, { token, ...body }));
    const walkAll = async (token) => { const o = {}; for (const s of SLOTS) o[s] = (await photo(token, s)).body?.id; return o; };
    // Scan + start a check as someone; returns the check token.
    const session = async (secret, kind, who, deviceId = `rc75-${who.id}`) => {
      const s = await scan(secret);
      const st = await start(s.body?.ticket, kind, who, deviceId);
      return { token: st.body?.token, status: st.status, scan: s };
    };

    const M1 = await mkPlant(1), M2 = await mkPlant(2), M3 = await mkPlant(3), M4 = await mkPlant(4);
    const hired = await mkPlant("hired", { ownership: "HIRED" });
    const attachment = await mkPlant("attachment", { type: "ATTACHMENT" });
    const OP1 = await mkPerson(1, "Operator"), OP2 = await mkPerson(2), OP3 = await mkPerson(3);

    // (1) Printing: Managers+ only, owned plant only.
    for (const who of ["VIEWER", "COORDINATOR", "YARD", "ACCOUNTS"]) t.status(await c.post("/api/plant/qr", who, { resourceId: M1.id }), 403, `printing a plant QR: ${who} refused`);
    t.status(await c.post("/api/plant/qr", null, { resourceId: M1.id }), 401, "printing a plant QR: no login refused");
    t.status(await printQr(hired.id), 400, "a hired machine can't have a plant QR");
    t.status(await printQr(attachment.id), 400, "an attachment can't have a plant QR");
    const q1 = await printQr(M1.id);
    if (!t.ok(q1.status === 201 && /\/site\/plant\//.test(q1.body?.url ?? ""), "a Manager prints a plant QR (shown once, /site/plant/...)", q1.status)) return;
    let s1 = secretOf(q1.body.url);
    const s2 = secretOf((await printQr(M2.id)).body?.url), s3 = secretOf((await printQr(M3.id)).body?.url);
    const list = (await c.json("/api/plant/qr", "MANAGER")).body ?? [];
    t.ok(list.some((x) => x.resourceId === M1.id), "GET /api/plant/qr lists it for a Manager");
    t.status(await c.get("/api/plant/qr", "VIEWER"), 403, "GET /api/plant/qr: a Viewer is refused");
    const links = await db.siteLink.findMany({ where: { resourceId: { in: [M1.id, M2.id, M3.id] }, revokedAt: null }, select: { id: true, kind: true, place: true } });
    made.links.push(...links.map((l) => l.id));
    t.ok(links.length === 3 && links.every((l) => l.kind === "PLANT" && !l.place), "stored as SiteLink kind PLANT (not a POSTER, no sign-in place)");

    // (2) Never a sign-in, and no sign-in QR starts a plant check.
    t.status(await c.get(`/api/site/in/${encodeURIComponent(s1)}`, null), 404, "a plant QR can't be scanned as a sign-in");
    const ps = await scan(s1);
    t.ok(ps.status === 200 && typeof ps.body?.ticket === "string" && /RC plant 1/.test(ps.body.machine) && (ps.body.crew ?? []).some((p) => p.id === OP1.id), "scanning it gives a plant ticket, the machine, the operators first", ps.status);
    const sign = await c.post("/api/site/in/sign", null, { ticket: ps.body?.ticket, jobId: links[0]?.id, action: "IN", resourceId: OP1.id, deviceId: `rc75-sign-${tag}` });
    t.status(sign, 401, "the sign-in route refuses a plant ticket - signing in from a plant QR is impossible");
    t.ok((await db.siteAttendance.count({ where: { resourceId: OP1.id } })) === 0, "no sign-in was made");
    const office = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const truck = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", name: `RC75 truck ${tag}`, ownership: "OWNED" } });
    made.res.push(truck.id);
    const truckQr = await makeLink(db, "POSTER", truck.id, { place: "VEHICLE" });
    made.links.push(office.id, truckQr.id);
    t.status(await scan(office.secret), 404, "an office sign-in QR can't start a plant check");
    t.status(await scan(truckQr.secret), 404, "a truck QR can't start a plant check");
    const signScan = await c.json(`/api/site/in/${office.secret}`, null);
    t.status(await start(signScan.body?.ticket, "PRE", OP1, `rc75-x-${tag}`), 401, "a sign-in ticket can't start a plant check session");

    // (3) The first pre-start of the day: walk-around + hour meter, both required.
    const a = await session(s1, "PRE", OP1);
    t.ok(a.status === 201 && typeof a.token === "string", "Start of shift makes a check session and its token", a.status);
    const v = await view(a.token);
    t.ok(v.status === 200 && v.body?.checklist?.id === "plant-pre.v1" && v.body.walkaround?.required === true && v.body.walkaround.slots?.length === 5 && v.body.hourMeter?.required === true && v.body.odometer === null && v.body.noun === "machine",
      "the view: plant-pre.v1, walk-around needed (5), hour meter needed, no odometer", v.status);
    const walkA = await walkAll(a.token);
    const meterA = (await photo(a.token, "HOUR_METER")).body?.id;
    t.ok(SLOTS.every((s) => !!walkA[s]) && !!meterA, "the walk-around and hour-meter photos are stored");
    t.status(await submit(a.token, { answers: allOk(PRE), hourMeter: { value: "1000", mediaId: meterA } }), 400, "the first pre-start without the walk-around -> 400");
    t.status(await submit(a.token, { answers: allOk(PRE), walkaround: walkA, hourMeter: { value: "1000" } }), 400, "...without the hour-meter photo -> 400");
    t.status(await submit(a.token, { answers: allOk(PRE), walkaround: walkA, hourMeter: { mediaId: meterA } }), 400, "...without the hours -> 400");
    t.status(await submit(a.token, { answers: allOk(PRE), walkaround: walkA, hourMeter: { value: "lots", mediaId: meterA } }), 400, "...with hours that aren't a number -> 400");
    t.status(await submit(a.token, { answers: allOk(PRE), walkaround: { ...walkA, FRONT: meterA }, hourMeter: { value: "1000", mediaId: walkA.FRONT } }), 400, "...with the photos swapped between slots -> 400");
    const okA = await submit(a.token, { answers: allOk(PRE), walkaround: walkA, hourMeter: { value: "1000", mediaId: meterA } });
    t.ok(okA.status === 201 && okA.body?.walkaround === "DONE" && okA.body?.hourMeterFlag === null, "the pre-start with the walk-around and the hour meter is accepted", okA.status);
    const checkA = await db.prestartCheck.findFirst({ where: { resourceId: M1.id, kind: "PRE" }, orderBy: { createdAt: "asc" } });
    t.ok(checkA?.hourMeter === 1000 && !!checkA.sessionId && !checkA.attendanceId && (await db.assetFaultMedia.count({ where: { checkId: checkA.id } })) === 6, "stored: 1000 hours, on its session (no sign-in), 6 photos on the check");
    t.status(await submit(a.token, { answers: allOk(PRE), walkaround: walkA, hourMeter: { value: "1000", mediaId: meterA } }), 409, "the same session's check twice -> 409");

    // (4) A later pre-start the same day: no walk-around needed, the hour meter still is.
    const b = await session(s1, "PRE", OP2);
    const vb = await view(b.token);
    t.ok(vb.body?.walkaround?.required === false && /Rcop1/.test(vb.body.walkaround.earlier?.by ?? "") && !/Tester/.test(JSON.stringify(vb.body.walkaround)) && vb.body.hourMeter?.last === 1000,
      "a second pre-start: walk-around optional ('taken at ... by' first name), last hours shown (1000)");
    t.status(await submit(b.token, { answers: allOk(PRE) }), 400, "a second pre-start still needs the hour meter");
    const meterB = (await photo(b.token, "HOUR_METER")).body?.id;
    const okB = await submit(b.token, { answers: allOk(PRE), hourMeter: { value: "1005", mediaId: meterB } });
    t.ok(okB.status === 201 && okB.body?.walkaround === "OPTIONAL", "...and is accepted with it, no walk-around", okB.status);

    // (5) Post-check: the hour meter; lower than last -> accepted and flagged.
    const p = await session(s1, "POST", OP1);
    const vp = await view(p.token);
    t.ok(vp.body?.checklist?.id === "plant-post.v1" && vp.body.walkaround === null && vp.body.hourMeter?.required === true, "End of shift: plant-post.v1, no walk-around, hour meter needed");
    t.status(await submit(p.token, { answers: allOk(POST) }), 400, "a post-check without the hour meter -> 400");
    const meterP = (await photo(p.token, "HOUR_METER")).body?.id;
    t.status(await photo(p.token, "FRONT"), 400, "no walk-around slots on a post-check");
    const okP = await submit(p.token, { answers: allOk(POST), hourMeter: { value: "990.5", mediaId: meterP } });
    t.ok(okP.status === 201 && okP.body?.hourMeterFlag === "LOWER" && /lower/.test(okP.body?.message ?? ""), "a reading lower than the last is accepted and flagged", okP.status);
    const checkP = await db.prestartCheck.findFirst({ where: { resourceId: M1.id, kind: "POST" } });
    t.ok(checkP?.hourMeterFlag === "LOWER" && checkP.hourMeterPrev === 1005 && checkP.hourMeter === 990.5, "stored: 990.5, the last 1005, flagged LOWER");

    // (6) Faults: Do not use marks the machine Down + an alert decision; still there; no cross-machine.
    const d = await session(s2, "PRE", OP3);
    const walkD = await walkAll(d.token);
    const meterD = (await photo(d.token, "HOUR_METER")).body?.id;
    const fd = (await photo(d.token)).body?.id;
    const okD = await submit(d.token, { answers: { ...allOk(PRE), hoses: "FAULT" }, faults: [{ itemKey: "hoses", description: "Hydraulic hose split", priority: "DO_NOT_USE", mediaIds: [fd] }], walkaround: walkD, hourMeter: { value: "500", mediaId: meterD } });
    t.ok(okD.status === 201 && okD.body?.sent?.[0]?.markedDown === true, "a Do-not-use fault on plant is saved and marks it Down", okD.status);
    t.ok((await db.resource.findUnique({ where: { id: M2.id } }))?.status === "DOWN", "the machine is DOWN on the register");
    const al = await db.assetFaultAlert.findMany({ where: { resourceId: M2.id } });
    t.ok(al.length === 1 && al[0].decision === "SENT" && al[0].doNotUse === true, "an alert decision is recorded (SENT, Do not use)");
    const fault = await db.assetFault.findFirst({ where: { resourceId: M2.id } });
    const flist = (await c.json(`/api/faults?resource=${M2.id}`, "MANAGER")).body?.faults ?? [];
    t.ok(flist[0]?.source?.method === "Plant QR" && flist[0].source.staff === true && flist[0].canBackToAvailable === true, "on /faults: source Plant QR, staff; back to Available offered");
    // One machine's token can't touch another's.
    const x = await session(s1, "PRE", OP3, `rc75-x2-${tag}`);
    t.status(await submit(x.token, { answers: { ...allOk(PRE), hoses: "FAULT" }, stillThere: [fault?.id], hourMeter: { value: "1006", mediaId: meterB } }), 400, "machine 1's token can't confirm machine 2's fault");
    const mx = (await photo(x.token, "HOUR_METER")).body?.id;
    t.status(await submit(x.token, { answers: allOk(PRE), hourMeter: { value: "1006", mediaId: meterD } }), 400, "...or use machine 2's photos");
    t.status(await submit(x.token, { answers: allOk(PRE), hourMeter: { value: "1006", mediaId: mx } }), 201, "...its own check goes through");
    const st = await session(s2, "PRE", OP2, `rc75-st-${tag}`);
    const ms = (await photo(st.token, "HOUR_METER")).body?.id;
    t.status(await submit(st.token, { answers: { ...allOk(PRE), hoses: "FAULT" }, stillThere: [fault?.id], hourMeter: { value: "501", mediaId: ms } }), 201, "the next operator confirms it 'Still there'");
    t.ok((await db.assetFault.findUnique({ where: { id: fault?.id } }))?.seenCount === 1 && (await db.assetFault.count({ where: { resourceId: M2.id } })) === 1, "a sighting, not a second fault");

    // (7) The caps and the session limits.
    const cap = await session(s3, "PRE", OP1, `rc75-cap-${tag}`);
    const sts = [];
    for (let i = 0; i < 31; i++) sts.push((await photo(cap.token)).status);
    t.ok(sts.slice(0, 30).every((s) => s === 201) && sts[30] === 429, "the per-session photo cap: the 31st is refused", sts.join(","));
    const dev = `rc75-dev-${tag}`;
    const devStarts = [];
    for (let i = 0; i < 13; i++) devStarts.push((await start((await scan(s3)).body?.ticket, "POST", OP2, dev)).status);
    t.ok(devStarts.slice(0, 12).every((s) => s === 201) && devStarts[12] === 429, "one phone: 12 check sessions a day, the 13th refused", devStarts.join(","));
    const qrLink = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M3.id, revokedAt: null } });
    const already = await db.plantCheckSession.count({ where: { linkId: qrLink?.id, day: c.today } });
    for (let i = already; i < 40; i++) await db.plantCheckSession.create({ data: { linkId: qrLink.id, resourceId: M3.id, kind: "PRE", day: c.today, personName: "RC seed", deviceId: `rc75-seed-${i}` } });
    t.status(await start((await scan(s3)).body?.ticket, "PRE", OP1, `rc75-fresh-${tag}`), 429, "one QR: 40 check sessions a day, then refused");

    // (8) A reprinted QR: the old one 404, and its open checks stop.
    const open = await session(s1, "POST", OP2, `rc75-open-${tag}`);
    const re = await printQr(M1.id);
    t.status(re, 201, "the Manager reprints machine 1's QR");
    t.status(await scan(s1), 404, "the old QR -> 404");
    t.status(await view(open.token), 404, "a check started on the old QR stops (404)");
    s1 = secretOf(re.body?.url);
    t.status(await scan(s1), 200, "the new QR works");
    t.status(await c.post("/api/plant/qr", "MANAGER", { resourceId: M4.id, off: true }), 200, "switching off (no QR) is fine");

    // (9) The Checks tab's Plant section: booked machines ("No pre-start") and the checked ones with photos.
    const project = await db.project.create({ data: { name: `RC75 site ${tag}`, status: "ACTIVE" } });
    const job = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    await db.assignment.create({ data: { jobId: job.id, resourceId: M4.id } });
    await db.assignment.create({ data: { jobId: job.id, resourceId: M1.id } });
    const day = (await c.json(`/api/faults/checks?date=${c.today}`, "ADMIN")).body?.plant ?? [];
    const r4 = day.find((m) => m.machineId === M4.id), r1 = day.find((m) => m.machineId === M1.id), r2 = day.find((m) => m.machineId === M2.id);
    t.ok(r4?.booked === true && r4.preStatus === "No pre-start" && r4.checks.length === 0, "Checks/Plant: a booked machine with no pre-start reads 'No pre-start'");
    const pre1 = r1?.checks?.find((x) => x.kind === "PRE" && x.walkaround === "DONE");
    t.ok(r1?.booked === true && r1.preStatus === "Done" && pre1?.walkaroundPhotos?.length === 5 && !!pre1.meterPhotoId && pre1.hourMeter === 1000, "Checks/Plant: machine 1 - the walk-around photos, the hour-meter photo and hours");
    t.ok(r1?.checks?.some((x) => x.hourMeterFlag === "LOWER"), "Checks/Plant: the lower reading is flagged");
    t.ok(r2?.booked === false && r2.checks.length >= 1, "Checks/Plant: a checked machine that isn't booked is listed too");
    for (const who of ["VIEWER", "ACCOUNTS"]) {
      t.status(await c.get(`/api/faults/checks?date=${c.today}`, who), 403, `Checks: ${who} refused`);
      t.status(await c.get(`/api/faults/media/${pre1?.meterPhotoId}`, who), 403, `the hour-meter photo: ${who} refused`);
    }
    t.status(await c.get(`/api/faults/media/${pre1?.meterPhotoId}`, "ADMIN"), 200, "an ADMIN opens the hour-meter photo");
    t.status(await c.get(`/api/faults/media/${pre1?.walkaroundPhotos?.[0]?.id}`, "YARD"), 200, "the yard opens a walk-around photo");

    // (9b) PS-018: 60 starts at once on one QR - at most 40 sessions, the rest 429, nothing else.
    {
      const M5 = await mkPlant(5);
      const s5 = secretOf((await printQr(M5.id)).body?.url);
      const tk = (await scan(s5)).body?.ticket;
      const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => start(tk, "PRE", OP2, `rc75-burst-${tag}-${i}`)));
      const ok = burst.filter((r) => r.status === 201).length;
      const link5 = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M5.id, revokedAt: null } });
      const rows = await db.plantCheckSession.count({ where: { linkId: link5?.id, day: c.today } });
      t.ok(ok <= 40 && rows <= 40 && burst.every((r) => r.status === 201 || r.status === 429), "PS-018: 60 starts at once on one QR - at most 40 sessions, the rest 429", `${ok} started, ${rows} rows; ${burst.map((r) => r.status).join(",")}`);
      t.ok(ok === rows, "and exactly the started ones are recorded", `${ok} / ${rows}`);
    }

    // (9c) PS-019: a junk reading is flagged HIGHER and never becomes "the last"; "Reading wrong" is kept, left out of it.
    {
      const M6 = await mkPlant(6);
      const s6 = secretOf((await printQr(M6.id)).body?.url);
      const first = await session(s6, "PRE", OP1, `rc75-h1-${tag}`);
      const w6 = await walkAll(first.token);
      const m1 = (await photo(first.token, "HOUR_METER")).body?.id;
      t.status(await submit(first.token, { answers: allOk(PRE), walkaround: w6, hourMeter: { value: "1000", mediaId: m1 } }), 201, "machine 6: first reading 1000");
      const junk = await session(s6, "PRE", OP2, `rc75-h2-${tag}`);
      const m2 = (await photo(junk.token, "HOUR_METER")).body?.id;
      const j = await submit(junk.token, { answers: allOk(PRE), hourMeter: { value: "99999", mediaId: m2 } });
      t.ok(j.status === 201 && j.body?.hourMeterFlag === "HIGHER", "PS-019: a reading far above the last (99999 after 1000) is accepted and flagged HIGHER", j.status);
      const next = await session(s6, "PRE", OP3, `rc75-h3-${tag}`);
      t.ok((await view(next.token)).body?.hourMeter?.last === 1000, "PS-019: the hint (the last reading) is still 1000 - the flagged one is left out");
      const m3 = (await photo(next.token, "HOUR_METER")).body?.id;
      const n = await submit(next.token, { answers: allOk(PRE), hourMeter: { value: "1002", mediaId: m3 } });
      t.ok(n.status === 201 && n.body?.hourMeterFlag === null, "PS-019: the next true reading (1002) is NOT flagged LOWER against the junk one", JSON.stringify(n.body?.hourMeterFlag));
      const c1002 = await db.prestartCheck.findFirst({ where: { resourceId: M6.id, hourMeter: 1002 } });
      const wrongUrl = `/api/faults/checks/${c1002?.id}/hour-meter`;
      // Managers and Admins only (Ilies, 10 Nov 2026) - the coordinator and the yard see the Checks tab, not this.
      for (const who of ["VIEWER", "ACCOUNTS", "COORDINATOR", "YARD"]) t.status(await c.post(wrongUrl, who, { note: "Typo" }), 403, `'Reading wrong': ${who} refused`);
      t.status(await c.post(wrongUrl, null, { note: "Typo" }), 401, "'Reading wrong': no login refused");
      t.status(await c.post(wrongUrl, "MANAGER", { note: "" }), 400, "'Reading wrong' needs a reason");
      t.status(await c.post(wrongUrl, "MANAGER", { note: "Typo - meter shows 1020" }), 200, "a Manager marks the 1002 reading wrong");
      t.status(await c.post(wrongUrl, "MANAGER", { note: "again" }), 409, "...once only (409 after)");
      const cJunk = await db.prestartCheck.findFirst({ where: { resourceId: M6.id, hourMeter: 99999 } });
      t.status(await c.post(`/api/faults/checks/${cJunk?.id}/hour-meter`, "ADMIN", { note: "Junk reading" }), 200, "an Admin marks the junk reading wrong too");
      const marked = await db.prestartCheck.findUnique({ where: { id: c1002?.id } });
      const ev = await db.hourMeterEvent.findMany({ where: { checkId: c1002?.id } });
      t.ok(marked?.hourMeter === 1002 && !!marked.hourMeterWrongAt && !!marked.hourMeterWrongBy && /Typo/.test(marked.hourMeterWrongNote ?? "") && ev.length === 1 && ev[0].action === "WRONG",
        "PS-019: recorded (who, when, why, an event) and the reading itself kept");
      const after = await session(s6, "POST", OP3, `rc75-h4-${tag}`);
      t.ok((await view(after.token)).body?.hourMeter?.last === 1000, "PS-019: the reading marked wrong is left out of 'the last reading' (back to 1000)");
      const plant6 = ((await c.json(`/api/faults/checks?date=${c.today}`, "MANAGER")).body?.plant ?? []).find((m) => m.machineId === M6.id);
      t.ok(plant6?.checks?.some((x) => x.hourMeter === 1002 && x.hourMeterWrong?.note) && plant6.checks.some((x) => x.hourMeterFlag === "HIGHER"), "Checks/Plant shows the HIGHER flag and the reading marked wrong, with its note");
    }

    // (9d) PS-021: the office can switch off the QR of a machine sold / archived or now hired; printing still needs owned plant.
    {
      const M7 = await mkPlant(7), M8 = await mkPlant(8);
      await printQr(M7.id); await printQr(M8.id);
      await db.resource.update({ where: { id: M7.id }, data: { active: false } });
      await db.resource.update({ where: { id: M8.id }, data: { ownership: "HIRED" } });
      for (const [what, m] of [["archived", M7], ["now hired", M8]]) {
        t.status(await c.post("/api/plant/qr", "MANAGER", { resourceId: m.id, off: true }), 200, `PS-021: switching off the QR of a machine ${what} -> 200`);
        t.ok((await db.siteLink.count({ where: { kind: "PLANT", resourceId: m.id, revokedAt: null } })) === 0, `...and its QR is switched off (${what})`);
        t.status(await printQr(m.id), 400, `PS-021: printing a new QR for a machine ${what} is still refused`);
      }
      t.status(await c.post("/api/plant/qr", "VIEWER", { resourceId: M7.id, off: true }), 403, "switching off: a Viewer refused");
    }

    // (9d2) PS-022: a QR that has had its 40 today is turned away before any write or queue place; a full queue -> 503.
    // Run in one process through tsx with the queue's own counters (a fetch can't see the server's queue).
    {
      const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
      const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
      if (!env.AUTH_SECRET || !existsSync(tsxCli)) t.note("PS-022 not run: no test env or no tsx");
      else {
        const M9 = await mkPlant(9), M10 = await mkPlant(10);
        await printQr(M9.id); await printQr(M10.id);
        const l9 = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M9.id, revokedAt: null } });
        const l10 = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M10.id, revokedAt: null } });
        for (let i = 0; i < 40; i++) await db.plantCheckSession.create({ data: { linkId: l9.id, resourceId: M9.id, kind: "PRE", day: c.today, personName: "RC seed", deviceId: `rc75-p22-${i}` } });
        const src = (rel) => JSON.stringify("file:///" + path.join(c.p.appDir, ...rel.split("/")).split(path.sep).join("/"));
        const script = path.join(c.p.files, `rc75-p22-${tag}.mts`);
        writeFileSync(script, [
          `import { startPlantCheck } from ${src("src/lib/prestart/plant.ts")};`,
          `import { oneAtATime, queueStats } from ${src("src/lib/prestart/queue.ts")};`,
          `import { makePlantTicket } from ${src("src/lib/signin.ts")};`,
          `import { prisma } from ${src("src/lib/prisma.ts")};`,
          `const who = { resourceId: ${JSON.stringify(OP1.id)} };`,
          `const rows0 = await prisma.plantCheckSession.count({ where: { linkId: ${JSON.stringify(l9.id)} } });`,
          `const q0 = queueStats();`,
          `const full = []; for (let i = 0; i < 5; i++) { const r = await startPlantCheck({ ticket: makePlantTicket(${JSON.stringify(l9.id)}, ${JSON.stringify(M9.id)}), kind: "PRE", deviceId: "rc75-p22-x" + i, ...who }); full.push("error" in r ? r.status : 201); }`,
          `const q1 = queueStats();`,
          `const rows1 = await prisma.plantCheckSession.count({ where: { linkId: ${JSON.stringify(l9.id)} } });`,
          `const blockers = Array.from({ length: 55 }, () => oneAtATime(() => new Promise((r) => setTimeout(r, 200))));`,
          `const busyR = await startPlantCheck({ ticket: makePlantTicket(${JSON.stringify(l10.id)}, ${JSON.stringify(M10.id)}), kind: "PRE", deviceId: "rc75-p22-busy", ...who });`,
          `const busy = "error" in busyR ? busyR.status : 201;`,
          `await Promise.all(blockers);`,
          `const after = await startPlantCheck({ ticket: makePlantTicket(${JSON.stringify(l10.id)}, ${JSON.stringify(M10.id)}), kind: "PRE", deviceId: "rc75-p22-after", ...who });`,
          `console.log("RESULT " + JSON.stringify({ full, rows0, rows1, q0, q1, busy, after: "error" in after ? after.status : 201 }));`,
          `process.exit(0);`,
        ].join("\n"));
        let out = "";
        try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 }); }
        catch (e) { out = String(e?.stdout ?? ""); }
        const r = JSON.parse(out.match(/RESULT (.*)/)?.[1] ?? "{}");
        t.ok(r.full?.length === 5 && r.full.every((s) => s === 429), "PS-022: a QR at its 40 for the day - further starts get 429", JSON.stringify(r.full));
        t.ok(r.rows0 === 40 && r.rows1 === 40, "PS-022: ...and no session row is written", `${r.rows0} -> ${r.rows1}`);
        t.ok(r.q0 && r.q1 && r.q1.enqueued === r.q0.enqueued, "PS-022: ...and none of them took a place in the queue", JSON.stringify({ q0: r.q0, q1: r.q1 }));
        t.ok(r.busy === 503, "PS-022: with more than 50 writes waiting, a start gets 503 'Busy - try again'", String(r.busy));
        t.ok(r.after === 201, "PS-022: once the queue clears, the next start goes through", String(r.after));
      }
    }

    // (9e) A check token from an earlier day is refused (the session's Sydney day must be today).
    {
      const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
      if (!env.AUTH_SECRET) t.note("test AUTH_SECRET not readable - old-day token case not checked");
      else {
        const link1 = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M1.id, revokedAt: null } });
        const y = new Date(`${c.today}T00:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
        const old = await db.plantCheckSession.create({ data: { linkId: link1.id, resourceId: M1.id, kind: "PRE", day: y.toISOString().slice(0, 10), personName: "RC old day", personId: OP1.id } });
        const payload = `PC|${old.id}|PRE|${Date.now() + 60 * 60_000}`;
        const tok = `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", `${env.AUTH_SECRET}:site-signin`).update(payload).digest("base64url").slice(0, 22)}`;
        t.status(await view(tok), 401, "a check token for yesterday's session is refused (still within its 2 hours)");
        t.status(await photo(tok), 401, "...for a photo too");
      }
    }

    // (10) Nothing with a dollar figure on the link; no sign-ins were made by any of it.
    const leaked = linkBodies.filter((x) => !noMoney(x));
    t.ok(leaked.length === 0, `no $ figure in any of the ${linkBodies.length} link replies`, `${leaked.length} with $`);
    t.ok((await db.siteAttendance.count({ where: { resourceId: { in: [OP1.id, OP2.id, OP3.id] } } })) === 0, "none of the plant checks made a sign-in");

    await db.assignment.deleteMany({ where: { jobId: job.id } });
    await db.siteLink.updateMany({ where: { OR: [{ id: { in: made.links } }, { kind: "PLANT", resourceId: { in: made.res } }] }, data: { revokedAt: new Date() } });
    await db.resource.updateMany({ where: { id: { in: made.res } }, data: { active: false } });
    await db.project.update({ where: { id: project.id }, data: { status: "INACTIVE" } }).catch(() => {});
  },
};
