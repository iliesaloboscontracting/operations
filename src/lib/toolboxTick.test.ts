// "Check my toolbox" as a tick list (Ilies, 25 Nov 2026): the heading and count, the send button only once every tool
// is marked, present / missing built from the ticks, tool ids from outside the toolbox refused, no money. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_TOOLBOX, buildTickResult, canSendTick, linkSafe, markAllHere, markedCount, markedLabel, tickHeading, tickListView, tickReply, toolCount,
} from "./toolboxTick";

const tools = ["1", "2", "3", "4", "5", "6"].map((n) => ({ id: `t${n}`, tag: `LOB-000${n}`, name: `Tool ${n}`, serialNumber: `SN${n}` }));
const box = { id: "box1", name: "Pol Heredia Maya's toolbox", tools };

test("heading: the toolbox's name and how many tools", () => {
  assert.equal(tickHeading(box), "Pol Heredia Maya's toolbox – 6 tools");
  assert.equal(tickHeading({ name: "Jed's toolbox", tools: [tools[0]] }), "Jed's toolbox – 1 tool");
  assert.equal(tickHeading({ name: "Tom's toolbox", tools: [] }), "Tom's toolbox – 0 tools");
  assert.equal(toolCount(2), "2 tools");
});

test("the list view carries only the toolbox name, tool names and LOB tags", () => {
  const v = tickListView(box);
  assert.equal(v.heading, "Pol Heredia Maya's toolbox – 6 tools");
  assert.deepEqual(Object.keys(v).sort(), ["heading", "id", "name", "tools"]);
  for (const t of v.tools) assert.deepEqual(Object.keys(t).sort(), ["id", "name", "tag"]);
  assert.ok(!JSON.stringify(v).includes("SN1"), "no serial numbers");
});

test("nothing pre-selected; Check toolbox is off until every tool is marked; 'N of M marked'", () => {
  assert.equal(markedCount(tools, {}), 0);
  assert.equal(markedLabel(tools, {}), "0 of 6 marked");
  assert.equal(canSendTick(tools, {}), false);
  const three = { t1: "HERE", t2: "MISSING", t3: "HERE" } as const;
  assert.equal(markedLabel(tools, three), "3 of 6 marked");
  assert.equal(canSendTick(tools, three), false);
  const five = { ...three, t4: "HERE", t5: "HERE" } as const;
  assert.equal(canSendTick(tools, five), false, "one still unmarked");
  assert.equal(canSendTick(tools, { ...five, t6: "MISSING" }), true);
  assert.equal(canSendTick([], {}), false, "an empty toolbox can't be sent");
  assert.equal(markedCount(tools, { t1: "MAYBE" as never }), 0, "only Here / Missing count");
});

test("Mark all here sets every row Here, and any can then be flipped to Missing", () => {
  const all = markAllHere(tools);
  assert.equal(Object.keys(all).length, 6);
  assert.ok(Object.values(all).every((m) => m === "HERE"));
  assert.equal(canSendTick(tools, all), true);
  const flipped = { ...all, t4: "MISSING" as const };
  const r = buildTickResult(tools, flipped);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.result.missing.map((l) => l.toolId), ["t4"]);
});

test("present and missing are built from the ticks, in the photo check's record format", () => {
  const r = buildTickResult(tools, { t1: "HERE", t2: "MISSING", t3: "HERE", t4: "HERE", t5: "MISSING", t6: "HERE" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.result.present.map((l) => l.toolId), ["t1", "t3", "t4", "t6"]);
  assert.deepEqual(r.result.missing.map((l) => l.toolId), ["t2", "t5"]);
  assert.deepEqual(r.result.presentUnconfirmed, []);
  assert.deepEqual(r.result.foreign, []);
  assert.deepEqual(r.result.unknown, []);
  assert.equal(r.result.method, "TICK");
  assert.deepEqual(r.result.present[0], { toolId: "t1", tag: "LOB-0001", name: "Tool 1", serialNumber: "SN1", how: "tick" });
});

test("refused: a tool id from outside the toolbox, an unmarked tool, a bad mark, a bad body, an empty toolbox", () => {
  const all = markAllHere(tools);
  const foreign = buildTickResult(tools, { ...all, tOther: "HERE" });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.match(foreign.error, /isn't in your toolbox/);
  const missingOne = buildTickResult(tools, { t1: "HERE", t2: "HERE", t3: "HERE", t4: "HERE", t5: "HERE" });
  assert.equal(missingOne.ok, false);
  if (!missingOne.ok) assert.match(missingOne.error, /1 still to go/);
  assert.equal(buildTickResult(tools, { ...all, t1: "MAYBE" }).ok, false);
  assert.equal(buildTickResult(tools, null).ok, false);
  assert.equal(buildTickResult(tools, ["t1"]).ok, false);
  assert.equal(buildTickResult(tools, "t1").ok, false);
  const empty = buildTickResult([], {});
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.error, EMPTY_TOOLBOX);
  assert.equal(buildTickResult([], { t1: "HERE" }).ok, false, "a foreign id on an empty toolbox is still refused");
  const huge = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`x${i}`, "HERE"]));
  assert.equal(buildTickResult(tools, huge).ok, false);
});

test("the phone's reply: names and LOB tags, no serial numbers, no money", () => {
  const r = buildTickResult(tools, { ...markAllHere(tools), t2: "MISSING" });
  assert.ok(r.ok);
  if (!r.ok) return;
  const reply = tickReply(r.result);
  assert.ok(!JSON.stringify(reply).includes("SN"), "no serial numbers in the reply");
  assert.equal(reply.missing[0].tag, "LOB-0002");
  assert.ok(linkSafe(reply));
  assert.ok(linkSafe(tickListView(box)));
  assert.ok(!linkSafe({ ...reply, notes: "worth $450" }), "the guard catches a dollar figure");
});
