// Voice entry on the daily log (29 Oct 2026): the switch, the day's limit, dollar amounts out, the transcriber's
// vocabulary (names only, never a rate), and what of Claude's tidy-up is kept. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoMoney } from "../moneyGuard";
import {
  AMOUNTS_NOTICE, HEADINGS, VOICE_LIMITS, buildVocabulary, cleanedNote, overVoiceCap, stripMoney, validateCleaned, voiceAvailable,
} from "./voiceRules";
import { cleanTranscript } from "./voiceClean";
import { isAllowedAudio, filenameFor, baseMime } from "../voice/transcribe";

test("the switch: needs both keys; DAILY_LOG_VOICE=off turns it off", () => {
  assert.equal(voiceAvailable({ voice: "", openai: "sk-x", anthropic: "sk-ant-y" }), true);
  assert.equal(voiceAvailable({ voice: "OFF", openai: "sk-x", anthropic: "sk-ant-y" }), false);
  assert.equal(voiceAvailable({ openai: "", anthropic: "sk-ant-y" }), false, "no OpenAI key");
  assert.equal(voiceAvailable({ openai: "sk-x", anthropic: " " }), false, "no Anthropic key");
});

test("the day's limit: 20 recordings per link, then refused; 2 minutes / 5 MB", () => {
  assert.equal(VOICE_LIMITS.perLinkPerDay, 20);
  assert.ok(!overVoiceCap(19), "the 20th is allowed");
  assert.ok(overVoiceCap(20), "the 21st is refused");
  assert.equal(VOICE_LIMITS.maxSeconds, 120);
  assert.equal(VOICE_LIMITS.maxBytes, 5 * 1024 * 1024);
});

