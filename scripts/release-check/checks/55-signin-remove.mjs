// Removing a sign-in (was delcheck.mjs) + Accounts stage 4 access. An Admin removes one sign-in from an unlocked week
// with a reason; a Manager can't; twice is refused; it leaves the Sign-ins page and the timesheets.
// WRITES: one sign-in on the test copy goes to REJECTED/removed.
import { readdirSync } from "node:fs";
import path from "node:path";
import { sydneyDate } from "../lib/util.mjs";

export default {
  id: "signin-remove", title: "Sign-in removal (Admin, with reason, unlocked weeks) + invoice-check access",
  writes: true,
  async run(t, c) {
    const cands = [];
    for (let i = 0; i < 10 && cands.length < 40; i++) {
      const date = sydneyDate(new Date(Date.now() - i * 86400000));
      const a = (await c.json(`/api/attendance?date=${date}`, "ADMIN")).body;
      for (const j of [...(a?.points ?? []), ...(a?.jobs ?? [])]) for (const r of j.rows ?? []) if (r.status !== "REJECTED") cands.push({ id: r.id, date });
    }
    if (!cands.length) return t.block("no sign-ins in the last 10 days on the snapshot");
    t.status(await c.del(`/api/attendance/${cands[0].id}`, "MANAGER", { reason: "release check" }), 403, "a Manager can't remove a sign-in");
    t.status(await c.del(`/api/attendance/${cands[0].id}`, "ADMIN", { reason: "" }), 400, "a reason is needed");
    let done = null, locked = 0;
    for (const cand of cands) {
      const r = await c.del(`/api/attendance/${cand.id}`, "ADMIN", { reason: "Release check - signed in twice" });
      if (r.status === 200) { done = cand; break; }
      const b = await r.json().catch(() => ({}));
      if (r.status === 400 && /approved|reopen/i.test(b.error ?? "")) { locked++; continue; }
      t.ok(false, "an Admin removes a sign-in", `got ${r.status}`); return;
    }
    if (locked) t.ok(true, `a locked (approved) week refuses removal (${locked} tried)`);
    if (!done) return t.block("every recent sign-in is in a locked week - the removal itself couldn't be exercised");
    t.ok(true, "an Admin removes a sign-in with a reason -> 200");
    t.status(await c.del(`/api/attendance/${done.id}`, "ADMIN", { reason: "again" }), 400, "removing it twice is refused");
    const after = (await c.json(`/api/attendance?date=${done.date}`, "ADMIN")).body;
    t.ok(![...(after?.points ?? []), ...(after?.jobs ?? [])].flatMap((j) => j.rows ?? []).some((x) => x.id === done.id), "it's gone from the Sign-ins page");
    t.ok(!(await c.text(`/api/timesheets?week=${done.date}`, "MANAGER")).text.includes(done.id), "not in the timesheets");

    for (const p of ["/accounts/invoice-checks", "/accounts/abn-template"]) {
      const pr = await c.text(p, "ACCOUNTS"); t.ok(pr.status === 200 && !/Application error/.test(pr.text), `page ${p} as accounts`, pr.status);
    }
    let apis = [];
    try { apis = readdirSync(path.join(c.p.appDir, "src", "app", "api", "accounts"), { withFileTypes: true }).filter((d) => d.isDirectory() && /invoice-check|abn|rate/.test(d.name)).map((d) => "/api/accounts/" + d.name); } catch { /* none */ }
    for (const a of apis) {
      const sa = (await c.get(a, "ACCOUNTS")).status, sm = (await c.get(a, "MANAGER")).status;
      t.ok(sa !== 403 && sa !== 401 && sm === 403, `${a}: accounts allowed, manager 403`, `${sa}/${sm}`);
    }
  },
};
