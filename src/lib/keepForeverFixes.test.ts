// Keep forever security fixes PS-029..033 (Ilies approved, 10 Nov 2026). `npm test`; the races themselves run in
// release check 76-keep-forever on a real server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const today = new Date().toISOString().slice(0, 10);
const raw = {
  supplier: "Allcott Hire", entityBilled: "Lobos Contracting", invoiceNo: "INV-77", invoiceDate: today, periodFrom: null, periodTo: null,
  description: "Materials", siteText: null, hireRef: null, amountExGst: 500, gst: 50, totalIncGst: 550, category: "MATERIALS", projectId: "p1",
  confidence: "HIGH" as const, matchReason: null,
};

test("PS-029: an upload line matching an invoice removed from Tracking waits for a person, with who / when / why", async () => {
  const { decide, removedNote } = await import("./invoiceInbox");
  assert.equal((await decide(raw, new Set(), new Set(), new Set(["p1"]))).status, "ADDED", "a clear match on its own goes straight on");
  const note = removedNote({ removedAt: new Date("2026-11-09T01:00:00Z"), removedBy: "Ilies", removeReason: "Entered by mistake" });
  assert.match(note, /^Removed from Tracking on 9 Nov 2026 by Ilies: Entered by mistake$/);
  // The key is the inbox's own duplicate key: first word of the supplier | the invoice number without "INV".
  const v = await decide(raw, new Set(), new Set(), new Set(["p1"]), [], new Map([["allcott|77", note]]));
  assert.deepEqual(v, { status: "NEEDS_REVIEW", problem: note }, "a re-upload of a removed invoice is NOT added back");
  // A live duplicate still wins (already entered).
  assert.equal((await decide(raw, new Set(), new Set(["allcott|77"]), new Set(["p1"]), [], new Map([["allcott|77", note]]))).status, "DUPLICATE");
  const s = src("src/lib/invoiceInbox.ts");
  assert.match(s, /if \(invoiceKey\(r\.invoiceNo\) && removed\.has\(key\)\) return \{ status: "NEEDS_REVIEW", problem: removed\.get\(key\)! \};/);
  assert.ok(s.indexOf("removed.has(key)") < s.indexOf('return { status: "ADDED", problem: null }'), "checked before anything can be ADDED");
  assert.match(s, /removedAt: \{ not: null \}/, "the removed lines are read for the check");
});

