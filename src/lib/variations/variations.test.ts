// Variation / Day docket (Ilies approved 25 Nov 2026): the hours maths, what a phone may send (amounts refused), the
// signature bytes, the docket number (also with several phones at once), the role walls, that a sent docket has no
// update / delete path, and that the phone alert goes to the coordinator and the owner only with no money. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  LIMITS, TICKS, UNITS, alertRecipients, allocateNumber, clockMinutes, currentStatus, docketNo, hasMoney, linkMayFill, linkSafe, mayReadVariations,
  parseDocket, parseDocketNo, signedAlert, spanHours, statusChange, taskHours, totalHours, variationsOn,
} from "./rules";
import { checkPng, parseSignature } from "./signature";
import { COORDINATOR_PAGES, ROLES, YARD_PAGES, isCoordinatorPage, isYardPage } from "../roles";
import { OWNER_EMAIL } from "../owner";
import { assertNoMoney } from "../moneyGuard";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const id = (n: number) => `cm${String(n).padStart(23, "0")}`;
const good = (x: Record<string, unknown> = {}) => ({
  jobId: id(1), ticks: ["VARIATION"], tasks: [{ description: "Strip out extra partition wall, level 2", men: 3, start: "07:00", finish: "10:30" }],
  items: [{ quantity: 6, unit: "M3", type: "Mixed waste", comment: "two skips" }], note: "", photoIds: [],
  customerName: "Sam Client", customerPosition: "Site manager", customerSignature: PNG, lobosPosition: "Supervisor", lobosSignature: PNG, ...x,
});
const err = (x: unknown) => (x && typeof x === "object" && "error" in x ? (x as { error: string }).error : null);

// ---------- hours ----------

test("hours: start to finish x men, over midnight, the same time twice is no time", () => {
  assert.equal(clockMinutes("07:30"), 450);
  assert.equal(clockMinutes("7:05"), 425);
  assert.equal(clockMinutes("24:00"), null);
  assert.equal(clockMinutes("07:60"), null);
  assert.equal(clockMinutes("7am"), null);
  assert.equal(spanHours("07:00", "10:30"), 3.5);
  assert.equal(spanHours("22:00", "06:00"), 8, "a night shift runs past midnight");
  assert.equal(spanHours("07:00", "07:00"), null);
  assert.equal(spanHours("07:00", null), null);
  assert.equal(taskHours({ men: 3, start: "07:00", finish: "10:30" }), 10.5, "3 men x 3.5 h");
  assert.equal(taskHours({ men: null, start: "07:00", finish: "10:15" }), 3.25, "no men given = 1");
  assert.equal(taskHours({ men: 2, start: "23:30", finish: "01:00" }), 3);
  assert.equal(taskHours({ men: 2, start: "", finish: "" }), null);
  assert.equal(totalHours([{ hours: 10.5 }, { hours: null }, { hours: 3.25 }]), 13.75);
});

test("the server works the hours out itself; an edited total is kept, within reason", () => {
  const ok = parseDocket(good());
  assert.ok(!err(ok));
  if (!err(ok)) {
    const t = (ok as Exclude<ReturnType<typeof parseDocket>, { error: string }>).tasks[0];
    assert.deepEqual([t.hoursCalc, t.hours], [10.5, 10.5], "nothing typed: the worked-out hours");
  }
  const edited = parseDocket(good({ tasks: [{ description: "Extra cut", men: 2, start: "07:00", finish: "09:00", hours: 3.5 }] })) as { tasks: { hours: number; hoursCalc: number }[] };
  assert.deepEqual([edited.tasks[0].hoursCalc, edited.tasks[0].hours], [4, 3.5], "the edited total is sent, the worked-out one kept beside it");
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Extra cut", men: 2, hours: 49 }] }))), "more than 24 h a man");
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Extra cut", hours: 0 }] }))));
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Extra cut", hours: -1 }] }))));
  assert.ok(!err(parseDocket(good({ tasks: [{ description: "Extra cut", hours: 6 }] }))), "hours with no times is fine");
});

// ---------- validation ----------

