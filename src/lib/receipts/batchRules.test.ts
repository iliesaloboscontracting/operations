import { test } from "node:test";
import assert from "node:assert/strict";
import { BATCH_LIMITS, batchLinkMarker, bulkNoAsbestos, capProblem, jobForDocket, samePhotoProblem, shownName } from "./batchRules";
import { checkReceiptPhoto, sniffImage } from "./files";
import { decideTip } from "./checks";
import type { TipReading } from "./reading";

const J = (id: string, day: string, shift = "DAY") => ({ id, day, shift });

test("job mapping: one job that day -> that job", () => {
  assert.deepEqual(jobForDocket([J("a", "2026-11-03"), J("b", "2026-11-04")], { day: "2026-11-04", time: "09:15" }), { jobId: "b", note: null });
});
test("job mapping: no job that day -> project only, no note", () => {
  assert.deepEqual(jobForDocket([J("a", "2026-11-03")], { day: "2026-11-05", time: "09:15" }), { jobId: null, note: null });
});
test("job mapping: two jobs that day -> project only, pick the job", () => {
  const p = jobForDocket([J("a", "2026-11-04"), J("b", "2026-11-04", "NIGHT")], { day: "2026-11-04", time: "14:00" });
  assert.equal(p.jobId, null);
  assert.match(p.note ?? "", /2 jobs .* pick the job/);
});
test("job mapping: before noon, last night's night shift counts", () => {
  assert.deepEqual(jobForDocket([J("n", "2026-11-03", "NIGHT")], { day: "2026-11-04", time: "02:30" }), { jobId: "n", note: null });
  // after noon it doesn't; a day shift the day before never does
  assert.deepEqual(jobForDocket([J("n", "2026-11-03", "NIGHT")], { day: "2026-11-04", time: "13:00" }), { jobId: null, note: null });
  assert.deepEqual(jobForDocket([J("d", "2026-11-03")], { day: "2026-11-04", time: "02:30" }), { jobId: null, note: null });
  // a date with no time: no night carry-over
  assert.deepEqual(jobForDocket([J("n", "2026-11-03", "NIGHT")], { day: "2026-11-04", time: null }), { jobId: null, note: null });
});
test("job mapping: no date read -> project only", () => {
  assert.deepEqual(jobForDocket([J("a", "2026-11-04")], { day: null, time: null }), { jobId: null, note: null });
});

test("caps: per batch and per login per day", () => {
  assert.equal(capProblem({ inBatch: 0, userToday: 0 }), null);
  assert.match(capProblem({ inBatch: BATCH_LIMITS.photosPerBatch, userToday: 0 }) ?? "", /at most 100/);
  assert.match(capProblem({ inBatch: 1, userToday: BATCH_LIMITS.photosPerUserPerDay }) ?? "", /in a day/);
  assert.equal(capProblem({ inBatch: BATCH_LIMITS.photosPerBatch - 1, userToday: BATCH_LIMITS.photosPerUserPerDay - 1 }), null);
});