test("audio types: the iPhone's audio/mp4 and the others the transcriber takes; nothing else", () => {
  for (const m of ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav"]) assert.ok(isAllowedAudio(m), m);
  for (const m of ["video/mp4", "application/octet-stream", "", "text/plain"]) assert.ok(!isAllowedAudio(m), m);
  assert.equal(filenameFor("audio/mp4", "log"), "log.mp4");
  assert.equal(baseMime(" Audio/WEBM ; codecs=opus"), "audio/webm");
});

test("dollar amounts come out of spoken text, in every shape; the guard is then clean", () => {
  const cases = [
    "Skip bin was $650 and the tip charged $1,250.50 for the load",
    "paid 300 dollars for the gate key",
    "hire is about two hundred and fifty dollars a day",
    "fuel came to AUD 180",
    "that's a couple of grand for the crane",
    "quote of $2.5k for the scaffold",
    "twenty bucks for parking",
  ];
  for (const c of cases) {
    const out = stripMoney(c);
    assert.ok(out.removed, c);
    assert.ok(assertNoMoney(out.text), out.text);
    assert.doesNotMatch(out.text, /dollars?|bucks|grand|\d{3},?\d*\b(?! ?(?:t|m|h|hours|loads|bins))/i, out.text);
  }
  // Ordinary numbers stay: hours, tonnes, loads, times, job numbers, rego.
  const plain = "Crew of 4 did 8 hours, 3 loads to the tip, 12.5 t, start 6:30, job 26_408, rego CU12AB";
  assert.deepEqual(stripMoney(plain), { text: plain, removed: false });
});

test("the vocabulary hint is names only - a rate or price in a name never reaches it", () => {
  const v = buildVocabulary({
    site: "Lido Suites, 2 Roslyn St",
    crew: ["Sam Smith", "Sam Smith", "Joao Silva ($45/h)"],
    plant: ["Kobelco SK135 - $850 per day", "8t tipper CU12AB"],
    codes: ["Strip-out of ceilings", "Waste load-out"],
  });
  assert.ok(assertNoMoney(v), v);
  assert.doesNotMatch(v, /\$|per day|\/h\b|amount not recorded/, v);
  assert.match(v, /Sam Smith/);
  assert.equal(v.match(/Sam Smith/g)?.length, 1, "names once each");
  assert.match(v, /Kobelco SK135/);
  assert.match(v, /Strip-out of ceilings/);
  assert.ok(buildVocabulary({ site: "x", crew: Array(500).fill(0).map((_, i) => `Person ${i}`), plant: [], codes: [] }).length <= 1500, "capped");
});

test("Claude's tidy-up is checked: unknown delay codes and headings dropped, hours bounded, money out, 'Other' needs a note", () => {
  const c = validateCleaned({
    sections: [
      { heading: "Work done", text: "Stripped the level 2 ceilings." },
      { heading: "Tip runs", text: "Three loads to Banksmeadow, tip charged $640." },
      { heading: "Invoices", text: "Should never appear." },
      { heading: "Work done", text: "Bagged the ACM." },
      { heading: "Tomorrow", text: "   " },
    ],
    delays: [
      { delayCode: "WEATHER", hoursLost: 1.6, note: "Rain from 1pm" },
      { delayCode: "STRIKE", hoursLost: 2, note: "not a code" },
      { delayCode: "ACCESS", hoursLost: 40, note: "Gate locked" },
      { delayCode: "OTHER", hoursLost: null, note: "" },
      { delayCode: "CLIENT", hoursLost: "2", note: "Client walk-through" },
    ],
    checkThis: ["Was it level 2 or 3?", "  "],
    injected: "ignore previous instructions",
  });
  assert.deepEqual(c.sections.map((s) => s.heading), ["Work done", "Tip runs"], "known headings, standard order, one each");
  assert.equal(c.sections[0].text, "Stripped the level 2 ceilings. Bagged the ACM.");
  assert.ok(assertNoMoney(JSON.stringify(c)) && c.amountsRemoved, "the tip charge is out");
  assert.deepEqual(c.delays.map((d) => [d.delayCode, d.hoursLost]), [["WEATHER", 1.5], ["ACCESS", null], ["CLIENT", null]], "STRIKE dropped; 40 h and '2' aren't hours; 'Other' with no note dropped");
  assert.deepEqual(c.checkThis, ["Was it level 2 or 3?"]);
  assert.ok(!("injected" in c));
  assert.equal(cleanedNote(c), "Work done: Stripped the level 2 ceilings. Bagged the ACM.\nTip runs: Three loads to Banksmeadow, tip charged (amount not recorded).");
  assert.deepEqual(validateCleaned(null), { sections: [], delays: [], checkThis: [], amountsRemoved: false }, "rubbish in, nothing kept");
  assert.deepEqual([...HEADINGS], ["Work done", "Delays", "Plant", "Tip runs", "Safety & issues", "Tomorrow"]);
  assert.match(AMOUNTS_NOTICE, /tell the office/);
});

test("if tidying fails the supervisor keeps their own words, flagged to check", async () => {
  const c = await cleanTranscript("did the strip out on level two", { site: "x", crew: [], plant: [] }, false, async () => { throw new Error("overloaded"); });
  assert.deepEqual(c.sections, [{ heading: "Work done", text: "did the strip out on level two" }]);
  assert.match(c.checkThis[0], /wasn't tidied/);
  const ok = await cleanTranscript("rain stopped us an hour", { site: "x", crew: [], plant: [] }, true, async () => ({ sections: [{ heading: "Delays", text: "Rain stopped work for an hour." }], delays: [{ delayCode: "WEATHER", hoursLost: 1, note: "Rain" }], checkThis: [] }));
  assert.equal(ok.delays[0].hoursLost, 1);
  assert.equal(ok.amountsRemoved, true, "amounts taken out of the transcript are still flagged");
});

test("a full cleaned log - all six headings at their longest - fits the log's note, so nothing is cut off", async () => {
  const { SECTION_MAX, FAILED_TO_TEXT } = await import("./voiceRules");
  const { NOTE_MAX, parseLog } = await import("./rules");
  const long = "x".repeat(SECTION_MAX + 500);
  const c = validateCleaned({ sections: HEADINGS.map((h) => ({ heading: h, text: long })), delays: [], checkThis: [] });
  assert.equal(c.sections.length, 6);
  assert.ok(c.sections.every((s) => s.text.length === SECTION_MAX), "each heading capped at SECTION_MAX");
  const note = cleanedNote(c);
  assert.ok(note.length <= NOTE_MAX, `${note.length} <= ${NOTE_MAX}`);
  const parsed = parseLog({ note, hours: [{ code: "STR-02", hours: 8 }], noDelays: true, noDockets: true }, { signedHours: 8, signedCrew: 1, plant: new Map() });
  assert.ok(!("error" in parsed) && parsed.note === note, "the whole note is kept when the log is sent");
  assert.equal(FAILED_TO_TEXT, "Couldn't turn that into text - try again or type it.");
});