test("PS-029: the manual Add needs addAgain for a removed match, and records it", () => {
  const s = src("src/lib/invoicedCosts.ts");
  assert.match(s, /removedAt: \{ not: null \}/);
  assert.match(s, /if \(body\.addAgain !== true\) \{[\s\S]*?removedMatch: true, removed,/);
  assert.match(s, /field: "addedAgainAfterRemoval"/);
  assert.match(src("src/app/api/invoiced-costs/route.ts"), /if \(out\.againOf\) await recordAddedAgain\(/);
  assert.match(src("src/app/api/invoiced-costs/route.ts"), /guard\("MANAGER"\)/, "who can add is unchanged");
  assert.match(src("src/components/InvoiceModal.tsx"), /Add again – the removal was wrong/);
});

test("PS-030: a close works the costs out before its transaction, then takes the write lock and re-checks the day", () => {
  const r = src("src/app/api/day-close/route.ts");
  const plan = r.indexOf("await planDayCosts(date)"), tx = r.indexOf("prisma.$transaction", plan);
  assert.ok(plan > 0 && tx > plan, "planned before the transaction");
  const body = r.slice(tx, r.indexOf("if (close) return", tx));
  assert.ok(body.indexOf("writeLock(tx)") < body.indexOf("dayFingerprint(tx, date)") && body.indexOf("dayFingerprint(tx, date)") < body.indexOf("writeDayCosts("), "lock, re-check, then write");
  assert.doesNotMatch(body, /costAllocation|planDayCosts/, "no cost maths inside the transaction");
  assert.match(r, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/, "worked out again once");
  assert.match(r, /The day changed while closing - try again\." \}, \{ status: 409 \}/);
  const d = src("src/lib/dayClose.ts");
  assert.ok(d.indexOf("await supersedeDayCosts(tx, date, by)") < d.indexOf("allocationCost.createMany"), "earlier rows superseded before the new set - one current ledger");
});

test("PS-031: a cancel recounts sign-ins and logs inside its transaction; every sign-in is made only on a live job", () => {
  const c = src("src/lib/jobCancel.ts");
  const tx = c.slice(c.indexOf("prisma.$transaction"));
  assert.ok(tx.indexOf("tx.job.updateMany(") < tx.indexOf("tx.siteAttendance.count("), "the job is marked first (write lock), then counted");
  assert.match(tx, /tx\.dailyLog\.count\(/);
  assert.match(tx, /status: 409/);
  const make = src("src/lib/signInCreate.ts");
  assert.ok(make.indexOf("tx.siteAttendance.create(") < make.indexOf("tx.job.count("), "the sign-in writes first, then checks the job");
  for (const f of ["src/app/api/attendance/route.ts", "src/app/api/site/in/sign/route.ts", "src/app/api/site/[token]/signin/route.ts"]) {
    assert.match(src(f), /createSignIn\(/, f);
    assert.doesNotMatch(src(f), /siteAttendance\.create\(/, `${f} makes sign-ins only through createSignIn`);
  }
});

test("PS-033: an ABN check's hidden inbox line is shown as removed", () => {
  assert.match(src("src/lib/abnInvoices/store.ts"), /\(removed from the inbox\)/);
});

test("PS-034: a sign-in waits its turn (TX) and falls back to the plain create when the database stays busy", async () => {
  const s = src("src/lib/signInCreate.ts");
  assert.match(s, /\}, TX\);/, "the transaction gets the 15 s waits");
  assert.match(s, /if \(!isBusyError\(e\)\) throw e;[\s\S]*?return prisma\.siteAttendance\.create\(\{ data \}\);/, "busy -> plain create, so the sign-in always wins");
  const { isBusyError } = await import("./signInCreate");
  assert.ok(isBusyError(new Error("Transaction API error: Unable to start a transaction in the given time.")));
  assert.ok(isBusyError(new Error("SQLITE_BUSY: database is locked")));
  assert.ok(!isBusyError(new Error("Unique constraint failed on the fields")));
});

test("PS-035: the other open sign-in is ended only after this one is saved (all three paths)", () => {
  for (const f of ["src/app/api/attendance/route.ts", "src/app/api/site/in/sign/route.ts", "src/app/api/site/[token]/signin/route.ts"]) {
    const t = src(f);
    const made = t.indexOf("createSignIn({"), ended = t.indexOf("endOpenElsewhere({");
    assert.ok(made > 0 && ended > made, `${f}: endOpenElsewhere after createSignIn`);
    assert.ok(t.indexOf(JOB_LINE, made) < ended, `${f}: after the cancelled-job refusal`);
  }
});
const JOB_LINE = "JOB_CANCELLED_SIGN_IN";

test("PS-036: 'Add again' is Admin only; the history row is written in the same transaction", () => {
  const s = src("src/lib/invoicedCosts.ts");
  assert.match(s, /if \(body\.addAgain === true && actor\.role !== "ADMIN"\) return \{ error: "Only an Admin can put a removed invoice back\.", status: 403/);
  for (const f of ["src/app/api/invoiced-costs/route.ts", "src/app/api/invoiced-costs/[id]/route.ts"]) {
    const t = src(f);
    assert.match(t, /readInvoice\([^)]*\{ role: user\?\.role \?\? null \}\)/, f);
    assert.match(t, /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?recordAddedAgain\(tx,/, f);
  }
  assert.match(src("src/components/InvoiceModal.tsx"), /removedMatch && !isAdmin/);
});

test("PS-037: the inbox's Read again takes the write lock first", () => {
  assert.match(src("src/app/api/invoice-inbox/uploads/[id]/route.ts"), /prisma\.\$transaction\(async \(tx\) => \{\s*await writeLock\(tx\);/);
});