test("a docket needs the job, a tick, a row, the client's name and both signatures", () => {
  assert.equal(err(parseDocket(good({ jobId: "" }))), "Which job is it for?");
  assert.equal(err(parseDocket(good({ jobId: "../../etc/passwd" }))), "Which job is it for?");
  assert.equal(err(parseDocket(good({ ticks: [] }))), "Tick what the docket is for.");
  assert.ok(err(parseDocket(good({ ticks: ["VARIATION", "GOLD"] }))), "a tick that isn't on the paper");
  assert.equal(err(parseDocket(good({ ticks: ["OTHER"] }))), "Say what \"Other\" is.");
  assert.ok(!err(parseDocket(good({ ticks: ["OTHER"], otherText: "Traffic control" }))));
  assert.equal(err(parseDocket(good({ tasks: [], items: [] }))), "Add a task, or the equipment / materials used.");
  assert.ok(!err(parseDocket(good({ tasks: [] }))), "items only is fine");
  assert.ok(!err(parseDocket(good({ items: [] }))), "tasks only is fine");
  assert.equal(err(parseDocket(good({ customerName: " " }))), "The client's name.");
  assert.equal(err(parseDocket(good({ customerSignature: null }))), "The client needs to sign first.", "Send is refused until the client has signed");
  assert.equal(err(parseDocket(good({ customerSignature: "data:image/jpeg;base64,/9j/" }))), "The client needs to sign first.");
  assert.ok(err(parseDocket(good({ lobosSignature: "" }))), "the Lobos signature too");
  const ok = parseDocket(good({ ticks: ["RUBBISH", "VARIATION"] })) as { ticks: string[] };
  assert.deepEqual(ok.ticks, ["VARIATION", "RUBBISH"], "ticks kept in the paper's order");
  assert.deepEqual(TICKS.map((t) => t.key), ["VARIATION", "LABOUR_HIRE", "MATERIALS", "RUBBISH", "TOOL_HIRE", "OTHER"]);
  assert.deepEqual(UNITS.map((u) => u.key), ["M3", "EACH", "HRS", "OTHER"]);
});

test("lengths, times and row counts are capped", () => {
  const task = { description: "Remove ceiling", start: "07:00", finish: "08:00" };
  assert.ok(err(parseDocket(good({ tasks: Array(LIMITS.tasks + 1).fill(task) }))), "too many task rows");
  assert.ok(!err(parseDocket(good({ tasks: Array(LIMITS.tasks).fill(task) }))));
  assert.ok(err(parseDocket(good({ items: Array(LIMITS.items + 1).fill({ type: "Bin" }) }))), "too many item rows");
  assert.ok(err(parseDocket(good({ tasks: [{ description: "x".repeat(LIMITS.description + 1) }] }))));
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Remove ceiling", start: "7am", finish: "9am" }] }))), "a time like 07:30");
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Remove ceiling", start: "07:00" }] }))), "both times or neither");
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Remove ceiling", start: "07:00", finish: "07:00" }] }))));
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Remove ceiling", men: 51 }] }))));
  assert.ok(err(parseDocket(good({ tasks: [{ description: "Remove ceiling", men: 1.5 }] }))));
  assert.ok(err(parseDocket(good({ items: [{ type: "Bin", quantity: -1 }] }))));
  assert.ok(err(parseDocket(good({ items: [{ type: "Bin", quantity: "lots" }] }))));
  assert.ok(err(parseDocket(good({ items: [{ type: "Bin", unit: "TONNES" }] }))));
  assert.ok(err(parseDocket(good({ items: [{ type: "" }] }))));
  assert.ok(err(parseDocket(good({ customerName: "x".repeat(LIMITS.name + 1) }))));
  assert.ok(err(parseDocket(good({ note: "x".repeat(LIMITS.note + 1) }))));
  assert.ok(err(parseDocket(good({ photoIds: Array.from({ length: LIMITS.photos + 1 }, (_, i) => id(100 + i)) }))));
  assert.ok(err(parseDocket(good({ photoIds: ["not an id!"] }))));
  const tidy = parseDocket(good({ customerName: "  Sam \u0007 Client  ", tasks: [{ description: "Line one\r\n\r\n\r\n\r\nLine two\u0000" }] })) as { customerName: string; tasks: { description: string }[] };
  assert.equal(tidy.customerName, "Sam Client");
  assert.equal(tidy.tasks[0].description, "Line one\n\nLine two");
});

