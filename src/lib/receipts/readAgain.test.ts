// CT-001 (Ilies approved 25 Nov 2026): "Read again" caps for every role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAILY_CAP_MESSAGE, READ_AGAIN_LIMITS, RECEIPT_CAP_MESSAGE, dailyReadAgainUsed, nextManualReads, receiptCapProblem, sydneyDayOf, takeDailyReadAgain } from "./readAgain";

test("per receipt: three manual re-reads, then 'used up'", () => {
  assert.equal(READ_AGAIN_LIMITS.perReceipt, 3);
  for (const n of [undefined, 0, 1, 2]) assert.equal(receiptCapProblem({ manualReads: n }), null, String(n));
  for (const n of [3, 4, 99]) assert.equal(receiptCapProblem({ manualReads: n }), RECEIPT_CAP_MESSAGE, String(n));
  assert.equal(RECEIPT_CAP_MESSAGE, "Read again used up for this docket - correct it by hand.");
  // A broken log value never lifts the cap above 3 or blocks a first read.
  assert.equal(receiptCapProblem({ manualReads: "9" }), null);
  assert.equal(receiptCapProblem({ manualReads: Number.NaN }), null);
  assert.equal(nextManualReads({}), 1);
  assert.equal(nextManualReads({ manualReads: 2 }), 3);
});

test("per login: 40 a Sydney day, counted only when it goes ahead; a new Sydney day starts again; logins apart", () => {
  assert.equal(READ_AGAIN_LIMITS.perLoginPerDay, 40);
  assert.equal(DAILY_CAP_MESSAGE, "Read again limit reached for today.");
  const day1 = new Date("2026-11-25T02:00:00Z"); // 1pm Sydney, 25 Nov
  const late = new Date("2026-11-25T12:59:00Z"); // 11:59pm Sydney, 25 Nov
  const day2 = new Date("2026-11-25T13:01:00Z"); // 12:01am Sydney, 26 Nov
  assert.equal(sydneyDayOf(day1), "2026-11-25");
  assert.equal(sydneyDayOf(late), "2026-11-25");
  assert.equal(sydneyDayOf(day2), "2026-11-26");
  const who = `test-login-${Date.now()}`;
  for (let i = 0; i < 40; i++) assert.equal(takeDailyReadAgain(who, i < 39 ? day1 : late), true, `press ${i + 1}`);
  assert.equal(takeDailyReadAgain(who, late), false, "the 41st that day is refused");
  assert.equal(dailyReadAgainUsed(who, late), 40, "a refused press isn't counted");
  assert.equal(takeDailyReadAgain(`${who}-other`, late), true, "another login has its own 40");
  assert.equal(takeDailyReadAgain(who, day2), true, "the next Sydney day starts again");
  assert.equal(dailyReadAgainUsed(who, day2), 1);
});

test("the counter lives on globalThis (shared by every route bundle), and the READ_AGAIN path uses both caps", () => {
  const g = globalThis as unknown as { __receiptReadAgain?: unknown };
  assert.ok(g.__receiptReadAgain instanceof Map);
  assert.match(readFileSync(new URL("./readAgain.ts", import.meta.url), "utf8"), /__receiptReadAgain \?\?= new Map/);
  const office = readFileSync(new URL("./office.ts", import.meta.url), "utf8");
  const path = office.slice(office.indexOf('if (op === "READ_AGAIN")'), office.indexOf('return { error: "Correct, confirm, reject or read again."'));
  assert.match(path, /receiptCapProblem\(log\)[\s\S]*status: 429[\s\S]*takeDailyReadAgain\(who\.id[\s\S]*DAILY_CAP_MESSAGE, status: 429[\s\S]*manualReads: nextManualReads\(log\)/);
  // The automatic reading's tries are untouched: runner.ts never names manualReads except in the log type, and keeps it (...prior).
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  assert.equal((runner.match(/manualReads/g) ?? []).length, 1);
  assert.match(readFileSync(new URL("../../app/api/receipts/[id]/route.ts", import.meta.url), "utf8"), /receiptAction\(\{ name: g\.user\.name, id: g\.user\.id \}/);
});
