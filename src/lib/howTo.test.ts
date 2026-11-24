import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertNoMoney } from "./moneyGuard";
import { ALL_GUIDES, DRIVER_GUIDE, GOLDEN_RULE, HANDOVER_GUIDE, SIGNIN_GUIDE, SUPERVISOR_GUIDE, guideForLink, guideText } from "./howTo";

const src = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const count = (text: string, word: string) => text.split(word).length - 1;

test("no guide carries a dollar figure or an amount", () => {
  for (const g of ALL_GUIDES) {
    const t = guideText(g);
    assert.ok(assertNoMoney(t), `${g.id}: assertNoMoney`);
    assert.ok(!t.includes("$"), `${g.id}: no "$" at all`);
    assert.ok(!/\b\d+(\.\d+)?\s?(dollars?|cents?|AUD)\b/i.test(t), `${g.id}: no written-out amounts`);
  }
});

test("which links get a guide: DRIVER, SUPERVISOR, HANDOVER - never POSTER, OFFICE or the yard's shared link", () => {
  assert.equal(guideForLink("DRIVER"), DRIVER_GUIDE);
  assert.equal(guideForLink("SUPERVISOR"), SUPERVISOR_GUIDE);
  assert.equal(guideForLink("HANDOVER"), HANDOVER_GUIDE);
  assert.equal(guideForLink("POSTER"), null);
  assert.equal(guideForLink("OFFICE"), null);
  assert.equal(guideForLink("OFFICE", true), null);
  assert.equal(guideForLink("SUPERVISOR", true), null);
  assert.equal(guideForLink("anything"), null);
});

test("the driver guide: the golden rule, Sign out once at the end, the truck's QR, regional, the link's buttons", () => {
  const t = guideText(DRIVER_GUIDE);
  assert.equal(DRIVER_GUIDE.rule, GOLDEN_RULE);
  assert.match(GOLDEN_RULE, /one place at a time/);
  assert.match(GOLDEN_RULE, /Never sign out in between/);
  assert.match(GOLDEN_RULE, /Only press Sign out once, at the very end of your day/);
  // A normal truck day: "Sign out" appears in the last step only.
  const day = DRIVER_GUIDE.sections.find((s) => s.title === "A normal truck day")!;
  const steps = day.steps!.map((s) => `${s.lead} ${s.text}`);
  assert.ok(day.numbered && steps.length === 5);
  assert.ok(steps.slice(0, -1).every((s) => !s.includes("Sign out")), "no Sign out before the end of the day");
  assert.equal(count(steps[steps.length - 1], "Sign out"), 1, "Sign out once, in the last step");
  assert.match(steps[steps.length - 1], /End of the day/);
  assert.match(steps[steps.length - 1], /knock-off check/);
  assert.ok(count(t, "truck's QR") >= 4, "the truck's QR");
  assert.match(t, /pre-start must be done/);
  assert.match(t, /Never press Start travel/);
  for (const label of ["Add receipt", "My receipts", "Reimbursement", "Delivered", "Picked up", "Client's bin", "Our bin", "Got it", "Tip docket", "Fuel"]) assert.ok(t.includes(label), `driver guide: ${label}`);
});

