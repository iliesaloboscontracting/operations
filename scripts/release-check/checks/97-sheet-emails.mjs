// The allocation email list (Ilies, 20 Nov 2026: "add these emails to the automatic email listing when allocations
// goes out into outlook"; the addresses go in To, everyone on the list every day). Checks: only Managers / Admins see
// or change the list (every other login and no login refused); a pasted block is trimmed, lower-cased and deduped,
// invalid addresses refused and named back; removing keeps the row (soft remove, with who / when / why) and adding it
// again makes a new row; the list stops at 100; the addresses never reach a DaySheetSend snapshot or a site link; the
// code makes no outbound call. Made-up example.com addresses only.
// WRITES on the test copy: SheetEmailRecipient rows (all taken off the list again at the end), one DaySheetSend.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const API = "/api/sheet-emails";

export default {
  id: "sheet-emails", title: "Allocation email list: Managers / Admins only, dedupe, soft remove, cap 100, never on a link or a send snapshot",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/sheetEmails/rules.ts") || "needs lib/sheetEmails",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    if (!db.sheetEmailRecipient) return t.block("the copy's Prisma client has no SheetEmailRecipient (schema not pushed)");
    const addr = (n) => `rc-${tag}-${n}@example.com`;
    const add = (who, text) => c.post(API, who, { action: "add", text });
    const list = async (who = "MANAGER") => (await c.json(API, who)).body;

    // (1) Who may see or change the list.
    for (const who of ["COORDINATOR", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"]) {
      t.status(await c.get(API, who), 403, `the list refused for ${who}`);
      t.status(await add(who, addr("x")), 403, `adding refused for ${who}`);
      t.status(await c.post(API, who, { action: "remove", id: "x" }), 403, `removing refused for ${who}`);
    }
    t.status(await c.get(API, null), 401, "the list refused with no login");
    t.status(await add(null, addr("x")), 401, "adding refused with no login");
    t.ok((await db.sheetEmailRecipient.count({ where: { email: addr("x") } })) === 0, "nothing was stored by a refused add");
    t.status(await c.get(API, "MANAGER"), 200, "a Manager sees the list");
    t.status(await c.get(API, "ADMIN"), 200, "an Admin sees the list");

    // (2) A pasted block: 5 entries, one repeated (in another case), one invalid.
    const paste = `  ${addr(1).toUpperCase()} \nRC Two <${addr(2)}>; ${addr(3)}, ${addr(1)}\nnot-an-email@`;
    const r1 = await add("MANAGER", paste);
    t.status(r1, 200, "a Manager adds a pasted block");
    const b1 = await r1.json().catch(() => ({}));
    t.ok(b1.added === 3 && b1.already === 1 && Array.isArray(b1.invalid) && b1.invalid.length === 1, "added 3, already 1, 1 not valid", JSON.stringify({ a: b1.added, al: b1.already, i: b1.invalid?.length }));
    t.ok(/^Added 3, already on the list 1, not valid: not-an-email@$/.test(b1.message ?? ""), "the summary names the invalid one", b1.message);
    const rows = await db.sheetEmailRecipient.findMany({ where: { email: { contains: `rc-${tag}-` } } });
    t.ok(rows.length === 3 && rows.every((r) => r.active && r.activeEmail === r.email && r.email === r.email.toLowerCase().trim()), "three rows, trimmed and lower-cased, active", rows.length);
    t.ok(rows.find((r) => r.email === addr(2))?.label === "RC Two", "a pasted name is kept as the label");
    t.ok(rows.every((r) => !!r.addedBy && !!r.addedAt), "who added each one and when is kept");
    const r2 = await (await add("ADMIN", addr(2))).json().catch(() => ({}));
    t.ok(r2.added === 0 && r2.already === 1, "adding an address already on the list adds nothing", JSON.stringify(r2));
    t.ok((await db.sheetEmailRecipient.count({ where: { email: addr(2) } })) === 1, "...still one row for it");

    // (3) Invalid addresses refused (nothing stored).
    const bad = ["plainword", "a@b", "two@@example.com", "sp ace@example.com", `rc-${tag}..dots@example.com`, `<rc-${tag}@example.com`];
    const rb = await (await add("MANAGER", bad.join("\n"))).json().catch(() => ({}));
    t.ok(rb.added === 0 && rb.invalid?.length === bad.length, "every invalid address refused and named back", JSON.stringify({ a: rb.added, i: rb.invalid?.length }));
    t.status(await c.post(API, "MANAGER", { action: "add", text: Array.from({ length: 301 }, (_, i) => addr(`p${i}`)).join("\n") }), 400, "more than 300 at once is refused");

    // (4) Soft remove: kept, with who / when / why; off the list; adding again makes a new row, the old one stays.
    const two = rows.find((r) => r.email === addr(2));
    t.status(await c.post(API, "MANAGER", { action: "remove", id: "no-such-id" }), 404, "removing an unknown id -> 404");
    t.status(await c.post(API, "MANAGER", { action: "remove", id: two?.id, reason: "left the company" }), 200, "a Manager removes one");
    t.status(await c.post(API, "ADMIN", { action: "remove", id: two?.id }), 409, "removing it twice -> 409");
    const gone = await db.sheetEmailRecipient.findUnique({ where: { id: two?.id ?? "-" } });
    t.ok(!!gone && gone.active === false && gone.activeEmail === null && !!gone.removedAt && !!gone.removedBy && gone.removedReason === "left the company", "the row is kept, marked removed, with who / when / why");
    const l1 = await list();
    t.ok(!l1.active.some((r) => r.email === addr(2)) && l1.removed.some((r) => r.email === addr(2)), "it shows under Removed, not on the list");
    t.status(await add("ADMIN", addr(2)), 200, "an Admin puts it back");
    const both = await db.sheetEmailRecipient.findMany({ where: { email: addr(2) }, orderBy: { addedAt: "asc" } });
    t.ok(both.length === 2 && both[0].active === false && both[1].active === true, "put back = a new row; the removed one is kept", both.length);
    const l2 = await list();
    t.ok(l2.active.some((r) => r.email === addr(2)) && !l2.removed.some((r) => r.email === addr(2)), "back on the list, no longer under Removed");

    // (5) The cap: 100 active addresses.
    const room = 100 - l2.active.length;
    t.ok(l2.max === 100, "the list says it holds 100", l2.max);
    if (room > 0) t.status(await add("MANAGER", Array.from({ length: room }, (_, i) => addr(`f${i}`)).join("\n")), 200, `filling the list to 100 (${room} more)`);
    t.ok((await db.sheetEmailRecipient.count({ where: { active: true } })) === 100, "the list holds 100");
    const over = await add("MANAGER", addr("over"));
    t.status(over, 409, "a 101st address is refused");
    t.ok(/holds 100/.test(JSON.stringify(await over.json().catch(() => ({})))), "...saying the list holds 100");
    t.ok((await db.sheetEmailRecipient.count({ where: { email: addr("over") } })) === 0, "...and nothing is stored");
    const r100 = await (await add("MANAGER", addr(1))).json().catch(() => ({}));
    t.ok(r100.added === 0 && r100.already === 1, "re-pasting one already on a full list is fine", JSON.stringify(r100));

    // (6) Never in a DaySheetSend snapshot or on a site link.
    const send = await c.post("/api/board/sends", "MANAGER", { date: c.today, how: "EMAIL" });
    t.status(send, [201, 429], "the board records an email send");
    const latest = await db.daySheetSend.findFirst({ orderBy: { sentAt: "desc" } });
    const sendText = JSON.stringify(latest ?? {}) + JSON.stringify(await send.json().catch(() => ({})));
    t.ok(!sendText.includes("@example.com") && !sendText.includes(`rc-${tag}`), "no address in the send record or its reply");
    const linkReplies = [];
    for (const l of [c.links?.sup, c.links?.office].filter(Boolean)) {
      for (const p of [c.site(l), c.sitePage(l)]) linkReplies.push((await c.text(p, null)).text);
    }
    if (!linkReplies.length) t.note("no site links in the snapshot - link replies not checked");
    t.ok(linkReplies.every((x) => !x.includes(`rc-${tag}`) && !x.includes("@example.com")), "no address on a supervisor / office link", linkReplies.length);
    const src = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    const walk = (rel) => {
      const dir = path.join(c.p.appDir, rel), out = [];
      const go = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) go(f); else if (/\.tsx?$/.test(e.name)) out.push(readFileSync(f, "utf8")); } };
      try { go(dir); } catch { /* missing */ }
      return out;
    };
    const linkSrc = [...walk("src/app/site"), ...walk("src/app/api/site"), ...walk("src/lib/boardGuard")];
    t.ok(linkSrc.length > 0 && linkSrc.every((s) => !/sheetEmail|SheetEmail/.test(s)), "no site-link or send-record code reads the list", linkSrc.length);

    // (7) No outbound call: the list's code fetches nothing (the run's no-outbound check covers the server as a whole).
    const own = [src("src/lib/sheetEmails/rules.ts"), src("src/lib/sheetEmails/store.ts"), src("src/app/api/sheet-emails/route.ts")];
    t.ok(own.every((s) => s && !/\bfetch\(|https?:\/\/|node:http|node:net|require\(["']https?/.test(s.replace(/\/\/[^\n]*/g, ""))), "the list's server code makes no outbound call");
    t.ok(!/console\.(log|info|warn|error)/.test(own.join("\n")), "the list's server code logs nothing");

    // Tidy: take off everything this check added, so later checks see an empty list.
    for (const r of await db.sheetEmailRecipient.findMany({ where: { active: true, email: { contains: `rc-${tag}-` } } }))
      await c.post(API, "MANAGER", { action: "remove", id: r.id, reason: "release check tidy-up" });
    t.ok((await db.sheetEmailRecipient.count({ where: { active: true, email: { contains: `rc-${tag}-` } } })) === 0, "tidied: this check's addresses are off the list (rows kept)");
  },
};
