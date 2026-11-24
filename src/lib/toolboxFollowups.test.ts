// Security follow-ups on the toolbox tick list (Ilies approved TT-001, TT-002, TT-003 + TT-005, 25 Nov 2026). `npm test`.
//   TT-001 - the Toolboxes page's last check says whether it was ticked or a photo check, and the last photo check.
//   TT-002 - "Mark missing" is recorded in the tool's change history: the link's person, the link, the check.
//   TT-003 - at most 20 tick checks a Sydney day per link; the 21st is 429 before anything is written.
//   TT-005 - the tick check's ToolboxCheck and SiteSubmission are saved in one transaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkMethod, lastCheckOf, lastCheckText } from "./toolboxLastCheck";
import { TICK_DAILY_LIMIT, TICK_LIMIT_MESSAGE, buildTickResult, markMissingSource, tickLimitReached } from "./toolboxTick";

const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const tools = [1, 2, 3].map((n) => ({ id: `t${n}`, tag: `LOB-000${n}`, name: `Tool ${n}`, serialNumber: `SN${n}` }));
const tick = buildTickResult(tools, { t1: "HERE", t2: "HERE", t3: "MISSING" });
if (!tick.ok) throw new Error("tick result");
const photo = { present: [{ toolId: "t1", tag: "LOB-0001", name: "Tool 1", serialNumber: "SN1", how: "tag" }], presentUnconfirmed: [], missing: [], foreign: [{ toolId: "t9" }], unknown: [], notes: "" };

test("TT-001: the method comes from the stored result - method TICK, or a line marked how: tick", () => {
  assert.equal(checkMethod(tick.result), "TICK");
  assert.equal(checkMethod({ ...tick.result, method: undefined }), "TICK", "an older tick record without method still reads as ticked");
  assert.equal(checkMethod(photo), "PHOTO");
  assert.equal(checkMethod(null), "PHOTO");
  assert.equal(checkMethod("x"), "PHOTO");
});

test("TT-001: lastCheck carries the method; a ticked one also carries the last photo check", () => {
  const at = new Date("2026-11-25T02:00:00Z");
  const t = lastCheckOf({ id: "c1", createdAt: at, checkedBy: "Pol (site)", result: JSON.stringify(tick.result) }, new Date("2026-11-18T02:00:00Z"));
  assert.equal(t?.method, "TICK");
  assert.equal(t?.missing, 1);
  assert.equal(t?.foreign, 0);
  assert.equal(new Date(t!.lastPhotoCheckAt!).toISOString(), "2026-11-18T02:00:00.000Z");
  const p = lastCheckOf({ id: "c2", createdAt: at, checkedBy: null, result: JSON.stringify(photo) }, at);
  assert.equal(p?.method, "PHOTO");
  assert.equal(p?.foreign, 1);
  assert.ok(!("lastPhotoCheckAt" in p!), "a photo check doesn't repeat itself");
  assert.equal(lastCheckOf(null), null);
  const broken = lastCheckOf({ id: "c3", createdAt: at, checkedBy: null, result: "not json" });
  assert.equal(broken?.method, "PHOTO");
});

test("TT-001: the page line says (ticked) or (photo), and 'last photo check' after a ticked one", () => {
  const at = new Date("2026-11-25T02:00:00Z");
  const t = lastCheckOf({ id: "c1", createdAt: at, checkedBy: "Pol (site)", result: JSON.stringify(tick.result) }, new Date("2026-11-18T02:00:00Z"));
  assert.equal(lastCheckText(t), "last checked 25 Nov (ticked) by Pol (site) — 1 missing, 0 from other boxes · last photo check: 18 Nov");
  const never = lastCheckOf({ id: "c1", createdAt: at, checkedBy: null, result: JSON.stringify({ ...tick.result, missing: [] }) }, null);
  assert.equal(lastCheckText(never), "last checked 25 Nov (ticked) — all good · last photo check: never");
  const p = lastCheckOf({ id: "c2", createdAt: at, checkedBy: "Office", result: JSON.stringify(photo) });
  assert.equal(lastCheckText(p), "last checked 25 Nov (photo) by Office — 0 missing, 1 from other boxes");
  assert.equal(lastCheckText(null), "never checked");
});

