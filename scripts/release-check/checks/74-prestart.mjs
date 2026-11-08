// Vehicle & plant pre-start checks (stage 1, Ilies approved 8 Nov 2026). A truck QR sign-in hands the phone a pre-start
// token (a site poster or the office point never does); the checklist and its fault photos ride the link with no money;
// a valid check makes the check and its faults in one go, a second is refused (409), a fault without a photo is
// refused, another sign-in's or an already-used photo is refused, Do not use marks the truck Down, "Still there"
// records a sighting instead of a second fault, sign-out hands over the post-check, forged / expired / non-truck tokens
// are refused, and the office side (/api/faults*) is open to exactly ADMIN, MANAGER, COORDINATOR and YARD.
// WRITES on the test copy: a truck, three drivers, a project with a job today, three QR links, sign-ins, checks, faults
// (the truck and drivers are switched off and the links revoked again).
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PRE = ["tyres", "lights", "brakes", "horn", "mirrors", "seatbelt", "fluids", "leaks", "tipper", "load", "safety-kit", "body"];
const POST = ["new-damage", "driving-faults", "tray", "parked"];
const allOk = (keys) => Object.fromEntries(keys.map((k) => [k, "OK"]));
const ALLOWED = ["ADMIN", "MANAGER", "COORDINATOR", "YARD"];
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"];

