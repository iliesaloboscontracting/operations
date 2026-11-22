// Full-time crew tiles (Ilies, 22 Nov 2026) - the plain rules and the colour chooser.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_TONE, CHIP_ROLE_TEXT, CHIP_TONE, cardKind, cardRoleTone, chipKind, fullTimeInputError, fullTimeValue, isFullTime,
  withFullTimeTitle,
} from "./fullTime";
import { pickResourceData, RESOURCE_FIELDS, PAY_RATE_FIELDS } from "./resourceFields";
import { HIRE_MONEY_FIELDS, HIRE_WRITE_FIELDS, coordinatorHireWrite } from "./coordinatorHire";
import { toPublicResource } from "./serializeResource";
import { buildDaySheet, type DaySheetJob } from "./daySheet";

test("on screen only: the day sheet never says FT or Full-time, even handed a ticked person", () => {
  // Ilies, 22 Nov 2026: "the colour display for the full timers is only for the system not to be exported".
  const crew = (name: string, role: string | null, fullTime: boolean) =>
    ({ role, resource: { name, type: "PERSONNEL", category: "Labourer", identifier: null, agency: null, fullTime } });
  const job = {
    title: "Test Site", client: null, siteAddress: "1 Test St", startTime: "7am", endTime: "3:30pm", shift: "DAY",
    notRunning: false, dayBrief: null,
    assignments: [crew("Alex Fulltimer", "Supervisor", true), crew("Bo Fulltimer", null, true), crew("Cy Casual", null, false)],
  } as unknown as DaySheetJob; // the board's own objects carry fullTime; the builder must ignore it
  const { subject, body } = buildDaySheet([job], "2026-11-23");
  const text = `${subject}\n${body}`;
  assert.ok(text.includes("Alex Fulltimer") && text.includes("Bo Fulltimer") && text.includes("Cy Casual"));
  assert.doesNotMatch(text.replace(/Fulltimer/g, ""), /fulltime|full-time|\bFT\b/i);
});

const person = (fullTime?: boolean | null) => ({ type: "PERSONNEL", category: "Labourer", fullTime });

test("only a Labour-register person with the tick is full-time", () => {
  assert.equal(isFullTime(person(true)), true);
  assert.equal(isFullTime(person(false)), false);
  assert.equal(isFullTime(person(null)), false);
  assert.equal(isFullTime(person(undefined)), false);
  assert.equal(isFullTime({ type: "HIRE", category: "LABOUR", fullTime: true }), false); // a hire worker never is
  assert.equal(isFullTime({ type: "EQUIPMENT", fullTime: true }), false);
});

test("a body's fullTime is a yes or a no", () => {
  assert.equal(fullTimeValue(true), true);
  assert.equal(fullTimeValue("true"), true);
  assert.equal(fullTimeValue(false), false);
  assert.equal(fullTimeValue("false"), false);
  assert.equal(fullTimeValue(""), false);
  assert.equal(fullTimeValue(null), false);
  assert.equal(fullTimeValue("yes"), null);
  assert.equal(fullTimeValue(1), null);
  assert.equal(fullTimeInputError("maybe", "PERSONNEL"), "Full-time is a yes or a no.");
  assert.equal(fullTimeInputError(true, "PERSONNEL"), null);
  assert.equal(fullTimeInputError("true", "EQUIPMENT"), "Full-time is for people on the Labour register only.");
  assert.equal(fullTimeInputError(false, "EQUIPMENT"), null); // the Plant form sends the whole record back - fine
});

test("pickResourceData keeps fullTime as a true / false", () => {
  assert.ok((RESOURCE_FIELDS as readonly string[]).includes("fullTime"));
  assert.deepEqual(pickResourceData({ fullTime: "true" }), { fullTime: true });
  assert.deepEqual(pickResourceData({ fullTime: "false" }), { fullTime: false });
  assert.deepEqual(pickResourceData({ fullTime: false }), { fullTime: false });
});

test("it isn't pay or money: every role that sees the board keeps it", () => {
  assert.ok(!(PAY_RATE_FIELDS as readonly string[]).includes("fullTime"));
  assert.ok(!HIRE_MONEY_FIELDS.includes("fullTime"));
  for (const role of ["ADMIN", "MANAGER", "VIEWER"] as const) {
    assert.equal(toPublicResource({ fullTime: true }, role).fullTime, true, role);
  }
});