test("no amount anywhere on the docket - a $ figure or a money phrase is refused", () => {
  for (const [field, x] of [
    ["task description", { tasks: [{ description: "Extra wall $450" }] }],
    ["task description (words)", { tasks: [{ description: "Extra wall, 450 dollars agreed" }] }],
    ["task description (k)", { tasks: [{ description: "quote of 2k for the extra" }] }],
    ["item type", { items: [{ type: "Skip bin $380" }] }],
    ["item comment", { items: [{ type: "Skip bin", comment: "charge AUD 200" }] }],
    ["note", { note: "Client agreed to pay $1,200" }],
    ["other", { ticks: ["OTHER"], otherText: "Traffic control $90/hr" }],
    ["client's name", { customerName: "Sam $5" }],
    ["position", { customerPosition: "PM ($)" }],
    ["full-width dollar", { note: "＄300" }],
  ] as const) {
    assert.match(err(parseDocket(good(x as Record<string, unknown>))) ?? "", /Leave prices and amounts off/, field);
  }
  assert.ok(!err(parseDocket(good({ tasks: [{ description: "Removed 3 bins of plasterboard, 2 men, level 4" }], note: "Job 26_171, gate 2" }))), "plain numbers are fine");
  assert.ok(hasMoney("$5") && hasMoney("five hundred dollars") && !hasMoney("5 men 3 hours"));
});

test("a correction names the docket it replaces", () => {
  assert.equal((parseDocket(good({ replaces: "V-0012" })) as { replaces: number }).replaces, 12);
  assert.equal((parseDocket(good({ replaces: "" })) as { replaces: number | null }).replaces, null);
  assert.ok(err(parseDocket(good({ replaces: "twelve" }))));
  assert.equal(parseDocketNo("v12"), 12);
  assert.equal(parseDocketNo(" V - 0007 "), 7);
  assert.equal(parseDocketNo("0"), null);
  assert.equal(parseDocketNo("V-12a"), null);
});

// ---------- signatures ----------

test("a signature must be a real PNG by its own bytes, and small", () => {
  const s = parseSignature(PNG, "client");
  assert.ok(!err(s));
  if (!err(s)) assert.equal((s as { width: number }).width, 1);
  assert.ok(err(parseSignature("data:image/png;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQ", "client")), "a JPEG labelled PNG");
  assert.ok(err(parseSignature("data:image/png;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64"), "client")), "SVG / HTML labelled PNG");
  assert.ok(err(parseSignature("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9aw", "client")), "cut short (no IEND)");
  assert.ok(err(parseSignature("data:image/png;base64,iVBOR w0KGgo=", "client")), "not clean base64");
  const raw = Buffer.from(PNG.slice(22), "base64");
  const big = Buffer.concat([raw.subarray(0, raw.length - 12), Buffer.alloc(LIMITS.signatureBytes), raw.subarray(raw.length - 12)]);
  assert.match(err(parseSignature("data:image/png;base64," + big.toString("base64"), "Lobos")) ?? "", /too big/);
  const wide = Buffer.from(raw); wide.writeUInt32BE(5000, 16);
  assert.ok(err(checkPng(wide)), "an odd size");
});

// ---------- docket numbers ----------

test("docket numbers: V-0001 style, one more than the highest, the unique index decides", async () => {
  assert.equal(docketNo(1), "V-0001");
  assert.equal(docketNo(12), "V-0012");
  assert.equal(docketNo(12345), "V-12345");
  const taken = new Set<number>();
  const got = await allocateNumber(async () => Math.max(0, ...taken), async (n) => { taken.add(n); return n; });
  assert.deepEqual(got, { number: 1, row: 1 });
});