export default {
  id: "prestart", title: "Pre-start checks: truck QR token, checklist + faults, Do not use = Down, still there, office roles, no $",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/lib/prestart/rules.ts") || "the candidate has no pre-start checks",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const linkBodies = [];
    const truck = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC prestart truck ${tag}`, identifier: `RC${tag}`.slice(0, 10), ownership: "OWNED", status: "AVAILABLE" } });
    const mk = (n) => db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rcdriver${n} Tester ${tag}` } });
    const [A, B, C] = [await mk("a"), await mk("b"), await mk("c")];
    const point = await makeLink(db, "POSTER", truck.id, { place: "VEHICLE" });
    const office = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const project = await db.project.create({ data: { name: `RC prestart site ${tag}`, status: "ACTIVE" } });
    const job = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    const poster = await makeLink(db, "POSTER", null, { projectId: project.id });

    const sign = async (secret, jobId, action, who) => {
      const scan = await c.json(`/api/site/in/${encodeURIComponent(secret)}`, null);
      linkBodies.push(JSON.stringify(scan.body ?? {}));
      const r = await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId, action, resourceId: who.id, deviceId: `rc74-${who.id}`, gps: { status: "DENIED" } });
      const j = await r.json().catch(() => ({}));
      linkBodies.push(JSON.stringify(j));
      return { status: r.status, body: j };
    };
    const link = async (method, pth, body) => {
      const r = method === "GET" ? await c.get(pth, null) : await c.post(pth, null, body);
      const text = await r.text().catch(() => "");
      linkBodies.push(text);
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: j };
    };
    const view = (token) => link("GET", `/api/site/in/prestart?token=${encodeURIComponent(token)}`);
    const photo = (token, p = PNG) => link("POST", "/api/site/in/prestart/photo", { token, photo: p });
    const submit = (token, body) => link("POST", "/api/site/in/prestart", { token, ...body });

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

    // (2) The checklist.
    const v = await view(tokA);
    t.ok(v.status === 200 && v.body?.checklist?.id === "truck-pre.v1" && v.body.checklist.items.length === 12 && v.body.done === false, "GET: the truck pre-start (12 items), not done", v.status);

    // (3) Photos: real image bytes only.
    const m1 = await photo(tokA);
    t.status(m1, 201, "a fault photo is stored for the sign-in");
    t.status(await photo(tokA, `data:image/png;base64,${Buffer.from("not really a picture").toString("base64")}`), 400, "a 'photo' that isn't image bytes is refused");
    const attA = (await db.prestartCheck.count({ where: { resourceId: truck.id } }));

    // (4) A fault needs a photo; foreign media is refused; nothing is saved by a refusal.
    const answers = { ...allOk(PRE), tyres: "FAULT", lights: "FAULT" };
    const noMedia = await submit(tokA, { answers, faults: [{ itemKey: "tyres", description: "Front left flat", priority: "DO_NOT_USE", mediaIds: [] }, { itemKey: "lights", description: "Beacon out", priority: "URGENT", mediaIds: [m1.body?.id] }] });
    t.status(noMedia, 400, "a fault without a photo is refused");
    const inB = await sign(point.secret, point.id, "IN", B);
    const tokB = inB.body?.prestart;
    t.ok(typeof tokB === "string", "a second driver on the same truck gets their own token");
    const mB = await photo(tokB);
    const m2 = await photo(tokA);
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
    t.ok(fT?.priority === "DO_NOT_USE" && fT.markedDown === true && fL?.markedDown === false, "the Do-not-use fault is the one that marked it Down");
    t.ok((await db.resource.findUnique({ where: { id: truck.id } }))?.status === "DOWN", "Do not use: the truck is DOWN on the register");
    t.ok(fT?.events.some((e) => e.action === "REPORTED") && fT.events.some((e) => e.action === "DOWN"), "the history has Reported and Marked Down");
    t.ok(noMoney(fT?.description ?? "$1"), "the dollar amount was taken out of the words");

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

    // (8) Sign-out hands over the post-check.
    const outA = await sign(point.secret, point.id, "OUT", A);
    t.ok(outA.status === 200 && typeof outA.body.postcheck === "string", "a truck sign-out returns a post-check token", outA.status);
    const pv = await view(outA.body.postcheck);
    t.ok(pv.status === 200 && pv.body?.checklist?.id === "truck-post.v1", "GET: the truck post-check");
    t.status(await submit(outA.body.postcheck, { answers: allOk(POST) }), 201, "a post-check with no faults is saved");

    // (9) Forged, expired and non-truck tokens.
    const secret = (() => { try { return readFileSync(c.p.envFile, "utf8").match(/^AUTH_SECRET=(.*)$/m)?.[1]?.replace(/^"|"$/g, "").trim(); } catch { return null; } })();
    t.status(await view(tokA.slice(0, -3) + "AAA"), 401, "a tampered token is refused");
    if (secret) {
      const forge = (payload) => `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", `${secret}:site-signin`).update(payload).digest("base64url").slice(0, 22)}`;
      const aId = (await db.prestartCheck.findFirst({ where: { resourceId: truck.id, personId: A.id, kind: "PRE" } }))?.attendanceId;
      t.status(await view(forge(`S|${aId}|PRE|${Date.now() - 1000}`)), 401, "an expired token is refused");
      const officeAtt = await db.siteAttendance.findFirst({ where: { resourceId: C.id, place: "OFFICE" } });
      t.ok([400, 404].includes((await view(forge(`S|${officeAtt?.id}|PRE|${Date.now() + 60_000}`))).status), "a token for a sign-in that isn't on a truck is refused");
    } else t.note("test AUTH_SECRET not readable - expired-token case not checked");

    // (10) The office side: exactly the four roles.
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
    t.ok(noMoney(JSON.stringify(list)), "no $ figure in the office list");
    // A driver on the truck with no pre-start reads "No pre-start".
    await sign(point.secret, point.id, "IN", C);
    const day = (await c.json(`/api/faults/checks?date=${c.today}`, "YARD")).body?.signIns ?? [];
    const rowA = day.find((s) => s.person === A.name), rowC = day.find((s) => s.person === C.name);
    t.ok(rowA?.preStatus?.startsWith("Done") && rowA?.postStatus === "Done" && rowA.pre?.answers?.length === 12, "Checks: A's pre-start and post-check, with the answers");
    t.ok(rowC?.preStatus === "No pre-start", "Checks: a sign-in with no check reads 'No pre-start'");

    // (11) Working a fault: conditional, a note to fix, back to Available only where this fault set it Down.
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

    // (12) Nothing with a dollar figure ever went to a phone.
    const leaked = linkBodies.filter((b) => !noMoney(b));
    t.ok(leaked.length === 0, `no $ figure in any of the ${linkBodies.length} link replies`, `${leaked.length} with $`);

    await sign(point.secret, point.id, "OUT", B);
    await sign(point.secret, point.id, "OUT", C);
    await db.siteLink.updateMany({ where: { id: { in: [point.id, office.id, poster.id] } }, data: { revokedAt: new Date() } });
    await db.resource.updateMany({ where: { id: { in: [truck.id, A.id, B.id, C.id] } }, data: { active: false } });
    await db.project.update({ where: { id: project.id }, data: { status: "INACTIVE" } }).catch(() => {});
  },
};