test("the coordinator can't set it (not a hire field)", () => {
  assert.ok(!HIRE_WRITE_FIELDS.includes("fullTime"));
  const out = coordinatorHireWrite({ fullTime: true }, { type: "HIRE", category: "PLANT" });
  assert.ok("error" in out && out.status === 400);
  const person = coordinatorHireWrite({ fullTime: true }, { type: "PERSONNEL" });
  assert.ok("error" in person && person.status === 403);
});

test("chip colour: full-timers orange in the Crew column, everyone else as before", () => {
  const crew = { column: "crew" as const, supervisorLike: false, labourHire: false };
  assert.equal(chipKind(person(true), crew), "fullTime");
  assert.equal(chipKind(person(true), { ...crew, supervisorLike: true }), "fullTimeLead");
  assert.equal(chipKind(person(false), crew), "crew");
  assert.equal(chipKind(person(false), { ...crew, supervisorLike: true }), "lead");
  assert.equal(chipKind({ type: "HIRE", category: "LABOUR", fullTime: true }, { ...crew, labourHire: true }), "labourHire");
  assert.equal(chipKind({ type: "EQUIPMENT", fullTime: true }, { ...crew, column: "plant" }), "plant");
  assert.equal(chipKind({ type: "HIRE", category: "PLANT" }, { ...crew, column: "hire" }), "hire");
  // The tones as they were before 22 Nov for everyone who isn't full-time.
  assert.equal(CHIP_TONE.crew, "border border-brand-500/40 bg-brand-950/20 text-gray-200");
  assert.equal(CHIP_TONE.lead, "bg-brand-600 text-white");
  assert.equal(CHIP_TONE.plant, "border border-orange-500/60 bg-orange-950/60 text-orange-200");
  assert.equal(CHIP_TONE.hire, "border border-teal-500/60 bg-teal-950/60 text-teal-200");
  assert.equal(CHIP_TONE.labourHire, "border border-yellow-400 bg-yellow-400/20 font-medium text-yellow-100");
  assert.equal(CHIP_ROLE_TEXT.crew, "text-gray-400");
  assert.equal(CHIP_ROLE_TEXT.lead, "text-white");
  assert.equal(CHIP_ROLE_TEXT.labourHire, "text-yellow-200");
});

test("the full-time orange never looks like plant, a warning (amber) or an error (red)", () => {
  for (const tone of [CHIP_TONE.fullTime, CHIP_TONE.fullTimeLead, CARD_TONE.fullTime]) {
    assert.match(tone, /orange-500/);
    assert.doesNotMatch(tone, /amber|red|yellow|orange-950/);
    assert.notEqual(tone, CHIP_TONE.plant);
  }
});

test("sidebar card colour", () => {
  assert.equal(cardKind(person(true), { labourHire: false, highlighted: false }), "fullTime");
  assert.equal(cardKind(person(true), { labourHire: false, highlighted: true }), "fullTime");
  assert.equal(cardKind(person(false), { labourHire: false, highlighted: true }), "lead");
  assert.equal(cardKind(person(false), { labourHire: false, highlighted: false }), "plain");
  assert.equal(cardKind({ type: "HIRE", category: "LABOUR" }, { labourHire: true, highlighted: false }), "labourHire");
  assert.equal(CARD_TONE.plain, "border-edge bg-panel2");
  assert.equal(CARD_TONE.lead, "border-brand-500/50 bg-brand-500/10");
  assert.equal(cardRoleTone("fullTime", true), "bg-orange-500 text-black");
  assert.equal(cardRoleTone("lead", true), "bg-brand-600 text-white");
  assert.equal(cardRoleTone("fullTime", false), "bg-gray-700 text-gray-300");
});

test("the tooltip says Full-time, so colour is never the only sign", () => {
  assert.equal(withFullTimeTitle("Drag to move to another job", true), "Full-time · Drag to move to another job");
  assert.equal(withFullTimeTitle(null, true), "Full-time");
  assert.equal(withFullTimeTitle("Excavator", false), "Excavator");
  assert.equal(withFullTimeTitle(null, false), undefined);
});
