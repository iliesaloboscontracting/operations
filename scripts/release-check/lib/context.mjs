// Release check: what each check module gets - an HTTP client bound to the test server, cached logins per role, the
// throwaway links, the test database (Prisma, test.db only) and the list of the candidate's GET API routes.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { mondayOf, scrub, sydneyDate } from "./util.mjs";

export function makeContext({ base, p, db, users, links, port, options }) {
  const cookies = {};
  const today = sydneyDate();
  const ctx = {
    base, p, db, users, links, port, options, today,
    lastWeek: mondayOf(today, 1), thisWeek: mondayOf(today, 0),
    async login(key) {
      if (!key) return null;
      if (cookies[key]) return cookies[key];
      const u = users[key];
      if (!u) throw new Error(`no test login for ${key}`);
      const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) });
      const c = r.headers.get("set-cookie")?.split(";")[0];
      if (r.status !== 200 || !c) throw new Error(`login as ${key} failed (${r.status})`);
      cookies[key] = { cookie: c, body: await r.json().catch(() => ({})) };
      return cookies[key];
    },
    async req(method, pth, who, body, headers = {}) {
      const s = who ? await ctx.login(who) : null;
      const h = { ...(s ? { cookie: s.cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
      return fetch(base + pth, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    },
    get: (pth, who) => ctx.req("GET", pth, who),
    post: (pth, who, body = {}) => ctx.req("POST", pth, who, body),
    put: (pth, who, body = {}) => ctx.req("PUT", pth, who, body),
    patch: (pth, who, body = {}) => ctx.req("PATCH", pth, who, body),
    del: (pth, who, body) => ctx.req("DELETE", pth, who, body),
    async json(pth, who) { const r = await ctx.get(pth, who); return { status: r.status, body: await r.json().catch(() => null) }; },
    async text(pth, who) { const r = await ctx.get(pth, who); return { status: r.status, text: await r.text().catch(() => "") }; },
    site: (link, rest = "") => `/api/site/${link.secret}${rest}`,
    sitePage: (link, rest = "") => `/site/${link.secret}${rest}`,
    // Every GET API route of the candidate without a [dynamic] segment, from its own source tree.
    getRoutes() {
      const apiDir = path.join(p.appDir, "src", "app", "api");
      const out = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) { if (!e.name.includes("[")) walk(full); }
          else if (e.name === "route.ts" && /export\s+(const|async\s+function)\s+GET\b/.test(readFileSync(full, "utf8")))
            out.push("/api/" + path.relative(apiDir, d).split(path.sep).join("/"));
        }
      };
      walk(apiDir);
      return out.sort();
    },
    hasPath: (rel) => { try { readFileSync(path.join(p.appDir, rel)); return true; } catch { try { readdirSync(path.join(p.appDir, rel)); return true; } catch { return false; } } },
    scrub,
  };
  return ctx;
}

// One check module's run: assertions, plus BLOCKED / SKIPPED with a reason.
export function makeTally() {
  const items = [];
  let blocked = null, skipped = null;
  const t = {
    items,
    ok(cond, name, detail) { items.push({ ok: !!cond, name, detail: cond ? undefined : scrub(detail ?? "").slice(0, 240) }); return !!cond; },
    status(res, want, name) {
      const s = typeof res === "number" ? res : res.status;
      const wants = Array.isArray(want) ? want : [want];
      return t.ok(wants.includes(s), `${name} -> ${wants.join("/")}`, `got ${s}`);
    },
    note(text) { items.push({ note: scrub(text).slice(0, 240) }); },
    block(reason) { blocked = scrub(reason); },
    skip(reason) { skipped = scrub(reason); },
    get blocked() { return blocked; },
    get skipped() { return skipped; },
  };
  return t;
}

export const noMoney = (text) => !/\$\s?\d/.test(text);