test("docket numbers with several phones sending at once: every one different, no gaps", async () => {
  // A fake table: reading the highest and writing a row each take a moment, so phones read the same highest and
  // collide; the duplicate is refused the way SQLite's unique index refuses it (P2002) and the loser tries again.
  const rows = new Set<number>();
  const pause = () => new Promise((r) => setTimeout(r, Math.random() * 4));
  const highest = async () => { await pause(); return Math.max(0, ...rows); };
  const create = async (n: number) => {
    await pause();
    if (rows.has(n)) throw Object.assign(new Error("Unique constraint failed on the fields: (`number`)"), { code: "P2002" });
    rows.add(n);
    return n;
  };
  const got = await Promise.all(Array.from({ length: 10 }, () => allocateNumber(highest, create)));
  const nums = got.map((g) => g.number).sort((a, b) => a - b);
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // Any other database error is not retried.
  await assert.rejects(allocateNumber(async () => 0, async () => { throw Object.assign(new Error("disk"), { code: "P1001" }); }), /disk/);
  // The store sends one at a time on top of this (the docket number index is only the backstop).
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /const made = await serial\(/);
  assert.match(store, /allocateNumber\(/);
  const schema = readFileSync(path.join(__dirname, "..", "..", "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /model VariationDocket \{[\s\S]*?number\s+Int\s+@unique/);
});

// ---------- the role walls ----------

test("who reads /variations: Managers, Admins and the coordinator - nobody else", () => {
  const yes = ROLES.filter((r) => mayReadVariations(r));
  assert.deepEqual(yes.sort(), ["ADMIN", "COORDINATOR", "MANAGER"]);
  for (const r of ["VIEWER", "ACCOUNTS", "TIMESHEETS", "YARD", "DIRECTOR", "", "OWNER", "admin"]) assert.equal(mayReadVariations(r), false, r);
  assert.ok((COORDINATOR_PAGES as readonly string[]).includes("/variations"));
  assert.ok(isCoordinatorPage("/variations?status=TO_PRICE") && isCoordinatorPage("/variations/abc123"));
  assert.ok(!isCoordinatorPage("/variations/abc/edit"));
  assert.ok(!(YARD_PAGES as readonly string[]).includes("/variations") && !isYardPage("/variations"), "never the yard");
  const auth = readFileSync(path.join(__dirname, "..", "auth.ts"), "utf8");
  assert.match(auth, /export async function guardVariations\(\)[\s\S]*?mayReadVariations\(user\.role\)/);
});

test("which links fill one in: a person's SUPERVISOR or HANDOVER link - never DRIVER, POSTER, OFFICE or a shared link", () => {
  const p = { id: id(9) };
  assert.ok(linkMayFill({ kind: "SUPERVISOR", shared: false, person: p }));
  assert.ok(linkMayFill({ kind: "HANDOVER", shared: false, person: p }));
  assert.ok(!linkMayFill({ kind: "OFFICE", shared: false, person: p }));
  assert.ok(!linkMayFill({ kind: "OFFICE", shared: true, person: { id: null } }), "the yard's shared link");
  assert.ok(!linkMayFill({ kind: "DRIVER", shared: false, person: p }));
  assert.ok(!linkMayFill({ kind: "POSTER", shared: false, person: p }));
  assert.ok(!linkMayFill({ kind: "SUPERVISOR", shared: false, person: { id: null } }));
});

// ---------- a sent docket is never changed ----------

const filesUnder = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts")) out.push(f); } };
  try { walk(dir); } catch { /* missing */ }
  return out;
};
test("immutable: no update or delete of a docket, its rows, its signatures or a status event - anywhere", () => {
  const src = path.join(__dirname, "..", "..");
  const all = filesUnder(src);
  const bad = all.filter((f) => /\bvariation(Docket|Task|Item|Signature|StatusEvent)\.(update|updateMany|upsert|delete|deleteMany)\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad.map((f) => path.relative(src, f)), [], "no file updates or deletes a variation row");
  const routes = [...filesUnder(path.join(src, "app", "api", "variations")), ...filesUnder(path.join(src, "app", "api", "site", "[token]", "variation"))];
  assert.ok(routes.length >= 6, `${routes.length} route files`);
  for (const f of routes) assert.doesNotMatch(readFileSync(f, "utf8"), /export const (PATCH|PUT|DELETE)\b|export async function (PATCH|PUT|DELETE)\b/, path.relative(src, f));
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /variationStatusEvent\.create\(/, "a status change is a new event");
  // Nothing in the feature touches hours anywhere else.
  for (const f of filesUnder(__dirname)) assert.doesNotMatch(readFileSync(f, "utf8"), /prisma\.(siteAttendance|jobActual|allocationCost|timesheetWeek|assignment)\.(create|update|upsert|delete)/, path.basename(f));
});

test("the office status: forward any time, back a step with a reason, never the same, a stale page is told", () => {
  assert.equal(currentStatus([]), "TO_PRICE");
  assert.equal(currentStatus([{ status: "PRICED", createdAt: new Date(1) }, { status: "SENT_TO_CLIENT", createdAt: new Date(3) }, { status: "TO_PRICE", createdAt: new Date(2) }]), "SENT_TO_CLIENT");
  assert.deepEqual(statusChange("TO_PRICE", { status: "PRICED", from: "TO_PRICE" }), { to: "PRICED", note: null });
  assert.deepEqual(statusChange("TO_PRICE", { status: "SENT_TO_CLIENT" }), { to: "SENT_TO_CLIENT", note: null });
  assert.ok(err(statusChange("PRICED", { status: "PRICED" })));
  assert.match(err(statusChange("PRICED", { status: "TO_PRICE" })) ?? "", /why/);
  assert.deepEqual(statusChange("PRICED", { status: "TO_PRICE", note: "priced the wrong job" }), { to: "TO_PRICE", note: "priced the wrong job" });
  assert.match(err(statusChange("PRICED", { status: "SENT_TO_CLIENT", from: "TO_PRICE" })) ?? "", /Someone changed it/);
  assert.ok(err(statusChange("TO_PRICE", { status: "PRICED", note: "priced at $4,500" })), "no amounts in the note");
  assert.ok(err(statusChange("TO_PRICE", { status: "PAID" })));
});

// ---------- the phone alert ----------

test("the alert: \"Variation V-0012 signed - <project> (<supervisor>)\", opens the docket, no money", () => {
  const a = signedAlert({ id: id(5), number: 12, projectName: "Bondi Rd strip-out", supervisor: "Pol Tuilagi" });
  assert.ok(a);
  assert.equal(a!.title, "Variation docket signed");
  assert.equal(a!.body, "Variation V-0012 signed - Bondi Rd strip-out (Pol Tuilagi)");
  assert.equal(a!.url, `/variations/${id(5)}`);
  assert.ok(assertNoMoney(JSON.stringify(a)));
  const priced = signedAlert({ id: id(5), number: 3, projectName: "$450 Coogee job", supervisor: "Pol" });
  assert.ok(priced && !priced.body.includes("$") && assertNoMoney(JSON.stringify(priced)), "a dollar figure in the project name is taken out");
});

test("the alert goes to the active coordinator login(s) and the owner - nobody else", () => {
  const users = [
    { id: "coord", role: "COORDINATOR", email: "alex@loboscontracting.com.au", active: true },
    { id: "coord-off", role: "COORDINATOR", email: "old@loboscontracting.com.au", active: false },
    { id: "owner", role: "ADMIN", email: OWNER_EMAIL.toUpperCase(), active: true },
    { id: "admin", role: "ADMIN", email: "nick@loboscontracting.com.au", active: true },
    { id: "manager", role: "MANAGER", email: "m@loboscontracting.com.au", active: true },
    { id: "viewer", role: "VIEWER", email: "v@loboscontracting.com.au", active: true },
    { id: "director", role: "DIRECTOR", email: "d@loboscontracting.com.au", active: true },
    { id: "accounts", role: "ACCOUNTS", email: "accounts@loboscontracting.com.au", active: true },
  ];
  assert.deepEqual(alertRecipients(users, OWNER_EMAIL).sort(), ["coord", "owner"]);
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /alertRecipients\(users, OWNER_EMAIL\)/);
  assert.match(store, /pushToUsers\(to, msg/);
  assert.doesNotMatch(store, /pushToAdmins|pushToSiteLinks/, "never every Admin, never a site link");
  assert.match(store, /void alertSigned\(made\.id\)/, "sent after the docket is saved, never holding up the send");
});

test("the kill switch VARIATION_DOCKETS=off; a link reply is checked for money", () => {
  assert.equal(variationsOn({}), true);
  assert.equal(variationsOn({ VARIATION_DOCKETS: "on" }), true);
  assert.equal(variationsOn({ VARIATION_DOCKETS: "off" }), false);
  assert.equal(variationsOn({ VARIATION_DOCKETS: " OFF " }), false);
  assert.ok(linkSafe({ jobs: [{ label: "Bondi Rd" }] }));
  assert.ok(!linkSafe({ note: "$500" }));
  // Every route answers the kill switch first.
  const src = path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "variation");
  for (const f of filesUnder(src)) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /if \(!variationsOn\(\)\) return/, path.basename(path.dirname(f)));
    assert.match(s, /resolveVariationLink\(/);
  }
});
