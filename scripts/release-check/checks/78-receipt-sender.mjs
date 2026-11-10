// Who was on the truck (Ilies, 10 Nov 2026): a tip docket / fuel receipt naming one of our trucks, sent on the link of
// someone who wasn't signed in on that truck while somebody else was, is To check with a note naming who was on it.
// Two drivers with DRIVER links; driver B signs in on a test truck's QR. The reading is driven the way the pipeline
// does it (runner.readReceipt) in a tsx child with a stand-in reader - no Claude, no outbound call (RECEIPT_READING
// stays off for the server). Then: A's docket and fuel -> CHECK naming B and the truck; B's docket -> READ; the note on
// the office list (Manager); never on a link; no $ on any link reply.
// WRITES on the test copy: a truck + its QR point, two drivers, two DRIVER links, a project + job today, a truck
// sign-in, three receipts with a 1x1 photo each (drivers / truck switched off, links revoked, B signed out at the end).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";

export default {
  id: "receipt-sender", title: "Receipts: a docket / fuel receipt sent on a link whose owner wasn't on the truck is To check, office-only note",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/lib/receipts/senderStore.ts") || "the candidate has no sender check",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (!existsSync(tsxCli)) return t.block("no tsx in the candidate's node_modules");
    const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
    const tag = Date.now().toString(36).slice(-6).toUpperCase();
    const rego = `RS${tag}`.slice(0, 8);
    const linkBodies = [];

    // A truck with its QR point, two drivers with DRIVER links, a job today.
    const truck = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC sender truck - ${rego}`, identifier: rego, ownership: "OWNED", status: "AVAILABLE" } });
    const point = await makeLink(db, "POSTER", truck.id, { place: "VEHICLE" });
    const A = await db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rcsendera Tester ${tag}` } });
    const B = await db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rcsenderb Tester ${tag}` } });
    const drvA = await makeLink(db, "DRIVER", A.id), drvB = await makeLink(db, "DRIVER", B.id);
    const project = await db.project.create({ data: { name: `RC sender site ${tag}`, status: "ACTIVE" } });
    const job = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    const keep = async (r) => { const text = await r.text().catch(() => ""); linkBodies.push(text); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body: j }; };

    try {
      // Driver B signs in on the truck QR (the real sign-in flow).
      const scan = await c.json(`/api/site/in/${encodeURIComponent(point.secret)}`, null);
      linkBodies.push(JSON.stringify(scan.body ?? {}));
      const signed = await keep(await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId: point.id, action: "IN", resourceId: B.id, deviceId: `rc78-${B.id}`, gps: { status: "DENIED" } }));
      t.status(signed, [200, 201], "driver B signs in on the truck QR");
      const onTruck = await db.siteAttendance.findFirst({ where: { place: "VEHICLE", vehicleId: truck.id, resourceId: B.id, signOutAt: null } });
      if (!onTruck) return t.block("driver B's truck sign-in wasn't recorded - the rest needs it");

      const send = async (link, body) => {
        const ph = await keep(await c.post(c.site(link, "/receipts/photos"), null, { dataUrl: JPEG }));
        return keep(await c.post(c.site(link, "/receipts"), null, { ...body, photoIds: [ph.body?.id] }));
      };
      const sA = await send(drvA, { kind: "TIP", jobId: job.id, asbestos: false });
      const sB = await send(drvB, { kind: "TIP", jobId: job.id, asbestos: false });
      const fA = await send(drvA, { kind: "FUEL", vehicleId: truck.id });
      t.ok(sA.status === 201 && sB.status === 201 && fA.status === 201, "driver A's docket, driver B's docket and driver A's fuel receipt are sent", `${sA.status}/${sB.status}/${fA.status}`);
      const rowOf = (linkId, kind) => db.receipt.findFirst({ where: { siteLinkId: linkId, kind }, orderBy: { sentAt: "desc" } });
      const [rA, rB, rF] = [await rowOf(drvA.id, "TIP"), await rowOf(drvB.id, "TIP"), await rowOf(drvA.id, "FUEL")];
      if (!rA || !rB || !rF) return t.block("the receipts weren't saved");
      t.ok([rA, rB, rF].every((r) => r.status === "SENT"), "reading is off on the server - all three wait to be read");

      // Read them the way the pipeline does, with a stand-in reader naming the test truck.
      const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(", ", "T");
      const runner = "file:///" + path.join(c.p.appDir, "src", "lib", "receipts", "runner.ts").split(path.sep).join("/");
      const script = path.join(c.p.files, `rc78-read-${tag}.mts`);
      writeFileSync(script, [
        `import { readReceipt } from ${JSON.stringify(runner)};`,
        `let n = 0;`,
        `const reader = {`,
        `  tip: async () => ({ documentType: "tip_docket", docketNo: "RC78-${tag}-" + (++n), dateTime: ${JSON.stringify(now)}, tipSite: "Release Check Tip", wasteType: "Mixed C&D", tonnesNet: "6.2", rego: ${JSON.stringify(rego.toLowerCase().replace(/^(..)/, "$1 "))}, priceExGst: "", priceIncGst: "", unclear: [], note: "" }),`,
        `  fuel: async () => ({ documentType: "fuel_receipt", litres: "100", pricePerLitre: "2.000", total: "200.00", station: "Release Check Fuel", dateTime: ${JSON.stringify(now)}, rego: "", unclear: [], note: "" }),`,
        `  purchase: async () => { throw new Error("not used"); },`,
        `  odometer: async () => { throw new Error("not used"); },`,
        `};`,
        `for (const id of ${JSON.stringify([rA.id, rB.id, rF.id])}) await readReceipt(id, reader);`,
        `await new Promise((r) => setTimeout(r, 2000)); // let the background tip matching finish`,
        `console.log("RESULT done");`,
        `process.exit(0);`,
      ].join("\n"));
      let out = "";
      try {
        const childEnv = { ...process.env, ...env };
        delete childEnv.RECEIPT_READING; // on for this one process only - its reader is the stand-in above
        delete childEnv.ANTHROPIC_API_KEY;
        out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 120_000 });
      } catch (e) { out = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
      t.ok(/RESULT done/.test(out), "the reading pipeline ran with the stand-in reader", out.includes("RESULT") ? "" : "no RESULT line");

      const reasons = (r) => { try { return JSON.parse(r?.checkReasons ?? "[]"); } catch { return []; } };
      const [a, b, f] = await Promise.all([rA, rB, rF].map((r) => db.receipt.findUnique({ where: { id: r.id } })));
      const noteA = reasons(a).find((x) => /signed in on/.test(x)) ?? "";
      t.ok(a?.status === "CHECK", "driver A's tip docket naming the truck B is signed in on -> To check", a?.status);
      t.ok(noteA.includes(B.name) && noteA.includes(rego) && noteA.includes(`${A.name}'s link`), "...the note names B, the truck and A's link", noteA ? "note present" : "no note");
      t.ok(noMoney(noteA), "...with no $ in the note");
      t.ok(a?.vehicleId === truck.id, "...and the docket is linked to the truck");
      t.ok(b?.status === "READ" && !reasons(b).some((x) => /signed in on/.test(x)), "driver B's own docket for the truck he's on -> no flag (READ)", b?.status);
      const noteF = reasons(f).find((x) => /signed in on/.test(x)) ?? "";
      t.ok(f?.status === "CHECK" && noteF.includes(B.name) && noteF.includes(rego), "driver A's fuel receipt for that truck (picked truck) -> To check naming B", f?.status);

      // The office sees the note; the links never do.
      const office = (await c.json(`/api/receipts?day=${c.today}`, "MANAGER")).body;
      const row = (office?.rows ?? []).find((x) => x.id === rA.id);
      t.ok(row?.status === "CHECK" && (row?.reasons ?? []).some((x) => /signed in on/.test(x) && x.includes(B.name)), "the Receipts page (Manager) shows the note like the other reader notes", row ? "row found" : "row not in the list");
      for (const [who, link] of [["A", drvA], ["B", drvB]]) {
        const mine = await keep(await c.get(c.site(link, "/receipts"), null));
        const text = JSON.stringify(mine.body ?? {});
        t.ok(mine.status === 200 && !/signed in on/i.test(text) && !text.includes(B.name), `driver ${who}'s link: the note never reaches it (words and dates only)`, mine.status);
      }
      const leaked = linkBodies.filter((x) => !noMoney(x));
      t.ok(leaked.length === 0, `no $ figure in any of the ${linkBodies.length} link replies`, `${leaked.length} with $`);
    } finally {
      // Tidy (nothing deleted): B signed out, links revoked, drivers and truck switched off, the project inactive.
      await db.siteAttendance.updateMany({ where: { vehicleId: truck.id, signOutAt: null }, data: { signOutAt: new Date(), signOutMethod: "OFFICE" } });
      await db.siteLink.updateMany({ where: { id: { in: [point.id, drvA.id, drvB.id] } }, data: { revokedAt: new Date() } });
      await db.resource.updateMany({ where: { id: { in: [truck.id, A.id, B.id] } }, data: { active: false } });
      await db.project.update({ where: { id: project.id }, data: { status: "INACTIVE" } }).catch(() => {});
    }
  },
};
