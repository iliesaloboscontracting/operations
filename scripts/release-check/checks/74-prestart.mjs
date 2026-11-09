// Vehicle & plant pre-start checks (stage 1, Ilies approved 8 Nov 2026; security fixes PS-001..008, 9 Nov 2026). A truck
// QR sign-in hands the phone a pre-start token (a site poster or the office point never does); the checklist and its
// fault photos ride the link with no money; a valid check makes the check and its faults in one go, a second is refused
// (409), a fault without a photo is refused, another sign-in's or an already-used photo is refused, Do not use marks the
// truck Down, "Still there" records a sighting instead of a second fault, sign-out hands over the post-check, forged /
// expired / non-truck tokens are refused, and the office side (/api/faults*) is open to exactly ADMIN, MANAGER,
// COORDINATOR and YARD. Security fixes: photo caps per sign-in / machine (rotated phone ids and parallel uploads can't
// get past them), one throttled alert per check, the PRE token closed at sign-out, the token never read from the
// address, the stale-photo cleanup, the report's source on /faults, back-to-Available refused after an unrelated change.
// WRITES on the test copy: five trucks, drivers, a project with a job today, QR links, sign-ins, checks, faults, photos
// (seeded cap rows removed again; trucks and drivers switched off and the links revoked at the end).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
// Every photo different (the same photo twice on one sign-in is refused - PS-001); the first bytes stay a PNG's.
const uniqPng = () => `data:image/png;base64,${Buffer.concat([PNG_BYTES, randomBytes(16)]).toString("base64")}`;
const PRE = ["tyres", "lights", "brakes", "horn", "mirrors", "seatbelt", "fluids", "leaks", "tipper", "load", "safety-kit", "body"];
const POST = ["new-damage", "driving-faults", "tray", "parked"];
const allOk = (keys) => Object.fromEntries(keys.map((k) => [k, "OK"]));
const ALLOWED = ["ADMIN", "MANAGER", "COORDINATOR", "YARD"];
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"];

