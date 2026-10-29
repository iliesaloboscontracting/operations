// Day Review's site-log extras (30 Oct 2026): the all-logs summary's states and supervisors, and "What was said" -
// the raw transcripts, money-free, Managers and up only. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertNoMoney } from "../moneyGuard";
import { summaryState, supervisorsFor, voiceTranscript } from "./dayReview";

test("summary: logged wins; no supervisor on the log; didn't run; due until 19:00, then 'No site log'", () => {
  assert.equal(summaryState({ pilot: true, ran: true, hasLog: true, missing: false }), "LOGGED");
  assert.equal(summaryState({ pilot: false, ran: true, hasLog: true, missing: false }), "LOGGED", "a stand-in's log still counts");
  assert.equal(summaryState({ pilot: false, ran: true, hasLog: false, missing: false }), "NO_SUPERVISOR");
  assert.equal(summaryState({ pilot: true, ran: false, hasLog: false, missing: false }), "NOT_RUN");
  assert.equal(summaryState({ pilot: true, ran: true, hasLog: false, missing: false }), "DUE");
  assert.equal(summaryState({ pilot: true, ran: true, hasLog: false, missing: true }), "NO_LOG");
});

test("summary: the supervisors on the job (once each, board order); none -> whoever sent the log", () => {
  const sup = new Set(["r1", "r3"]);
  assert.deepEqual(supervisorsFor([{ resourceId: "r3", name: "Sam" }, { resourceId: "r2", name: "Joao" }, { resourceId: "r1", name: "Lee" }, { resourceId: "r1", name: "Lee" }], sup, "Sam"), ["Sam", "Lee"]);
  assert.deepEqual(supervisorsFor([{ resourceId: "r2", name: "Joao" }], sup, "Stand-in Tom"), ["Stand-in Tom"]);
  assert.deepEqual(supervisorsFor([{ resourceId: "r2", name: "Joao" }], sup, null), []);
});

test("what was said: the transcript and its tidied text, with any amount taken out again; nothing shown without words", () => {
  const at = new Date("2026-10-30T06:52:00Z");
  const cleaned = JSON.stringify({ sections: [{ heading: "Work done", text: "Strip-out level 2. Skip was $650." }, { heading: "Plant", text: "Kobelco 6 h" }], delays: [], checkThis: [], amountsRemoved: true });
  const v = voiceTranscript({ id: "v1", createdAt: at, seconds: 125, transcript: "uh strip out level two, skip was $650 and the hire guy wants 40 bucks", cleaned });
  assert.ok(v);
  assert.equal(v.at, at.toISOString());
  assert.equal(v.seconds, 125);
  assert.ok(!/\$\s?\d/.test(v.transcript) && v.transcript.includes("(amount not recorded)"), v.transcript);
  assert.equal(v.tidied, "Work done: Strip-out level 2. Skip was (amount not recorded).\nPlant: Kobelco 6 h");
  assert.ok(assertNoMoney(JSON.stringify(v)));
  assert.equal(voiceTranscript({ id: "v2", createdAt: at, seconds: 3, transcript: "  ", cleaned: null }), null);
  assert.equal(voiceTranscript({ id: "v3", createdAt: at, seconds: 3, transcript: null, cleaned }), null);
  assert.equal(voiceTranscript({ id: "v4", createdAt: at, seconds: null, transcript: "all good", cleaned: "not json" })?.tidied, null, "bad tidied JSON -> not tidied, the words still shown");
  assert.equal(voiceTranscript({ id: "v5", createdAt: at, seconds: null, transcript: "all good", cleaned: JSON.stringify({ sections: [{ heading: 1, text: "x" }] }) })?.tidied, null);
});

test("the raw transcripts are a Manager / Admin field only: the route decides, the store adds them only for the office", () => {
  const route = readFileSync(new URL("../../app/api/day-review/site-logs/route.ts", import.meta.url), "utf8");
  assert.match(route, /guard\("VIEWER"\)/, "Day Review stays Viewer+");
  assert.match(route, /const office = !!user && \(user\.role === "MANAGER" \|\| user\.role === "ADMIN"\);/);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /\.\.\.\(office \? \{ transcripts:/, "transcripts are only put on the DTO for the office");
  const types = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
  assert.ok(!/transcripts\?:[^\n]*(rate|cost|price|\$)/i.test(types));
});