test("TT-001: the Toolboxes route and page use it (source)", () => {
  const route = src("src/app/api/toolboxes/route.ts");
  assert.match(route, /lastCheckOf\(checks\[0\], lastPhoto\.get\(b\.id\)/);
  assert.match(route, /photoIds: \{ not: "\[\]" \}/, "the last photo check is one with photos");
  assert.match(src("src/app/tools/toolboxes/page.tsx"), /\{lastCheckText\(last\)\}/);
  assert.match(src("src/lib/types.ts"), /method: "TICK" \| "PHOTO"/);
});

test("TT-002: the history source names the link and the check", () => {
  assert.equal(markMissingSource("link1", "check1"), "Marked missing from a toolbox check on a site link (link link1, check check1)");
  assert.match(markMissingSource("link1", null), /check none/);
  assert.ok(markMissingSource("c".repeat(30), "c".repeat(30)).length <= 160, "fits RecordChange.source");
});

test("TT-002: Mark missing goes through the change history, after the own-toolbox check (source)", () => {
  const route = src("src/app/api/site/[token]/submit/route.ts");
  const store = src("src/lib/toolboxTickStore.ts");
  const missing = route.slice(route.indexOf('if (body.action === "MISSING")'));
  assert.ok(!/prisma\.tool\.update\(/.test(route), "no untracked tool update left in the route");
  const own = missing.indexOf("tool.toolboxId !== box.id");
  const which = missing.indexOf("checkIdFor(link.id, box.id, body.checkId)");
  const mark = missing.indexOf("markToolMissing(tool.id, { name, linkId: link.id, checkId })");
  assert.ok(own > 0 && own < which && which < mark, "another box's tool is refused before anything is read or written");
  assert.match(missing, /if \(checkId === false\) return bad\(/, "a check from another link is refused");
  assert.match(store, /updateTracked\("Tool", toolId, \{ condition: "Missing" \}, \{ by: \{ id: null, name: who\.name \}, source: markMissingSource\(who\.linkId, who\.checkId\) \}\)/);
  assert.match(store, /siteLinkId: linkId, toolboxId, kind: "CHECK", checkId: given/, "a given check id must be this link's check of this box");
  assert.match(src("src/components/site/ToolboxTickList.tsx"), /action: "MISSING", toolId, toolboxId: view\.id, checkId \}/);
  assert.match(src("src/app/site/[token]/page.tsx"), /action: kind, toolId, toolboxId: boxId, checkId \}/);
});

test("TT-003: 20 tick checks a day per link; the 21st is refused", () => {
  assert.equal(TICK_DAILY_LIMIT, 20);
  assert.equal(tickLimitReached(0), false);
  assert.equal(tickLimitReached(19), false, "the 20th still goes");
  assert.equal(tickLimitReached(20), true, "the 21st doesn't");
  assert.equal(TICK_LIMIT_MESSAGE, "That's a lot of toolbox checks today - call the office.");
});

test("TT-003 + TT-005: counted per link from Sydney midnight, before the writes, all in one transaction (source)", () => {
  const store = src("src/lib/toolboxTickStore.ts");
  const fn = store.slice(store.indexOf("export async function saveTickCheck"), store.indexOf("export async function checkIdFor"));
  assert.match(fn, /return prisma\.\$transaction\(async \(tx\) => \{\s*await writeLock\(tx\);/);
  const count = fn.indexOf("tx.siteSubmission.count({ where: TICK_SUBMISSION(linkId, sydneyMidnight()) })");
  const limited = fn.indexOf("if (tickLimitReached(today)) return { limited: true as const }");
  const check = fn.indexOf("tx.toolboxCheck.create(");
  const sub = fn.indexOf("tx.siteSubmission.create(");
  assert.ok(count > 0 && count < limited && limited < check && check < sub, "count, refuse, then both writes");
  assert.ok(!/prisma\.(toolboxCheck|siteSubmission)\.create/.test(fn), "both writes inside the transaction");
  assert.match(store, /siteLinkId: linkId, kind: "CHECK", photoIds: "\[\]", createdAt: \{ gte: since \}/, "only this link's tick checks count");
  assert.match(store, /fromSydneyLocal\(`\$\{todaySydney\(\)\}T00:00`\)/, "the Sydney day");
  const route = src("src/app/api/site/[token]/submit/route.ts");
  assert.match(route, /if \(saved\.limited\) return bad\(TICK_LIMIT_MESSAGE, 429\);/);
  const tickFn = route.slice(route.indexOf("async function tickCheck"), route.indexOf("async function checkAction"));
  assert.ok(!/prisma\.\w+\.(create|update)/.test(tickFn), "the route itself writes nothing for a tick check");
});
