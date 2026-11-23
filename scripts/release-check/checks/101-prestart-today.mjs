// Pre-starts today + the truck pre-start can't be skipped (Ilies, 23 Nov 2026: "yes do 1 and 2, deploy once passes").
//   1. The card on the Allocations board (/api/faults/today): each truck signed in today, each owned machine with a QR
//      sticker or booked today, the counts and "N machines have no QR sticker yet"; the rows open the Checks tab
//      (/faults?tab=checks&date=&row=); the "Pre-starts" nav link only where the Checks tab already is.
//   2. The truck's first pre-start of the day is required: the sign-in time is saved at the scan (before any check), no
//      odometer "Can't now" / skip, "Pre-start not done" (red) on the Checks tab, Sign-ins and the card until it's sent,
//      reopening the QR on the same phone hands the pre-start back (STATUS, body only - PS-005; never after sign-out -
//      PS-006), sign-out is never blocked, a later sign-in the same day stays optional, and a full odometer photo limit
//      never traps a driver.
// WRITES on the test copy: two trucks (+ QR links), four drivers, two owned machines (one with a plant QR), sign-ins,
// odometer readings and photos, walk-around photos, checks, seeded receipt-photo rows (removed again); everyone signed
// out, trucks / drivers / machines switched off and the links revoked at the end.
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const uniqPng = () => `data:image/png;base64,${Buffer.concat([PNG_BYTES, randomBytes(16)]).toString("base64")}`;
const PRE = ["tyres", "lights", "brakes", "horn", "mirrors", "seatbelt", "fluids", "leaks", "tipper", "load", "safety-kit", "body"];
const POST = ["new-damage", "driving-faults", "tray", "parked"];
const SLOTS = ["FRONT", "BACK", "DRIVER", "PASSENGER", "CAB"];
const allOk = (keys) => Object.fromEntries(keys.map((k) => [k, "OK"]));
const ALLOWED = ["ADMIN", "MANAGER", "COORDINATOR", "YARD"];
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"];
const NOT_DONE = "Pre-start not done";