test("regional travel (24 Nov 2026 design): company truck = truck QR out and back; own car = Start travel on the link; crew riding along = nothing", () => {
  for (const g of [DRIVER_GUIDE, SIGNIN_GUIDE]) {
    const reg = g.sections.find((s) => s.title.startsWith("Regional"))!;
    assert.equal(reg.steps!.length, 3);
    const truck = reg.steps!.find((s) => /company truck/.test(s.lead ?? ""))!;
    assert.match(truck.text!, /truck's QR for the drive out, and again for the drive back/);
    assert.match(truck.text!, /Never press Start travel/);
    const own = reg.steps!.find((s) => /own car or ute/.test(s.lead ?? ""))!;
    assert.match(own.text!, /Start travel on your link/);
    assert.match(own.text!, /Travelling home/);
    assert.match(own.text!, /Arrived/);
    assert.match(own.text!, /If Start travel won't start, sign in on the supervisor's QR at site and tell the office\./, "HT-003");
    const crew = reg.steps!.find((s) => /Riding along as crew/.test(s.lead ?? ""))!;
    assert.match(crew.text!, /nothing to do for travel/);
    assert.match(crew.text!, /worked out from the driver you travelled with/);
    assert.match(crew.text!, /supervisor's QR when you get to site/);
    assert.ok(!/Start travel/.test(crew.text!), "crew never press Start travel");
  }
  for (const g of ALL_GUIDES) assert.ok(!/If it asks|Passenger or Own car/.test(guideText(g)), `${g.id}: no passenger / own car picker wording`);
});

test("the supervisor guide covers every tile the link shows today", () => {
  const t = guideText(SUPERVISOR_GUIDE);
  for (const label of ["Sign in crew", "Tick in", "Tick out", "Confirm all", "Wasn't here", "Hand over", "Approve hours", "Approve the day", "Daily log", "Before photos", "Talk through your day", "Fill my log from this", "After photos", "Make a request", "My requests", "Collected", "Hire on my site", "Still needed", "Finished", "Not on site", "Add receipt", "My receipts", "Reimbursement", "Bins", "Got it", "Add a tool", "Check my toolbox", "Report a fault"]) {
    assert.ok(t.includes(label), `supervisor guide: ${label}`);
  }
  assert.match(t, /Only the office can change a time/);
  assert.match(t, /Don't say prices or dollar amounts/);
  // HT-002: Confirm all only when everyone listed was on site (supervisor and hand-over guides).
  for (const g of [SUPERVISOR_GUIDE, HANDOVER_GUIDE]) {
    const gt = guideText(g);
    assert.match(gt, /Only tap Confirm all if everyone listed was on site\./, `${g.id}: HT-002`);
    assert.ok(!/confirms everyone who was on site/.test(gt), `${g.id}: the old Confirm all wording is gone`);
  }
});

test("the hand-over guide: only what a hand-over link shows (no hours, receipts, bins, messages or hand over)", () => {
  const t = guideText(HANDOVER_GUIDE);
  for (const label of ["Sign in crew", "Confirm all", "Make a request", "Hire on my site", "Talk through your day"]) assert.ok(t.includes(label), `handover: ${label}`);
  for (const label of ["Approve hours", "Add receipt", "Reimbursement", "Bins", "Got it", "Hand over sign-in"]) assert.ok(!t.includes(label), `handover: no ${label}`);
});

test("the sign-in screen guide: golden rule, the truck pre-start and knock-off check, regional, what to do if it goes wrong", () => {
  const t = guideText(SIGNIN_GUIDE);
  assert.equal(SIGNIN_GUIDE.rule, GOLDEN_RULE);
  assert.ok(SIGNIN_GUIDE.sections.some((s) => /pre-start/.test(s.title) && /knock-off/.test(s.title)));
  assert.match(t, /Not driving after all\?/);
  // HT-004: required until today's pre-start for that truck has been sent.
  assert.match(t, /the pre-start is required until today's pre-start for that truck has been sent/);
  assert.ok(!/First sign-in on that truck today/.test(t), "HT-004: the old first-sign-in-only wording is gone");
  assert.match(t, /Do not use/);
  assert.match(t, /Only the office can fix a time/);
  assert.match(t, /scan the truck QR again/);
  assert.match(t, /I'm from a hire company \/ subcontractor/);
});

test("the button names in the guides are the screens' real labels", () => {
  const link = src("src/app/site/[token]/page.tsx");
  for (const label of ["Add receipt", "My receipts", "Reimbursement", "Bins", "Sign in crew", "Daily log", "Approve hours", "Make a request", "My requests", "Hire on my site", "Add a tool", "Report a fault", "How to use"]) {
    assert.ok(link.includes(`title="${label}"`), `site link tile: ${label}`);
  }
  assert.ok(link.includes(`: "Check my toolbox"`), "site link tile: Check my toolbox");
  const crew = src("src/components/site/SignInCrew.tsx");
  for (const label of ["Tick in", "Tick out", "Select all on site", "Hand over", "Wasn&apos;t here", "Confirm all", "Signed in from the poster - confirm"]) assert.ok(crew.includes(label), `Sign in crew: ${label}`);
  assert.ok(src("src/components/site/ApproveHours.tsx").includes("Approve the day") && src("src/components/site/ApproveHours.tsx").includes("Changed since you approved"));
  assert.ok(src("src/components/site/VoiceNote.tsx").includes("Talk through your day") && src("src/components/site/VoiceNote.tsx").includes("Fill my log from this"));
  assert.ok(src("src/components/site/HireCheck.tsx").includes(`STILL_NEEDED: "Still needed", FINISHED: "Finished", NOT_ON_SITE: "Not on site"`));
  assert.ok(src("src/components/site/SiteRequests.tsx").includes(">Collected<"));
  const bins = src("src/components/site/Bins.tsx");
  assert.ok(bins.includes("Delivered") && bins.includes("Picked up"));
  assert.ok(src("src/components/site/CrewMessages.tsx").includes("Got it"));
  const signin = src("src/app/site/in/[code]/page.tsx");
  for (const label of ["Sign in", "Sign out", "Take the photo", "Not driving after all? Sign out", "Travelling home", "I&apos;m from a hire company / subcontractor", "How signing in works"]) assert.ok(signin.includes(label), `sign-in screen: ${label}`);
  assert.ok(src("src/app/site/in/travel/page.tsx").includes("Start travel") && src("src/app/site/in/travel/page.tsx").includes("Arrived"));
  assert.ok(src("src/lib/prestart/rules.ts").includes(`"That's timed out - scan the truck QR again`));
  assert.ok(src("src/lib/prestart/rules.ts").includes(`DO_NOT_USE: "Do not use"`));
});

test("the guides stay static: no fetch, no API, no storage in the guide code", () => {
  for (const rel of ["src/lib/howTo.ts", "src/components/site/HowToGuide.tsx"]) {
    const s = src(rel);
    assert.ok(!/\bfetch\(|\/api\/|localStorage|prisma|XMLHttpRequest/.test(s), `${rel} is static`);
  }
});