test("same photo: refused unless the earlier one was set aside", () => {
  assert.equal(samePhotoProblem(null), null);
  assert.equal(samePhotoProblem({ receiptStatus: "REJECTED", sentBy: "x", at: new Date() }), null);
  assert.match(samePhotoProblem({ receiptStatus: "READ", sentBy: "Carlos", at: new Date("2026-11-04T01:00:00Z") }) ?? "", /already in \(sent by Carlos/);
  assert.match(samePhotoProblem({ receiptStatus: "SENT", sentBy: "Office", at: new Date() }) ?? "", /already in/);
});

test("the batch marker is never a link id, and file names are shown only tidied", () => {
  assert.match(batchLinkMarker("cabc"), /^office-batch:/);
  assert.equal(shownName("../../etc/passwd<script>"), "....etcpasswdscript");
});

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
test("file type is decided by the bytes, and the hash is stable", () => {
  const a = checkReceiptPhoto(JPEG), b = checkReceiptPhoto(JPEG);
  assert.ok(!("error" in a) && !("error" in b));
  if (!("error" in a) && !("error" in b)) { assert.equal(a.ext, "jpg"); assert.equal(a.sha256, b.sha256); assert.match(a.sha256, /^[0-9a-f]{64}$/); }
  // a PDF / text dressed up as a JPEG is refused
  assert.ok("error" in checkReceiptPhoto("data:image/jpeg;base64," + Buffer.from("%PDF-1.7 not a photo").toString("base64")));
  assert.ok("error" in checkReceiptPhoto("data:application/pdf;base64," + Buffer.from("%PDF-1.7").toString("base64")));
  // a RIFF file that isn't WebP (a WAV) is refused
  const wav = Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1");
  assert.equal(sniffImage(wav), null);
  assert.ok("error" in checkReceiptPhoto("data:image/webp;base64," + wav.toString("base64")));
  assert.equal(sniffImage(Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1")), "webp");
  // over the size given
  assert.ok("error" in checkReceiptPhoto(JPEG, 10));
});

const tip = (o: Partial<TipReading> = {}): TipReading => ({
  documentType: "tip_docket", docketNo: "A123", dateTime: "2026-11-04T09:15", tipSite: "Bingo Eastern Creek", wasteType: "Mixed C&D", tonnesNet: "6.2",
  rego: "", priceExGst: "", priceIncGst: "", unclear: [], note: "", ...o,
} as TipReading);
test("office batch reading: asbestos unanswered -> To check; old date isn't a problem, a future one is; duplicate flagged", () => {
  const uploaded = new Date("2026-11-20T03:00:00Z");
  const d = decideTip(tip(), { sentAt: uploaded, asbestosTap: null, ourRegos: [], duplicateOf: null, officeBatch: true });
  assert.equal(d.status, "CHECK");
  assert.ok(d.reasons.some((x) => /asbestos yes or no/.test(x)));
  assert.ok(!d.reasons.some((x) => /more than 2 days/.test(x)), "a 16-day-old docket in a batch isn't flagged for its age");
  const future = decideTip(tip({ dateTime: "2026-11-25T09:00" }), { sentAt: uploaded, asbestosTap: false, ourRegos: [], duplicateOf: null, officeBatch: true });
  assert.ok(future.reasons.some((x) => /after it was uploaded/.test(x)));
  const dup = decideTip(tip(), { sentAt: uploaded, asbestosTap: false, ourRegos: [], duplicateOf: "by Carlos on 4/11/2026", officeBatch: true });
  assert.equal(dup.status, "CHECK");
  assert.ok(dup.reasons.some((x) => /Docket number A123 was already sent/.test(x)));
  const job = decideTip(tip(), { sentAt: uploaded, asbestosTap: false, ourRegos: [], duplicateOf: null, officeBatch: true, jobNote: "2 jobs on this project that day - pick the job" });
  assert.ok(job.reasons.includes("2 jobs on this project that day - pick the job"));
  // a phone docket is unchanged: the 2-day rule still applies, no asbestos question
  const phone = decideTip(tip(), { sentAt: uploaded, asbestosTap: false, ourRegos: [], duplicateOf: null });
  assert.ok(phone.reasons.some((x) => /more than 2 days/.test(x)) && !phone.reasons.some((x) => /asbestos yes or no/.test(x)));
});

// DB-006 (Ilies approved 23 Nov 2026): "None of this batch is asbestos" answers only read dockets that don't say asbestos.
type BulkRow = { kind: string; status: string; asbestos: boolean | null; wasteType: string | null; reading?: string | null };
const bulk = (o: Partial<BulkRow>): BulkRow => ({ kind: "TIP", status: "CHECK", asbestos: null, wasteType: "Mixed C&D", ...o });
test("bulk not-asbestos: SET only for a read, unanswered docket that doesn't say asbestos", () => {
  assert.equal(bulkNoAsbestos(bulk({ status: "CHECK", wasteType: "Mixed C&D" })), "SET");
  assert.equal(bulkNoAsbestos(bulk({ status: "READ", wasteType: "Concrete" })), "SET");
});
test("bulk not-asbestos: a docket that says asbestos is left for a person (any case)", () => {
  for (const w of ["Asbestos - bonded", "ACM", "Friable", "bonded sheet", "ASBESTOS", "acm waste", "FRIABLE material", "Bonded Sheet"]) {
    assert.equal(bulkNoAsbestos(bulk({ status: "CHECK", wasteType: w })), "SKIP_ASBESTOS", w);
  }
});
test("bulk not-asbestos: not read yet (SENT) waits - with no reading and with its tries used up", () => {
  assert.equal(bulkNoAsbestos(bulk({ status: "SENT", reading: null })), "SKIP_UNREAD");
  assert.equal(bulkNoAsbestos(bulk({ status: "SENT", reading: JSON.stringify({ tries: 3, lastError: "Couldn't read it this time" }) })), "SKIP_UNREAD");
  assert.equal(bulkNoAsbestos(bulk({ status: "SENT", wasteType: null })), "SKIP_UNREAD");
});
test("bulk not-asbestos: set aside, already answered or not a tip docket -> SKIP", () => {
  assert.equal(bulkNoAsbestos(bulk({ status: "REJECTED" })), "SKIP");
  assert.equal(bulkNoAsbestos(bulk({ asbestos: true })), "SKIP");
  assert.equal(bulkNoAsbestos(bulk({ asbestos: false })), "SKIP");
  assert.equal(bulkNoAsbestos(bulk({ kind: "FUEL" })), "SKIP");
});