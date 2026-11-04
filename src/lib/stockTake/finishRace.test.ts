// ST-001 (Ilies approved 4 Nov 2026): finishing is claimed before anything is applied, every line write is conditional
// on the stock take being OPEN, and a finish that stopped part-way resumes. Run against a small in-memory stand-in for
// the database (the where-clauses the store uses), so `npm test` needs no database. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Deps } from "./store";
import { BEING_FINISHED, CANT_CANCEL_FINISHING, FINISH_RUNNING } from "./rules";

type Row = Record<string, unknown>;
const tick = () => new Promise((r) => setImmediate(r));

function matches(row: Row, where: Row, tables: Record<string, Row[]>): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w, tables))) return false; continue; }
    if (k === "stockTake") { const t = tables.stockTake.find((s) => s.id === row.stockTakeId); if (!t || !matches(t, v as Row, tables)) return false; continue; }
    const val = row[k];
    if (v === null) { if (val != null) return false; continue; }
    if (v instanceof Date) { if (!(val instanceof Date) || val.getTime() !== v.getTime()) return false; continue; }
    if (typeof v === "object") {
      const o = v as Row;
      if ("in" in o && !(o.in as unknown[]).includes(val)) return false;
      if ("not" in o && val === o.not) return false;
      if ("lt" in o && !(val instanceof Date && val.getTime() < (o.lt as Date).getTime())) return false;
      continue;
    }
    if (val !== v) return false;
  }
  return true;
}

function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; where?: Row; data?: Row }[] = [];
  const pick = (r: Row | undefined) => (r ? { ...r } : null);
  const table = (name: string) => ({
    findUnique: async (a: { where: Row }) => { await tick(); return pick(tables[name].find((r) => matches(r, a.where, tables))); },
    findFirst: async (a: { where: Row }) => { await tick(); return pick(tables[name].find((r) => matches(r, a.where, tables))); },
    findMany: async (a: { where?: Row } = {}) => { await tick(); return tables[name].filter((r) => matches(r, a.where ?? {}, tables)).map((r) => ({ ...r })); },
    updateMany: async (a: { where: Row; data: Row }) => {
      await tick();
      const hit = tables[name].filter((r) => matches(r, a.where, tables));
      for (const r of hit) for (const [k, v] of Object.entries(a.data)) r[k] = v && typeof v === "object" && "increment" in (v as Row) ? (r[k] as number) + ((v as Row).increment as number) : v;
      writes.push({ table: name, op: "updateMany", where: a.where, data: a.data });
      return { count: hit.length };
    },
    update: async (a: { where: Row; data: Row }) => {
      await tick();
      const r = tables[name].find((x) => matches(x, a.where, tables))!;
      for (const [k, v] of Object.entries(a.data)) r[k] = v && typeof v === "object" && "increment" in (v as Row) ? (r[k] as number) + ((v as Row).increment as number) : v;
      writes.push({ table: name, op: "update", where: a.where, data: a.data });
      return { ...r };
    },
    create: async (a: { data: Row }) => { await tick(); const r = { id: `new${tables[name].length}`, ...a.data }; tables[name].push(r); writes.push({ table: name, op: "create", data: a.data }); return r; },
    deleteMany: async (a: { where: Row }) => { await tick(); const before = tables[name].length; tables[name] = tables[name].filter((r) => !matches(r, a.where, tables)); writes.push({ table: name, op: "deleteMany", where: a.where }); return { count: before - tables[name].length }; },
    count: async (a: { where?: Row } = {}) => { await tick(); return tables[name].filter((r) => matches(r, a.where ?? {}, tables)).length; },
  });
  const db: Row = { stockTake: table("stockTake"), stockTakeLine: table("stockTakeLine"), tool: table("tool"), toolPhoto: table("toolPhoto"), stockTakeScan: table("stockTakeScan") };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db); // the stand-in runs it in place
  return { db, writes };
}