export default {
  id: "prestart", title: "Pre-start checks: truck QR token, checklist + faults, Do not use = Down, still there, caps, alerts, office roles, no $",
  writes: true, timeoutMs: 360_000,
  applies: (c) => c.hasPath("src/lib/prestart/rules.ts") || "the candidate has no pre-start checks",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const linkBodies = [];
    const trucks = [], people = [], links = [], seeded = [];
    let n = 0;
    const mkTruck = async () => {
      const r = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC prestart truck ${++n} ${tag}`, identifier: `RC${n}${tag}`.slice(0, 12), ownership: "OWNED", status: "AVAILABLE" } });
      trucks.push(r.id);
      const l = await makeLink(db, "POSTER", r.id, { place: "VEHICLE" });
      links.push(l.id);
      return { ...r, point: l };
    };
    const mkPerson = async (x) => {
      const r = await db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rcdriver${x} Tester ${tag}` } });
      people.push(r.id);
      return r;
    };
    const truck = await mkTruck();
    const point = truck.point;
    const [A, B, C] = [await mkPerson("a"), await mkPerson("b"), await mkPerson("c")];
    const office = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const project = await db.project.create({ data: { name: `RC prestart site ${tag}`, status: "ACTIVE" } });
    const job = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    const poster = await makeLink(db, "POSTER", null, { projectId: project.id });
    links.push(office.id, poster.id);

    const sign = async (secret, jobId, action, who) => {
      const scan = await c.json(`/api/site/in/${encodeURIComponent(secret)}`, null);
      linkBodies.push(JSON.stringify(scan.body ?? {}));
      const r = await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId, action, resourceId: who.id, deviceId: `rc74-${who.id}`, gps: { status: "DENIED" } });
      const j = await r.json().catch(() => ({}));
      linkBodies.push(JSON.stringify(j));
      return { status: r.status, body: j };
    };
    const onTruck = (tr, action, who) => sign(tr.point.secret, tr.point.id, action, who);
    const keep = async (r) => {
      const text = await r.text().catch(() => "");
      linkBodies.push(text);
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: j };
    };
    // PS-005: the view reads the token from a header only.
    const view = async (token) => keep(await c.req("GET", "/api/site/in/prestart", null, undefined, { "x-prestart-token": token }));
    const photo = async (token, p = uniqPng(), deviceId) => keep(await c.post("/api/site/in/prestart/photo", null, { token, photo: p, ...(deviceId ? { deviceId } : {}) }));
    const submit = async (token, body) => keep(await c.post("/api/site/in/prestart", null, { token, ...body }));

    // (1) Only a truck QR sign-in hands out a pre-start token.
    const inA = await sign(point.secret, point.id, "IN", A);
    if (!t.ok(inA.status === 200 && typeof inA.body.prestart === "string", "a truck QR sign-in returns a pre-start token", inA.status)) return;
    t.ok(typeof inA.body.odometer === "string", "the odometer token still comes first, unchanged");
    const tokA = inA.body.prestart;
    const inOffice = await sign(office.secret, office.id, "IN", C);
    t.ok(inOffice.status === 200 && !inOffice.body.prestart && !inOffice.body.odometer, "the office point sign-in gets no pre-start token", inOffice.status);
    await sign(office.secret, office.id, "OUT", C);
    const inSite = await sign(poster.secret, job.id, "IN", C);
    t.ok(inSite.status === 200 && !inSite.body.prestart, "a site-poster sign-in gets no pre-start token", inSite.status);
    t.ok(!(await sign(poster.secret, job.id, "OUT", C)).body?.postcheck, "and its sign-out no post-check token");

    // (2) The checklist - the token in a header; PS-005: never from the address.
    const v = await view(tokA);
    t.ok(v.status === 200 && v.body?.checklist?.id === "truck-pre.v1" && v.body.checklist.items.length === 12 && v.body.done === false, "GET (header token): the truck pre-start (12 items), not done", v.status);
    t.status(await keep(await c.get(`/api/site/in/prestart?token=${encodeURIComponent(tokA)}`, null)), 401, "PS-005: a token in the query string is not accepted");

    // (3) Photos: real image bytes only; the same photo twice on one sign-in refused.
    const m1 = await photo(tokA);
    t.status(m1, 201, "a fault photo is stored for the sign-in");
    t.status(await photo(tokA, `data:image/png;base64,${Buffer.from("not really a picture").toString("base64")}`), 400, "a 'photo' that isn't image bytes is refused");
    const twice = uniqPng();
    const m2 = await photo(tokA, twice);
    t.status(await photo(tokA, twice), 409, "PS-001: the same photo twice on one sign-in is refused");
    const attA = await db.prestartCheck.count({ where: { resourceId: truck.id } });

    // (4) A fault needs a photo; foreign media is refused; nothing is saved by a refusal.
    const answers = { ...allOk(PRE), tyres: "FAULT", lights: "FAULT" };
    const noMedia = await submit(tokA, { answers, faults: [{ itemKey: "tyres", description: "Front left flat", priority: "DO_NOT_USE", mediaIds: [] }, { itemKey: "lights", description: "Beacon out", priority: "URGENT", mediaIds: [m1.body?.id] }] });
    t.status(noMedia, 400, "a fault without a photo is refused");
    const inB = await sign(point.secret, point.id, "IN", B);
    const tokB = inB.body?.prestart;
    t.ok(typeof tokB === "string", "a second driver on the same truck gets their own token");
    const mB = await photo(tokB);
    const foreign = await submit(tokA, { answers, faults: [{ itemKey: "tyres", description: "Front left flat", priority: "DO_NOT_USE", mediaIds: [mB.body?.id] }, { itemKey: "lights", description: "Beacon out", priority: "URGENT", mediaIds: [m2.body?.id] }] });
    t.status(foreign, 400, "another sign-in's photo is refused");
    t.ok((await db.prestartCheck.count({ where: { resourceId: truck.id } })) === attA && (await db.assetFault.count({ where: { resourceId: truck.id } })) === 0, "refused checks saved nothing");

    // (5) A valid check: the check, two faults, photos attached, Do not use marks the truck Down, the history.
    const ok = await submit(tokA, { answers, faults: [
      { itemKey: "tyres", description: "Front left flat, quote was $450", priority: "DO_NOT_USE", mediaIds: [m1.body?.id] },
      { itemKey: "lights", description: "Beacon out", priority: "URGENT", mediaIds: [m2.body?.id] },
    ] });
    t.ok(ok.status === 201 && ok.body?.sent?.length === 2, "a valid pre-start is saved with its two faults", ok.status);
    const faults = await db.assetFault.findMany({ where: { resourceId: truck.id }, include: { media: true, events: true } });
    const fT = faults.find((f) => f.itemKey === "tyres"), fL = faults.find((f) => f.itemKey === "lights");
    t.ok(fT && fL && fT.media.length === 1 && fL.media.length === 1, "each fault has its photo attached");
    t.ok(fT?.priority === "DO_NOT_USE" && fT.markedDown === true && !!fT.markedDownAt && fL?.markedDown === false, "the Do-not-use fault is the one that marked it Down (and when)");
    t.ok((await db.resource.findUnique({ where: { id: truck.id } }))?.status === "DOWN", "Do not use: the truck is DOWN on the register");
    t.ok(fT?.events.some((e) => e.action === "REPORTED") && fT.events.some((e) => e.action === "DOWN"), "the history has Reported and Marked Down");
    t.ok(noMoney(fT?.description ?? "$1"), "the dollar amount was taken out of the words");
    const al1 = await db.assetFaultAlert.findMany({ where: { resourceId: truck.id } });
    t.ok(al1.length === 1 && al1[0].decision === "SENT" && JSON.parse(al1[0].faultIds).length === 2, "PS-002: ONE alert decision for the check's two loud faults", JSON.stringify(al1.map((a) => a.decision)));

    // (6) Once only; no photos after; used photos can't move.
    t.status(await submit(tokA, { answers: allOk(PRE) }), 409, "a second pre-start for the same sign-in -> 409");
    t.status(await photo(tokA), 409, "no more photos once the check is in");
    const vB = await view(tokB);
    const known = vB.body?.openFaults ?? [];
    t.ok(known.some((f) => f.id === fT?.id) && known.every((f) => !/Tester/.test(f.reportedBy)), "the next driver sees the open faults, reporter by first name only");
    t.status(await submit(tokB, { answers: { ...allOk(PRE), body: "FAULT" }, faults: [{ itemKey: "body", description: "Dent on door", priority: "LOW", mediaIds: [m1.body?.id] }] }), 400, "a photo already on a fault (another sign-in's) is refused");

    // (7) Still there: a sighting, not a second fault.
    const seen = await submit(tokB, { answers: { ...allOk(PRE), tyres: "FAULT" }, stillThere: [fT?.id] });
    t.status(seen, 201, "the next driver confirms the known fault 'Still there'");
    const fT2 = await db.assetFault.findUnique({ where: { id: fT?.id }, include: { events: true } });
    t.ok(fT2?.seenCount === 1 && fT2.lastSeenBy === B.name && !!fT2.lastSeenAt && fT2.events.some((e) => e.action === "SEEN"), "the sighting is recorded (seen count, who, when, SEEN in the history)");
    t.ok((await db.assetFault.count({ where: { resourceId: truck.id } })) === 2, "no duplicate fault was made");
    t.status(await submit(tokB, { answers: allOk(PRE), stillThere: ["not-a-fault"] }), [400, 409], "'Still there' on an unknown fault is refused");

    // (8) Sign-out hands over the post-check; PS-006: the PRE token is closed from then on.
    const outA = await sign(point.secret, point.id, "OUT", A);
    t.ok(outA.status === 200 && typeof outA.body.postcheck === "string", "a truck sign-out returns a post-check token", outA.status);
    const pv = await view(outA.body.postcheck);
    t.ok(pv.status === 200 && pv.body?.checklist?.id === "truck-post.v1", "GET: the truck post-check");
    t.status(await submit(outA.body.postcheck, { answers: allOk(POST) }), 201, "a post-check with no faults is saved");
    {
      const D = await mkPerson("d");
      const inD = await onTruck(truck, "IN", D);
      const mPre = await photo(inD.body?.prestart);
      t.status(mPre, 201, "a photo under the pre-start");
      const outD = await onTruck(truck, "OUT", D);
      t.status(await view(inD.body?.prestart), 409, "PS-006: the PRE token after sign-out is refused (view)");
      t.status(await photo(inD.body?.prestart), 409, "PS-006: ... and for a photo");
      t.status(await submit(inD.body?.prestart, { answers: allOk(PRE) }), 409, "PS-006: ... and for the check");
      t.status(await submit(outD.body?.postcheck, { answers: { ...allOk(POST), tray: "FAULT" }, faults: [{ itemKey: "tray", description: "Tray not empty", priority: "LOW", mediaIds: [mPre.body?.id] }] }),
        400, "PS-006: a photo sent under the pre-start can't go on the post-check");
    }

    // (9) Forged, expired and non-truck tokens.
    const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
    const secret = env.AUTH_SECRET;
    t.status(await view(tokA.slice(0, -3) + "AAA"), 401, "a tampered token is refused");
    if (secret) {
      const forge = (payload) => `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", `${secret}:site-signin`).update(payload).digest("base64url").slice(0, 22)}`;
      const aId = (await db.prestartCheck.findFirst({ where: { resourceId: truck.id, personId: A.id, kind: "PRE" } }))?.attendanceId;
      t.status(await view(forge(`S|${aId}|POST|${Date.now() - 1000}`)), 401, "an expired token is refused");
      const officeAtt = await db.siteAttendance.findFirst({ where: { resourceId: C.id, place: "OFFICE" } });
      t.ok([400, 404].includes((await view(forge(`S|${officeAtt?.id}|PRE|${Date.now() + 60_000}`))).status), "a token for a sign-in that isn't on a truck is refused");
    } else t.note("test AUTH_SECRET not readable - expired-token case not checked");

    // (10) PS-001: the caps. Truck 2: one sign-in can't pass 20, whatever phone id it gives.
    const t2 = await mkTruck();
    const E = await mkPerson("e"), F = await mkPerson("f"), G = await mkPerson("g");
    const tokE = (await onTruck(t2, "IN", E)).body?.prestart;
    const statusesE = [];
    for (let i = 0; i < 21; i++) statusesE.push((await photo(tokE, uniqPng(), `rc74-rotated-${tag}-${i}`)).status);
    t.ok(statusesE.slice(0, 20).every((s) => s === 201) && statusesE[20] === 429, "PS-001: the 21st photo on one sign-in is refused (429) even with a new phone id each time", statusesE.join(","));
    // Parallel uploads from one sign-in never get past its 20.
    const tokF = (await onTruck(t2, "IN", F)).body?.prestart;
    const par = await Promise.all(Array.from({ length: 30 }, () => photo(tokF)));
    const fOk = par.filter((r) => r.status === 201).length;
    const fRows = await db.assetFaultMedia.count({ where: { resourceId: t2.id, attendanceId: { not: null }, deviceId: `rc74-${F.id}` } }).catch(() => -1);
    t.ok(fOk === 20 && par.every((r) => r.status === 201 || r.status === 429), "PS-001: 30 photos at once from one sign-in - exactly 20 kept, the rest 429, nothing else", `${fOk} kept; ${par.map((r) => r.status).join(",")}`);
    t.ok(fRows <= 20, "and no more than 20 rows recorded for it", fRows);
    // The machine's day: seed it to 75, then 10 at once from a new sign-in - only 5 get in; then 429 in plain words.
    const today0 = await db.assetFaultMedia.count({ where: { resourceId: t2.id } });
    const need = Math.max(0, 75 - today0);
    for (let i = 0; i < need; i++) {
      const r = await db.assetFaultMedia.create({ data: { resourceId: t2.id, attendanceId: null, kind: "PHOTO", fileName: `rc-seed-${tag}-${i}`, mime: "image/png", sha256: `rc-seed-${tag}-${i}` } });
      seeded.push(r.id);
    }
    const tokG = (await onTruck(t2, "IN", G)).body?.prestart;
    const parG = await Promise.all(Array.from({ length: 10 }, () => photo(tokG)));
    const gOk = parG.filter((r) => r.status === 201).length;
    const machineToday = await db.assetFaultMedia.count({ where: { resourceId: t2.id } });
    t.ok(gOk === 5 && machineToday === 80, "PS-001: at 75 for the machine, 10 at once - exactly 5 kept, the machine stops at 80", `${gOk} kept, ${machineToday} today`);
    const over = await photo(tokG);
    t.ok(over.status === 429 && /machine/.test(over.body?.error ?? ""), "PS-001: over the machine's daily cap -> 429, said in plain words", over.status);

    // (11) PS-002: two Urgent checks on one machine within 15 minutes -> one alert sent, the second held (both saved).
    const t3 = await mkTruck();
    const H = await mkPerson("h"), I = await mkPerson("i");
    for (const who of [H, I]) {
      const tk = (await onTruck(t3, "IN", who)).body?.prestart;
      const mp = await photo(tk);
      t.status(await submit(tk, { answers: { ...allOk(PRE), brakes: "FAULT" }, faults: [{ itemKey: "brakes", description: `Spongy pedal ${who.id.slice(-4)}`, priority: "URGENT", mediaIds: [mp.body?.id] }] }), 201, "an Urgent check is saved");
    }
    const al3 = (await db.assetFaultAlert.findMany({ where: { resourceId: t3.id }, orderBy: { at: "asc" } })).map((a) => a.decision);
    t.ok(JSON.stringify(al3) === JSON.stringify(["SENT", "HELD_RECENT"]), "PS-002: the first sends, the second within 15 minutes is held back (recorded)", al3.join(","));
    t.ok((await db.assetFault.count({ where: { resourceId: t3.id, priority: "URGENT" } })) === 2, "both Urgent faults are saved and listed anyway");

    // (12) PS-008: back to Available refused after an unrelated change; regression: one truck's token can't touch another.
    const t4 = await mkTruck();
    const J = await mkPerson("j");
    const tokJ = (await onTruck(t4, "IN", J)).body?.prestart;
    t.status(await submit(tokJ, { answers: { ...allOk(PRE), tyres: "FAULT" }, stillThere: [fT?.id] }), 400, "truck 4's token can't confirm a fault on truck 1");
    const mJ = await photo(tokJ);
    t.status(await submit(tokJ, { answers: { ...allOk(PRE), leaks: "FAULT" }, faults: [{ itemKey: "leaks", description: "Hydraulic leak", priority: "DO_NOT_USE", mediaIds: [mJ.body?.id] }] }), 201, "truck 4: a Do-not-use fault marks it Down");
    const fJ = await db.assetFault.findFirst({ where: { resourceId: t4.id } });
    t.ok((await c.json(`/api/faults?resource=${t4.id}`, "MANAGER")).body?.faults?.[0]?.canBackToAvailable === true, "back to Available is offered while nothing else has changed it");
    t.status(await c.patch(`/api/resources/${t4.id}`, "MANAGER", { status: "AVAILABLE" }), 200, "the office puts truck 4 back on the register by hand");
    t.status(await c.patch(`/api/resources/${t4.id}`, "MANAGER", { status: "DOWN" }), 200, "...and later marks it Down for something else");
    t.ok((await c.json(`/api/faults?resource=${t4.id}`, "MANAGER")).body?.faults?.[0]?.canBackToAvailable === false, "PS-008: back to Available is no longer offered");
    t.status(await c.patch(`/api/faults/${fJ?.id}`, "MANAGER", { status: "FIXED", note: "Hose replaced", backToAvailable: true }), 409, "PS-008: fixing it with back to Available is refused");
    t.ok((await db.resource.findUnique({ where: { id: t4.id } }))?.status === "DOWN" && (await db.assetFault.findUnique({ where: { id: fJ?.id } }))?.status === "OPEN", "the other Down stands and the fault is unchanged");

    // (13) The office side: exactly the four roles; PS-004: where the report came from.
    for (const pth of ["/api/faults", "/api/faults/flags", `/api/faults/checks?date=${c.today}`]) {
      t.status(await c.get(pth, null), 401, `${pth.split("?")[0]}: no login refused`);
      for (const who of ALLOWED) t.status(await c.get(pth, who), 200, `${pth.split("?")[0]}: ${who}`);
      for (const who of REFUSED) t.status(await c.get(pth, who), 403, `${pth.split("?")[0]}: ${who} refused`);
    }
    const mediaId = fT?.media[0]?.id;
    const med = await c.get(`/api/faults/media/${mediaId}`, "MANAGER");
    t.ok(med.status === 200 && /^image\//.test(med.headers.get("content-type") ?? ""), "a Manager opens the fault photo", med.status);
    for (const who of REFUSED) t.status(await c.get(`/api/faults/media/${mediaId}`, who), 403, `the photo: ${who} refused`);
    for (const who of REFUSED) t.status(await c.patch(`/api/faults/${fL?.id}`, who, { status: "IN_HAND" }), 403, `PATCH: ${who} refused`);
    const flags = (await c.json("/api/faults/flags", "MANAGER")).body?.flags ?? {};
    t.ok(flags[truck.id]?.open === 2 && flags[truck.id]?.worst === "DO_NOT_USE", "the board flag: 2 open, worst Do not use");
    const list = (await c.json(`/api/faults?resource=${truck.id}`, "COORDINATOR")).body?.faults ?? [];
    t.ok(list.length === 2 && list[0].id === fT?.id && list[0].mediaIds.length === 1 && list[0].canBackToAvailable === true, "the list: Do not use first, with its photo, back-to-Available offered");
    t.ok(list[0].source?.staff === true && list[0].source?.method === "Truck QR" && !!list[0].source?.point, "PS-004: the report's source - staff, Truck QR, which truck", JSON.stringify(list[0].source ?? null));
    t.ok(noMoney(JSON.stringify(list)), "no $ figure in the office list");
    await sign(point.secret, point.id, "IN", C);
    const day = (await c.json(`/api/faults/checks?date=${c.today}`, "YARD")).body?.signIns ?? [];
    const rowA = day.find((s) => s.person === A.name), rowC = day.find((s) => s.person === C.name);
    t.ok(rowA?.preStatus?.startsWith("Done") && rowA?.postStatus === "Done" && rowA.pre?.answers?.length === 12, "Checks: A's pre-start and post-check, with the answers");
    t.ok(rowC?.preStatus === "No pre-start", "Checks: a sign-in with no check reads 'No pre-start'");

    // (14) Working a fault: conditional, a note to fix, back to Available only where this fault set it Down.
    t.status(await c.patch(`/api/faults/${fT?.id}`, "MANAGER", { status: "FIXED", note: "" }), 400, "Fixed with no note is refused");
    t.status(await c.patch(`/api/faults/${fT?.id}`, "YARD", { status: "IN_HAND" }), 200, "the yard marks it In hand");
    t.status(await c.patch(`/api/faults/${fT?.id}`, "MANAGER", { status: "IN_HAND" }), 409, "In hand twice -> 409");
    t.status(await c.patch(`/api/faults/${fT?.id}`, "COORDINATOR", { status: "FIXED", note: "New tyre fitted", backToAvailable: true }), 200, "the coordinator marks it Fixed and puts the truck back");
    const fixed = await db.assetFault.findUnique({ where: { id: fT?.id }, include: { events: true } });
    t.ok(fixed?.status === "FIXED" && fixed.fixNote === "New tyre fitted" && !!fixed.fixedBy && fixed.events.some((e) => e.action === "BACK_AVAILABLE"), "fixed: note, who, and Back to Available in the history");
    t.ok((await db.resource.findUnique({ where: { id: truck.id } }))?.status === "AVAILABLE", "the truck is Available again");
    t.status(await c.patch(`/api/faults/${fT?.id}`, "MANAGER", { status: "FIXED", note: "again" }), 409, "fixing it again -> 409");
    t.status(await c.patch(`/api/faults/${fL?.id}`, "MANAGER", { status: "FIXED", note: "Bulb", backToAvailable: true }), 409, "back to Available refused for a fault that didn't set it Down");
    t.ok((await db.assetFault.findUnique({ where: { id: fL?.id } }))?.status === "OPEN", "and that refusal changed nothing");
    t.status(await c.patch(`/api/faults/${fL?.id}`, "MANAGER", { status: "FIXED", note: "Bulb replaced" }), 200, "it's fixed without touching the register");

    // (15) PS-003: the cleanup removes only stale, unattached fault photos (run directly - the tick waits for 3am).
    const photoDir = env.TOOL_PHOTO_DIR;
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (!photoDir || !existsSync(tsxCli)) t.note("PS-003 cleanup not run: no TOOL_PHOTO_DIR in the test env or no tsx");
    else {
      const K = await mkPerson("k");
      const tokK = (await onTruck(t3, "IN", K)).body?.prestart;
      const stale = await photo(tokK), fresh = await photo(tokK);
      const longAgo = new Date(Date.now() - 25 * 3_600_000);
      await db.assetFaultMedia.update({ where: { id: stale.body?.id }, data: { createdAt: longAgo } });
      await db.assetFaultMedia.update({ where: { id: mediaId }, data: { createdAt: longAgo } }); // attached - stays
      const rowOf = (id) => db.assetFaultMedia.findUnique({ where: { id } });
      const staleFile = path.join(photoDir, (await rowOf(stale.body?.id))?.fileName ?? "x");
      const attachedFile = path.join(photoDir, (await rowOf(mediaId))?.fileName ?? "x");
      const other = path.join(photoDir, `rc-keep-${tag}.txt`);
      writeFileSync(other, "not a fault photo");
      const script = path.join(c.p.files, `rc74-cleanup-${tag}.mts`);
      writeFileSync(script, `import { cleanupUnattachedMedia } from ${JSON.stringify("file:///" + path.join(c.p.appDir, "src", "lib", "prestart", "store.ts").split(path.sep).join("/"))};\nconst r = await cleanupUnattachedMedia();\nconsole.log("RESULT " + JSON.stringify(r));\nprocess.exit(0);\n`);
      let out = "";
      try {
        const childEnv = { ...process.env, ...env };
        delete childEnv.FAULT_PHOTO_CLEANUP;
        out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 120_000 });
      } catch (e) { out = String(e?.stdout ?? ""); }
      const res = JSON.parse(out.match(/RESULT (.*)/)?.[1] ?? "{}");
      t.ok((res.removed ?? 0) >= 1, "PS-003: the cleanup ran and removed the stale unattached photo", JSON.stringify(res));
      t.ok(!(await rowOf(stale.body?.id)) && !existsSync(staleFile), "PS-003: its row and its file are gone");
      t.ok(!!(await rowOf(fresh.body?.id)), "PS-003: a fresh unattached photo is kept (under 24 hours)");
      t.ok(!!(await rowOf(mediaId)) && existsSync(attachedFile), "PS-003: an old photo on a fault is kept, file and row");
      t.ok(existsSync(other), "PS-003: other files in the photo folder are never touched");
    }

    // (16) Nothing with a dollar figure ever went to a phone.
    const leaked = linkBodies.filter((b) => !noMoney(b));
    t.ok(leaked.length === 0, `no $ figure in any of the ${linkBodies.length} link replies`, `${leaked.length} with $`);

    // Tidy: the seeded cap rows go; everyone signed out; trucks and drivers off; links revoked.
    await db.assetFaultMedia.deleteMany({ where: { id: { in: seeded } } });
    await db.siteAttendance.updateMany({ where: { vehicleId: { in: trucks }, signOutAt: null }, data: { signOutAt: new Date(), signOutMethod: "OFFICE" } });
    await db.siteLink.updateMany({ where: { id: { in: links } }, data: { revokedAt: new Date() } });
    await db.resource.updateMany({ where: { id: { in: [...trucks, ...people] } }, data: { active: false } });
    await db.project.update({ where: { id: project.id }, data: { status: "INACTIVE" } }).catch(() => {});
  },
};
