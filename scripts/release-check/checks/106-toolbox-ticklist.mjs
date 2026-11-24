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
// WRITES on the test copy: three made-up supervisors, three toolboxes, tools in them, links of each kind, tick checks
// and one CHECK photo. At the end the links are revoked, toolboxes switched off, tools retired, people switched off.
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
      const checks = () => db.toolboxCheck.count({ where: { toolboxId: { in: [B.id, B2.id, E.id] } } });

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
      // "Mark missing" afterwards - the photo check's own action.
      const mm = await send(L.sup, { kind: "CHECK_ACTION", action: "MISSING", toolId: active[2].id, toolboxId: B.id });
      t.status(mm, 200, "Mark missing after the tick check (CHECK_ACTION)");
      t.ok((await db.tool.findUnique({ where: { id: active[2].id }, select: { condition: true } }))?.condition === "Missing", "the tool is Missing on the register");
      t.status(await send(L.sup, { kind: "CHECK_ACTION", action: "MISSING", toolId: other.id, toolboxId: B.id }), 400, "but never another toolbox's tool");
      // The list still shows it (Missing is still in the box) - the next check ticks it again.
      const again = await c.json(c.site(L.sup), null);
      t.ok(again.body?.toolboxes?.[0]?.tools?.length === 4, "the missing tool stays on the list for the next check");

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
