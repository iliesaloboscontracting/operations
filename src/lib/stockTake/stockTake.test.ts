// Yard Stage B - the stock take's plain rules (lib/stockTake/rules.ts), and that the routes and store keep to them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALREADY_OPEN, CONDITIONS_SEEN, NOT_OPEN, SCAN_LIMIT, SWAPPED_SINCE, expectedFor, extraError, isMissingCandidate, lineChange, noteError, openKeyFor,
  planFinish, planScan, summarise, type CurrentTool, type FinishLine, type LineState, type RegisterTool,
} from "./rules";
import { compareToolbox } from "../toolboxCheck";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const handler = (code: string, name: string) => {
  const i = code.indexOf(`export const ${name} `);
  if (i < 0) return "";
  const j = code.indexOf("export const ", i + 1);
  return code.slice(i, j < 0 ? undefined : j);
};
const tool = (id: string, o: Partial<RegisterTool> = {}): RegisterTool => ({ id, tag: `LOB-${id.padStart(4, "0")}`, name: `Tool ${id}`, serialNumber: `SN${id}`, condition: "Good", toolboxId: null, ...o });
const line = (id: string, o: Partial<FinishLine> = {}): FinishLine => ({ id, toolId: `t${id}`, tag: `LOB-${id}`, expected: true, result: "UNCHECKED", conditionSeen: null, via: null, ...o });

test("expected at the start: every tool with no home toolbox, Missing ones too, never a swapped-out one", () => {
  const out = expectedFor("YARD", [
    tool("3"), tool("1", { condition: "Missing" }), tool("2", { toolboxId: "box1" }), tool("4", { condition: "Swapped out" }), tool("5", { condition: "Needs repair" }),
  ]);
  assert.deepEqual(out.map((t) => t.id), ["1", "3", "5"], "sorted by tag; in-a-toolbox and swapped-out left out; Missing kept");
  assert.throws(() => expectedFor("TOOLBOX", []), /Only the yard/);
});

test("one open stock take per location (the unique open key) and the closed wording", () => {
  assert.equal(openKeyFor("YARD"), "YARD");
  assert.match(ALREADY_OPEN, /already open/);
  assert.match(NOT_OPEN, /only be looked at/);
  const schema = src("../../../prisma/schema.prisma");
  assert.match(schema, /model StockTake \{[\s\S]*openKey\s+String\?\s+@unique/, "openKey is unique");
  const store = src("./store.ts");
  assert.match(store, /openKey: openKeyFor\(location\)/, "set when opened");
  assert.match(store, /e\.code === "P2002"\) return fail\(ALREADY_OPEN, 409\)/, "a second open one is refused");
  for (const s of ["CANCELLED", "FINISHED"]) assert.match(store, new RegExp(`status: "${s}", openKey: null`), `${s} frees the location`);
  assert.doesNotMatch(store, /stockTake\.delete/, "a stock take is never deleted");
});

test("ticking by hand: found (with a condition), not here, undo, condition - and extras", () => {
  const l: LineState = line("1");
  assert.deepEqual(lineChange(l, { action: "FOUND" }), { patch: { result: "FOUND", conditionSeen: null, via: "HAND", checked: true } });
  assert.deepEqual(lineChange(l, { action: "FOUND", conditionSeen: "Needs repair" }), { patch: { result: "FOUND", conditionSeen: "Needs repair", via: "HAND", checked: true } });
  assert.ok("error" in lineChange(l, { action: "FOUND", conditionSeen: "Missing" }), "Missing is never a 'seen' condition - it comes from finishing");
  assert.deepEqual(lineChange(line("1", { result: "FOUND" }), { action: "NOT_FOUND" }), { patch: { result: "NOT_FOUND", conditionSeen: null, via: "HAND", checked: true } });
  assert.deepEqual(lineChange(line("1", { result: "FOUND", via: "PHOTO" }), { action: "UNTICK" }), { patch: { result: "UNCHECKED", conditionSeen: null, via: null, checked: false } });
  assert.ok("error" in lineChange(l, { action: "CONDITION", conditionSeen: "Good" }), "tick it first");
  assert.deepEqual(lineChange(line("1", { result: "FOUND", via: "PHOTO" }), { action: "CONDITION", conditionSeen: "Needs repair" }), { patch: { result: "FOUND", conditionSeen: "Needs repair", via: "PHOTO", checked: true } });
  const extra = line("9", { expected: false, result: "EXTRA" });
  for (const a of ["FOUND", "NOT_FOUND", "UNTICK"] as const) assert.ok("error" in lineChange(extra, { action: a }), a);
  assert.ok("patch" in lineChange(extra, { action: "CONDITION", conditionSeen: "Good" }));
  assert.deepEqual([...CONDITIONS_SEEN], ["Good", "Needs repair"]);
  // Adding an extra by hand.
  assert.equal(extraError(null, []), "That tool isn't on the register.");
  assert.match(extraError(tool("2", { condition: "Swapped out" }), [])!, /swapped out/);
  assert.match(extraError(tool("2"), [line("x", { toolId: "2" })])!, /already on this stock take/);
  assert.equal(extraError(tool("2", { toolboxId: "box1" }), [line("1")]), null);
});

