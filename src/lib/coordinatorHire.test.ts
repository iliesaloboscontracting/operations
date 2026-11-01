// Hire for the COORDINATOR login (lib/coordinatorHire.ts, 2 Nov 2026): no dollar figure out, no money field in, no
// other register, no archiving - and saving the form unchanged never loses an amount the office typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoMoney } from "./moneyGuard";
import { HIRE_MONEY_FIELDS, NO_ARCHIVE, NO_MONEY_ON_HIRE, coordinatorHireWrite, toCoordinatorHire } from "./coordinatorHire";

const stored = {
  id: "r1", type: "HIRE", category: "PLANT", ownership: "HIRED", active: true, status: "AVAILABLE",
  name: "5t excavator", agency: "Hire Express", role: null, hireRef: "HX-2231",
  hireSource: "Email: Hire Express 16 Oct, quoted $450/day", hireStart: null, hireEnd: "Fri, $90 pick-up",
  notes: "Delivery $120 + collection $120. Keys in the site box.",
  onHireDate: "2026-10-20", offHireDate: "2026-11-07", hireProjectId: "p1", hireStatus: "ON_HIRE",
  rate: "$450/day", dailyRateExGst: 450, hireRate: 450, hireRateUnit: "DAY", hireDeliveryCost: 120, hireCollectionCost: 120,
  ordinaryRate: 55, payRateNotes: "x", phone: "0400 000 000", createdAt: new Date(),
  assignments: [{ id: "a1", job: { id: "j1", title: "Smith St strip-out", date: "2026-10-21", shift: "DAY" } }],
};

test("the coordinator's hire item has no money field and no dollar figure", () => {
  const dto = toCoordinatorHire(stored);
  for (const f of [...HIRE_MONEY_FIELDS, "phone", "status", "ownership", "createdAt"]) assert.ok(!(f in dto), f);
  assert.ok(assertNoMoney(JSON.stringify(dto)), JSON.stringify(dto));
  // Everything he works with is there.
  assert.equal(dto.name, "5t excavator");
  assert.equal(dto.agency, "Hire Express");
  assert.equal(dto.offHireDate, "2026-11-07");
  assert.equal(dto.hireStatus, "ON_HIRE");
  assert.equal(dto.hireProjectId, "p1");
  assert.equal(dto.assignments[0].job.title, "Smith St strip-out");
  assert.match(dto.notes ?? "", /\(amount not recorded\)/);
  assert.match(dto.notes ?? "", /Keys in the site box/);
  // A name with an amount in it: the amount goes, with no tag.
  assert.equal(toCoordinatorHire({ ...stored, name: "Tipper ($90/day)" }).name, "Tipper");
});

test("a write with any money field is refused - whatever its value", () => {
  for (const f of HIRE_MONEY_FIELDS) {
    for (const v of [450, "", null]) {
      const out = coordinatorHireWrite({ [f]: v }, stored);
      assert.ok("error" in out && out.status === 400 && out.error === NO_MONEY_ON_HIRE, `${f}=${v}`);
    }
  }
});

test("only hire items, only hire fields, never archived", () => {
  assert.equal((coordinatorHireWrite({ notes: "x" }, { ...stored, type: "PERSONNEL" }) as { status: number }).status, 403, "another register");
  assert.equal((coordinatorHireWrite({ name: "Bob", type: "PERSONNEL", category: "Labourer" }, null) as { status: number }).status, 403, "adding a non-hire");
  assert.ok("error" in coordinatorHireWrite({ type: "VEHICLE" }, stored), "moving it off the Hire register");
  assert.ok("error" in coordinatorHireWrite({ category: "Site Manager" }, stored), "a non-hire category");
  assert.ok("error" in coordinatorHireWrite({ ownership: "OWNED" }, stored), "making it owned");
  for (const f of ["phone", "email", "tickets", "identifier", "serviceDue", "payClass", "status"]) assert.ok("error" in coordinatorHireWrite({ [f]: "x" }, stored), f);
  for (const v of [false, "false", 0, null]) {
    const out = coordinatorHireWrite({ active: v }, stored);
    assert.ok("error" in out && out.status === 403 && out.error === NO_ARCHIVE, `active=${v}`);
  }
});

test("what he may do: add, extend, off-hire, supplier, project, status", () => {
  const add = coordinatorHireWrite({ type: "HIRE", category: "EQUIPMENT", ownership: "HIRED", name: "EWP 19ft scissor", agency: "Allcott", onHireDate: "2026-11-03", hireStatus: "BOOKED" }, null);
  assert.ok("body" in add && add.body.name === "EWP 19ft scissor" && add.body.type === "HIRE");
  const extend = coordinatorHireWrite({ offHireDate: "2026-11-14", hireStatus: "ON_HIRE", hireProjectId: "p2", agency: "Hire Express Sydney" }, stored);
  assert.deepEqual("body" in extend && extend.body, { offHireDate: "2026-11-14", hireStatus: "ON_HIRE", hireProjectId: "p2", agency: "Hire Express Sydney" });
  const off = coordinatorHireWrite({ hireStatus: "RETURNED", active: true }, stored);
  assert.deepEqual("body" in off && off.body, { hireStatus: "RETURNED", active: true });
});

test("the edit form sent back unchanged loses nothing; an amount can't be typed in", () => {
  const dto = toCoordinatorHire(stored);
  // The whole row comes back from the form, as RegisterPage sends it, with one real change.
  const out = coordinatorHireWrite({ ...dto, offHireDate: "2026-11-10" }, stored);
  assert.ok("body" in out, JSON.stringify(out));
  if ("body" in out) {
    for (const f of ["notes", "hireSource", "hireEnd", "name", "agency"]) assert.ok(!(f in out.body), `${f} unchanged -> not saved`);
    assert.equal(out.body.offHireDate, "2026-11-10");
  }
  // Changing a field that holds an amount he can't see would lose it - refused.
  assert.equal((coordinatorHireWrite({ notes: "Keys at the gate." }, stored) as { status: number }).status, 409);
  // A field with no hidden amount can change; typing an amount in is refused.
  assert.ok("body" in coordinatorHireWrite({ hireRef: "HX-2232" }, stored));
  for (const t of ["$450/day", "about 450 dollars a day", "AUD 300"]) assert.equal((coordinatorHireWrite({ hireRef: t }, stored) as { status: number }).status, 400, t);
  assert.equal((coordinatorHireWrite({ type: "HIRE", category: "PLANT", name: "Roller", notes: "$200 delivery" }, null) as { status: number }).status, 400, "an amount in a new item's notes");
});
