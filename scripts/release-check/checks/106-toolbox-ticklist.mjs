// "Check my toolbox" as a tick list (Ilies, 25 Nov 2026: "this needs to be changed. what this should display is the
// list of tools 'belonging to Pol, Toolbox'" - he chose "List + tick each one").
//   (1) The list: a supervisor's link reply lists exactly that toolbox's active tools (not retired, not swapped out),
//       and the empty toolbox shows no tools; no $ in any link reply.
//   (2) A tick check saves a ToolboxCheck exactly like the photo check: present = Here, missing = Missing, no photos,
//       method TICK, plus the CHECK SiteSubmission - so the office sees the missing tools on From site
//       (/api/site-submissions) and the Toolboxes page's last check (/api/toolboxes) the same way; "Mark missing"
//       afterwards (CHECK_ACTION, as after a photo check) marks the tool Missing on the register. The phone's reply
//       carries names and LOB tags only (no serial numbers) and no $.
//   (3) Refused, nothing saved: a tool id from another toolbox or made up (400), a tool left unmarked (400), another
//       supervisor's toolbox (400), an empty toolbox (400); the hand-over and office links (403); driver, poster,
//       switched-off and made-up links (404).
//   (4) The photo path still works: a CHECK photo uploads (201), no photos -> 400, a photo -> 503 (reading needs the
//       Claude key, not on the copy - no outbound call). The page keeps the photo check behind "Use photos instead".
//   (5) No outbound call.
//   Security follow-ups (Ilies approved 25 Nov 2026):
//   TT-001 the Toolboxes page's lastCheck carries method TICK / PHOTO, and after a ticked check the last photo check's date;
//   TT-002 Mark missing writes a RecordChange row (after Missing, by the link's person, source naming the link and the
//          check); another box's tool or another link's check id -> 400 with nothing written;
//   TT-003 the 21st tick check of a Sydney day on one link -> 429, nothing saved; another link still ticks (201).
// WRITES on the test copy: three made-up supervisors, three toolboxes, tools in them, links of each kind, tick checks,
// two seeded photo-check records (no photo) and one CHECK photo. At the end the links are revoked, toolboxes switched off, tools retired, people switched off.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "toolbox-ticklist", title: "Check my toolbox tick list: exactly the toolbox's active tools, Here / Missing saved as the photo check's ToolboxCheck, foreign ids 400, other links refused, photo path kept, no $",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/toolboxTick.ts") || "needs lib/toolboxTick.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    if (!c.users.MANAGER) return t.block("no MANAGER test login (lib/setup.mjs TEST_ROLES)");
    const net0 = netLines(c);
    const tag = Date.now().toString(36).toUpperCase();
    const made = { people: [], boxes: [], tools: [], links: [] };
    const seen = []; // every link reply - scanned for "$" + digit at the end
    const send = async (link, body) => {
      const r = await c.post(c.site(link, "/submit"), null, body);
      const text = await r.text().catch(() => "");
      seen.push([`POST submit ${body.kind}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ }
      return { status: r.status, body: j, text };
    };
    try {
      // Seed.
      const person = async (n) => { const r = await db.resource.create({ data: { name: `RC Tick ${n} ${tag}`, type: "PERSONNEL", category: "Site Manager", role: "Supervisor", status: "AVAILABLE" } }); made.people.push(r.id); return r; };
      const S = await person("S"), S2 = await person("S2"), S3 = await person("S3");
      const box = async (n, sup) => { const b = await db.toolbox.create({ data: { name: `RC Tick ${n}'s toolbox ${tag}`, supervisorId: sup.id } }); made.boxes.push(b.id); return b; };
      const B = await box("S", S), B2 = await box("S2", S2), E = await box("S3", S3);
      let n = 0;
      const tool = async (b, extra = {}) => {
        n += 1;
        const r = await db.tool.create({ data: { tag: `RCTK-${tag}-${String(n).padStart(2, "0")}`, name: `RC tick tool ${n}`, serialNumber: `RCSERIAL${tag}${n}`, toolboxId: b.id, ...extra } });
        made.tools.push(r.id); return r;
      };
      const active = [await tool(B), await tool(B), await tool(B), await tool(B)];
      const retired = await tool(B, { retiredAt: new Date() });
      const swapped = await tool(B, { condition: "Swapped out" });
      const other = await tool(B2);
      const job = await db.job.findFirst({ select: { id: true } });
      const L = {
        sup: await makeLink(db, "SUPERVISOR", S.id),
        sup2: await makeLink(db, "SUPERVISOR", S2.id),
        empty: await makeLink(db, "SUPERVISOR", S3.id),
        handover: job ? await makeLink(db, "HANDOVER", S.id, { jobId: job.id, expiresAt: new Date(Date.now() + 36 * 3_600_000) }) : null,
        office: await makeLink(db, "OFFICE", S2.id),
        driver: await makeLink(db, "DRIVER", S.id),
        poster: await makeLink(db, "POSTER", null, { place: "YARD" }),
        off: await makeLink(db, "SUPERVISOR", S.id, { revokedAt: new Date() }),
      };
      for (const l of Object.values(L)) if (l) made.links.push(l.id);
      const fake = { secret: "x".repeat(32) };
      // TT-001: an earlier photo check of B (two days ago) and a photo check as E's latest - seeded, no photo is read.
      const emptyResult = JSON.stringify({ present: [], presentUnconfirmed: [], missing: [], foreign: [], unknown: [], notes: "" });
      const photoAt = new Date(Date.now() - 2 * 86_400_000);
      await db.toolboxCheck.create({ data: { toolboxId: B.id, photoIds: JSON.stringify(["rc-seeded-photo"]), result: emptyResult, checkedBy: "RC office", createdAt: photoAt } });
      const ePhoto = await db.toolboxCheck.create({ data: { toolboxId: E.id, photoIds: JSON.stringify(["rc-seeded-photo"]), result: emptyResult, checkedBy: "RC office" } });
      const checks = () => db.toolboxCheck.count({ where: { toolboxId: { in: [B.id, B2.id, E.id] } } });
      const history = (toolId) => db.recordChange.count({ where: { model: "Tool", recordId: toolId } });

      // (1) The list.
      const home = await c.text(c.site(L.sup), null);
      seen.push(["GET supervisor link", home.text]);
      t.status(home.status, 200, "the supervisor's link answers");
      let info = null; try { info = JSON.parse(home.text); } catch { /* */ }
      const listed = info?.toolboxes?.find((b) => b.id === B.id);
      t.ok(info?.toolboxes?.length === 1 && !!listed, "the link lists only its own toolbox", JSON.stringify(info?.toolboxes?.map((b) => b.name)));
      t.ok(listed?.name === B.name, "the toolbox's own name comes with it (the screen's heading)");
      t.ok(JSON.stringify(listed?.tools?.map((x) => x.id)) === JSON.stringify(active.map((x) => x.id)),
        "exactly that toolbox's active tools, in tag order - not the retired or swapped-out ones", JSON.stringify(listed?.tools?.map((x) => x.tag)));
      t.ok(!JSON.stringify(info).includes(other.id) && !JSON.stringify(info).includes(retired.id) && !JSON.stringify(info).includes(swapped.id), "no other box's tool, no retired or swapped-out tool");
      t.ok(listed?.tools?.every((x) => x.tag && x.name), "each tool has its name and LOB tag");
      const emptyHome = await c.json(c.site(L.empty), null);
      t.ok(emptyHome.body?.toolboxes?.length === 1 && emptyHome.body.toolboxes[0].tools.length === 0, "an empty toolbox lists no tools");

      // (3) Refused - nothing saved.
      const c0 = await checks();
      const allHere = Object.fromEntries(active.map((x) => [x.id, "HERE"]));
      let r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: { ...allHere, [other.id]: "HERE" } });
      t.status(r, 400, "a tool from another supervisor's toolbox in the ticks");
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: { ...allHere, [retired.id]: "HERE" } });
      t.status(r, 400, "a retired tool of the same toolbox in the ticks");
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: { ...allHere, madeUpToolId: "MISSING" } });
      t.status(r, 400, "a made-up tool id in the ticks");
      const { [active[3].id]: _left, ...three } = allHere;
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: three });
      t.status(r, 400, "a tool left unmarked (3 of 4)");
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: { ...allHere, [active[0].id]: "MAYBE" } });
      t.status(r, 400, "a mark that isn't Here or Missing");
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: ["x"] });
      t.status(r, 400, "marks that aren't a list of tools");
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B2.id, marks: { [other.id]: "HERE" } });
      t.status(r, 400, "another supervisor's toolbox from this link");
      r = await send(L.sup2, { kind: "TICK_CHECK", toolboxId: B.id, marks: allHere });
      t.status(r, 400, "another supervisor's link ticking this toolbox");
      r = await send(L.empty, { kind: "TICK_CHECK", toolboxId: E.id, marks: {} });
      t.status(r, 400, "an empty toolbox can't be sent");
      if (L.handover) t.status(await send(L.handover, { kind: "TICK_CHECK", toolboxId: B.id, marks: allHere }), 403, "the hand-over link");
      else t.note("no job on the copy - the hand-over link case was skipped");
      t.status(await send(L.office, { kind: "TICK_CHECK", toolboxId: B.id, marks: allHere }), 403, "the office link (keeps the photo check)");
      for (const [name, link] of [["driver", L.driver], ["poster", L.poster], ["switched-off", L.off], ["made-up", fake]]) {
        t.status(await send(link, { kind: "TICK_CHECK", toolboxId: B.id, marks: allHere }), 404, `a ${name} link`);
      }
      t.ok((await checks()) === c0, "no toolbox check saved by any refused one");

      // (2) A tick check: 3 Here, 1 Missing.
      const marks = { ...allHere, [active[2].id]: "MISSING" };
      const subs0 = await db.siteSubmission.count({ where: { siteLinkId: L.sup.id } });
      r = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks });
      t.status(r, 201, "the tick check is saved");
      const want = { present: [active[0].id, active[1].id, active[3].id], missing: [active[2].id] };
      t.ok(JSON.stringify(r.body?.result?.present?.map((x) => x.toolId)) === JSON.stringify(want.present)
        && JSON.stringify(r.body?.result?.missing?.map((x) => x.toolId)) === JSON.stringify(want.missing), "the reply: present = Here, missing = Missing", r.text.slice(0, 200));
      t.ok(!r.text.includes("RCSERIAL"), "the reply carries no serial numbers (names and LOB tags only)");
      const saved = await db.toolboxCheck.findFirst({ where: { toolboxId: B.id }, orderBy: { createdAt: "desc" } });
      let res = null; try { res = JSON.parse(saved?.result ?? ""); } catch { /* */ }
      t.ok(saved?.photoIds === "[]" && res?.method === "TICK", "a ToolboxCheck with no photos, method TICK", JSON.stringify({ photoIds: saved?.photoIds, method: res?.method }));
      t.ok(JSON.stringify(res?.present?.map((x) => x.toolId)) === JSON.stringify(want.present) && JSON.stringify(res?.missing?.map((x) => x.toolId)) === JSON.stringify(want.missing)
        && res?.presentUnconfirmed?.length === 0 && res?.foreign?.length === 0 && res?.unknown?.length === 0, "the saved record: the photo check's format, present / missing from the ticks");
      t.ok(typeof saved?.checkedBy === "string" && saved.checkedBy.includes(S.name), "checked by the link's own person", saved?.checkedBy);
      const sub = await db.siteSubmission.findFirst({ where: { siteLinkId: L.sup.id, kind: "CHECK" }, orderBy: { createdAt: "desc" } });
      t.ok((await db.siteSubmission.count({ where: { siteLinkId: L.sup.id } })) === subs0 + 1 && sub?.checkId === saved?.id && sub?.status === "APPLIED" && sub?.toolboxId === B.id,
        "and the CHECK SiteSubmission, as the photo check writes");
      // The office sees it the same way.
      const from = await c.json("/api/site-submissions", "MANAGER");
      const row = Array.isArray(from.body) ? from.body.find((x) => x.checkId === saved?.id) : null;
      t.ok(row?.checkResult?.missing?.length === 1 && row.checkResult.missing[0].toolId === active[2].id, "From site (office): the check with its missing tool");
      const boxes = await c.json("/api/toolboxes", "MANAGER");
      const lb = Array.isArray(boxes.body) ? boxes.body.find((x) => x.id === B.id) : null;
      t.ok(lb?.lastCheck?.id === saved?.id && lb.lastCheck.missing === 1 && lb.lastCheck.foreign === 0, "the Toolboxes page: last check, 1 missing", JSON.stringify(lb?.lastCheck));
      // TT-001: the method shows, and after a ticked check the box's last photo check.
      t.ok(lb?.lastCheck?.method === "TICK" && lb.lastCheck.lastPhotoCheckAt && Math.abs(new Date(lb.lastCheck.lastPhotoCheckAt).getTime() - photoAt.getTime()) < 1000,
        "TT-001: the last check says ticked, with the last photo check's date beside it", JSON.stringify(lb?.lastCheck));
      const le = Array.isArray(boxes.body) ? boxes.body.find((x) => x.id === E.id) : null;
      t.ok(le?.lastCheck?.id === ePhoto.id && le.lastCheck.method === "PHOTO" && !("lastPhotoCheckAt" in le.lastCheck), "TT-001: a photo check says photo", JSON.stringify(le?.lastCheck));
      const tbPage = (() => { try { return readFileSync(path.join(c.p.appDir, "src/app/tools/toolboxes/page.tsx"), "utf8"); } catch { return ""; } })();
      t.ok(/lastCheckText\(last\)/.test(tbPage), "TT-001: the Toolboxes page shows (ticked) / (photo) and the last photo check (source)");
      t.ok(r.body?.checkId === saved?.id, "the tick reply names the saved check (for Mark missing)");
      // "Mark missing" afterwards - the photo check's own action, now with its history (TT-002).
      const mm = await send(L.sup, { kind: "CHECK_ACTION", action: "MISSING", toolId: active[2].id, toolboxId: B.id, checkId: r.body?.checkId });
      t.status(mm, 200, "Mark missing after the tick check (CHECK_ACTION)");
      t.ok((await db.tool.findUnique({ where: { id: active[2].id }, select: { condition: true } }))?.condition === "Missing", "the tool is Missing on the register");
      const h = await db.recordChange.findFirst({ where: { model: "Tool", recordId: active[2].id, field: "condition" }, orderBy: { changedAt: "desc" } });
      t.ok(h?.after === "Missing" && h.changedBy.includes(S.name) && h.changedById === null && h.source?.includes(L.sup.id) && h.source?.includes(saved?.id ?? "-"),
        "TT-002: a history row - after Missing, by the link's person, naming the link and the check", JSON.stringify(h && { after: h.after, changedBy: h.changedBy, source: h.source }));
      const otherH0 = await history(other.id);
      t.status(await send(L.sup, { kind: "CHECK_ACTION", action: "MISSING", toolId: other.id, toolboxId: B.id }), 400, "but never another toolbox's tool");
      t.ok((await history(other.id)) === otherH0 && (await db.tool.findUnique({ where: { id: other.id }, select: { condition: true } }))?.condition !== "Missing",
        "TT-002: and nothing written for it - no history row, the tool unchanged");
      // An older page (no check id): the link's latest check of the box is named.
      t.status(await send(L.sup, { kind: "CHECK_ACTION", action: "MISSING", toolId: active[1].id, toolboxId: B.id }), 200, "Mark missing with no check id (older page)");
      const h1 = await db.recordChange.findFirst({ where: { model: "Tool", recordId: active[1].id, field: "condition" }, orderBy: { changedAt: "desc" } });
      t.ok(h1?.after === "Missing" && h1.source?.includes(saved?.id ?? "-"), "TT-002: the history names the link's latest check", h1?.source);
      // The list still shows it (Missing is still in the box) - the next check ticks it again.
      const again = await c.json(c.site(L.sup), null);
      t.ok(again.body?.toolboxes?.[0]?.tools?.length === 4, "the missing tool stays on the list for the next check");

      // TT-003: 20 tick checks a Sydney day per link - the 21st is 429 with nothing saved; another link still works.
      const day0 = await db.siteSubmission.count({ where: { siteLinkId: L.sup.id, kind: "CHECK", photoIds: "[]" } });
      let okCount = 0;
      for (let i = day0; i < 20; i++) if ((await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: allHere })).status === 201) okCount += 1;
      t.ok(okCount === 20 - day0, `ticks ${day0 + 1} to 20 of the day are saved`, `${okCount} of ${20 - day0}`);
      const cap0 = { checks: await checks(), subs: await db.siteSubmission.count({ where: { siteLinkId: L.sup.id } }) };
      const over = await send(L.sup, { kind: "TICK_CHECK", toolboxId: B.id, marks: allHere });
      t.status(over, 429, "TT-003: the 21st tick check of the day");
      t.ok(over.body?.error === "That's a lot of toolbox checks today - call the office.", "with the call-the-office message", over.text.slice(0, 120));
      t.ok((await checks()) === cap0.checks && (await db.siteSubmission.count({ where: { siteLinkId: L.sup.id } })) === cap0.subs, "TT-003: nothing saved for it");
      const o2 = await send(L.sup2, { kind: "TICK_CHECK", toolboxId: B2.id, marks: { [other.id]: "HERE" } });
      t.status(o2, 201, "TT-003: another supervisor's link still ticks");
      const lb2 = (await c.json("/api/toolboxes", "MANAGER")).body?.find?.((x) => x.id === B2.id);
      t.ok(lb2?.lastCheck?.method === "TICK" && lb2.lastCheck.lastPhotoCheckAt === null, "TT-001: a ticked box with no photo check says so", JSON.stringify(lb2?.lastCheck));
      // TT-002: a check id from another link is refused, nothing written.
      const a0H = await history(active[0].id);
      t.status(await send(L.sup, { kind: "CHECK_ACTION", action: "MISSING", toolId: active[0].id, toolboxId: B.id, checkId: o2.body?.checkId ?? "x" }), 400, "TT-002: Mark missing naming another link's check");
      t.ok((await history(active[0].id)) === a0H && (await db.tool.findUnique({ where: { id: active[0].id }, select: { condition: true } }))?.condition !== "Missing", "and nothing written");

      // (4) The photo path still works.
      const ph = await c.post(c.site(L.sup, "/photos"), null, { kind: "CHECK", dataUrl: PNG });
      const phj = await ph.json().catch(() => ({}));
      t.status(ph.status, 201, "a toolbox photo uploads through the supervisor's link");
      t.status(await send(L.sup, { kind: "CHECK", toolboxId: B.id, photoIds: [] }), 400, "the photo check: no photos");
      if (phj?.id) t.status(await send(L.sup, { kind: "CHECK", toolboxId: B.id, photoIds: [phj.id] }), 503, "the photo check: reading needs the Claude key - not on the copy (no outbound call), refused cleanly");
      t.status(await send(L.office, { kind: "CHECK", toolboxId: B.id, photoIds: [] }), 400, "the office link still reaches its photo check");
      const page = (() => { try { return readFileSync(path.join(c.p.appDir, "src/app/site/[token]/page.tsx"), "utf8"); } catch { return ""; } })();
      const comp = (() => { try { return readFileSync(path.join(c.p.appDir, "src/components/site/ToolboxTickList.tsx"), "utf8"); } catch { return ""; } })();
      t.ok(/info\.kind === "SUPERVISOR" && <ToolboxTickList/.test(page) && /<CheckBox api=\{api\} info=\{info\} \/>/.test(page), "the page: the tick list on supervisor links, the photo check kept (source)");
      t.ok(/Use photos instead/.test(comp) && /Mark all here/.test(comp) && /canSendTick/.test(comp), "the tick screen: Mark all here, send only when all marked, Use photos instead (source)");

      // No money anywhere a link was answered.
      const bad = seen.filter(([, text]) => !noMoney(text));
      t.ok(bad.length === 0, "no dollar figure in any link reply", bad.map(([w]) => w).join(", "));
      // (5)
      t.ok(netLines(c) === net0, "no outbound call");
    } finally {
      await db.siteLink.updateMany({ where: { id: { in: made.links } }, data: { revokedAt: new Date() } }).catch(() => {});
      await db.tool.updateMany({ where: { id: { in: made.tools }, retiredAt: null }, data: { retiredAt: new Date() } }).catch(() => {});
      await db.toolbox.updateMany({ where: { id: { in: made.boxes } }, data: { active: false } }).catch(() => {});
      await db.resource.updateMany({ where: { id: { in: made.people } }, data: { active: false } }).catch(() => {});
    }
  },
};