test("a shelf photo: tag / serial matches ticked, a hand tick stands, toolbox tools become extras, model-only only suggested", () => {
  const tools = [
    { id: "a", tag: "LOB-0001", name: "Drill", brand: "Hilti", model: "TE 30", serialNumber: "111", toolboxId: null, toolboxName: null },
    { id: "b", tag: "LOB-0002", name: "Grinder", brand: "Hilti", model: "AG 125", serialNumber: "222", toolboxId: null, toolboxName: null },
    { id: "c", tag: "LOB-0003", name: "Saw", brand: "Hilti", model: "SC 30", serialNumber: "333", toolboxId: "box1", toolboxName: "Sinan's toolbox" },
    { id: "d", tag: "LOB-0004", name: "Vac", brand: "Hilti", model: "VC 40", serialNumber: "444", toolboxId: null, toolboxName: null },
    { id: "e", tag: "LOB-0005", name: "Drill 2", brand: "Hilti", model: "TE 30", serialNumber: "555", toolboxId: null, toolboxName: null },
  ];
  const reading = { notes: "", items: [
    { description: "drill", brand: "Hilti", model: "TE 30", lobTag: "LOB 1", serialNumber: "" },
    { description: "grinder", brand: "", model: "", lobTag: "", serialNumber: "222" },
    { description: "saw", brand: "", model: "", lobTag: "LOB-0003", serialNumber: "" },
    { description: "vac", brand: "", model: "", lobTag: "LOB-0004", serialNumber: "" },
    { description: "another drill", brand: "Hilti", model: "TE 30", lobTag: "", serialNumber: "" },
    { description: "laser level", brand: "Bosch", model: "GLL 3", lobTag: "", serialNumber: "" },
  ] };
  const result = compareToolbox(null, reading, tools); // the yard as the box
  const lines: LineState[] = [
    line("1", { toolId: "a" }), line("2", { toolId: "b", result: "NOT_FOUND" }), line("4", { toolId: "d", result: "FOUND", via: "HAND" }), line("5", { toolId: "e" }),
  ];
  const plan = planScan(lines, result);
  assert.deepEqual(plan.tick.sort(), ["1", "2"], "tag and serial matches - a 'not here' by hand is overruled by the photo");
  assert.deepEqual(plan.alreadyFound, ["4"], "a tool already ticked by hand stays as the person ticked it");
  assert.deepEqual(plan.extras.map((x) => [x.toolId, x.registerPlace]), [["c", "Sinan's toolbox"]], "a toolbox tool seen here is an extra");
  assert.deepEqual(plan.probably.map((p) => p.lineId), ["5"], "same brand + model only: a suggestion, never ticked");
  assert.equal(plan.unknown.length, 1, "the laser level isn't on the register");
  assert.equal(SCAN_LIMIT, 40);
});

