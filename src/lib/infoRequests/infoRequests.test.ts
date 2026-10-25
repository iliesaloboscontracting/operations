// Information requests (Task I, 25 Oct 2026): what a question needs, the
// lead's draft file format (batch-01.json loads), who "to" means, FYI vs
// QUESTION for the person asked, the file types an answer may carry, and that
// directors-only answer files stay with directors. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { parseDraftFile, parseInfoItem, resolveTo, canBeAsked, type Askable } from "./rules";
import { ANSWER_EXTS, INBOX_EXTS, contentMatches } from "../invoiceFiles";
import { assigneeView, canSeeAnswerFile } from "../findings/queries";

const OWNER = "iliesa@loboscontracting.com.au";
const today = "2026-10-25";

test("a question needs a title and the question; FYI or QUESTION only; the due date can't be past", () => {
  const ok = parseInfoItem({ type: "question", title: "Master tender register", question: "Which file is the master?", need: "Upload it as CSV", dueDate: "2026-11-01" }, today);
  assert.deepEqual(ok, { infoType: "QUESTION", title: "Master tender register", question: "Which file is the master?", need: "Upload it as CSV", why: null, dueDate: "2026-11-01" });
  assert.ok("error" in parseInfoItem({ title: "x", question: "Which file?" }, today));
  assert.ok("error" in parseInfoItem({ title: "Title", question: "?" }, today));
  assert.ok("error" in parseInfoItem({ type: "MAYBE", title: "Title", question: "A real question" }, today));
  assert.ok("error" in parseInfoItem({ title: "Title", question: "A real question", dueDate: "2026-10-01" }, today));
  assert.ok("error" in parseInfoItem({ title: "Title", question: "A real question", dueDate: "next week" }, today));
  assert.equal((parseInfoItem({ type: "FYI", title: "Heads up", question: "Xero goes live Monday" }, today) as { infoType: string }).infoType, "FYI");
});

test("the lead's draft file (docs/info-requests/batch-01.json) reads: every item has a 'to'", () => {
  const p = path.join(process.cwd(), "docs", "info-requests", "batch-01.json");
  const r = parseDraftFile(JSON.parse(fs.readFileSync(p, "utf8")), today);
  if ("error" in r) assert.fail(r.error);
  assert.ok(r.items.length > 0); // the lead trims the batch as answers come in
  assert.match(r.batch, /^01/);
  for (const it of r.items) assert.ok(!("error" in it), JSON.stringify(it));
  assert.ok("error" in parseDraftFile({ batch: "x", items: [] }, today));
  assert.ok("error" in parseDraftFile({ nope: true }, today));
  const mixed = parseDraftFile({ items: [{ to: "Nick", title: "OK title", question: "A real question" }, { title: "No to", question: "A real question" }] }, today);
  if ("error" in mixed) assert.fail(mixed.error);
  assert.deepEqual(mixed.items.map((i) => "error" in i), [false, true]);
});

const u = (x: Partial<Askable>): Askable => ({ id: "u", name: "Someone", email: "s@x", role: "MANAGER", directorAccess: false, active: true, ...x });
const people = [
  u({ id: "nick-admin", name: "Nick Giannopoulos", email: "nick@loboscontracting.com.au", role: "ADMIN" }),
  u({ id: "nick-dir", name: "Nick Giannopoulos", email: "nick.director@loboscontracting.com.au", role: "DIRECTOR" }),
  u({ id: "yoel", name: "Yoel Silvestre", email: "yoel@x", role: "DIRECTOR" }),
  u({ id: "acc", name: "Accounts", email: "accounts@loboscontracting.com.au", role: "ACCOUNTS" }),
  u({ id: "owner", name: "Iliesa", email: OWNER, role: "ADMIN", directorAccess: true }),
  u({ id: "mgr", name: "Alex", role: "MANAGER" }),
  u({ id: "gone", name: "Old Director", role: "DIRECTOR", active: false }),
];

test("'to' means: Nick's DIRECTOR login (not his ADMIN one), the accounts login, an exact email; never the owner, a Manager or a switched-off login", () => {
  assert.equal(resolveTo("Nick Giannopoulos", people, OWNER)?.id, "nick-dir");
  assert.equal(resolveTo("  nick giannopoulos ", people, OWNER)?.id, "nick-dir");
  assert.equal(resolveTo("Accounts", people, OWNER)?.id, "acc");
  assert.equal(resolveTo("yoel@x", people, OWNER)?.id, "yoel");
  assert.equal(resolveTo("Iliesa", people, OWNER), null);
  assert.equal(resolveTo("Alex", people, OWNER), null);
  assert.equal(resolveTo("Old Director", people, OWNER), null);
  assert.equal(resolveTo("Nobody", people, OWNER), null);
  const twins = [u({ id: "a", name: "Sam", role: "DIRECTOR" }), u({ id: "b", name: "Sam", role: "DIRECTOR" })];
  assert.equal(resolveTo("Sam", twins, OWNER), null, "two equally good logins: a person chooses");
  assert.equal(canBeAsked(people[1], OWNER), true);
  assert.equal(canBeAsked(people[5], OWNER), false);
});

