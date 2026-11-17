// Directors -> Tenders (17 Nov 2026, Ilies: "yes build the tenders tab"). Checks the Operations side only (Estimating
// isn't running in the release check): director access only, the tab says "not switched on" without BOARD_SECRET,
// inputs are checked before anything goes to Estimating, and the page / proxy never carry the board key.
import { readFileSync } from "node:fs";
import path from "node:path";

export default {
  id: "directors-tenders", title: "Directors Tenders tab: director only, off without the key, inputs checked",
  writes: false, timeoutMs: 60_000,
  applies: (c) => c.hasPath("src/app/api/directors/tenders/route.ts") || "needs the Tenders tab",
  async run(t, c) {
    const API = "/api/directors/tenders";
    for (const who of ["MANAGER", "VIEWER", "COORDINATOR", "ACCOUNTS", "TIMESHEETS", "YARD"]) {
      t.status(await c.json(API, who), 403, `the Tenders list is refused for ${who}`);
      t.status(await c.post(`${API}/abc/assign`, who, { version: 1, assignee: "", reason: "test" }), 403, `assign refused for ${who}`);
      t.status(await c.post(`${API}/log-quote`, who, {}), 403, `log-quote refused for ${who}`);
    }
    t.status(await c.json(API, null), 401, "no login: refused");
    const d = await c.json(API, "DIRECTOR");
    t.ok(d.status === 200 && ["OFF", "UNREACHABLE", "REFUSED"].includes(d.body?.state), "a director gets the tab; with no Estimating / key it says so", JSON.stringify(d.body));
    t.ok(!JSON.stringify(d.body ?? {}).match(/\$\d/), "nothing priced when it isn't connected");
    t.status(await c.json(`${API}?from=17/11/2026`, "DIRECTOR"), 400, "bad dates refused");
    t.status(await c.post(`${API}/..%2Fx/assign`, "DIRECTOR", { version: 1, assignee: "", reason: "test" }), [400, 404], "a path trick in the id is refused");
    t.status(await c.post(`${API}/abc/assign`, "DIRECTOR", { version: 1, assignee: "Bad Key!", reason: "test" }), 400, "an odd assignee is refused");
    t.status(await c.post(`${API}/abc/assign`, "DIRECTOR", { version: 1, assignee: "", reason: "x" }), 400, "a reason is needed");
    t.status(await c.post(`${API}/log-quote`, "DIRECTOR", { fileName: "q.pdf", dataUrl: "data:application/pdf;base64,PGh0bWw+", builder: "Acme", valueExGst: 10, quoteNo: "26_001" }), 400, "a file that isn't really a PDF is refused");
    t.status(await c.post(`${API}/log-quote`, "DIRECTOR", { fileName: "q.exe", dataUrl: "data:application/pdf;base64,JVBERi0=", builder: "Acme", valueExGst: 10, quoteNo: "26_001" }), 400, "a non-PDF / Word name is refused");
    t.status(await c.post(`${API}/log-quote`, "DIRECTOR", { fileName: "q.pdf", dataUrl: "data:application/pdf;base64,JVBERi0=", builder: "Acme", valueExGst: 10 }), 400, "no tender and no quote number: refused");
    t.status(await c.json(`${API}/abc/quote-files/..%2F..%2Fetc`, "DIRECTOR"), [400, 404], "a path trick in a quote-file id is refused");
    let page = "", proxy = "";
    try {
      page = readFileSync(path.join(c.p.appDir, "src", "app", "directors", "tenders", "page.tsx"), "utf8");
      proxy = readFileSync(path.join(c.p.appDir, "src", "lib", "estimatingProxy.ts"), "utf8");
    } catch { /* missing */ }
    t.ok(!/x-lobos-board|BOARD_SECRET\s*[=:]/.test(page), "the page never handles the board key");
    t.ok(/"x-lobos-board"/.test(proxy) && /SERVER_ONLY_HEADERS/.test(proxy), "the /estimating proxy never forwards a browser's x-lobos-board (EST2-006)");
  },
};
