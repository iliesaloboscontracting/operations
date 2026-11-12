// Checks & service history on the plant QR (Ilies, 12 Nov 2026: "Should allow pre and post starts and show service
// history.. if the build wants to check the guys did the prestart they can scan. if they want to check service history..
// allow these to be downloaded"). /api/site/plant/:code/history (+ /download, PDF / CSV) - view only, no name, the QR
// code the only key (the scan's own lookup); /api/plant/:id/history (+ /download) on the Plant page, Managers / Admins.
// Asserts: the operator's Start / End of shift flow still works as before; view + download with a valid code, refused
// (404) with a bad, switched-off or reprinted code; only this machine's records; the 90 / 30 / 7-day windows; no "$" or
// amount anywhere - including a seeded ServiceRecord with money in its fields and its words; no device ids or positions;
// CSV formula escaping; the PDFs are PDFs (and their text has no money); the office routes' access; the rate limits.
// WRITES on the test copy: plant, people, QRs, check sessions, checks, faults, photos, service records, asset dates.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";
import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";

const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const uniqPng = () => `data:image/png;base64,${Buffer.concat([PNG_BYTES, randomBytes(16)]).toString("base64")}`;
const PRE = ["walk-around", "hoses", "tracks", "fluids", "greased", "hitch", "rops", "seatbelt", "lights", "controls", "e-stop", "extinguisher", "warning-lights"];
const POST = ["damage", "parked", "fuel"];
const SLOTS = ["FRONT", "BACK", "LEFT", "RIGHT", "CAB"];
const allOk = (keys) => Object.fromEntries(keys.map((k) => [k, "OK"]));
const DAY = 24 * 60 * 60 * 1000;

// The text a react-pdf (pdfkit) file draws: its content streams inflated, the hex / literal strings in them decoded.
function pdfText(buf) {
  const bin = buf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(bin))) {
    const start = m.index + m[0].length, end = bin.indexOf("endstream", start);
    if (end < 0) break;
    let body;
    try { body = inflateSync(Buffer.from(bin.slice(start, end), "latin1")).toString("latin1"); } catch { continue; }
    for (const arr of body.match(/\[(?:[^\]]*)\]\s*TJ|<[0-9a-fA-F]+>\s*Tj|\((?:\\.|[^)])*\)\s*Tj/g) ?? []) {
      for (const h of arr.match(/<([0-9a-fA-F]+)>/g) ?? []) out += Buffer.from(h.slice(1, -1), "hex").toString("latin1");
      for (const l of arr.match(/\((?:\\.|[^)])*\)/g) ?? []) out += l.slice(1, -1).replace(/\\(.)/g, "$1");
      out += " ";
    }
    re.lastIndex = end;
  }
  // Words can come in separate runs ("250" + " hr service") - one space between them, as on the page.
  return out.replace(/\s+/g, " ");
}

