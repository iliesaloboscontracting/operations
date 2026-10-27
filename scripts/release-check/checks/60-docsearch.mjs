// Document search (LCI phase 6) - runs only when the candidate has src/lib/docsearch. Who may search, never on a site
// link, OFF with no Graph keys (no call out, no index file), every shipped folder unapproved, the index refuses
// prisma/, the DOC_SEARCH=off kill switch.
import { existsSync } from "node:fs";
import path from "node:path";
import { run } from "../lib/util.mjs";

const tsxEval = (c, code, env = {}) => run(process.execPath, [path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs"), "--eval", code],
  { cwd: c.p.appDir, env: { ...c.childEnv, ...env }, timeoutMs: 60_000 });

export default {
  id: "docsearch", title: "Document search: Manager/Admin only, OFF without Graph, nothing approved, index outside prisma/",
  applies: (c) => c.hasPath("src/lib/docsearch/folders.ts") || "the candidate has no document search (src/lib/docsearch)",
  async run(t, c) {
    // Who may use it (API decides; the page is a client-gated shell like every other page).
    for (const ep of ["/api/documents?q=swms", "/api/documents/status"]) {
      for (const [who, want] of [["MANAGER", 200], ["MANAGER_DIRECTOR", 200], ["ADMIN", 200], ["ADMIN_PLAIN", 200], ["VIEWER", 403], ["TIMESHEETS", 403], ["DIRECTOR", 403], ["ACCOUNTS", 403], [null, 401]])
        t.status(await c.get(ep, who), want, `GET ${ep.split("?")[0]} as ${who ?? "no login"}`);
    }
    for (const [who, want] of [["MANAGER", 403], ["VIEWER", 403], ["DIRECTOR", 403], ["ACCOUNTS", 403], ["TIMESHEETS", 403], [null, 401]])
      t.status(await c.post("/api/documents/refresh", who), want, `POST /api/documents/refresh as ${who ?? "no login"}`);
    const ref = await c.post("/api/documents/refresh", "ADMIN");
    const refBody = await ref.json().catch(() => ({}));
    t.ok(ref.status === 400 && /isn't connected|not connected/i.test(refBody.error ?? ""), "Admin 'Refresh now' with no Graph keys: a plain 'not connected', no run", `${ref.status}`);
    const st = (await c.json("/api/documents/status", "ADMIN")).body;
    t.ok(st && st.connected === false && st.documents === 0 && st.lastRun === null, "status: not connected, 0 documents, never refreshed");
    const s = (await c.json("/api/documents?q=swms", "MANAGER")).body;
    t.ok(Array.isArray(s?.hits) && s.hits.length === 0, "a search returns no hits (nothing indexed)");
    t.status(await c.get("/documents", null), 307, "page /documents signed out -> sign-in");
    const pg = await c.text("/documents", "MANAGER");
    t.ok(pg.status === 200 && !/Application error|Unhandled Runtime Error/.test(pg.text), "page /documents as Manager", pg.status);
    // Never on a site link.
    for (const L of [c.links.sup, c.links.office].filter(Boolean)) {
      t.status(await c.get(c.site(L, "/documents"), null), [404, 405], `site link API /documents (${L === c.links.sup ? "supervisor" : "office"})`);
      const sp = await c.text(c.sitePage(L, "/documents"), null);
      t.ok(sp.status === 404 || !/Document search|\/api\/documents/.test(sp.text), "site link page /documents has no document search", sp.status);
    }
    t.status(await c.get("/api/site/not-a-token/documents", null), [401, 403, 404, 405], "a made-up site path to documents is refused");
    // No index file anywhere (configured path and the default one).
    t.ok(!existsSync(c.p.searchIndex), "no index file at SEARCH_INDEX_PATH (test folder)");
    t.ok(c.pre.defaultIndexExisted || !existsSync(c.p.defaultSearchIndex), "no index file at the default path (../operations-search/search.db)");

    // Static: every shipped folder is unapproved; the index refuses prisma/; the kill switch; Graph OFF without keys.
    const f = await tsxEval(c, "import { FOLDERS } from './src/lib/docsearch/folders.ts'; console.log('RC' + JSON.stringify({ n: FOLDERS.length, approved: FOLDERS.filter((f) => f.approved).map((f) => f.id) }));");
    const fj = JSON.parse(f.out.match(/RC(\{.*\})/)?.[1] ?? "null");
    t.ok(fj && fj.n > 0 && fj.approved.length === 0, `every one of the ${fj?.n ?? "?"} shipped folders is approved:false`, fj ? fj.approved.join(",") : f.out.slice(-200));
    const probe = path.join(c.p.prismaDir, "rc-probe-search.db");
    const i = await tsxEval(c, `import { openIndex } from './src/lib/docsearch/index.ts'; try { openIndex(${JSON.stringify(probe)}); console.log('RCOPENED'); } catch (e) { console.log('RCREFUSED ' + e.message); }`);
    t.ok(/RCREFUSED/.test(i.out) && !existsSync(probe), "the index refuses a path under prisma/ (no file created)", i.out.slice(-200));
    const viaEnv = await tsxEval(c, "import { openIndex, indexPath } from './src/lib/docsearch/index.ts'; try { openIndex(indexPath()); console.log('RCOPENED'); } catch (e) { console.log('RCREFUSED'); }", { SEARCH_INDEX_PATH: probe });
    t.ok(/RCREFUSED/.test(viaEnv.out) && !existsSync(probe), "SEARCH_INDEX_PATH under prisma/ is refused too");
    const k = await tsxEval(c, "import { pickSource, switchedOff } from './src/lib/docsearch/service.ts'; const p = pickSource(); console.log('RC' + JSON.stringify({ off: switchedOff(), why: 'off' in p ? p.off : null }));", { DOC_SEARCH: "off", GRAPH_TENANT_ID: "00000000-0000-0000-0000-000000000000", GRAPH_CLIENT_ID: "x", GRAPH_CLIENT_SECRET: "y" });
    t.ok(/"off":true/.test(k.out) && /switched off/i.test(k.out), "DOC_SEARCH=off wins even with Graph keys set (no source picked)", k.out.slice(-200));
    const g = await tsxEval(c, "import { pickSource } from './src/lib/docsearch/service.ts'; const p = pickSource(); console.log('RC' + JSON.stringify('off' in p ? { off: p.off } : { on: p.source.name }));", { NODE_ENV: "production" });
    t.ok(/"off":/.test(g.out) && /isn't connected/i.test(g.out), "no GRAPH_* keys -> OFF (not connected)", g.out.slice(-200));
    const loc = await tsxEval(c, "import { pickSource } from './src/lib/docsearch/service.ts'; const p = pickSource(); console.log('RC' + JSON.stringify('off' in p ? { off: p.off } : { on: p.source.name }));", { NODE_ENV: "production", DOC_SEARCH_SOURCE: "local", DOC_SEARCH_LOCAL_ROOT: c.p.files });
    t.ok(/"off":/.test(loc.out) && /production/i.test(loc.out), "the local test source is refused in production", loc.out.slice(-200));
  },
};
