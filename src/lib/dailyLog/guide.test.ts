// The supervisor guide (30 Oct 2026): Ilies's wording as written, no money in it, and only on links with the daily log.
// `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { linkSafe } from "./rules";
import { GUIDE_NOTES, GUIDE_STEPS, GUIDE_TITLE, GUIDE_VERSION } from "./guide";

test("the approved wording, word for word", () => {
  assert.equal(GUIDE_TITLE, "New: daily log with photos and voice");
  assert.deepEqual(GUIDE_STEPS.map((s) => (s.text ? `${s.lead} ${s.text}` : s.lead)), [
    "Start of the day - Before photos. Take up to 6 photos of the site before work starts. Each one saves straight away.",
    "End of the day - Talk through your day. Tap the mic and talk for up to 5 minutes: who was on, what you did, machines and how long, hold-ups, tip runs, safety, and the plan for tomorrow. Tap Stop when you're done.",
    "Check it. Read the tidy version, including anything under \"Check this\".",
    "Tap \"Fill my log from this\", then check each step.",
    "After photos. Take up to 6 photos of the site at the end of the day.",
    "Send.",
  ]);
  assert.deepEqual(GUIDE_NOTES, [
    "You can still type everything instead of talking.",
    "Record again to add more. It adds on, it doesn't replace.",
    "Anything you typed is never written over.",
    "Don't say prices or dollar amounts.",
    "Keep the phone close to you and away from loud machines.",
    "If a job has no log or no before/after photos, you'll get a reminder at 7pm.",
  ]);
  assert.ok(GUIDE_VERSION >= 1);
});

test("no money in it (the link's money guard passes)", () => {
  assert.ok(linkSafe({ GUIDE_TITLE, GUIDE_STEPS, GUIDE_NOTES }));
  assert.ok(!JSON.stringify({ GUIDE_TITLE, GUIDE_STEPS, GUIDE_NOTES }).includes("$"));
});

test("the server offers it only where the daily log is (isPilotLink: supervisor, hand-over on their job)", () => {
  const route = readFileSync(new URL("../../app/api/site/[token]/route.ts", import.meta.url), "utf8");
  assert.match(route, /const hasLog = await isPilotLink\(link\);/);
  assert.match(route, /\.\.\.\(hasLog \? \{ guide: GUIDE_VERSION \} : \{\}\)/);
  const card = readFileSync(new URL("../../components/site/LogGuide.tsx", import.meta.url), "utf8");
  assert.equal((card.match(/localStorage\./g) ?? []).length, 2, "one read, one write");
  assert.equal((card.match(/try \{ (seen = Number\()?localStorage\./g) ?? []).length, 2, "both inside try / catch");
});
