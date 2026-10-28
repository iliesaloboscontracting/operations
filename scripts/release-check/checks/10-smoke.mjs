// Pages, core APIs, site links, the scope-of-works PDF and the sign-in gate (was n15smoke.mjs).
import { noMoney } from "../lib/context.mjs";

const PAGES = ["/assistant", "/attendance", "/bugs", "/calendar", "/command", "/completed", "/day-review", "/hire", "/labour",
  "/notes", "/plant", "/projects", "/requests", "/timesheets", "/tools", "/tools/faults", "/tools/site", "/tools/toolboxes", "/tracking",
  "/users", "/vehicles", "/receipts", "/production", "/changes", "/office-requests", "/purchases"];

export default {
  id: "smoke", title: "Pages, core APIs, site links, PDF, sign-in gate",
  async run(t, c) {
    const today = c.today;
    const pj = await c.json("/api/projects", "ADMIN");
    t.status(pj.status, 200, "GET /api/projects as Admin");
    const list = Array.isArray(pj.body) ? pj.body : pj.body?.projects ?? [];
    const project = list.find((x) => x.status === "ACTIVE") ?? list[0];
    if (!project) return t.block("the snapshot has no projects");
    for (const pg of [...PAGES, `/projects/${project.id}`, `/tracking/${project.id}`]) {
      const r = await c.get(pg, "ADMIN"); const html = await r.text();
      t.ok(r.status === 200 && !/Application error|Unhandled Runtime Error/.test(html), `page ${pg.replace(project.id, ":id")}`, r.status);
    }
    // The Invoices tab was removed on 28 Oct 2026 (Ilies); its old address forwards to Accounts data.
    const inv = await c.get("/invoices", "ADMIN");
    t.ok([307, 308].includes(inv.status) && (inv.headers.get("location") ?? "").includes("/accounts/xero"), "old /invoices forwards to /accounts/xero", inv.status);
    const apis = [`/api/jobs?date=${today}`, `/api/calendar?from=${today}&to=${today}`, `/api/attendance?date=${today}`, "/api/timesheets", "/api/requests",
      "/api/hire-alerts", `/api/alerts?date=${today}`, "/api/resources", "/api/tracking", `/api/day-review?date=${today}`, "/api/tools",
      "/api/invoice-inbox", `/api/projects/${project.id}`, "/api/site-links", "/api/auth/me", "/api/receipts", "/api/production"];
    for (const a of apis) t.status(await c.get(a, "MANAGER"), 200, `GET ${a.split("?")[0].replace(project.id, ":id")} as Manager`);
    // Known-expected: logins are Admin business only.
    t.status(await c.get("/api/users", "MANAGER"), 403, "GET /api/users as Manager (expected refusal)");
    t.status(await c.get("/api/users", "ADMIN"), 200, "GET /api/users as Admin");
    const pdf = await c.get(`/api/projects/${project.id}/scope-pdf`, "MANAGER");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    t.ok(pdf.status === 200 && bytes.subarray(0, 4).toString() === "%PDF", "scope-of-works PDF renders", pdf.status);

    // Site links: no session, the link's own secret.
    const L = c.links;
    if (!L.sup || !L.office) t.block(L.missing.join("; "));
    else {
      for (const pth of [c.sitePage(L.sup), c.site(L.sup), c.sitePage(L.sup, "/app.webmanifest"), c.site(L.sup, "/requests"), c.site(L.office, "/todo"), c.sitePage(L.office)]) {
        const r = await c.get(pth, null); const body = await r.text();
        t.ok(r.status === 200, `site link ${c.scrub(pth)}`, r.status);
        if (pth.startsWith("/api/")) t.ok(noMoney(body), `no $ figure in ${c.scrub(pth)}`);
      }
      const si = await c.get(c.site(L.sup, "/signin"), null);
      const sij = await si.json().catch(() => ({}));
      t.status(si.status, 200, "supervisor sign-in screen data");
      const code = JSON.stringify(sij).match(/"(?:code|qrCode|signInCode)"\s*:\s*"([^"]+)"/)?.[1];
      if (code) {
        t.status(await c.get(`/site/in/${encodeURIComponent(code)}`, null), 200, "crew QR sign-in page opens");
        t.status(await c.get(`/api/site/in/${encodeURIComponent(code)}`, null), 200, "crew QR sign-in data");
      } else t.note("no QR code in the supervisor's sign-in data today (no job on the board) - QR pages not exercised");
    }
    t.status(await c.get("/api/site/not-a-real-token", null), [401, 403, 404], "a bad site token is refused");
    t.status(await c.get("/command", null), 307, "signed out: a page redirects to sign-in");
    t.status(await c.get("/api/tracking", null), 401, "signed out: data refused");
    t.status(await c.get("/_next/image?url=%2Flogo.png&w=64&q=75", null), 404, "the image optimiser stays refused");
    // Logout clears the cookie. Since SEC-001 a sign-out ends EVERY session of that login, so: two fresh VIEWER
    // sessions, sign one out, the other must stop working too; then drop the cached VIEWER cookie so later checks
    // log in again.
    const u = c.users.VIEWER;
    const fresh = async () => (await fetch(c.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) })).headers.get("set-cookie")?.split(";")[0];
    const ck = await fresh(), other = await fresh();
    t.status(await fetch(c.base + "/api/auth/me", { headers: { cookie: other ?? "" } }), 200, "a second VIEWER session works before sign-out");
    const lo = await fetch(c.base + "/api/auth/logout", { method: "POST", headers: { cookie: ck ?? "" } });
    t.ok(lo.status === 200 && /Max-Age=0/i.test(lo.headers.get("set-cookie") ?? ""), "logout clears the session", lo.status);
    t.status(await fetch(c.base + "/api/auth/me", { headers: { cookie: other ?? "" } }), 401, "SEC-001: the other VIEWER session is signed out too");
    c.forget("VIEWER");
  },
};