test("answer files: the office types are accepted for answers, checked by content; the inbox keeps its own list", () => {
  assert.deepEqual([...ANSWER_EXTS].sort(), ["csv", "docx", "jpg", "pdf", "png", "xls", "xlsx"]);
  for (const e of ["exe", "html", "js", "svg", "zip"]) assert.ok(!ANSWER_EXTS.includes(e), e);
  assert.ok(!INBOX_EXTS.includes("docx") && !INBOX_EXTS.includes("xls"), "the invoices inbox never takes Word or old Excel");
  assert.ok(contentMatches("pdf", Buffer.from("%PDF-1.7 ...")));
  assert.ok(!contentMatches("pdf", Buffer.from("MZ\x90\x00 an exe")));
  assert.ok(contentMatches("xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])));
  assert.ok(contentMatches("docx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])));
  assert.ok(contentMatches("xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1])));
  assert.ok(contentMatches("png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])));
  assert.ok(contentMatches("jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(contentMatches("csv", Buffer.from("Tender,Due\n26_168,2026-10-01\n")));
  assert.ok(!contentMatches("csv", Buffer.from("<html><script>alert(1)</script></html>")));
  assert.ok(!contentMatches("csv", Buffer.from([0x4d, 0x5a, 0x00, 0x00])));
  assert.ok(!contentMatches("exe", Buffer.from("MZ")));
});

const req = (x: Record<string, unknown>) => ({
  id: "q1", number: 7, kind: "QUERY", siteLabel: "Information request", summary: "Master tender register", requestedBy: "Iliesa",
  createdAt: new Date("2026-10-25T00:00:00Z"), neededBy: new Date("2026-11-01T07:00:00Z"), status: "TODO", question: null, answer: null,
  answerFile: null, outcome: null, findingId: null, origin: "DIRECTOR", events: [], details: JSON.stringify({ question: "Which file is the master?", need: "CSV", infoType: "QUESTION" }), ...x,
}) as unknown as Parameters<typeof assigneeView>[0];

test("the person asked: a QUESTION is answered, an FYI is only marked read; titles, 'what we need' and reminders show", () => {
  const q = assigneeView(req({}), false);
  assert.deepEqual([q.title, q.need, q.canAnswer, q.canMarkRead, q.infoType], ["Master tender register", "CSV", true, false, "QUESTION"]);
  const fyi = assigneeView(req({ details: JSON.stringify({ question: "Xero goes live Monday", infoType: "FYI" }) }), false);
  assert.deepEqual([fyi.canAnswer, fyi.canMarkRead, fyi.infoType], [false, true, "FYI"]);
  const nudged = assigneeView(req({ events: [{ action: "REMINDED", at: new Date("2026-10-27T01:00:00Z") }] }), false);
  assert.equal(nudged.remindedAt, "2026-10-27T01:00:00.000Z");
  const done = assigneeView(req({ status: "DONE", details: JSON.stringify({ question: "x", infoType: "FYI" }) }), false);
  assert.deepEqual([done.canAnswer, done.canMarkRead], [false, false]);
  const fromFinding = assigneeView(req({ findingId: "f1", origin: "FINDING" }), false);
  assert.equal(fromFinding.title, null);
});

test("a directors-only answer file opens for the person asked, Ilies and directors - not an Admin without director access", () => {
  const a = { id: "x", email: "a@x", name: "A", role: "ADMIN", directorAccess: false };
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR" }, a), false);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "COMMERCIAL" }, a), true);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR" }, { ...a, id: "acc", role: "ACCOUNTS" }), true);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR" }, { ...a, role: "DIRECTOR" }), true);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR" }, { ...a, email: OWNER }), true);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR" }, { ...a, role: "MANAGER" }), false);
});

test("the invoices inbox still refuses Word and old Excel files (answers only take them)", async () => {
  const { saveInvoiceFile } = await import("../invoiceFiles");
  const xls = await saveInvoiceFile(`data:application/vnd.ms-excel;base64,${Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString("base64")}`, "register.xls");
  const docx = await saveInvoiceFile(`data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64")}`, "letter.docx");
  const exe = await saveInvoiceFile(`data:application/octet-stream;base64,${Buffer.from("MZ").toString("base64")}`, "x.exe", { allow: ANSWER_EXTS, checkContent: true });
  assert.ok("error" in xls && /PDF, a photo/.test(xls.error), JSON.stringify(xls));
  assert.ok("error" in docx && /PDF, a photo/.test(docx.error), JSON.stringify(docx));
  assert.ok("error" in exe && /can't be sent/.test(exe.error), JSON.stringify(exe));
});

test("a draft that can't be sent says why, plainly", async () => {
  const { whyUnresolved } = await import("./rules");
  const noAccounts = people.filter((p) => p.role !== "ACCOUNTS");
  assert.equal(whyUnresolved("Accounts", noAccounts, OWNER), "No Accounts login yet: create it on Users.");
  assert.match(whyUnresolved("Alex", people, OWNER), /has no director login/);
  assert.match(whyUnresolved("Iliesa", people, OWNER), /owner/);
  assert.match(whyUnresolved("Nobody Here", people, OWNER), /No login called/);
  const twins = [u({ id: "a", name: "Sam", role: "DIRECTOR" }), u({ id: "b", name: "Sam", role: "DIRECTOR" })];
  assert.match(whyUnresolved("Sam", twins, OWNER), /More than one/);
});
