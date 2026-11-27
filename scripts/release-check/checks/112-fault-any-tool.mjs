// Report a fault on ANY Lobos tool (Ilies, 27 Nov 2026 - "Any tool, plus 'not in the list'": "Their toolbox first,
// then every other Lobos tool, plus 'Not in the list' with a photo; the photo reader suggests the tool and the office
// confirms. Shows the empty-toolbox gap to the office too."). Omar's two toolboxes were empty, so he couldn't send one.
//   (1) The picker: GET /api/site/:token/fault-tools on a supervisor's link lists every other active tool (not retired,
//       not swapped out, not the link's own), grouped by toolbox, "Not in a toolbox" last, with tag + name ONLY (no
//       serial, notes, holder); hand-over / office links 403; driver, poster, switched-off and made-up links 404.
//   (2) A fault on another supervisor's tool, from a link with an empty toolbox (201) - a PENDING FAULT submission on
//       that tool, as before; and from a link with no toolbox at all (201). Refused, nothing saved: a retired tool, a
//       swapped-out tool, a made-up id, no tool (400); no description (400); a photo from another link (400); the
//       hand-over and office links (403); driver / poster / dead links (404).
//   (3) "Not in the list": needs a photo (400 without); with it -> 201, a FAULT submission with no tool and its photo,
//       reading { unlisted: true } - on the copy there's no Claude key, so it ends NOT_READ with no outbound call.
//   (4) The office (From site, Manager): the unlisted fault shows with its photo and reading; with a seeded reading
//       the likely tools come back (LOB tag first) - nothing is assigned. Log fault with no tool -> 400; with a retired
//       tool -> 400; with a tool -> the ToolIssue on that tool, Needs repair, the photo attached, the submission APPLIED
//       with the tool; a second Log -> 409. An ordinary fault still logs as before (no tool needed in the body).
//   (5) The empty-toolbox gap: /api/tools/supervisor-gaps (Manager) lists the supervisor with empty toolboxes and the
//       one with none, not the one with tools; the coordinator and the yard login get 403 (their access is unchanged).
//   (6) No $ in any link reply; no outbound call.
// WRITES on the test copy: made-up supervisors, toolboxes, tools, links, photos, fault submissions and a tool fault.
// At the end the links are revoked, toolboxes switched off, tools retired, people switched off.
import { readFileSync } from "node:fs";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: "fault-any-tool", title: "Report a fault on any tool: other people's tools (tag + name only), Not in the list with a photo, office links the tool, empty-toolbox gap, no $",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/toolFaults.ts") || "needs lib/toolFaults.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    if (!c.users.MANAGER) return t.block("no MANAGER test login (lib/setup.mjs TEST_ROLES)");
    const net0 = netLines(c);
    const tag = Date.now().toString(36).toUpperCase();
    const made = { people: [], boxes: [], tools: [], links: [] };
    const seen = [];
    const send = async (link, body) => {
      const r = await c.post(c.site(link, "/submit"), null, body);
      const text = await r.text().catch(() => "");
      seen.push([`POST submit ${body.kind}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ }
      return { status: r.status, body: j, text };
    };
    const photo = async (link) => {
      const r = await c.post(c.site(link, "/photos"), null, { kind: "FAULT", dataUrl: PNG });
      const j = await r.json().catch(() => ({}));
      return j?.id ?? null;
    };
    try {
      const person = async (n) => { const r = await db.resource.create({ data: { name: `RC Fault ${n} ${tag}`, type: "PERSONNEL", category: "Site Manager", role: "Supervisor", status: "AVAILABLE" } }); made.people.push(r.id); return r; };
      const O = await person("Omar"), P = await person("Pol"), Z = await person("Zed");
      const box = async (n, sup) => { const b = await db.toolbox.create({ data: { name: `RC Fault ${n}'s toolbox ${tag}`, supervisorId: sup.id } }); made.boxes.push(b.id); return b; };
      const O1 = await box("Omar", O), O2 = await box("Omar2", O), PB = await box("Pol", P);
      let n = 0;
      const tool = async (b, extra = {}) => {
        n += 1;
        const r = await db.tool.create({ data: { tag: `RCFT-${tag}-${String(n).padStart(2, "0")}`, name: `RC fault tool ${n}`, serialNumber: `RCFSERIAL${tag}${n}`, notes: `RCFNOTE${tag}`, heldBy: `RCFHOLDER${tag}`, toolboxId: b?.id ?? null, ...extra } });
        made.tools.push(r.id); return r;
      };
      const polTool = await tool(PB, { name: "RC impact wrench", brand: "Hilti", model: `RCMODEL${tag}` });
      const yardTool = await tool(null);
      const retired = await tool(PB, { retiredAt: new Date() });
      const swapped = await tool(PB, { condition: "Swapped out" });
      const job = await db.job.findFirst({ select: { id: true } });
      const L = {
        omar: await makeLink(db, "SUPERVISOR", O.id),
        pol: await makeLink(db, "SUPERVISOR", P.id),
        zed: await makeLink(db, "SUPERVISOR", Z.id),
        handover: job ? await makeLink(db, "HANDOVER", O.id, { jobId: job.id, expiresAt: new Date(Date.now() + 36 * 3_600_000) }) : null,
        office: await makeLink(db, "OFFICE", P.id),
        driver: await makeLink(db, "DRIVER", O.id),
        poster: await makeLink(db, "POSTER", null, { place: "YARD" }),
        off: await makeLink(db, "SUPERVISOR", O.id, { revokedAt: new Date() }),
      };
      for (const l of Object.values(L)) if (l) made.links.push(l.id);
      const fake = { secret: "x".repeat(32) };
      const subs = () => db.siteSubmission.count({ where: { siteLinkId: { in: made.links } } });

      // (1) The picker.
      const pk = await c.text(c.site(L.omar, "/fault-tools"), null);
      seen.push(["GET fault-tools", pk.text]);
      t.status(pk.status, 200, "Omar's link (two empty toolboxes) gets the other Lobos tools");
      let groups = []; try { groups = JSON.parse(pk.text).groups ?? []; } catch { /* */ }
      const flat = groups.flatMap((g) => g.tools.map((x) => ({ ...x, group: g.name })));
      t.ok(flat.some((x) => x.id === polTool.id && x.group === PB.name), "Pol's tool listed under Pol's toolbox");
      t.ok(flat.some((x) => x.id === yardTool.id && x.group === "Not in a toolbox"), "a tool in no toolbox listed under 'Not in a toolbox'");
      t.ok(groups.length > 0 && groups[groups.length - 1].name === "Not in a toolbox", "'Not in a toolbox' comes last");
      t.ok(!flat.some((x) => x.id === retired.id || x.id === swapped.id), "no retired or swapped-out tool");
      t.ok(flat.every((x) => Object.keys(x).sort().join() === "group,id,name,tag"), "each tool: id, tag and name only");
      t.ok(!pk.text.includes("RCFSERIAL") && !pk.text.includes("RCFNOTE") && !pk.text.includes("RCFHOLDER") && !pk.text.includes("RCMODEL"), "no serial, notes, holder or model in the reply");
      const polPk = await c.json(c.site(L.pol, "/fault-tools"), null);
      t.ok(polPk.status === 200 && !JSON.stringify(polPk.body).includes(polTool.id), "Pol's own tool isn't repeated in his 'other tools' (it's in his own toolbox list)");
      if (L.handover) t.status(await c.get(c.site(L.handover, "/fault-tools"), null), 403, "the hand-over link can't get the picker");
      else t.note("no job on the copy - the hand-over link case was skipped");
      t.status(await c.get(c.site(L.office, "/fault-tools"), null), 403, "the office link can't get the picker");
      for (const [nm, link] of [["driver", L.driver], ["poster", L.poster], ["switched-off", L.off], ["made-up", fake]]) {
        t.status(await c.get(c.site(link, "/fault-tools"), null), 404, `a ${nm} link`);
      }
      const home = await c.text(c.site(L.omar), null);
      seen.push(["GET Omar's link", home.text]);
      let info = null; try { info = JSON.parse(home.text); } catch { /* */ }
      t.ok(info?.toolboxes?.length === 2 && info.toolboxes.every((b) => b.tools.length === 0), "Omar's link still lists his own two (empty) toolboxes as before");

      // (2) A fault on another supervisor's tool.
      const s0 = await subs();
      for (const [why, body, want] of [
        ["a retired tool", { kind: "FAULT", toolId: retired.id, description: "broken" }, 400],
        ["a swapped-out tool", { kind: "FAULT", toolId: swapped.id, description: "broken" }, 400],
        ["a made-up tool id", { kind: "FAULT", toolId: "madeUpToolId", description: "broken" }, 400],
        ["no tool", { kind: "FAULT", description: "broken" }, 400],
        ["no description", { kind: "FAULT", toolId: polTool.id, description: "  " }, 400],
      ]) t.status(await send(L.omar, body), want, `refused: ${why}`);
      const polPhoto = await photo(L.pol);
      t.status(await send(L.omar, { kind: "FAULT", toolId: polTool.id, description: "broken", photoId: polPhoto }), 400, "refused: a photo sent through another link");
      if (L.handover) t.status(await send(L.handover, { kind: "FAULT", toolId: polTool.id, description: "broken" }), 403, "refused: the hand-over link");
      t.status(await send(L.office, { kind: "FAULT", toolId: polTool.id, description: "broken" }), 400, "refused: the office link (faults come from a supervisor's link)");
      for (const [nm, link] of [["driver", L.driver], ["poster", L.poster], ["switched-off", L.off], ["made-up", fake]]) {
        t.status(await send(link, { kind: "FAULT", toolId: polTool.id, description: "broken" }), 404, `refused: a ${nm} link`);
      }
      t.ok((await subs()) === s0, "nothing saved by any refused one");
      const okPhoto = await photo(L.omar);
      let r = await send(L.omar, { kind: "FAULT", toolId: polTool.id, description: "RC rattle gun won't hammer", photoId: okPhoto });
      t.status(r, 201, "Omar (empty toolboxes) reports a fault on Pol's tool");
      t.ok(r.body?.message?.includes(polTool.tag), "the reply names the tool's tag", r.text.slice(0, 120));
      const listed = await db.siteSubmission.findFirst({ where: { siteLinkId: L.omar.id, kind: "FAULT", toolId: polTool.id }, orderBy: { createdAt: "desc" } });
      t.ok(listed?.status === "PENDING" && listed.toolboxId === PB.id && JSON.parse(listed.photoIds)[0] === okPhoto, "a PENDING FAULT submission on that tool, with its photo - as before");
      r = await send(L.zed, { kind: "FAULT", toolId: yardTool.id, description: "RC cord frayed" });
      t.status(r, 201, "Zed (no toolbox at all) reports a fault on a yard tool");
      const page = (() => { try { return readFileSync(`${c.p.appDir}/src/app/site/[token]/page.tsx`, "utf8"); } catch { return ""; } })();
      t.ok(/info\.kind === "SUPERVISOR" && \(\s*<Big icon=\{<Wrench/.test(page), "the page: Report a fault on every supervisor's link, toolbox or not (source)");

      // (3) Not in the list.
      const u0 = await subs();
      t.status(await send(L.omar, { kind: "FAULT", toolId: "UNLISTED", description: "RC not on the list" }), 400, "Not in the list without a photo");
      t.ok((await subs()) === u0, "nothing saved for it");
      const uPhoto = await photo(L.omar);
      r = await send(L.omar, { kind: "FAULT", toolId: "UNLISTED", description: "RC Hilti rattle gun - housing cracked", photoId: uPhoto });
      t.status(r, 201, "Not in the list with a photo is sent");
      let un = await db.siteSubmission.findFirst({ where: { siteLinkId: L.omar.id, kind: "FAULT", toolId: null }, orderBy: { createdAt: "desc" } });
      t.ok(un && un.status === "PENDING" && un.toolboxId === null && JSON.parse(un.photoIds)[0] === uPhoto, "a PENDING FAULT submission with no tool and its photo");
      for (let i = 0; i < 20 && un && JSON.parse(un.reading ?? "{}").status === "WAITING"; i++) { await sleep(250); un = await db.siteSubmission.findUnique({ where: { id: un.id } }); }
      const ur = JSON.parse(un?.reading ?? "{}");
      t.ok(ur.unlisted === true && ur.status === "NOT_READ" && /isn't set up|switched off/.test(ur.reason ?? ""), "the reading: unlisted, NOT_READ - no Claude key on the copy, no outbound call", JSON.stringify(ur));

      // (4) The office.
      // A second unlisted fault with a seeded reading (as the photo reader would leave it) - for the suggestions.
      const seeded = await db.siteSubmission.create({
        data: { siteLinkId: L.omar.id, kind: "FAULT", photoIds: JSON.stringify([uPhoto]), description: "RC seeded",
          reading: JSON.stringify({ unlisted: true, status: "READ", seen: { toolType: "Impact wrench", brand: "Hilti", model: `RCMODEL${tag}`, lobTag: polTool.tag, serialNumber: "", damage: "Cracked" } }) },
      });
      const from = await c.json("/api/site-submissions", "MANAGER");
      const row = Array.isArray(from.body) ? from.body.find((x) => x.id === un?.id) : null;
      t.ok(row?.unlisted?.status === "NOT_READ" && row.tool === null && row.photoIds?.[0] === uPhoto && row.reading === null, "From site: the unlisted fault, with its photo and no tool", JSON.stringify(row?.unlisted));
      const srow = Array.isArray(from.body) ? from.body.find((x) => x.id === seeded.id) : null;
      t.ok(srow?.unlisted?.suggestions?.[0]?.toolId === polTool.id && srow.unlisted.suggestions[0].how === "tag", "the likely tools: the tag match first", JSON.stringify(srow?.unlisted?.suggestions?.slice(0, 2)));
      t.ok((await db.siteSubmission.findUnique({ where: { id: seeded.id } }))?.toolId === null, "nothing assigned automatically");
      const fromPage = (() => { try { return readFileSync(`${c.p.appDir}/src/app/tools/site/page.tsx`, "utf8"); } catch { return ""; } })();
      t.ok(/<UnlistedFault/.test(fromPage) && /Fault - tool not in the list/.test(fromPage), "the From site page shows it as not in the list (source)");
      const pat = (id, body) => c.patch(`/api/site-submissions/${id}`, "MANAGER", body);
      t.status(await pat(seeded.id, { status: "APPLIED", notWorking: true }), 400, "Log fault with no tool picked");
      t.status(await pat(seeded.id, { status: "APPLIED", toolId: retired.id, notWorking: true }), 400, "Log fault on a retired tool");
      const i0 = await db.toolIssue.count({ where: { toolId: polTool.id } });
      t.status(await pat(seeded.id, { status: "APPLIED", toolId: polTool.id, notWorking: true }), 200, "Log fault on the tool the office picked");
      const after = await db.siteSubmission.findUnique({ where: { id: seeded.id } });
      const issue = await db.toolIssue.findFirst({ where: { toolId: polTool.id }, orderBy: { createdAt: "desc" } });
      t.ok((await db.toolIssue.count({ where: { toolId: polTool.id } })) === i0 + 1 && issue?.description === "RC seeded" && issue.photoId === uPhoto && /\(site\)$/.test(issue.reportedBy ?? ""), "the tool's fault recorded, with the photo and who reported it");
      t.ok(after?.status === "APPLIED" && after.toolId === polTool.id && after.appliedRef === issue?.id, "the submission APPLIED, with the tool and the fault");
      t.ok((await db.tool.findUnique({ where: { id: polTool.id } }))?.condition === "Needs repair", "the tool marked Needs repair");
      t.ok((await db.toolPhoto.findUnique({ where: { id: uPhoto } }))?.toolId === polTool.id, "the photo attached to the tool");
      t.status(await pat(seeded.id, { status: "APPLIED", toolId: polTool.id }), 409, "a second Log fault");
      const z = await db.siteSubmission.findFirst({ where: { siteLinkId: L.zed.id, kind: "FAULT" } });
      t.status(await pat(z.id, { status: "APPLIED", notWorking: false }), 200, "an ordinary fault still logs as before");
      t.ok((await db.toolIssue.count({ where: { toolId: yardTool.id } })) === 1 && (await db.tool.findUnique({ where: { id: yardTool.id } }))?.condition !== "Needs repair", "on its own tool; 'still works' leaves the condition");
      t.status(await pat(un.id, { status: "REJECTED" }), 200, "Not needed still works for an unlisted fault");

      // (5) The empty-toolbox gap.
      const gap = await c.json("/api/tools/supervisor-gaps", "MANAGER");
      const names = (gap.body?.supervisors ?? []).map((x) => x.name);
      t.ok(gap.status === 200 && names.includes(O.name) && names.includes(Z.name) && !names.includes(P.name), "the gap: Omar (empty toolboxes) and Zed (none), not Pol", JSON.stringify(names.filter((x) => x.includes(tag))));
      const om = (gap.body?.supervisors ?? []).find((x) => x.id === O.id);
      t.ok(om?.toolboxes === 2 && Object.keys(om).sort().join() === "hasLink,id,name,toolboxes", "names and counts only");
      for (const role of ["COORDINATOR", "YARD", "VIEWER"]) {
        if (!c.users[role]) { t.note(`no ${role} test login - skipped`); continue; }
        t.status(await c.get("/api/tools/supervisor-gaps", role), 403, `the ${role} login can't read the gap (access unchanged)`);
      }
      const toolsPage = (() => { try { return readFileSync(`${c.p.appDir}/src/app/tools/page.tsx`, "utf8"); } catch { return ""; } })();
      t.ok(/canEdit && <SupervisorToolGap \/>/.test(toolsPage), "the Tools page shows the note to Managers and Admins (source)");

      // (6)
      const bad = seen.filter(([, text]) => !noMoney(text));
      t.ok(bad.length === 0, "no dollar figure in any link reply", bad.map(([w]) => w).join(", "));
      t.ok(netLines(c) === net0, "no outbound call");
    } finally {
      await db.siteLink.updateMany({ where: { id: { in: made.links } }, data: { revokedAt: new Date() } }).catch(() => {});
      await db.tool.updateMany({ where: { id: { in: made.tools }, retiredAt: null }, data: { retiredAt: new Date() } }).catch(() => {});
      await db.toolbox.updateMany({ where: { id: { in: made.boxes } }, data: { active: false } }).catch(() => {});
      await db.resource.updateMany({ where: { id: { in: made.people } }, data: { active: false } }).catch(() => {});
    }
  },
};
