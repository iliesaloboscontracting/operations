// The variation docket's 48-hour window (Ilies, 27 Nov 2026: "allow for the submitting of the variation 48hr window..
// this allows for the tipping to be documented if they cant tip the same day"). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
const log = readFileSync(path.join(__dirname, "..", "dailyLog", "store.ts"), "utf8");

test("variation dockets list the person's jobs today and the two days before", () => {
  assert.match(store, /export const VARIATION_DAYS_BACK = 2;/);
  assert.match(store, /loggableJobs\(link, now, \{ daysBack: VARIATION_DAYS_BACK \}\)/);
  // Every docket path (options, send, photos) goes through variationJobs - no second job rule.
  assert.doesNotMatch(store.replace(/export async function variationJobs[\s\S]*?\n\}/, ""), /loggableJobs\(/);
});

test("the daily log keeps its own window (today, plus yesterday until midday)", () => {
  assert.match(log, /: sydneyHour\(now\) < 12 \? \[addDays\(today, -1\), today\] : \[today\];/);
  assert.match(log, /Math\.min\(7, Math\.floor\(opts\.daysBack \?\? 0\)\)/, "a wider window is capped at 7 days");
});