test("the summary counts", () => {
  const s = summarise([
    line("1", { result: "FOUND", conditionSeen: "Needs repair" }), line("2", { result: "FOUND" }),
    line("3", { result: "NOT_FOUND", decision: "MISSING", appliedAt: new Date(), appliedChange: "Condition Good -> Missing" }),
    line("4", { decision: "LEAVE" }), line("5", { expected: false, result: "EXTRA", conditionSeen: "Needs repair" }),
  ]);
  assert.deepEqual(s, { expected: 4, checked: 3, found: 2, needsRepair: 2, notFound: 1, unchecked: 1, extras: 1, confirmedMissing: 1, left: 1 });
  // ST-006 (Ilies approved 4 Nov 2026): only a tool finishing really marked Missing counts as confirmed missing.
  const notMarked = summarise([
    line("a", { result: "NOT_FOUND", decision: "MISSING" }), // decided, not applied (e.g. its update failed)
    line("b", { result: "NOT_FOUND", decision: "MISSING", appliedChange: "Already missing" }), // already Missing - no change
    line("c", { result: "UNCHECKED", decision: "MISSING", appliedChange: "Moved to a toolbox since the start - not marked missing" }),
    line("d", { result: "NOT_FOUND", decision: "MISSING", appliedAt: new Date(), appliedChange: "Condition Needs repair -> Missing" }),
  ]);
  assert.equal(notMarked.confirmedMissing, 1);
  assert.equal(isMissingCandidate(line("x")), true);
  assert.equal(isMissingCandidate(line("x", { result: "NOT_FOUND" })), true);
  assert.equal(isMissingCandidate(line("x", { result: "FOUND" })), false);
  assert.equal(isMissingCandidate(line("x", { expected: false, result: "EXTRA" })), false);
});

test("finishing: nothing is marked Missing without a person confirming it", () => {
  const lines = [line("1", { result: "FOUND" }), line("2", { result: "NOT_FOUND" }), line("3")];
  const cur = new Map<string, CurrentTool>([["t1", { condition: "Good", toolboxId: null }], ["t2", { condition: "Good", toolboxId: null }], ["t3", { condition: "Good", toolboxId: null }]]);
  const none = planFinish(lines, cur, { missing: [], leave: [] });
  assert.ok("error" in none && none.undecided.sort().join() === "2,3", "both not-found tools need a decision");
  const half = planFinish(lines, cur, { missing: ["2"], leave: [] });
  assert.ok("error" in half && half.undecided.join() === "3");
  assert.ok("error" in planFinish(lines, cur, { missing: ["2", "3"], leave: ["3"] }), "not both");
  assert.ok("error" in planFinish(lines, cur, { missing: ["1", "2", "3"], leave: [] }), "a found tool can't be marked missing");
  const ok = planFinish(lines, cur, { missing: ["2"], leave: ["3"] });
  assert.ok("steps" in ok);
  const by = Object.fromEntries(ok.steps.map((s) => [s.lineId, s]));
  assert.equal(by["2"].condition, "Missing");
  assert.equal(by["2"].decision, "MISSING");
  assert.equal(by["3"].condition, null, "left as it is");
  assert.equal(by["3"].decision, "LEAVE");
  assert.equal(by["1"].condition, null, "found, condition as on the register - nothing to change");
});

test("finishing: conditions seen, a Missing tool found again, tools moved or deleted since, re-running", () => {
  const lines = [
    line("1", { result: "FOUND", conditionSeen: "Needs repair" }), line("2", { result: "FOUND" }), line("3", { result: "FOUND", conditionSeen: "Good" }),
    line("4", { result: "NOT_FOUND" }), line("5", { result: "NOT_FOUND" }), line("6", { result: "FOUND", toolId: null }),
    line("7", { expected: false, result: "EXTRA", conditionSeen: "Needs repair" }), line("8", { result: "FOUND", conditionSeen: "Needs repair", appliedAt: new Date() }),
    line("9"),
  ];
  const cur = new Map<string, CurrentTool>([
    ["t1", { condition: "Good", toolboxId: null }], ["t2", { condition: "Missing", toolboxId: null }], ["t3", { condition: "Missing", toolboxId: null }],
    ["t4", { condition: "Good", toolboxId: "box1" }], ["t5", { condition: "Missing", toolboxId: null }], ["t7", { condition: "Good", toolboxId: "box1" }],
    ["t8", { condition: "Needs repair", toolboxId: null }],
  ]);
  const r = planFinish(lines, cur, { missing: ["4", "5", "9"], leave: [] });
  assert.ok("steps" in r);
  const by = Object.fromEntries(r.steps.map((s) => [s.lineId, s]));
  assert.equal(by["1"].condition, "Needs repair");
  assert.equal(by["1"].change, "Condition Good -> Needs repair");
  assert.equal(by["2"].condition, "Good", "a Missing tool that turned up goes back to Good");
  assert.equal(by["3"].condition, "Good");
  assert.equal(by["4"].condition, null, "moved into a toolbox since the start - not marked missing");
  assert.match(by["4"].note!, /Moved to a toolbox/);
  assert.equal(by["5"].condition, null, "already Missing - nothing to do");
  assert.equal(by["5"].note, "Already missing");
  assert.equal(by["6"].note, "No longer on the register");
  assert.equal(by["7"].condition, "Needs repair", "an extra's condition is applied too");
  assert.equal(by["8"].note, "Already applied", "a finish pressed again skips what's done");
  assert.equal(by["9"].condition, null, "never checked, confirmed missing, but the tool is gone from the register");
});

