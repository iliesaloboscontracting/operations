// The hire estimate and off-hire (Ilies, 5 Nov 2026: the cost stops on the day it's called off). Made-up rates. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hireEstimate, hireEstimateDays, hireStillToCome, isOffHired, offHireAlert, offHiredBefore, offHireMissing, offHireStop, type HireLike } from "./hireEstimate";

// On hire Mon 26 Oct 2026, $100 a day (made up), $50 delivery + $40 pick-up, expected finish Fri 6 Nov.
const ITEM: HireLike = { onHireDate: "2026-10-26", offHireDate: "2026-11-06", hireRate: 100, hireRateUnit: "DAY", hireDeliveryCost: 50, hireCollectionCost: 40, hireStatus: "ON_HIRE" };
const TODAY = "2026-11-04"; // Wed: 8 weekdays from 26 Oct

test("on hire: cost runs to today, the forecast to the expected finish", () => {
  const e = hireEstimate(ITEM, TODAY)!;
  assert.equal(e.daysToDate, 8);
  assert.equal(e.costToDate, 850); // 8 x 100 + delivery
  assert.equal(e.daysTotal, 10);
  assert.equal(e.costTotal, 1090); // 10 x 100 + 50 + 40
  assert.equal(hireStillToCome(ITEM, TODAY), 240); // Thu, Fri + pick-up
  assert.equal(isOffHired(ITEM), false);
});

test("called off on Fri 30 Oct: the cost stops that day and pick-up lands on it", () => {
  const off = { ...ITEM, hireStatus: "RETURNED", offHiredOn: "2026-10-30" };
  const e = hireEstimate(off, TODAY)!;
  assert.equal(e.daysToDate, 5);
  assert.equal(e.costToDate, 590); // 5 x 100 + 50 + 40
  assert.equal(e.costTotal, 590);
  assert.equal(hireStillToCome(off, TODAY), 0);
  const days = hireEstimateDays(off, TODAY);
  assert.equal(days.reduce((n, d) => n + d.amount, 0), 590);
  assert.ok(days.some((d) => d.date === "2026-10-30" && d.amount === 40), "pick-up on the off-hire day");
  assert.equal(offHireAlert(off, "2026-11-10"), null, "no overdue alert once called off");
});

test("the off-hired day wins over the expected finish, earlier or later", () => {
  const late = { ...ITEM, hireStatus: "RETURNED", offHiredOn: "2026-11-10", offHireDate: "2026-11-06" };
  assert.equal(offHireStop(late), "2026-11-10");
  assert.equal(hireEstimate(late, "2026-11-12")!.daysToDate, 12); // 26 Oct - Tue 10 Nov
});

test("called off for a later day: still costing until then, forecast to that day", () => {
  const ahead = { ...ITEM, hireStatus: "RETURNED", offHiredOn: "2026-11-09" };
  const e = hireEstimate(ahead, TODAY)!;
  assert.equal(e.costToDate, 850, "no pick-up yet");
  assert.equal(hireStillToCome(ahead, TODAY), 340); // Thu, Fri, Mon + pick-up
  assert.equal(offHiredBefore(ahead, "2026-11-09"), false, "still on the board on its last day");
  assert.equal(offHiredBefore(ahead, "2026-11-10"), true, "off the board the day after");
});

test("Returned with no date at all: no estimate (it used to grow every day), flagged, off the board", () => {
  const lost = { ...ITEM, hireStatus: "RETURNED", offHireDate: null };
  assert.equal(offHireMissing(lost), true);
  const e = hireEstimate(lost, TODAY)!;
  assert.equal(e.costToDate, null);
  assert.equal(e.offHireMissing, true);
  assert.deepEqual(hireEstimateDays(lost, TODAY), []);
  assert.equal(hireStillToCome(lost, TODAY), 0);
  assert.equal(offHiredBefore(lost, TODAY), true);
});

test("an older Returned item keeps stopping on its finish date", () => {
  const old = { ...ITEM, hireStatus: "RETURNED", offHireDate: "2026-10-28" };
  assert.equal(offHireStop(old), "2026-10-28");
  assert.equal(hireEstimate(old, TODAY)!.costToDate, 390); // 3 x 100 + 50 + 40
});

test("finished on site, not called off yet: still costing to today, nothing more forecast but the pick-up", () => {
  const asked = { ...ITEM, hireStatus: "OFF_HIRE_REQUESTED", offHireDate: null };
  const e = hireEstimate(asked, TODAY)!;
  assert.equal(e.costToDate, 850);
  assert.equal(e.daysTotal, 8);
  assert.equal(hireStillToCome(asked, TODAY), 40);
  assert.equal(offHiredBefore(asked, "2026-11-20"), false, "stays on the board until it's called off");
});

test("still out past its expected finish: keeps costing until it's called off, and shows overdue", () => {
  const over = { ...ITEM, offHireDate: "2026-10-30" };
  const e = hireEstimate(over, TODAY)!;
  assert.equal(e.daysToDate, 8);
  assert.equal(e.costTotal, 890); // to today + delivery + pick-up
  assert.equal(offHireAlert(over, TODAY)?.level, "OVERDUE");
});