export default {
  id: "prestart-today", title: "Pre-starts today: the board card + nav link; the truck's first pre-start of the day can't be skipped (sign-in kept, resume, sign-out never blocked), no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/prestart/today.ts") || "needs lib/prestart/today.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const bodies = [];
    const trucks = [], people = [], links = [], machines = [], seeded = [];
    let n = 0;
    const keep = async (r) => {
      const text = await r.text().catch(() => "");
      bodies.push(text);
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: j };
    };
    const mkTruck = async () => {
      const r = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC101 truck ${++n} ${tag}`, identifier: `R1${n}${tag}`.slice(0, 12), ownership: "OWNED", status: "AVAILABLE" } });
      trucks.push(r.id);
      const l = await makeLink(db, "POSTER", r.id, { place: "VEHICLE" });
      links.push(l.id);
      return { ...r, point: l };
    };
    const mkPerson = async (x) => {
      const r = await db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rc101driver${x} Tester ${tag}` } });
      people.push(r.id);
      return r;
    };
    const sign = async (tr, action, who, deviceId = `rc101-${who.id}`) => {
      const scan = await c.json(`/api/site/in/${encodeURIComponent(tr.point.secret)}`, null);
      bodies.push(JSON.stringify(scan.body ?? {}));
      return keep(await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId: tr.point.id, action, resourceId: who.id, deviceId, gps: { status: "DENIED" } }));
    };
    const view = async (token) => keep(await c.req("GET", "/api/site/in/prestart", null, undefined, { "x-prestart-token": token }));
    const photo = async (token, slot) => keep(await c.post("/api/site/in/prestart/photo", null, { token, photo: uniqPng(), ...(slot ? { slot } : {}) }));
    const submit = async (token, body) => keep(await c.post("/api/site/in/prestart", null, { token, ...body }));
    const odometer = async (token, body) => keep(await c.post("/api/site/in/odometer", null, { token, ...body }));
    const walkAll = async (token) => { const out = {}; for (const s of SLOTS) out[s] = (await photo(token, s)).body?.id; return out; };
    const checksRow = async (id, who = "MANAGER") => ((await c.json(`/api/faults/checks?date=${c.today}`, who)).body?.signIns ?? []).find((s) => s.id === id);
    const card = async (who = "ADMIN") => { const r = await c.json("/api/faults/today", who); bodies.push(JSON.stringify(r.body ?? {})); return r; };
    const signInRow = async (id) => {
      const a = (await c.json(`/api/attendance?date=${c.today}`, "MANAGER")).body;
      for (const g of a?.points ?? []) for (const r of g.rows ?? []) if (r.id === id) return r;
      return null;
    };

    const T = await mkTruck();
    const [A, B, Cc, D] = [await mkPerson("a"), await mkPerson("b"), await mkPerson("c"), await mkPerson("d")];

    // (1) The first truck QR sign-in of the day: saved at the scan, then the pre-start is required.
    const before = Date.now();
    const inA = await sign(T, "IN", A);
    if (!t.ok(inA.status === 200 && typeof inA.body?.prestart === "string", "the truck QR sign-in goes through, with a pre-start token", inA.status)) return;
    const attA = await db.siteAttendance.findFirst({ where: { vehicleId: T.id, resourceId: A.id }, orderBy: { signInAt: "desc" } });
    t.ok(!!attA && attA.signInAt.getTime() >= before - 5000 && attA.signInAt.getTime() <= Date.now() && !attA.signOutAt, "the sign-in time is recorded at the scan (open sign-in, server time)");
    t.ok((await db.prestartCheck.count({ where: { attendanceId: attA?.id } })) === 0, "...before any pre-start exists - the check never holds the sign-in up");
    t.ok(inA.body?.prestartRequired === true && inA.body?.walkaroundRequired === true, "the reply says the pre-start is required (the truck has none yet today)");
    const vA = await view(inA.body.prestart);
    t.ok(vA.status === 200 && vA.body?.required === true && vA.body?.odometer === "MISSING", "the checklist view says required (no Do it later) and the odometer is missing", vA.status);
    t.status(await odometer(inA.body.odometer, { skip: true }), 409, "no odometer 'Can't now' / skip on the day's first pre-start");
    t.ok(!(await db.odometerReading.findUnique({ where: { siteAttendanceId: attA?.id } })), "...and the refused skip saved nothing");
    {
      let page = "", check = "";
      try {
        page = readFileSync(path.join(c.p.appDir, "src", "app", "site", "in", "[code]", "page.tsx"), "utf8");
        check = readFileSync(path.join(c.p.appDir, "src", "components", "site", "PrestartCheck.tsx"), "utf8");
      } catch { /* missing */ }
      t.ok(/noSkip=\{prestartRequired\}/.test(page) && /noSkip \? \(/.test(page), "the phone's odometer step shows no skip when required");
      t.ok(/prestartSkippable\(\{ required: !!view\.required, capped \}\)/.test(check) && /skippable \? \(/.test(check), "the checklist hides Do it later while required (only a photo limit brings it back)");
      t.ok(/onSignOut/.test(check) && /signOutInstead/.test(page), "the required screens still offer Sign out");
    }

    // (2) Until it's sent: red "Pre-start not done" on the Checks tab, Sign-ins and the card.
    const rowA = await checksRow(attA?.id);
    t.ok(rowA?.preStatus === NOT_DONE, "Checks tab: 'Pre-start not done' while it isn't sent", rowA?.preStatus);
    t.ok((await signInRow(attA?.id))?.flags?.includes("PRESTART_NOT_DONE"), "Sign-ins: the line carries PRESTART_NOT_DONE");
    const card1 = await card();
    t.ok(card1.status === 200, "the card loads for an Admin", card1.status);
    const cT1 = card1.body?.trucks?.find((x) => x.id === T.id);
    t.ok(cT1?.status === "NOT_DONE" && cT1.label === NOT_DONE && cT1.href === `/faults?tab=checks&date=${c.today}&row=${attA?.id}`, "the card: the truck is 'Pre-start not done' and opens the Checks tab on that day and row", JSON.stringify(cT1 ?? null));
    t.ok(card1.body?.counts?.trucks?.notDone >= 1 && typeof card1.body?.noSticker === "number", "the card has counts at the top and the no-sticker count");

    // (3) Reopening the QR on the same phone takes the driver back into the pre-start; PS-005: never in the address.
    const stA = await sign(T, "STATUS", A);
    t.ok(stA.status === 200 && stA.body?.signedIn === true && stA.body?.prestartRequired === true && typeof stA.body?.prestart === "string" && typeof stA.body?.odometer === "string" && stA.body?.odometerSent === false,
      "STATUS on the same phone: still signed in, and the pre-start (and odometer) handed back", stA.status);
    const stOther = await sign(T, "STATUS", A, `rc101-another-phone-${tag}`);
    t.ok(stOther.status === 200 && stOther.body?.signedIn === true && !stOther.body?.prestart, "...a different phone claiming the same name gets no pre-start token");
    const vR = await view(stA.body?.prestart);
    t.ok(vR.status === 200 && vR.body?.required === true && vR.body?.done === false, "the resumed token opens the same required pre-start", vR.status);
    t.status(await keep(await c.get(`/api/site/in/prestart?token=${encodeURIComponent(stA.body?.prestart ?? "")}`, null)), 401, "PS-005: the resumed token is not accepted from the address");

    // (4) Sign-out is never blocked - B signs in (also required), leaves without a pre-start, and it stays "not done".
    const inB = await sign(T, "IN", B);
    t.ok(inB.status === 200 && inB.body?.prestartRequired === true, "a second driver before anyone's pre-start: required too", inB.status);
    const outB = await sign(T, "OUT", B);
    t.ok(outB.status === 200 && typeof outB.body?.postcheck === "string", "sign-out with the required pre-start not done goes through (post-check offered)", outB.status);
    const attB = await db.siteAttendance.findFirst({ where: { vehicleId: T.id, resourceId: B.id }, orderBy: { signInAt: "desc" } });
    t.ok(!!attB?.signOutAt, "...and the sign-out time is saved");
    t.status(await view(inB.body?.prestart), 409, "PS-006: B's PRE token is dead after sign-out");
    const stB = await sign(T, "STATUS", B);
    t.ok(stB.status === 200 && stB.body?.signedIn === false && !stB.body?.prestart, "PS-006: reopening after sign-out hands out no pre-start");
    t.ok((await checksRow(attB?.id))?.preStatus === NOT_DONE, "B's sign-in stays 'Pre-start not done' on the Checks tab");

    // (5) A sends it (odometer + walk-around): Done everywhere, nothing more to resume.
    t.status(await odometer(stA.body?.odometer, { dataUrl: uniqPng() }), 201, "the odometer photo (resumed token)");
    const walk = await walkAll(stA.body?.prestart);
    const sent = await submit(stA.body?.prestart, { answers: allOk(PRE), walkaround: walk });
    t.ok(sent.status === 201 && sent.body?.walkaround === "DONE", "A's pre-start is sent (from the resumed screen)", sent.status);
    t.ok((await checksRow(attA?.id))?.preStatus === "Done", "Checks tab: now 'Done'");
    t.ok(!(await signInRow(attA?.id))?.flags?.includes("PRESTART_NOT_DONE"), "Sign-ins: the red flag is gone");
    const cT2 = (await card()).body?.trucks?.find((x) => x.id === T.id);
    t.ok(cT2?.status === "DONE" && cT2.label === "Done", "the card: the truck is 'Done'", JSON.stringify(cT2 ?? null));
    const stA2 = await sign(T, "STATUS", A);
    t.ok(stA2.body?.signedIn === true && !stA2.body?.prestart, "STATUS after it's sent: nothing to resume");
    t.ok((await checksRow(attB?.id))?.preStatus === NOT_DONE, "B (signed out before A's pre-start) is still 'Pre-start not done'");

    // (6) A later sign-in the same day on a checked truck keeps today's optional behaviour.
    const inC = await sign(T, "IN", Cc);
    t.ok(inC.status === 200 && inC.body?.prestartRequired === false && inC.body?.walkaroundRequired === false, "a later sign-in the same day: optional", inC.status);
    t.ok((await view(inC.body?.prestart)).body?.required === false, "...its view isn't required (Do it later stays)");
    t.status(await odometer(inC.body?.odometer, { skip: true }), 201, "...and its odometer 'Can't now' still works");
    t.ok(!(await sign(T, "STATUS", Cc)).body?.prestart, "...and reopening doesn't force it");
    const attC = await db.siteAttendance.findFirst({ where: { vehicleId: T.id, resourceId: Cc.id }, orderBy: { signInAt: "desc" } });
    t.ok((await checksRow(attC?.id))?.preStatus === "No pre-start", "Checks tab: a skipped optional one reads 'No pre-start', as before");
    t.ok(!(await signInRow(attC?.id))?.flags?.includes("PRESTART_NOT_DONE"), "...and isn't flagged red on Sign-ins");
    // The post-check after sign-out: the card shows it.
    const outA = await sign(T, "OUT", A);
    t.status(await submit(outA.body?.postcheck, { answers: allOk(POST) }), 201, "A's post-check");
    t.ok((await card()).body?.trucks?.find((x) => x.id === T.id)?.status === "POST_DONE", "the card: 'Post-check done'");

    // (7) Never trapped on a limit: truck 2's odometer photos for the day used up -> the first pre-start goes without it.
    {
      const T2 = await mkTruck();
      for (let i = 0; i < 60; i++) {
        const r = await db.receiptPhoto.create({ data: { fileName: `rc101-seed-${tag}-${i}.jpg`, siteLinkId: T2.point.id, takenBy: "release-check" } });
        seeded.push(r.id);
      }
      const inD = await sign(T2, "IN", D);
      t.ok(inD.body?.prestartRequired === true, "truck 2: D's first sign-in is required");
      const up = await odometer(inD.body?.odometer, { dataUrl: uniqPng() });
      t.ok(up.status === 429 && up.body?.capFull === true, "the odometer photo over the day's limit -> 429 capFull", up.status);
      t.status(await odometer(inD.body?.odometer, { skip: true }), 201, "...then 'Go on without it' is let through (the server counted the limit)");
      const vD = await view(inD.body?.prestart);
      t.ok(vD.body?.required === true && vD.body?.odometer === "LIMIT", "the view: still required, odometer LIMIT (not needed)");
      const okD = await submit(inD.body?.prestart, { answers: allOk(PRE), walkaround: await walkAll(inD.body?.prestart) });
      t.ok(okD.status === 201, "the required pre-start is accepted without the odometer when its limit is full", okD.status);
      await db.receiptPhoto.deleteMany({ where: { id: { in: seeded } } });
    }

    // (8) Machines: an owned machine with a sticker is listed; one with none counts in "no QR sticker yet".
    {
      const noneBefore = (await card()).body?.noSticker ?? -1;
      const M1 = await db.resource.create({ data: { type: "EQUIPMENT", category: "Excavator", name: `RC101 machine 1 ${tag}`, ownership: "OWNED", status: "AVAILABLE" } });
      const M2 = await db.resource.create({ data: { type: "EQUIPMENT", category: "Excavator", name: `RC101 machine 2 ${tag}`, ownership: "OWNED", status: "AVAILABLE" } });
      machines.push(M1.id, M2.id);
      const l = await makeLink(db, "PLANT", M1.id);
      links.push(l.id);
      const cm = (await card()).body;
      const m1 = cm?.machines?.find((x) => x.id === M1.id);
      t.ok(m1?.status === "NOT_DONE" && m1.label === "No pre-start" && m1.needed === false && m1.href === `/faults?tab=checks&date=${c.today}&row=${M1.id}`, "the card: a stickered machine not booked today - 'No pre-start', not counted as missing", JSON.stringify(m1 ?? null));
      t.ok(!cm?.machines?.some((x) => x.id === M2.id), "a machine with no sticker and no booking isn't listed");
      t.ok(cm?.noSticker === noneBefore + 1 && /^\d+ machines? (has|have) no QR sticker yet$/.test(cm?.noStickerText ?? ""), "...but counts in 'N machines have no QR sticker yet'", `${noneBefore} -> ${cm?.noSticker}`);
    }

    // (9) Who sees it: exactly the Checks tab's people; the nav link only for them.
    t.status(await c.get("/api/faults/today", null), 401, "/api/faults/today: no login refused");
    for (const who of ALLOWED) t.status(await card(who), 200, `/api/faults/today: ${who}`);
    for (const who of REFUSED) t.status(await c.get("/api/faults/today", who), 403, `/api/faults/today: ${who} refused`);
    {
      let nav = "", faults = "", board = "";
      try {
        nav = readFileSync(path.join(c.p.appDir, "src", "components", "TopNav.tsx"), "utf8");
        faults = readFileSync(path.join(c.p.appDir, "src", "app", "faults", "page.tsx"), "utf8");
        board = readFileSync(path.join(c.p.appDir, "src", "components", "Board.tsx"), "utf8");
      } catch { /* missing */ }
      const block = (name) => { const i = nav.indexOf(`const ${name} = [`); return i < 0 ? "" : nav.slice(i, nav.indexOf("];", i)); };
      t.ok(/PRESTARTS_HREF = "\/faults\?tab=checks"/.test(nav), "the nav link opens /faults?tab=checks");
      t.ok(block("COORDINATOR").includes("PRESTARTS_HREF") && block("YARD").includes("PRESTARTS_HREF"), "the coordinator's and the yard's screens have it");
      t.ok(!block("DIRECTORS").includes("PRESTARTS_HREF") && !block("ACCOUNTS").includes("PRESTARTS_HREF"), "the Directors and Accounts screens don't");
      t.ok(/i\.href !== PRESTARTS_HREF/.test(nav) && /\|\| canEdit\)/.test(nav), "on the Operations screen it's in the Managers / Admins-only list (a Viewer never sees it)");
      t.ok(/q\.get\("tab"\) === "checks"/.test(faults) && /q\.get\("date"\)/.test(faults) && /tab: "faults" \| "checks"/.test(faults), "the Faults page honours ?tab=checks and ?date= (Faults stays the default)");
      t.ok(/<PrestartToday enabled=\{canEdit\} \/>/.test(board), "the board shows the card to Managers and Admins only");
    }
    const page = await c.text(`/faults?tab=checks&date=${c.today}`, "ADMIN");
    t.ok(page.status === 200, "/faults?tab=checks loads for an Admin", page.status);

    // (10) No money anywhere it went.
    const leaked = bodies.filter((b) => !noMoney(b));
    t.ok(leaked.length === 0, `no $ figure in any of the ${bodies.length} replies (link and card)`, `${leaked.length} with $`);

    // Tidy.
    await db.receiptPhoto.deleteMany({ where: { id: { in: seeded } } });
    await db.siteAttendance.updateMany({ where: { vehicleId: { in: trucks }, signOutAt: null }, data: { signOutAt: new Date(), signOutMethod: "OFFICE" } });
    await db.siteLink.updateMany({ where: { id: { in: links } }, data: { revokedAt: new Date() } });
    await db.resource.updateMany({ where: { id: { in: [...trucks, ...people, ...machines] } }, data: { active: false } });
  },
};