test("ST-003: a tool swapped out with Hilti since the start is never changed by finishing (missing, found or extra)", () => {
  const lines = [
    line("1", { result: "NOT_FOUND" }), line("2", { result: "FOUND", conditionSeen: "Needs repair" }), line("3", { result: "FOUND" }),
    line("4", { expected: false, result: "EXTRA", conditionSeen: "Good" }), line("5", { result: "NOT_FOUND" }),
  ];
  const swapped = { condition: "Swapped out", toolboxId: null };
  const cur = new Map<string, CurrentTool>([["t1", swapped], ["t2", swapped], ["t3", swapped], ["t4", swapped], ["t5", { condition: "Good", toolboxId: null }]]);
  const r = planFinish(lines, cur, { missing: ["1", "5"], leave: [] });
  assert.ok("steps" in r);
  const by = Object.fromEntries(r.steps.map((s) => [s.lineId, s]));
  for (const id of ["1", "2", "3", "4"]) {
    assert.equal(by[id].condition, null, `line ${id} changes nothing`);
    assert.equal(by[id].note, SWAPPED_SINCE, `line ${id} says why`);
  }
  assert.equal(by["1"].decision, "MISSING", "the decision is still recorded");
  assert.equal(by["5"].condition, "Missing", "an ordinary confirmed one still is");
});

test("the note: short plain text", () => {
  assert.equal(noteError(undefined), null);
  assert.equal(noteError("End of month"), null);
  assert.ok(noteError(5));
  assert.ok(noteError("x".repeat(501)));
});

test("access: Tools levels - look Viewer+, coordinator, yard; count / finish / cancel Manager+, coordinator, yard; logins only", () => {
  const list = src("../../app/api/stock-takes/route.ts");
  assert.match(handler(list, "GET"), /await guardTools\("VIEWER"\)/);
  assert.match(handler(list, "POST"), /await guardTools\("MANAGER"\)/);
  const one = src("../../app/api/stock-takes/[id]/route.ts");
  assert.match(handler(one, "GET"), /await guardTools\("VIEWER"\)/);
  assert.match(handler(one, "POST"), /await guardTools\("MANAGER"\)/);
  for (const rel of ["../../app/api/stock-takes/[id]/lines/route.ts", "../../app/api/stock-takes/[id]/scan/route.ts"]) assert.match(handler(src(rel), "POST"), /await guardTools\("MANAGER"\)/, rel);
  for (const rel of ["../../app/api/stock-takes/route.ts", "../../app/api/stock-takes/[id]/route.ts", "../../app/api/stock-takes/[id]/scan/route.ts"])
    for (const h of ["GET", "POST"]) {
      const body = handler(src(rel), h);
      if (!body) continue;
      assert.doesNotMatch(body.replace(/NextResponse\.json\((out|\{ error|"undecided")[^\n]*/g, ""), /NextResponse\.json\(/, `${rel} ${h}: replies through viewJson`);
    }
  assert.doesNotMatch(src("../siteLinks.ts"), /stock/i, "no site link reaches it");
});

test("finishing changes the register only through the ordinary tool update and moveTool", () => {
  const store = src("./store.ts");
  // ST-001 made the store's database and helpers swappable for tests; the real ones are the ordinary tool paths.
  assert.match(store, /const REAL: Deps = \{ db: prisma, apply: updateTool, move: moveTool, read: readToolboxPhotos \};/);
  assert.match(store, /await deps\.apply\(line\.toolId, \{ condition: step\.condition \}, actor\)/);
  assert.match(store, /await deps\.move\(line\.toolId, null, "Found in the yard on a stock take", actor\.name\)/);
  assert.doesNotMatch(store, /\.tool\.(update|updateMany|upsert|delete|create)\(/, "no direct tool writes");
  assert.match(store, /await deps\.read\(/, "the toolbox check's photo reading - no new connection");
  assert.match(store, /compareToolbox\(null, reading/);
  const upd = src("../toolUpdate.ts");
  assert.match(upd, /pickTool\(body\)[\s\S]*toolFieldError\(data\)[\s\S]*moveTool\([\s\S]*prisma\.tool\.update/);
});
