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

// SEC-003 (27 Oct 2026): a synthetic fixture in the draft-file format - the real batches stay out of git.
test("a draft file in the lead's format reads: every item has a 'to'", () => {
  const p = path.join(process.cwd(), "src", "lib", "infoRequests", "fixtures", "batch-sample.json");
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

// ---------- Operations AI (27 Oct 2026, docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 2) ----------
test("Operations AI is the Building Agent login by email, never by role", async () => {
  const { isOperationsAi } = await import("./rules");
  assert.equal(isOperationsAi("iliesa+agent@loboscontracting.com.au", "MANAGER"), true);
  assert.equal(isOperationsAi(" ILIESA+AGENT@loboscontracting.com.au ", "MANAGER"), true);
  assert.equal(isOperationsAi("alex@loboscontracting.com.au", "MANAGER"), false); // an ordinary Manager
  assert.equal(isOperationsAi(null, "MANAGER"), false);
});

test("the AI asks accounts, directors, Admins, Managers and the owner - never itself, a Viewer or a switched-off login", async () => {
  const { aiTargetError, aiCanAsk } = await import("./rules");
  const u = (o: Partial<Askable>): Askable => ({ id: "x", name: "X", email: "x@l.com", role: "MANAGER", directorAccess: false, active: true, ...o });
  for (const role of ["ACCOUNTS", "DIRECTOR", "ADMIN", "MANAGER"]) assert.equal(aiTargetError(u({ role }), "ai", OWNER), null, role);
  assert.match(aiTargetError(u({ role: "VIEWER" }), "ai", OWNER)!, /accounts, the directors and the office/);
  assert.match(aiTargetError(u({ role: "TIMESHEETS" }), "ai", OWNER)!, /accounts/);
  assert.match(aiTargetError(u({ id: "ai" }), "ai", OWNER)!, /yourself/);
  assert.equal(aiTargetError(u({ role: "ADMIN", email: OWNER }), "ai", OWNER), null, "the owner too (Ilies 27 Oct, D-Q2)");
  assert.equal(aiCanAsk(u({ role: "ADMIN", email: OWNER }), "ai", OWNER), true);
  assert.match(aiTargetError(u({ active: false }), "ai", OWNER)!, /switched off/);
  assert.equal(aiTargetError(null, "ai", OWNER), "Pick who to ask.");
  assert.equal(aiCanAsk(u({ role: "ACCOUNTS" }), "ai", OWNER), true);
  assert.equal(aiCanAsk(u({ role: "VIEWER" }), "ai", OWNER), false);
});

test("amounts are fine in a question to anyone the AI asks, Managers included (Ilies 27 Oct)", async () => {
  const { aiTargetError } = await import("./rules");
  const u = (role: string): Askable => ({ id: "m", name: "M", email: "m@l.com", role, directorAccess: false, active: true });
  for (const role of ["MANAGER", "ACCOUNTS", "DIRECTOR", "ADMIN"]) assert.equal(aiTargetError(u(role), "ai", OWNER), null, role);
});

test("the AI's limit is 20 questions in a rolling 24 hours", async () => {
  const { overAiLimit, AI_DAILY_LIMIT } = await import("./rules");
  assert.equal(AI_DAILY_LIMIT, 20);
  assert.equal(overAiLimit(19), false);
  assert.equal(overAiLimit(20), true);
});

test("the AI opens the answer file only on a question it sent", async () => {
  const ai = { id: "ai", name: "Building Agent", email: "iliesa+agent@loboscontracting.com.au", role: "MANAGER", directorAccess: false };
  const mine = JSON.stringify({ question: "q", askedByAi: "1", askedByUserId: "ai" });
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR", details: mine }, ai), true);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR", details: JSON.stringify({ question: "q" }) }, ai), false);
  const manager = { ...ai, id: "m", email: "alex@loboscontracting.com.au" };
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR", details: mine }, manager), false);
});

test("CH-022: an Operations AI question never asks for or carries a TFN or bank details", async () => {
  const { aiQuestionError } = await import("./rules");
  const base = { title: "Supplier details", question: "Which supplier billed the Kanga?", need: null, why: null };
  assert.equal(aiQuestionError(base), null);
  assert.match(aiQuestionError({ ...base, question: "Please send the supplier's new bank details" })!, /bank details/);
  assert.match(aiQuestionError({ ...base, need: "their BSB and account number" })!, /bank details/);
  assert.match(aiQuestionError({ ...base, why: "TFN 123 456 789 on file" })!, /tax file/);
});

test("CH-023: nobody may be called 'Operations AI' (any case or spacing)", async () => {
  const { isReservedUserName } = await import("./rules");
  for (const n of ["Operations AI", "operations ai", "  OPERATIONS   AI ", "Operations\tAI"]) assert.equal(isReservedUserName(n), true, n);
  for (const n of ["Operations", "AI", "Operations AIs", "Ops AI", "", null, 42]) assert.equal(isReservedUserName(n), false, String(n));
});

test("CH-023: an AI question is recognised by the stored marker and the AI's user id, never by the name", async () => {
  const { askedByAiUser, AI_DETAILS_MARKER } = await import("./rules");
  const stored = JSON.stringify({ question: "When does it go back?", askedByAi: "1", askedByUserId: "ai-1" });
  assert.ok(stored.includes(AI_DETAILS_MARKER), "the marker is what JSON.stringify writes");
  assert.equal(askedByAiUser(stored, "ai-1"), true);
  assert.equal(askedByAiUser(stored, "someone-else"), false);
  // a person typing the marker into a question doesn't make it an AI question
  const typed = JSON.stringify({ question: 'fake "askedByAi":"1" here', askedByUserId: "ai-1" });
  assert.ok(!typed.includes(AI_DETAILS_MARKER), "JSON escapes the quotes inside a value");
  assert.equal(askedByAiUser(typed, "ai-1"), false);
  assert.equal(askedByAiUser(JSON.stringify({ question: "x" }), "ai-1"), false, "no marker: not the AI's");
  // the answer file follows the same rule
  const ai = { id: "ai-1", name: "Building Agent", email: "iliesa+agent@loboscontracting.com.au", role: "MANAGER", directorAccess: false };
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR", details: stored }, ai), true);
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR", details: JSON.stringify({ question: "x" }) }, ai), false, "a question someone named 'Operations AI' asked isn't the AI's");
});

test("CH-021: the AI is the Building Agent's email AND a Manager login - an Admin or Viewer with that email is not", async () => {
  const { isOperationsAi } = await import("./rules");
  const AI = "iliesa+agent@loboscontracting.com.au";
  assert.equal(isOperationsAi(AI, "MANAGER"), true);
  for (const role of ["ADMIN", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "", null, undefined]) assert.equal(isOperationsAi(AI, role as string), false, String(role));
  // and so no AI powers follow: no answer files, no AI name in chat
  const asAdmin = { id: "ai", name: "Building Agent", email: AI, role: "ADMIN", directorAccess: false };
  const asViewer = { ...asAdmin, role: "VIEWER" };
  const mine = JSON.stringify({ question: "q", askedByAi: "1", askedByUserId: "ai" });
  assert.equal(canSeeAnswerFile({ assigneeUserId: "acc", audience: "DIRECTOR", details: mine }, asViewer), false, "a Viewer with the email gets no AI answer files");
  const { chatName } = await import("../messages/rules");
  assert.equal(chatName("Building Agent", AI, "MANAGER"), "Operations AI");
  assert.equal(chatName("Building Agent", AI, "ADMIN"), "Building Agent", "an Admin with the email isn't shown as the AI");
});