const actor = { id: "u1", name: "Yard", role: "YARD" };
function setup(status = "OPEN", finishedAt: Date | null = null) {
  const tables: Record<string, Row[]> = {
    stockTake: [{ id: "st", status, openKey: "YARD", note: null, scans: 0, finishedAt }],
    stockTakeLine: [
      { id: "lA", stockTakeId: "st", toolId: "tA", tag: "LOB-0001", expected: true, result: "FOUND", conditionSeen: "Needs repair", via: "HAND", movedAt: null, appliedAt: null, decision: null },
      { id: "lB", stockTakeId: "st", toolId: "tB", tag: "LOB-0002", expected: true, result: "NOT_FOUND", conditionSeen: null, via: "HAND", movedAt: null, appliedAt: null, decision: null },
      { id: "lC", stockTakeId: "st", toolId: "tC", tag: "LOB-0003", expected: true, result: "UNCHECKED", conditionSeen: null, via: null, movedAt: null, appliedAt: null, decision: null },
    ],
    tool: [
      { id: "tA", tag: "LOB-0001", condition: "Good", toolboxId: null }, { id: "tB", tag: "LOB-0002", condition: "Good", toolboxId: null },
      { id: "tC", tag: "LOB-0003", condition: "Good", toolboxId: null }, { id: "tD", tag: "LOB-0009", name: "Saw", brand: null, model: null, serialNumber: "999", condition: "Good", toolboxId: "box", toolbox: { name: "Box" } },
    ],
    toolPhoto: [{ id: "p1", kind: "CHECK", fileName: "x.jpg" }],
    stockTakeScan: [],
  };
  const { db, writes } = fakeDb(tables);
  const applied: { toolId: string; body: Row }[] = [];
  let failOn: string | null = null;
  const deps = {
    db, read: async () => ({ items: [], notes: "" }), move: async () => {},
    apply: async (toolId: string, body: Row) => {
      await tick();
      if (failOn === toolId) return { error: "boom", status: 500 };
      applied.push({ toolId, body });
      tables.tool.find((t) => t.id === toolId)!.condition = body.condition;
      return { tool: {} };
    },
  } as unknown as Deps;
  return { tables, writes, applied, deps, failNext: (id: string | null) => { failOn = id; } };
}
const decisions = { missing: ["lB"], leave: ["lC"] };

test("ST-001: two Finish presses at once - one goes ahead (200), the other gets 409, each tool changed once", async () => {
  const { finishStockTake } = await import("./store");
  const f = setup();
  const [a, b] = await Promise.all([finishStockTake("st", decisions, undefined, actor, f.deps), finishStockTake("st", decisions, undefined, actor, f.deps)]);
  const ok = [a, b].filter((x) => "ok" in x);
  const refused = [a, b].filter((x) => "error" in x) as { status: number }[];
  assert.equal(ok.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].status, 409);
  assert.deepEqual(f.applied.map((x) => [x.toolId, x.body.condition]).sort(), [["tA", "Needs repair"], ["tB", "Missing"]]);
  assert.equal(f.tables.stockTake[0].status, "FINISHED");
  assert.equal(f.tables.stockTake[0].openKey, null);
  assert.equal(f.tables.tool.find((t) => t.id === "tC")!.condition, "Good", "left as it is");
});

test("ST-001: a shelf reading that ends after Finish ticks nothing - 409", async () => {
  const { scanShelf } = await import("./store");
  const f = setup();
  // The photo shows LOB-0003 (still to check) and a toolbox tool - but a finish claims the stock take while it's read.
  (f.deps as unknown as Row).read = async () => {
    f.tables.stockTake[0].status = "FINISHING";
    return { items: [{ description: "drill", brand: "", model: "", lobTag: "LOB-0003", serialNumber: "" }, { description: "saw", brand: "", model: "", lobTag: "LOB-0009", serialNumber: "" }], notes: "" };
  };
  const out = await scanShelf("st", ["p1"], actor, f.deps);
  assert.deepEqual(out, { error: BEING_FINISHED, status: 409 });
  assert.equal(f.tables.stockTakeLine.find((l) => l.id === "lC")!.result, "UNCHECKED", "nothing ticked");
  assert.equal(f.tables.stockTakeLine.length, 3, "no extra added");
  assert.ok(!f.writes.some((w) => w.table === "stockTakeLine"), "no line write at all");
});

