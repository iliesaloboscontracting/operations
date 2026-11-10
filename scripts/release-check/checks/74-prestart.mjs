// Vehicle & plant pre-start checks (stage 1, Ilies approved 8 Nov 2026; security fixes PS-001..008, 9 Nov 2026; stage 1b
// walk-around photos + PS-009..011, 10 Nov 2026). A truck QR sign-in hands the phone a pre-start token (a site poster
// or the office point never does); the checklist and its photos ride the link with no money; a valid check makes the
// check and its faults in one go, a second is refused (409), a fault without a photo is refused, another sign-in's or
// an already-used photo is refused, Do not use marks the truck Down, "Still there" records a sighting instead of a
// second fault, sign-out hands over the post-check, forged / expired / non-truck tokens are refused, and the office side
// (/api/faults*) is open to exactly ADMIN, MANAGER, COORDINATOR and YARD. Security fixes: photo caps per sign-in /
// machine (rotated phone ids and parallel uploads can't get past them), one throttled alert per check, the PRE token
// closed at sign-out, the token never read from the address, the report's source on /faults,
// back-to-Available refused after an unrelated change. Stage 1b: the day's first pre-start for a truck needs the five
// walk-around photos and the odometer, later ones don't; the Checks tab shows them; kept forever (10 Nov 2026 - no
// automatic photo deletion: unsent and old photos stay, rows and files); PS-009 (read-only
// pre-check), PS-010 (Urgent / Do not use and the walk-around get through when the day's limit is full), PS-011.
// WRITES on the test copy: six trucks, drivers, a project with a job today, QR links, sign-ins, checks, faults, photos,
// odometer readings (seeded cap rows removed again; trucks and drivers switched off and the links revoked at the end).
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
const SLOTS = ["FRONT", "BACK", "DRIVER", "PASSENGER", "CAB"];
const allOk = (keys) => Object.fromEntries(keys.map((k) => [k, "OK"]));
const ALLOWED = ["ADMIN", "MANAGER", "COORDINATOR", "YARD"];
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"];