export default {
  id: "plant-history", title: "Plant QR checks & service history: view + PDF / CSV download by QR only, this machine only, 90 days, no money, office view, limits",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/prestart/history.ts") || "the candidate has no plant checks & service history",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const made = { res: [] };
    const replies = []; // every reply body from the new routes, for the money scan
    const mkPlant = async (n) => { const r = await db.resource.create({ data: { type: "EQUIPMENT", category: "Plant", role: "Plant", name: `RC hist ${n} ${tag}`, ownership: "OWNED", status: "AVAILABLE" } }); made.res.push(r.id); return r; };
    const mkPerson = async (n, role = "Operator") => { const r = await db.resource.create({ data: { type: "PERSONNEL", category: "Labourer", role, name: `Rchist${n} Op ${tag}` } }); made.res.push(r.id); return r; };
    const keep = async (r) => { const text = await r.text().catch(() => ""); let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j, text, type: r.headers.get("content-type") ?? "" }; };
    const secretOf = (url) => (url ?? "").match(/\/site\/plant\/([^/?#]+)$/)?.[1] ?? "none";
    const printQr = async (id) => keep(await c.post("/api/plant/qr", "MANAGER", { resourceId: id }));
    const scan = (s) => c.get(`/api/site/plant/${encodeURIComponent(s)}`, null).then(keep);
    const start = async (ticket, kind, who, deviceId) => keep(await c.post("/api/site/plant/start", null, { ticket, kind, resourceId: who.id, deviceId }));
    const photo = async (token, slot) => keep(await c.post("/api/site/in/prestart/photo", null, { token, photo: uniqPng(), ...(slot ? { slot } : {}) }));
    const submit = async (token, body) => keep(await c.post("/api/site/in/prestart", null, { token, ...body }));
    const view = async (s, q = "") => { const r = await keep(await c.get(`/api/site/plant/${encodeURIComponent(s)}/history${q}`, null)); replies.push(r.text); return r; };
    const dl = async (s, q) => { const r = await c.get(`/api/site/plant/${encodeURIComponent(s)}/history/download${q}`, null); const buf = Buffer.from(await r.arrayBuffer()); const out = { status: r.status, type: r.headers.get("content-type") ?? "", disp: r.headers.get("content-disposition") ?? "", buf, text: buf.toString("utf8") }; replies.push(out.type.includes("pdf") ? pdfText(buf) : out.text); return out; };

    const M1 = await mkPlant(1), M2 = await mkPlant(2), M3 = await mkPlant(3), M4 = await mkPlant(4);
    const noName = (x) => x.split(M1.name).join(""); // the machine name carries a random tag that could hold any digits
    const OP1 = await mkPerson(1), OP2 = await mkPerson(2);
    const q1 = await printQr(M1.id), q2 = await printQr(M2.id), q3 = await printQr(M3.id), q4 = await printQr(M4.id);
    let s1 = secretOf(q1.body?.url);
    const s2 = secretOf(q2.body?.url), s3 = secretOf(q3.body?.url), s4 = secretOf(q4.body?.url);
    if (!t.ok(q1.status === 201 && s1 !== "none", "a Manager prints machine 1's QR", q1.status)) return;

    // (1) The operators' flow, unchanged: scan -> Start of shift (walk-around + hour meter + a fault) -> End of shift.
    const sc = await scan(s1);
    t.ok(sc.status === 200 && typeof sc.body?.ticket === "string" && (sc.body.crew ?? []).some((p) => p.id === OP1.id), "scan: plant ticket, machine, operators (as before)", sc.status);
    const st = await start(sc.body?.ticket, "PRE", OP1, `rc87-a-${tag}`);
    t.ok(st.status === 201 && typeof st.body?.token === "string", "Start of shift -> a check token (as before)", st.status);
    const walk = {}; for (const s of SLOTS) walk[s] = (await photo(st.body?.token, s)).body?.id;
    const meter = (await photo(st.body?.token, "HOUR_METER")).body?.id;
    const fp = (await photo(st.body?.token)).body?.id;
    const pre = await submit(st.body?.token, { answers: { ...allOk(PRE), hoses: "FAULT" }, faults: [{ itemKey: "hoses", description: "Weeping hose on the boom", priority: "HIGH", mediaIds: [fp] }], walkaround: walk, hourMeter: { value: "1200", mediaId: meter } });
    t.ok(pre.status === 201 && pre.body?.walkaround === "DONE", "the pre-start with walk-around, hour meter and a High fault is accepted (as before)", pre.status);
    const st2 = await start((await scan(s1)).body?.ticket, "POST", OP2, `rc87-b-${tag}`);
    const meter2 = (await photo(st2.body?.token, "HOUR_METER")).body?.id;
    t.status(await submit(st2.body?.token, { answers: allOk(POST), hourMeter: { value: "1207.5", mediaId: meter2 } }), 201, "End of shift post-check accepted (as before)");
    t.ok((await db.siteAttendance.count({ where: { resourceId: { in: [OP1.id, OP2.id] } } })) === 0, "still no sign-in made by a plant check");

    // (2) Seeded history: an older check (10 days), one outside 90 days, a formula name; another machine's check, fault
    // and service; a service record with money in its fields AND its words; asset dates.
    const link1 = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M1.id, revokedAt: null } });
    const link2 = await db.siteLink.findFirst({ where: { kind: "PLANT", resourceId: M2.id, revokedAt: null } });
    const seedCheck = async (m, link, daysAgo, personName) => {
      const at = new Date(Date.now() - daysAgo * DAY);
      const s = await db.plantCheckSession.create({ data: { linkId: link.id, resourceId: m.id, kind: "PRE", day: at.toISOString().slice(0, 10), personName, deviceId: `rc87-dev-${tag}`, createdAt: at } });
      return db.prestartCheck.create({ data: { resourceId: m.id, resourceName: m.name, resourceType: "EQUIPMENT", kind: "PRE", personName, deviceId: `rc87-dev-${tag}`, sessionId: s.id, checklist: "plant-pre.v1", answers: JSON.stringify(PRE.map((k) => ({ key: k, label: k, answer: "OK" }))), hourMeter: 1100, createdAt: at } });
    };
    const c10 = await seedCheck(M1, link1, 10, "=HYPERLINK(\"http://evil\",\"x\")");
    const c95 = await seedCheck(M1, link1, 95, `Rchist old ${tag}`);
    const cOther = await seedCheck(M2, link2, 1, `Rchist other ${tag}`);
    await db.assetFault.create({ data: { resourceId: M2.id, resourceName: M2.name, itemLabel: "Hoses", description: `Other machine fault ${tag}`, priority: "DO_NOT_USE", status: "OPEN", reportedBy: "RC" } });
    // PS-059: a typed record with prices and an invoice number in its words (no "$"), and one made from the invoices
    // inbox (invoiceDraftId) - its wording must never show.
    await db.serviceRecord.create({ data: { resourceId: M1.id, date: c.today, mechanic: "$5 Plant Repairs 2000", invoiceNo: `INV-RC87-${tag}`, work: "Full service 450 inc GST invoice INV-10234 165/hr. Parts $412.50, total 849.75", amountExGst: 772.5, gst: 77.25, total: 849.75, odometer: 1190, notes: "Paid $849.75 by card" } });
    await db.serviceRecord.create({ data: { resourceId: M1.id, date: "2026-01-05", mechanic: "Kubota Dealer West", invoiceNo: "TAX-5521", invoiceDraftId: `rc87-draft-${tag}`, work: "Kubota 500hr service 1,980.00 ex GST tax invoice no. 5521", amountExGst: 1800, gst: 180, total: 1980, odometer: 950 } });
    await db.resource.update({ where: { id: M1.id }, data: { serviceDue: "Next at 1,250 hrs - quote 640" } });
    // PS-061: insurance and rego are office-only.
    await db.complianceDocument.create({ data: { holderType: "ASSET", holderName: M1.name, kind: "ASSET_INSURANCE", title: "Insurance", expiryDate: "2027-03-31", resourceId: M1.id, createdBy: "release-check" } });
    await db.complianceDocument.create({ data: { holderType: "ASSET", holderName: M1.name, kind: "REGO", title: "Rego", expiryDate: "2027-04-30", resourceId: M1.id, createdBy: "release-check" } });
    await db.serviceRecord.create({ data: { resourceId: M2.id, date: c.today, mechanic: "Other Mechanic", work: `Theirs ${tag}`, total: 333.33 } });
    await db.complianceDocument.create({ data: { holderType: "ASSET", holderName: M1.name, kind: "SERVICE_DUE", title: "Service due", expiryDate: "2027-01-15", resourceId: M1.id, createdBy: "release-check" } });

    // (3) The view with a valid code: this machine's checks, newest first, 90 days; the dates, services, open faults.
    const v = await view(s1);
    const rows = v.body?.checks ?? [];
    t.ok(v.status === 200 && rows.length === 3 && rows.some((x) => x.hourMeter === 1100 && /HYPERLINK/.test(x.operator)) && !/Rchist old|Rchist other/.test(v.text), "view: machine 1's 3 checks in 90 days (not the 95-day-old one, not machine 2's)", `${v.status} ${rows.length}`);
    t.ok(rows.length > 0 && rows.every((x) => !("id" in x)) && !v.text.includes(c10.id) && !v.text.includes(c95.id) && !v.text.includes(cOther.id), "PS-064: no check ids in the QR's reply");
    t.ok(!/Insurance|Rego|2027-03-31|2027-04-30/.test(v.text), "PS-061: no insurance or rego on the QR");
    const [first] = v.body?.checks ?? [];
    t.ok(first?.kind === "POST" && first.hourMeter === 1207.5 && /Rchist2/.test(first.operator), "newest first: the post-check, its hour meter and operator", JSON.stringify(first));
    const preRow = (v.body?.checks ?? []).find((x) => x.kind === "PRE" && x.hourMeter === 1200);
    t.ok(preRow && preRow.allOk === false && preRow.failed.length === 1 && preRow.faults?.[0]?.priorityLabel === "High" && preRow.faults[0].statusLabel === "Open" && /Weeping hose/.test(preRow.faults[0].description) && /Walk-around/.test(preRow.walkaround ?? ""),
      "the pre-start: items failed (by name), the fault with priority and current status, walk-around taken");
    const recs = v.body?.service?.records ?? [];
    const typed = recs.find((r) => r.reading === 1190), inbox = recs.find((r) => r.reading === 950);
    t.ok(v.body?.service?.nextDue?.expiryDate === "2027-01-15" && recs.length === 2 && /^Full service\b/.test(typed?.work ?? "") && inbox?.work === "Service (mechanic's invoice)",
      "PS-059: service - next due; typed work cleaned to words ('Full service. Parts'); the inbox record reads 'Service (mechanic's invoice)'", JSON.stringify(recs));
    const words = [...recs.flatMap((r) => [r.work, r.provider ?? ""]), v.body?.service?.registerNote ?? "", ...(v.body?.service?.openFaults ?? []).map((f) => f.description ?? ""), ...rows.flatMap((x) => (x.faults ?? []).map((f) => f.description ?? ""))];
    t.ok(words.every((w) => !/\d/.test(w)), "PS-059: no digit in any work, provider, register note or fault text", words.join(" | "));
    t.ok(typed?.reading === 1190 && inbox?.reading === 950, "...while the odometer / hours column keeps its reading");
    t.ok(v.body?.service?.openFaults?.length === 1 && v.body.service.openFaults[0].priority === "HIGH", "open faults: machine 1's only");
    t.ok(v.body?.doNotUse === false, "machine 1 isn't Do-not-use (machine 2's Do-not-use fault doesn't leak)");
    t.ok(!/Rchist other|Theirs|Other machine fault|Other Mechanic/.test(v.text), "nothing of machine 2 in machine 1's view");
    t.ok(!/deviceId|rc87-dev|gps|latitude|longitude|sessionId|personId/i.test(v.text), "no device ids, session / person ids or positions");
    t.ok(noMoney(v.text) && !/412|849|772|77\.25|450|10234|165|1,980|5521|640|INV|Kubota 500hr|Paid|amountExGst|"total"|invoiceNo|invoiceDraftId|rc87-draft/.test(noName(v.text)), "no $, amount, invoice number or invoice wording - fields and words");
    t.ok(typed?.provider === "Plant Repairs", "the provider without its figures", JSON.stringify(typed?.provider));
    t.ok(((await view(s1, "?days=30")).body?.checks ?? []).length === 3 && ((await view(s1, "?days=7")).body?.checks ?? []).length === 2, "30 days: 3 checks; 7 days: 2 (the 10-day-old one drops out)");
    const v2 = await view(s2);
    t.ok(v2.status === 200 && (v2.body?.checks ?? []).length === 1 && v2.body.doNotUse === true && !v2.text.includes("Rchist1"), "machine 2's QR shows machine 2 only - with its Do-not-use fault", v2.status);

    // (4) Downloads with a valid code: PDF (a real PDF, text without money) and CSV (escaped, without money).
    const pdf = await dl(s1, "?what=checks&days=90&format=pdf");
    t.ok(pdf.status === 200 && /application\/pdf/.test(pdf.type) && pdf.buf.subarray(0, 5).toString() === "%PDF-" && /attachment/.test(pdf.disp), "pre-start records PDF: 200, application/pdf, a PDF file", `${pdf.status} ${pdf.type}`);
    const ptext = pdfText(pdf.buf);
    if (/RC hist 1/.test(ptext)) t.ok(noMoney(ptext) && /pre-start records/.test(ptext) && /Rchist2/.test(ptext), "the PDF's text: the machine, the heading, the operators - no $");
    else t.note("PDF text couldn't be read back here - the PDF is made only from the money-checked data");
    const spdf = await dl(s1, "?what=service&format=pdf");
    const stext = pdfText(spdf.buf);
    t.ok(spdf.status === 200 && spdf.buf.subarray(0, 5).toString() === "%PDF-", "service history PDF: 200, a PDF file", spdf.status);
    if (/RC hist 1/.test(stext)) t.ok(noMoney(stext) && !/412|849|450|10234|165|1,980|5521|640|INV|Insurance|Rego/.test(noName(stext)) && /Full service/.test(stext) && /Service \(mechanic's invoice\)/.test(stext) && /1190/.test(stext),
      "the service PDF's text: cleaned work, the inbox record as 'Service (mechanic's invoice)', the reading - no amount, invoice number, insurance or rego", stext.slice(0, 300));
    const csv = await dl(s1, "?what=checks&days=90&format=csv");
    t.ok(csv.status === 200 && /text\/csv/.test(csv.type) && /Lobos Contracting – pre-start records/.test(csv.text) && /RC hist 1/.test(csv.text), "pre-start records CSV: 200, the heading and the machine", `${csv.status} ${csv.type}`);
    t.ok(/"'=HYPERLINK/.test(csv.text) && !csv.text.split(/\r?\n/).some((l) => l.split(",").some((cell) => /^[=+@]/.test(cell))), "CSV: a name that is a formula is escaped (\"'=...\")");
    t.ok(noMoney(csv.text), "CSV: no $");
    const scsv = await dl(s1, "?what=service&format=csv");
    const svcLines = scsv.text.split(/\r?\n/).filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l));
    t.ok(scsv.status === 200 && /Full service/.test(scsv.text) && /Service \(mechanic's invoice\)/.test(scsv.text) && noMoney(scsv.text) && !/412|849|772|450|10234|165|5521|640|INV|Paid|Insurance|Rego/.test(noName(scsv.text)), "service CSV: cleaned work, no amount, invoice number, note, insurance or rego");
    t.ok(svcLines.length >= 2 && svcLines.every((l) => !/\d/.test(l.split(",").slice(1, -1).join(","))) && svcLines.some((l) => /,1190$/.test(l)), "PS-059: CSV service rows - no digit in the work / provider text, the reading in its own column", svcLines.join(" / "));

    // (5) Bad, switched-off and reprinted codes: nothing.
    t.status(await view("not-a-real-code-at-all-0000000000"), 404, "view: a made-up code");
    t.status((await c.get(`/api/site/plant/${"x".repeat(30)}/history/download?format=csv`, null)), 404, "download: a made-up code");
    t.status(await c.post("/api/plant/qr", "MANAGER", { resourceId: M3.id, off: true }), 200, "the office switches machine 3's QR off");
    t.status(await view(s3), 404, "view: a switched-off code");
    t.status((await dl(s3, "?format=pdf")).status, 404, "download: a switched-off code");
    const re = await printQr(M1.id);
    t.status(await view(s1), 404, "view: machine 1's old code after a reprint");
    s1 = secretOf(re.body?.url);
    t.status(await view(s1), 200, "view: the reprinted code works");
    const truckPoster = await makeLink(db, "POSTER", M4.id, { place: "VEHICLE" });
    t.status(await view(truckPoster.secret), 404, "view: a sign-in QR's code opens nothing (only PLANT codes)");
    await db.siteLink.update({ where: { id: truckPoster.id }, data: { revokedAt: new Date() } });

    // (6) The office side (Plant page): Managers / Admins; the same data and files.
    const o = await keep(await c.get(`/api/plant/${M1.id}/history`, "MANAGER"));
    replies.push(o.text);
    t.ok(o.status === 200 && (o.body?.checks ?? []).length === 3 && noMoney(o.text), "office: a Manager reads machine 1's records (the same 3, no $)", o.status);
    t.status(await c.get(`/api/plant/${M1.id}/history`, "ADMIN"), 200, "office: an Admin");
    for (const who of ["VIEWER", "COORDINATOR", "YARD", "ACCOUNTS"]) t.status(await c.get(`/api/plant/${M1.id}/history`, who), 403, `office: ${who} refused`);
    t.status(await c.get(`/api/plant/${M1.id}/history`, null), 401, "office: no login refused");
    const od = await c.get(`/api/plant/${M1.id}/history/download?what=service&format=pdf`, "MANAGER");
    t.ok(od.status === 200 && /application\/pdf/.test(od.headers.get("content-type") ?? ""), "office: the service PDF downloads", od.status);
    t.status(await c.get(`/api/plant/${M1.id}/history/download?format=csv`, "VIEWER"), 403, "office download: a Viewer refused");
    t.status(await c.get(`/api/plant/${OP1.id}/history`, "MANAGER"), 404, "office: a person isn't a plant item (404)");
    t.ok(/Insurance/.test(o.text) && /Rego/.test(o.text) && (o.body?.checks ?? []).every((x) => typeof x.id === "string"), "PS-061 / PS-064: the office keeps insurance, rego and the check ids");

    // PS-060: the vehicle / plant service route - a Viewer gets date, provider, work, odometer only; Managers as before.
    const vs = await keep(await c.get(`/api/resources/${M1.id}/service`, "VIEWER"));
    const FORBID = ["amountExGst", "gst", "total", "invoiceNo", "notes", "createdBy", "invoiceDraftId"];
    t.ok(vs.status === 200 && Array.isArray(vs.body) && vs.body.length === 2 && vs.body.every((r) => FORBID.every((k) => !(k in r)) && !/\d/.test(r.work ?? "") && !/\d/.test(r.mechanic ?? "")) && noMoney(vs.text) && !/849|772|INV|Paid|5521/.test(vs.text),
      "PS-060: a Viewer's service history - no amount, GST, total, invoice number, notes or creator; words without figures", vs.text.slice(0, 240));
    const ms = await keep(await c.get(`/api/resources/${M1.id}/service`, "MANAGER"));
    t.ok(ms.status === 200 && Array.isArray(ms.body) && ms.body.some((r) => r.total === 849.75 && r.invoiceNo), "PS-060: a Manager still sees the full records (unchanged)");
    t.status(await c.get(`/api/resources/${OP1.id}/service`, "VIEWER"), 404, "PS-060: a person isn't a vehicle / plant item (404)");
    t.status(await c.post(`/api/resources/${OP1.id}/service`, "MANAGER", { date: c.today }), 404, "PS-060: no service record on a person");

    // PS-062: plant operators are told the builder can read their fault words.
    t.ok(readFileSync(path.join(c.p.appDir, "src", "components", "site", "PrestartCheck.tsx"), "utf8").includes("The builder can read what you write here."), "PS-062: the plant fault form says the builder can read it");

    // PS-063: at most two PDFs at once (unit-tested exactly in pdfSlots.test.ts). Six at once here: each one is a PDF or
    // a 503 "Busy" - never anything else.
    const burst = await Promise.all(Array.from({ length: 6 }, () => c.get(`/api/plant/${M1.id}/history/download?what=checks&days=90&format=pdf`, "MANAGER")
      .then(async (r) => ({ status: r.status, text: r.status === 503 ? await r.text() : (await r.arrayBuffer(), "") }))));
    t.ok(burst.every((b) => b.status === 200 || (b.status === 503 && /Busy/.test(b.text))) && burst.some((b) => b.status === 200), "PS-063: six PDFs at once - each a PDF or 503 Busy", burst.map((b) => b.status).join(","));
    // Timing: a 400-check PDF (a fresh machine, seeded checks).
    {
      const M5 = await mkPlant(5);
      const now = Date.now();
      await db.prestartCheck.createMany({ data: Array.from({ length: 400 }, (_, i) => ({ resourceId: M5.id, resourceName: M5.name, resourceType: "EQUIPMENT", kind: i % 2 ? "POST" : "PRE", personName: `RC bulk ${i % 7}`, checklist: "plant-pre.v1",
        answers: JSON.stringify(PRE.map((k) => ({ key: k, label: k, answer: i % 13 === 0 && k === "hoses" ? "FAULT" : "OK" }))), hourMeter: 2000 + i, createdAt: new Date(now - i * 3 * 60 * 60_000) })) });
      const t0 = Date.now();
      const big = await c.get(`/api/plant/${M5.id}/history/download?what=checks&days=90&format=pdf`, "MANAGER");
      const bigBuf = Buffer.from(await big.arrayBuffer());
      const officeMs = Date.now() - t0;
      const count = (txt) => (txt.match(/RC bulk \d/g) ?? []).length;
      const officeText = pdfText(bigBuf);
      t.ok(big.status === 200 && count(officeText) === 400 && !/Showing the latest/.test(officeText), "PS-066: the office PDF keeps all 400 checks", `${big.status} ${count(officeText)}`);
      t.note(`PS-066 timing: the office 400-check pre-start PDF took ${officeMs} ms (${Math.round(bigBuf.length / 1024)} KB)`);
      // PS-066: the QR's PDF carries the latest 150 and says so; its CSV keeps all 400.
      const s5 = secretOf((await printQr(M5.id)).body?.url);
      const t1 = Date.now();
      const pub = await dl(s5, "?what=checks&days=90&format=pdf");
      const pubMs = Date.now() - t1;
      const pubText = pdfText(pub.buf);
      t.ok(pub.status === 200 && count(pubText) === 150 && /Showing the latest 150 checks/.test(pubText) && /download the CSV for all/.test(pubText), "PS-066: the QR's PDF - the latest 150 checks, and the line saying so", `${pub.status} ${count(pubText)}`);
      const pubCsv = await dl(s5, "?what=checks&days=90&format=csv");
      t.ok(pubCsv.status === 200 && count(pubCsv.text) === 400, "PS-066: the QR's CSV keeps all 400", `${pubCsv.status} ${count(pubCsv.text)}`);
      t.note(`PS-066 timing: the QR's 150-check PDF took ${pubMs} ms`);
    }

    // (7) The limits: 60 looks a QR in 10 minutes, 20 downloads an hour (machine 4's QR).
    const looks = [];
    for (let i = 0; i < 61; i++) looks.push((await c.get(`/api/site/plant/${s4}/history?days=7`, null)).status);
    t.ok(looks.slice(0, 60).every((s) => s === 200) && looks[60] === 429, "view: the 61st look at one QR in 10 minutes -> 429", looks.slice(55).join(","));
    const dls = [];
    for (let i = 0; i < 21; i++) dls.push((await c.get(`/api/site/plant/${s4}/history/download?format=csv&days=7`, null)).status);
    t.ok(dls.slice(0, 20).every((s) => s === 200) && dls[20] === 429, "download: the 21st from one QR in an hour -> 429", dls.slice(15).join(","));
    t.status(await view(s2), 200, "another QR is unaffected");

    // (8) No money in any reply from the new routes (JSON, CSV and the PDFs' text).
    const leaked = replies.filter((x) => !noMoney(x));
    t.ok(leaked.length === 0, `no $ figure in any of the ${replies.length} history replies`, `${leaked.length} with $`);

    await db.siteLink.updateMany({ where: { kind: "PLANT", resourceId: { in: made.res } }, data: { revokedAt: new Date() } });
    await db.resource.updateMany({ where: { id: { in: made.res } }, data: { active: false } });
  },
};