test("ST-001: ticking, dropping, moving, notes and cancelling are refused while it's being finished", async () => {
  const { lineAction, cancelStockTake, setNote, addExtra, moveExtraToYard, dropExtra } = await import("./store");
  const f = setup("FINISHING", new Date());
  assert.deepEqual(await lineAction("st", "lC", { action: "FOUND" }, actor, f.deps), { error: BEING_FINISHED, status: 409 });
  assert.deepEqual(await cancelStockTake("st", actor, f.deps), { error: CANT_CANCEL_FINISHING, status: 409 });
  assert.equal(((await setNote("st", "x", actor, f.deps)) as { status: number }).status, 409);
  assert.equal(((await addExtra("st", "tD", null, actor, f.deps)) as { status: number }).status, 409);
  assert.equal(((await moveExtraToYard("st", "lA", actor, f.deps)) as { status: number }).status, 409);
  assert.equal(((await dropExtra("st", "lA", f.deps)) as { status: number }).status, 409);
  assert.ok(!f.writes.some((w) => w.table === "stockTakeLine"), "no line write");
});

test("ST-001: a tick whose stock take is claimed between the check and the write matches nothing - 409", async () => {
  const { lineAction } = await import("./store");
  const f = setup();
  const orig = (f.deps.db as unknown as Row).stockTakeLine as Row;
  const findFirst = orig.findFirst as (a: unknown) => Promise<unknown>;
  orig.findFirst = async (a: unknown) => { const r = await findFirst(a); f.tables.stockTake[0].status = "FINISHING"; return r; };
  assert.deepEqual(await lineAction("st", "lC", { action: "FOUND" }, actor, f.deps), { error: BEING_FINISHED, status: 409 });
  assert.equal(f.tables.stockTakeLine.find((l) => l.id === "lC")!.result, "UNCHECKED");
  const w = f.writes.find((x) => x.table === "stockTakeLine")!;
  assert.deepEqual(w.where, { id: "lC", stockTakeId: "st", appliedAt: null, stockTake: { status: "OPEN" } }, "the write itself is conditional on OPEN");
});

test("ST-001: a finish that fails part-way stays FINISHING (claim released); Finish again resumes and applies the rest once", async () => {
  const { finishStockTake, lineAction } = await import("./store");
  const f = setup();
  f.failNext("tB");
  const first = await finishStockTake("st", decisions, undefined, actor, f.deps);
  assert.equal((first as { status: number }).status, 500);
  assert.equal(f.tables.stockTake[0].status, "FINISHING");
  assert.equal(f.tables.stockTake[0].finishedAt, null, "the claim is released so Finish can be pressed again");
  assert.equal(f.tables.stockTake[0].openKey, "YARD", "still holds the yard");
  assert.ok(f.tables.stockTakeLine.find((l) => l.id === "lA")!.appliedAt, "A was applied");
  assert.equal(f.tables.stockTakeLine.find((l) => l.id === "lB")!.appliedAt, null, "B's claim was undone");
  assert.equal(((await lineAction("st", "lA", { action: "UNTICK" }, actor, f.deps)) as { status: number }).status, 409);
  f.failNext(null);
  const again = await finishStockTake("st", decisions, undefined, actor, f.deps);
  assert.ok("ok" in again, JSON.stringify(again));
  assert.deepEqual(f.applied.map((x) => x.toolId), ["tA", "tB"], "A once, then B");
  assert.equal(f.tables.stockTake[0].status, "FINISHED");
});

test("ST-001: a running finish holds its claim - a second Finish is 409 until it's done or its claim runs out", async () => {
  const { finishStockTake } = await import("./store");
  const fresh = setup("FINISHING", new Date());
  assert.deepEqual(await finishStockTake("st", decisions, undefined, actor, fresh.deps), { error: FINISH_RUNNING, status: 409 });
  assert.equal(fresh.applied.length, 0);
  const stale = setup("FINISHING", new Date(Date.now() - 10 * 60_000));
  assert.ok("ok" in (await finishStockTake("st", decisions, undefined, actor, stale.deps)), "a claim from a finish that died is taken over");
});

test("ST-001: a finish refused for undecided tools claims nothing", async () => {
  const { finishStockTake } = await import("./store");
  const f = setup();
  const out = await finishStockTake("st", { missing: [], leave: [] }, undefined, actor, f.deps);
  assert.equal((out as { status: number }).status, 409);
  assert.equal(f.tables.stockTake[0].status, "OPEN");
  assert.equal(f.writes.length, 0);
});