export default {
  id: "prestart", title: "Pre-start checks: truck QR token, checklist + faults, walk-around photos, Do not use = Down, caps, alerts, office roles, no $",
  writes: true, timeoutMs: 480_000,
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
    const photo = async (token, p = uniqPng(), deviceId, slot) => keep(await c.post("/api/site/in/prestart/photo", null, { token, photo: p, ...(deviceId ? { deviceId } : {}), ...(slot ? { slot } : {}) }));
    const submit = async (token, body) => keep(await c.post("/api/site/in/prestart", null, { token, ...body }));
    // Stage 1b: the five walk-around photos for a sign-in, and its odometer photo (Receipts R1's own route).
    const walkAll = async (token) => {
      const out = {};
      for (const s of SLOTS) out[s] = (await photo(token, uniqPng(), undefined, s)).body?.id;
      return out;
    };
    const odometer = async (odoToken) => keep(await c.post("/api/site/in/odometer", null, { token: odoToken, dataUrl: uniqPng() }));
    // Sign in on a truck and do the day's first pre-start properly (walk-around + odometer); returns the sign-in reply.
    const firstCheck = async (tr, who, body) => {
      const s = await onTruck(tr, "IN", who);
      await odometer(s.body?.odometer);
      const walkaround = await walkAll(s.body?.prestart);
      const r = await submit(s.body?.prestart, { ...body, walkaround: { ...walkaround, ...(body.walkaround ?? {}) } });
      return { sign: s, res: r, walkaround };
    };

    // (1) Only a truck QR sign-in hands out a pre-start token.
    const inA = await sign(point.secret, point.id, "IN", A);
    if (!t.ok(inA.status === 200 && typeof inA.body.prestart === "string", "a truck QR sign-in returns a pre-start token", inA.status)) return;
    t.ok(typeof inA.body.odometer === "string", "the odometer token still comes first, unchanged");
    t.ok(inA.body.walkaroundRequired === true, "stage 1b: the truck's first sign-in of the day is told the walk-around is needed");
    const tokA = inA.body.prestart;
    const inOffice = await sign(office.secret, office.id, "IN", C);
    t.ok(inOffice.status === 200 && !inOffice.body.prestart && !inOffice.body.odometer && inOffice.body.walkaroundRequired === undefined, "the office point sign-in gets no pre-start token", inOffice.status);
    await sign(office.secret, office.id, "OUT", C);
    const inSite = await sign(poster.secret, job.id, "IN", C);
    t.ok(inSite.status === 200 && !inSite.body.prestart, "a site-poster sign-in gets no pre-start token", inSite.status);
    t.ok(!(await sign(poster.secret, job.id, "OUT", C)).body?.postcheck, "and its sign-out no post-check token");

    // (2) The checklist - the token in a header; PS-005: never from the address.
    const v = await view(tokA);
    t.ok(v.status === 200 && v.body?.checklist?.id === "truck-pre.v1" && v.body.checklist.items.length === 12 && v.body.done === false, "GET (header token): the truck pre-start (12 items), not done", v.status);
    t.ok(v.body?.walkaround?.required === true && v.body.walkaround.slots?.length === 5 && v.body.odometer === "MISSING", "stage 1b: the view asks for the five walk-around photos and says the odometer is missing");
    t.status(await keep(await c.get(`/api/site/in/prestart?token=${encodeURIComponent(tokA)}`, null)), 401, "PS-005: a token in the query string is not accepted");

    // (3) Photos: real image bytes only; the same photo twice on one sign-in refused; a slot that isn't on the check.
    const m1 = await photo(tokA);
    t.status(m1, 201, "a fault photo is stored for the sign-in");
    t.status(await photo(tokA, `data:image/png;base64,${Buffer.from("not really a picture").toString("base64")}`), 400, "a 'photo' that isn't image bytes is refused");
    const twice = uniqPng();
    const m2 = await photo(tokA, twice);
    t.status(await photo(tokA, twice), 409, "PS-001: the same photo twice on one sign-in is refused");
    t.status(await photo(tokA, uniqPng(), undefined, "ROOF"), 400, "stage 1b: a walk-around slot that isn't on the check is refused");
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

    // (5) Stage 1b: the day's first pre-start needs the five walk-around photos and the odometer.
    const goodFaults = [
      { itemKey: "tyres", description: "Front left flat, quote was $450", priority: "DO_NOT_USE", mediaIds: [m1.body?.id] },
      { itemKey: "lights", description: "Beacon out", priority: "URGENT", mediaIds: [m2.body?.id] },
    ];
    t.status(await submit(tokA, { answers, faults: goodFaults }), 400, "stage 1b: the first pre-start of the day without the walk-around photos is refused");
    const walkA = await walkAll(tokA);
    t.ok(SLOTS.every((s) => !!walkA[s]), "the five walk-around photos are stored");
    t.status(await submit(tokA, { answers, faults: goodFaults, walkaround: walkA }), 400, "stage 1b: ...and with them but without the odometer photo");
    t.status(await odometer(inA.body.odometer), 201, "the odometer photo is sent (its own route, unchanged)");
    t.ok((await view(tokA)).body?.odometer === "SENT", "the view now says the odometer is in");
    t.status(await submit(tokA, { answers, faults: goodFaults, walkaround: { ...walkA, CAB: undefined } }), 400, "...and with only four walk-around photos");
    t.status(await submit(tokA, { answers, faults: goodFaults, walkaround: { ...walkA, FRONT: m1.body?.id } }), 400, "...and with a fault photo in a walk-around slot");
    t.status(await submit(tokA, { answers, faults: goodFaults, walkaround: { ...walkA, FRONT: walkA.BACK, BACK: walkA.FRONT } }), 400, "...and with two photos in each other's slots");
    t.ok((await db.prestartCheck.count({ where: { resourceId: truck.id } })) === attA, "none of those refusals saved a check");
    const ok = await submit(tokA, { answers, faults: goodFaults, walkaround: walkA });
    t.ok(ok.status === 201 && ok.body?.sent?.length === 2 && ok.body?.walkaround === "DONE", "a valid first pre-start is saved with its two faults and the walk-around", ok.status);
    const checkA = await db.prestartCheck.findFirst({ where: { resourceId: truck.id, personId: A.id, kind: "PRE" } });
    t.ok(checkA?.walkaround === "DONE" && (await db.assetFaultMedia.count({ where: { checkId: checkA.id, role: "WALKAROUND" } })) === 5, "the five walk-around photos are on the check");
    const faults = await db.assetFault.findMany({ where: { resourceId: truck.id }, include: { media: true, events: true } });
    const fT = faults.find((f) => f.itemKey === "tyres"), fL = faults.find((f) => f.itemKey === "lights");
    t.ok(fT && fL && fT.media.length === 1 && fL.media.length === 1, "each fault has its photo attached (walk-around photos aren't on faults)");
    t.ok(fT?.priority === "DO_NOT_USE" && fT.markedDown === true && !!fT.markedDownAt && fL?.markedDown === false, "the Do-not-use fault is the one that marked it Down (and when)");
    t.ok((await db.resource.findUnique({ where: { id: truck.id } }))?.status === "DOWN", "Do not use: the truck is DOWN on the register");
    t.ok(fT?.events.some((e) => e.action === "REPORTED") && fT.events.some((e) => e.action === "DOWN"), "the history has Reported and Marked Down");
    t.ok(noMoney(fT?.description ?? "$1"), "the dollar amount was taken out of the words");
    const al1 = await db.assetFaultAlert.findMany({ where: { resourceId: truck.id } });
    t.ok(al1.length === 1 && al1[0].decision === "SENT" && al1[0].doNotUse === true && JSON.parse(al1[0].faultIds).length === 2, "PS-002: ONE alert decision for the check's two loud faults", JSON.stringify(al1.map((a) => a.decision)));

    // (6) Once only; no photos after; used photos can't move.
    t.status(await submit(tokA, { answers: allOk(PRE) }), 409, "a second pre-start for the same sign-in -> 409");
    t.status(await photo(tokA), 409, "no more photos once the check is in");
    const vB = await view(tokB);
    const known = vB.body?.openFaults ?? [];
    t.ok(known.some((f) => f.id === fT?.id) && known.every((f) => !/Tester/.test(f.reportedBy)), "the next driver sees the open faults, reporter by first name only");
    t.ok(vB.body?.walkaround?.required === false && vB.body.walkaround.earlier?.by === "Rcdrivera" && !/Tester/.test(JSON.stringify(vB.body.walkaround)), "stage 1b: the next driver sees the photos as optional - 'taken at ... by' first name only");
    t.status(await submit(tokB, { answers: { ...allOk(PRE), body: "FAULT" }, faults: [{ itemKey: "body", description: "Dent on door", priority: "LOW", mediaIds: [m1.body?.id] }] }), 400, "a photo already on a fault (another sign-in's) is refused");
    t.status(await submit(tokB, { answers: allOk(PRE), walkaround: { FRONT: walkA.FRONT } }), 400, "stage 1b: another sign-in's walk-around photo is refused");

    // (7) Still there: a sighting, not a second fault - and a later pre-start the same day goes without photos.
    const seen = await submit(tokB, { answers: { ...allOk(PRE), tyres: "FAULT" }, stillThere: [fT?.id] });
    t.ok(seen.status === 201 && seen.body?.walkaround === "OPTIONAL", "stage 1b: a second pre-start the same day is accepted with no walk-around photos or odometer", seen.status);
    const fT2 = await db.assetFault.findUnique({ where: { id: fT?.id }, include: { events: true } });
    t.ok(fT2?.seenCount === 1 && fT2.lastSeenBy === B.name && !!fT2.lastSeenAt && fT2.events.some((e) => e.action === "SEEN"), "the sighting is recorded (seen count, who, when, SEEN in the history)");
    t.ok((await db.assetFault.count({ where: { resourceId: truck.id } })) === 2, "no duplicate fault was made");
    t.status(await submit(tokB, { answers: allOk(PRE), stillThere: ["not-a-fault"] }), [400, 409], "'Still there' on an unknown fault is refused");

    // (8) Sign-out hands over the post-check; PS-006: the PRE token is closed from then on.
    const outA = await sign(point.secret, point.id, "OUT", A);
    t.ok(outA.status === 200 && typeof outA.body.postcheck === "string", "a truck sign-out returns a post-check token", outA.status);
    const pv = await view(outA.body.postcheck);
    t.ok(pv.status === 200 && pv.body?.checklist?.id === "truck-post.v1" && pv.body.walkaround === null, "GET: the truck post-check (no walk-around)");
    t.status(await photo(outA.body.postcheck, uniqPng(), undefined, "FRONT"), 400, "stage 1b: no walk-around photos on a post-check");
    t.status(await submit(outA.body.postcheck, { answers: allOk(POST) }), 201, "a post-check with no faults is saved");
    {
      const D = await mkPerson("d");
      const inD = await onTruck(truck, "IN", D);
      t.ok(inD.body?.walkaroundRequired === false, "stage 1b: a later sign-in the same day is told the photos are optional");
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
      t.status(await view(forge(`S|${checkA?.attendanceId}|POST|${Date.now() - 1000}`)), 401, "an expired token is refused");
      const officeAtt = await db.siteAttendance.findFirst({ where: { resourceId: C.id, place: "OFFICE" } });
      t.ok([400, 404].includes((await view(forge(`S|${officeAtt?.id}|PRE|${Date.now() + 60_000}`))).status), "a token for a sign-in that isn't on a truck is refused");
    } else t.note("test AUTH_SECRET not readable - expired-token case not checked");

    // (10) PS-001: the caps. Truck 2: one sign-in can't pass 30, whatever phone id it gives.
    const t2 = await mkTruck();
    const E = await mkPerson("e"), F = await mkPerson("f"), G = await mkPerson("g");
    const tokE = (await onTruck(t2, "IN", E)).body?.prestart;
    const statusesE = [];
    for (let i = 0; i < 31; i++) statusesE.push((await photo(tokE, uniqPng(), `rc74-rotated-${tag}-${i}`)).status);
    t.ok(statusesE.slice(0, 30).every((s) => s === 201) && statusesE[30] === 429, "PS-001: the 31st photo on one sign-in is refused (429) even with a new phone id each time", statusesE.join(","));
    // Parallel uploads from one sign-in never get past its 30.
    const tokF = (await onTruck(t2, "IN", F)).body?.prestart;
    const par = await Promise.all(Array.from({ length: 40 }, () => photo(tokF)));
    const fOk = par.filter((r) => r.status === 201).length;
    const fRows = await db.assetFaultMedia.count({ where: { resourceId: t2.id, deviceId: `rc74-${F.id}` } }).catch(() => -1);
    t.ok(fOk <= 30 && fOk >= 1 && par.every((r) => [201, 429, 503].includes(r.status)), "PS-001: 40 photos at once from one sign-in - at most 30 kept, the rest 429 / 503, nothing else", `${fOk} kept; ${par.map((r) => r.status).join(",")}`);
    t.ok(fRows === fOk, "and exactly the kept ones are recorded", `${fRows} rows, ${fOk} kept`);
    // PS-012: the machine's FAULT photo allowance (65 a day): seed it to 60, then 10 at once - only 5 get in; then 429.
    const seedMedia = async (resourceId, role, count) => {
      for (let i = 0; i < count; i++) {
        const k = `rc-seed-${tag}-${seeded.length}`;
        const r = await db.assetFaultMedia.create({ data: { resourceId, attendanceId: null, kind: "PHOTO", role, slot: role === "WALKAROUND" ? "FRONT" : null, fileName: k, mime: "image/png", sha256: k } });
        seeded.push(r.id);
      }
    };
    const faultsToday = () => db.assetFaultMedia.count({ where: { resourceId: t2.id, role: "FAULT" } });
    await seedMedia(t2.id, "FAULT", Math.max(0, 60 - (await faultsToday())));
    const inG = await onTruck(t2, "IN", G);
    const tokG = inG.body?.prestart;
    const parG = await Promise.all(Array.from({ length: 10 }, () => photo(tokG)));
    const gOk = parG.filter((r) => r.status === 201).length;
    const faultT2 = await faultsToday();
    t.ok(gOk === 5 && faultT2 === 65, "PS-001/012: at 60 fault photos for the machine, 10 at once - exactly 5 kept, it stops at 65", `${gOk} kept, ${faultT2} today`);
    // PS-009: a cap already full answers at once, with nothing written; PS-010/012: it says which allowance is full.
    const before = await db.assetFaultMedia.count({ where: {} });
    const over = await photo(tokG);
    t.ok(over.status === 429 && over.body?.capFull === true && over.body?.cap === "FAULT" && /Urgent|Do-not-use/.test(over.body?.error ?? ""), "PS-012: over the machine's FAULT allowance -> 429, cap FAULT, plain words saying an Urgent / Do-not-use fault can still go", over.status);
    t.ok((await db.assetFaultMedia.count({ where: {} })) === before, "PS-009: the refused photo wrote nothing");
    const notices = (resourceId, cap) => db.photoCapNotice.count({ where: { resourceId, cap, day: c.today } });
    t.ok((await notices(t2.id, "FAULT")) === 1, "PS-012: ONE notice recorded for the machine's full fault allowance today");
    await photo(tokG);
    t.ok((await notices(t2.id, "FAULT")) === 1, "PS-012: hitting it again the same day records nothing new");
    // PS-012: fault photos filling their allowance do NOT excuse the walk-around - still required, and its own photos fit.
    t.status(await odometer(inG.body?.odometer), 201, "G sends the odometer photo");
    t.status(await submit(tokG, { answers: { ...allOk(PRE), horn: "FAULT" }, faults: [{ itemKey: "horn", description: "Horn dead", priority: "LOW", mediaIds: [] }] }), 400, "PS-010: a Low fault without a photo is still refused when the fault allowance is full");
    t.status(await submit(tokG, { answers: { ...allOk(PRE), horn: "FAULT" }, faults: [{ itemKey: "horn", description: "Horn dead", priority: "URGENT", mediaIds: [] }] }), 400,
      "PS-012: with only the FAULT allowance full, the first pre-start without walk-around photos is still refused");
    const walkG = await walkAll(tokG);
    t.ok(SLOTS.every((s) => !!walkG[s]), "PS-012: the walk-around photos still upload (their own allowance)");
    const lim = await submit(tokG, { answers: { ...allOk(PRE), horn: "FAULT" }, faults: [{ itemKey: "horn", description: "Horn dead", priority: "URGENT", mediaIds: [] }], walkaround: walkG });
    t.ok(lim.status === 201 && lim.body?.walkaround === "DONE", "PS-012: ...and the pre-start is accepted with them (DONE, not LIMIT); the Urgent fault goes without a photo (PS-010)", lim.status);
    const fG = await db.assetFault.findFirst({ where: { resourceId: t2.id } });
    t.ok(!!fG?.photoNote && /limit/.test(fG.photoNote), "PS-010: the Urgent fault without a photo carries the 'photo couldn't be added' note");
    const faultsT2 = (await c.json(`/api/faults?resource=${t2.id}`, "MANAGER")).body?.faults ?? [];
    t.ok(faultsT2[0]?.photoNote === fG?.photoNote, "PS-010: /faults shows the note");
    // PS-012: a full WALK-AROUND allowance (15) gives LIMIT; fault photos still go; an Urgent fault still needs its photo.
    {
      const t7 = await mkTruck();
      const R = await mkPerson("r");
      // 14 seeded + one kept photo fills it (PS-016: a cap fills, and is told, only on a kept photo).
      await seedMedia(t7.id, "WALKAROUND", 14);
      const inR = await onTruck(t7, "IN", R);
      const tokR = inR.body?.prestart;
      t.status(await photo(tokR, uniqPng(), undefined, "BACK"), 201, "PS-012: the 15th walk-around photo of the day is kept");
      const ws = await photo(tokR, uniqPng(), undefined, "FRONT");
      t.ok(ws.status === 429 && ws.body?.cap === "WALKAROUND", "PS-012: over the machine's walk-around allowance -> 429, cap WALKAROUND", ws.status);
      t.ok((await notices(t7.id, "WALKAROUND")) === 1 && (await notices(t7.id, "FAULT")) === 0, "PS-012: one walk-around notice for that machine, no fault notice");
      const fr = await photo(tokR);
      t.status(fr, 201, "PS-012: its fault photos still go (separate allowance)");
      await odometer(inR.body?.odometer);
      t.status(await submit(tokR, { answers: { ...allOk(PRE), horn: "FAULT" }, faults: [{ itemKey: "horn", description: "Horn dead", priority: "URGENT", mediaIds: [] }] }), 400,
        "PS-012: with only the walk-around allowance full, an Urgent fault still needs its photo");
      const rl = await submit(tokR, { answers: { ...allOk(PRE), horn: "FAULT" }, faults: [{ itemKey: "horn", description: "Horn dead", priority: "URGENT", mediaIds: [fr.body?.id] }] });
      t.ok(rl.status === 201 && rl.body?.walkaround === "LIMIT", "PS-012: a full walk-around allowance lets the pre-start through - LIMIT", rl.status);
    }

    // (11) PS-002 / PS-011: two Urgent checks within 15 minutes -> one sent, one held; a Do-not-use one isn't held by them.
    const t3 = await mkTruck();
    const H = await mkPerson("h"), I = await mkPerson("i"), P = await mkPerson("p");
    const fh = await firstCheck(t3, H, { answers: { ...allOk(PRE), brakes: "FAULT" }, faults: [] });
    t.status(fh.res, 400, "(H's Urgent fault needs its photo first)");
    const tkH = fh.sign.body?.prestart;
    const mh = await photo(tkH);
    t.status(await submit(tkH, { answers: { ...allOk(PRE), brakes: "FAULT" }, faults: [{ itemKey: "brakes", description: "Spongy pedal", priority: "URGENT", mediaIds: [mh.body?.id] }], walkaround: fh.walkaround }), 201, "an Urgent first pre-start is saved");
    const tkI = (await onTruck(t3, "IN", I)).body?.prestart;
    const mi = await photo(tkI);
    t.status(await submit(tkI, { answers: { ...allOk(PRE), brakes: "FAULT" }, faults: [{ itemKey: "brakes", description: "Still spongy", priority: "URGENT", mediaIds: [mi.body?.id] }] }), 201, "a second Urgent pre-start is saved");
    const tkP = (await onTruck(t3, "IN", P)).body?.prestart;
    const mp = await photo(tkP);
    t.status(await submit(tkP, { answers: { ...allOk(PRE), leaks: "FAULT" }, faults: [{ itemKey: "leaks", description: "Oil pouring out", priority: "DO_NOT_USE", mediaIds: [mp.body?.id] }] }), 201, "then a Do-not-use one");
    const al3 = (await db.assetFaultAlert.findMany({ where: { resourceId: t3.id }, orderBy: { at: "asc" } })).map((a) => a.decision);
    t.ok(JSON.stringify(al3) === JSON.stringify(["SENT", "HELD_RECENT", "SENT"]), "PS-002: the second Urgent within 15 min is held; PS-011: the Do-not-use one is sent anyway", al3.join(","));
    t.ok((await db.assetFault.count({ where: { resourceId: t3.id } })) === 3, "all three faults are saved and listed");

    // (12) PS-008: back to Available refused after an unrelated change; regression: one truck's token can't touch another.
    const t4 = await mkTruck();
    const J = await mkPerson("j");
    const inJ = await onTruck(t4, "IN", J);
    const tokJ = inJ.body?.prestart;
    await odometer(inJ.body?.odometer);
    t.status(await submit(tokJ, { answers: { ...allOk(PRE), tyres: "FAULT" }, stillThere: [fT?.id] }), 400, "truck 4's token can't confirm a fault on truck 1");
    t.status(await submit(tokJ, { answers: allOk(PRE), walkaround: fh.walkaround }), 400, "truck 4's token can't use truck 3's walk-around photos");
    const walkJ = await walkAll(tokJ);
    const mJ = await photo(tokJ);
    t.status(await submit(tokJ, { answers: { ...allOk(PRE), leaks: "FAULT" }, faults: [{ itemKey: "leaks", description: "Hydraulic leak", priority: "DO_NOT_USE", mediaIds: [mJ.body?.id] }], walkaround: walkJ }), 201, "truck 4: a Do-not-use fault marks it Down");
    const fJ = await db.assetFault.findFirst({ where: { resourceId: t4.id } });
    t.ok((await c.json(`/api/faults?resource=${t4.id}`, "MANAGER")).body?.faults?.[0]?.canBackToAvailable === true, "back to Available is offered while nothing else has changed it");
    t.status(await c.patch(`/api/resources/${t4.id}`, "MANAGER", { status: "AVAILABLE" }), 200, "the office puts truck 4 back on the register by hand");
    t.status(await c.patch(`/api/resources/${t4.id}`, "MANAGER", { status: "DOWN" }), 200, "...and later marks it Down for something else");
    t.ok((await c.json(`/api/faults?resource=${t4.id}`, "MANAGER")).body?.faults?.[0]?.canBackToAvailable === false, "PS-008: back to Available is no longer offered");
    t.status(await c.patch(`/api/faults/${fJ?.id}`, "MANAGER", { status: "FIXED", note: "Hose replaced", backToAvailable: true }), 409, "PS-008: fixing it with back to Available is refused");
    t.ok((await db.resource.findUnique({ where: { id: t4.id } }))?.status === "DOWN" && (await db.assetFault.findUnique({ where: { id: fJ?.id } }))?.status === "OPEN", "the other Down stands and the fault is unchanged");

    // (13) The office side: exactly the four roles; PS-004: where the report came from; stage 1b: the Checks tab photos.
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
    const day = (await c.json(`/api/faults/checks?date=${c.today}`, "ADMIN")).body?.signIns ?? [];
    const rowA = day.find((s) => s.person === A.name), rowC = day.find((s) => s.person === C.name), rowB = day.find((s) => s.person === B.name);
    t.ok(rowA?.preStatus?.startsWith("Done") && rowA?.postStatus === "Done" && rowA.pre?.answers?.length === 12, "Checks: A's pre-start and post-check, with the answers");
    t.ok(rowA?.pre?.walkaround === "DONE" && rowA.pre.walkaroundPhotos?.length === 5 && rowA.pre.walkaroundPhotos.every((p) => !!p.label) && rowA.odometer?.photoIds?.length === 1,
      "stage 1b: Checks (ADMIN) - A's five walk-around photos with their labels, and the odometer photo");
    t.ok(rowB?.pre?.walkaround === "OPTIONAL" && rowB.pre.walkaroundPhotos?.length === 0, "stage 1b: Checks - B's later pre-start: optional, no photos");
    t.ok(rowC?.preStatus === "No pre-start", "Checks: a sign-in with no check reads 'No pre-start'");
    const wId = rowA?.pre?.walkaroundPhotos?.[0]?.id, oId = rowA?.odometer?.photoIds?.[0];
    t.status(await c.get(`/api/faults/media/${wId}`, "ADMIN"), 200, "stage 1b: an ADMIN opens a walk-around photo full size");
    t.status(await c.get(`/api/faults/odometer/${oId}`, "YARD"), 200, "stage 1b: the yard opens the odometer photo from the Checks tab");
    for (const who of ["VIEWER", "ACCOUNTS"]) {
      t.status(await c.get(`/api/faults/media/${wId}`, who), 403, `stage 1b: the walk-around photo - ${who} refused`);
      t.status(await c.get(`/api/faults/odometer/${oId}`, who), 403, `stage 1b: the odometer photo - ${who} refused`);
    }
    const tip = await db.receiptPhoto.findFirst({ where: { odometerReadingId: null }, select: { id: true } });
    if (tip) t.status(await c.get(`/api/faults/odometer/${tip.id}`, "MANAGER"), 404, "stage 1b: a receipt photo that isn't an odometer's is never served there");

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

    // (15) PS-009: a burst bigger than the queue - only 201 / 429 / 503, never more than the sign-in's 30.
    {
      const t6 = await mkTruck();
      const Q = await mkPerson("q");
      const tokQ = (await onTruck(t6, "IN", Q)).body?.prestart;
      const burst = await Promise.all(Array.from({ length: 70 }, () => photo(tokQ)));
      const kept = burst.filter((r) => r.status === 201).length, busy = burst.filter((r) => r.status === 503).length;
      t.ok(kept <= 30 && burst.every((r) => [201, 429, 503].includes(r.status)), "PS-009: 70 photos at once - at most 30 kept, the rest 429 or 503 'Busy', no errors", burst.map((r) => r.status).join(","));
      t.note(`PS-009 burst: ${kept} kept, ${busy} turned away as busy`);
    }

    // (16) Keep forever (Ilies, 10 Nov 2026: "ALL information is kept forever"): PS-003's 24-hour removal of unsent photos
    // and stage 1b's 12-month walk-around removal are gone. Old and unsent photos stay - rows and files - and the code
    // has no automatic photo deletion left to run.
    const photoDir = env.TOOL_PHOTO_DIR;
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    {
      const K = await mkPerson("k");
      const tokK = (await onTruck(t3, "IN", K)).body?.prestart;
      const stale = await photo(tokK), staleWalk = await photo(tokK, uniqPng(), undefined, "FRONT");
      const ago = (h) => new Date(Date.now() - h * 3_600_000);
      const monthsAgo = (m) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - m); return d; };
      const rowOf = (id) => db.assetFaultMedia.findUnique({ where: { id } });
      const oldWalk = walkA.FRONT;
      await db.assetFaultMedia.update({ where: { id: stale.body?.id }, data: { createdAt: ago(25) } });
      await db.assetFaultMedia.update({ where: { id: staleWalk.body?.id }, data: { createdAt: ago(25) } });
      await db.assetFaultMedia.update({ where: { id: mediaId }, data: { createdAt: monthsAgo(13) } });
      await db.assetFaultMedia.update({ where: { id: oldWalk }, data: { createdAt: monthsAgo(13) } });
      const src = ["src/lib/prestart/store.ts", "src/instrumentation.ts"].map((f) => readFileSync(path.join(c.p.appDir, f), "utf8")).join("\n");
      t.ok(!/cleanupUnattachedMedia|cleanupOldWalkaround|faultPhotoCleanupTick|FAULT_PHOTO_CLEANUP|WALKAROUND_RETENTION/.test(src), "keep forever: no automatic photo deletion is left in the pre-start store or the background tick");
      const rows = await Promise.all([stale.body?.id, staleWalk.body?.id, oldWalk, mediaId].map(rowOf));
      t.ok(rows.every(Boolean), "keep forever: an unsent photo over 24 h, an unsent walk-around, a 13-month-old walk-around and fault photo - all rows kept");
      if (photoDir) t.ok(rows.every((r) => r && existsSync(path.join(photoDir, r.fileName))), "keep forever: ...and their files");
      else t.note("photo files not looked at: no TOOL_PHOTO_DIR in the test env");
    }

    // (16b) PS-012: the all-day ceiling (400 across every machine) full -> LIMIT for both kinds, one notice for everyone.
    {
      // Sydney midnight today, as the server counts "today" (UTC+10 or +11).
      const sydHour = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
      const midnight = [10, 11].map((h) => new Date(Date.parse(`${c.today}T00:00:00Z`) - h * 3_600_000))
        .find((d) => sydHour.format(d).replace(",", "") === `${c.today} 00`);
      const allToday = await db.assetFaultMedia.count({ where: { createdAt: { gte: midnight ?? new Date(Date.now() - 86_400_000) } } });
      await seedMedia(`rc-seed-all-${tag}`, "FAULT", Math.max(0, 399 - allToday));
      const t8 = await mkTruck();
      const S = await mkPerson("s");
      const inS = await onTruck(t8, "IN", S);
      const tokS = inS.body?.prestart;
      t.status(await photo(tokS), 201, "PS-012: the 400th photo of the day (all trucks) is kept - and fills the ceiling");
      const a1 = await photo(tokS, uniqPng(), undefined, "FRONT"), a2 = await photo(tokS);
      t.ok(a1.status === 429 && a1.body?.cap === "ALL" && a2.status === 429 && a2.body?.cap === "ALL", "PS-012: the all-day ceiling full -> 429 cap ALL, walk-around and fault photos alike", `${a1.status}/${a1.body?.cap} ${a2.status}/${a2.body?.cap}`);
      t.ok((await notices("*", "ALL")) === 1, "PS-012: ONE notice for the all-day ceiling (for everyone, not per machine)");
      await photo(tokS);
      t.ok((await notices("*", "ALL")) === 1, "PS-012: ...and nothing new on the next refusal");
      await odometer(inS.body?.odometer);
      const al = await submit(tokS, { answers: { ...allOk(PRE), horn: "FAULT" }, faults: [{ itemKey: "horn", description: "Horn dead", priority: "DO_NOT_USE", mediaIds: [] }] });
      t.ok(al.status === 201 && al.body?.walkaround === "LIMIT", "PS-012: with the ceiling full, LIMIT for the walk-around and a Do-not-use fault without a photo", al.status);
      t.ok(!!(await db.assetFault.findFirst({ where: { resourceId: t8.id } }))?.photoNote, "...with its 'photo couldn't be added' note");
      await db.assetFaultMedia.deleteMany({ where: { id: { in: seeded } } });
    }

    // (16b2) PS-016: once a cap is full, refused uploads write nothing - not even a notice attempt. Run in one process
    // through tsx (the store's own counters): 6 photos at once at 64 fault photos -> 1 kept (the notice: 1 run, 1 create),
    // 5 refused inside the transaction; then 5 more refused by the read-only pre-check. Neither refusal runs the notice.
    if (photoDir && existsSync(tsxCli)) {
      const spyId = `rc-spy-${tag}`;
      await seedMedia(spyId, "FAULT", 64);
      const script = path.join(c.p.files, `rc74-spy-${tag}.mts`);
      const store = "file:///" + path.join(c.p.appDir, "src", "lib", "prestart", "store.ts").split(path.sep).join("/");
      writeFileSync(script, [
        `import { linkPhoto, noticeStats } from ${JSON.stringify(store)};`,
        `import { randomBytes } from "node:crypto";`,
        `const PNG = Buffer.from(${JSON.stringify(PNG_BYTES.toString("base64"))}, "base64");`,
        `const pic = () => "data:image/png;base64," + Buffer.concat([PNG, randomBytes(16)]).toString("base64");`,
        `const ctx = { attendanceId: ${JSON.stringify(spyId + "-att")}, kind: "POST", deviceId: null, person: { id: null, name: "RC spy" }, machine: { id: ${JSON.stringify(spyId)}, name: "RC spy truck", type: "VEHICLE", status: "AVAILABLE" }, list: null };`,
        `const s0 = noticeStats();`,
        `const burst = await Promise.all(Array.from({ length: 6 }, () => linkPhoto(ctx, pic(), null).then((r) => ("id" in r ? 201 : r.status))));`,
        `const s1 = noticeStats();`,
        `const later = []; for (let i = 0; i < 5; i++) later.push(await linkPhoto(ctx, pic(), null).then((r) => ("id" in r ? 201 : r.status)));`,
        `const s2 = noticeStats();`,
        `console.log("RESULT " + JSON.stringify({ s0, s1, s2, burst, later }));`,
        `process.exit(0);`,
      ].join("\n"));
      let out = "";
      try {
        const childEnv = { ...process.env, ...env };
        out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 120_000 });
      } catch (e) { out = String(e?.stdout ?? ""); }
      const r = JSON.parse(out.match(/RESULT (.*)/)?.[1] ?? "{}");
      const d = (a, b, k) => (b?.[k] ?? NaN) - (a?.[k] ?? NaN);
      t.ok(r.burst?.filter((s) => s === 201).length === 1 && r.burst.filter((s) => s === 429).length === 5, "PS-016: 6 at once at 64 - one kept, five refused (inside the transaction)", JSON.stringify(r.burst));
      t.ok(d(r.s0, r.s1, "runs") === 1 && d(r.s0, r.s1, "creates") === 1, "PS-016: only the kept photo ran the notice - 1 run, 1 create", JSON.stringify({ s0: r.s0, s1: r.s1 }));
      t.ok((r.later ?? []).every((s) => s === 429) && r.later?.length === 5, "PS-016: five more refused by the pre-check", JSON.stringify(r.later));
      t.ok(d(r.s1, r.s2, "runs") === 0 && d(r.s1, r.s2, "finds") === 0 && d(r.s1, r.s2, "creates") === 0, "PS-016: refused uploads made no notice run, read or create attempt", JSON.stringify({ s1: r.s1, s2: r.s2 }));
      t.ok((await db.photoCapNotice.count({ where: { resourceId: spyId } })) === 1, "PS-016: exactly one notice row for it");
      await db.assetFaultMedia.deleteMany({ where: { resourceId: spyId } });
    } else t.note("PS-016 spy not run: no TOOL_PHOTO_DIR in the test env or no tsx");

    // (16c) PS-015: the crew are told the photos are kept and seen by the office (kept forever since 10 Nov 2026).
    {
      let src = "";
      try { src = readFileSync(path.join(c.p.appDir, "src", "components", "site", "PrestartCheck.tsx"), "utf8"); } catch { /* missing */ }
      t.ok(src.includes("These photos are kept and seen by the office.") && !src.includes("12 months"), "PS-015: the walk-around step says the photos are kept and seen by the office (no 12-month line)");
    }

    // (17) Nothing with a dollar figure ever went to a phone.
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
