// Before and after site photos (30 Oct 2026): the 6-a-set limit, the job check, the missing-set flags and the one
// reminder's wording. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BEFORE_AFTER_LIMITS, addRefusal, parsePhase, photoFlags, reminderText } from "./beforeAfter";

test("up to 6 shown in a set; the 7th is refused; a removed one frees its place, up to 20 sent in all", () => {
  assert.equal(BEFORE_AFTER_LIMITS.perPhase, 6);
  for (let n = 0; n < 6; n++) assert.equal(addRefusal(n, n), null, `photo ${n + 1}`);
  assert.match(addRefusal(6, 6) ?? "", /6 photos already - remove one/);
  assert.equal(addRefusal(5, 9), null, "4 removed - 5 shown, room for one more");
  assert.match(addRefusal(3, 20) ?? "", /most photos for this job today/);
});

test("only BEFORE or AFTER", () => {
  assert.equal(parsePhase("BEFORE"), "BEFORE");
  assert.equal(parsePhase("AFTER"), "AFTER");
  for (const x of ["before", "DURING", "", null, 1]) assert.equal(parsePhase(x), null);
});

test("missing sets: no before once the job ran; no after only once the log is in or it's past due; never if it didn't run", () => {
  assert.deepEqual(photoFlags({ ran: true, before: 0, after: 0, hasLog: false, pastDue: false }), { noBefore: true, noAfter: false }, "7am: no 'No after photos' yet");
  assert.deepEqual(photoFlags({ ran: true, before: 2, after: 0, hasLog: true, pastDue: false }), { noBefore: false, noAfter: true });
  assert.deepEqual(photoFlags({ ran: true, before: 2, after: 0, hasLog: false, pastDue: true }), { noBefore: false, noAfter: true });
  assert.deepEqual(photoFlags({ ran: true, before: 1, after: 3, hasLog: true, pastDue: true }), { noBefore: false, noAfter: false });
  assert.deepEqual(photoFlags({ ran: false, before: 0, after: 0, hasLog: false, pastDue: true }), { noBefore: false, noAfter: false });
});

test("the one 19:00 reminder: the log first, photos mentioned; nothing when nothing is missing", () => {
  assert.equal(reminderText("Lido", { noLog: true, noBefore: false, noAfter: false }), "No daily log for Lido yet - 60 seconds: tap to log.", "unchanged when photos are in");
  assert.equal(reminderText("Lido", { noLog: true, noBefore: true, noAfter: true }), "No daily log for Lido yet (and no before and after photos) - 60 seconds: tap to log.");
  assert.equal(reminderText("Lido", { noLog: false, noBefore: false, noAfter: true }), "No after photos for Lido yet - tap to add them.");
  assert.equal(reminderText("Lido", { noLog: false, noBefore: true, noAfter: false }), "No before photos for Lido yet - tap to add them.");
  assert.equal(reminderText("Lido", { noLog: false, noBefore: false, noAfter: false }), null);
  // The other choice (REMIND_PHOTOS_WITH_LOG_IN = false): photos only ever in the "no daily log" reminder.
  assert.equal(reminderText("Lido", { noLog: false, noBefore: true, noAfter: true }, false), null);
  assert.equal(reminderText("Lido", { noLog: true, noBefore: true, noAfter: false }, false), "No daily log for Lido yet (and no before photos) - 60 seconds: tap to log.");
});

test("the job check comes first: a photo is only saved for a job the link can log today, and never once the day is closed", () => {
  const src = readFileSync(new URL("./beforeAfterLink.ts", import.meta.url), "utf8");
  const add = src.slice(src.indexOf("export async function addLinkPhoto"), src.indexOf("export async function hideLinkPhoto"));
  const at = (s: string) => add.indexOf(s);
  assert.ok(at("loggableJob(link, body.jobId, now)") > 0, "the job is looked up among the link's loggable jobs");
  assert.ok(at("status: 403") > at("loggableJob(") && at("status: 403") < at("savePhoto("), "403 before any file is written");
  assert.ok(at("dayClosed(") < at("savePhoto(") && at("addRefusal(") < at("savePhoto("), "closed day and the limit are checked before the file is written");
  assert.match(src, /loggableJobs\(link, now\)\)\.find\(\(j\) => j\.id === jobId\)/, "the same check as the voice route (loggableJobs)");
  const hide = src.slice(src.indexOf("export async function hideLinkPhoto"));
  assert.ok(!/\.delete\(/.test(src.replace(/busy\.delete\(key\)/g, "")), "nothing is ever deleted - a remove only hides");
  assert.match(hide, /hiddenAt: now, hiddenBy:/);
});
