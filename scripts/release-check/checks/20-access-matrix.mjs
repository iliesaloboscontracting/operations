// Every GET API route vs every restricted login (no login, TIMESHEETS, DIRECTOR, ACCOUNTS, COORDINATOR, YARD). Routes not on the
// MAY_ANSWER list for that login must refuse with 401/403 (generalises dirtest.mjs's sweep to all one-page roles).
import { MAY_ANSWER, REFUSE_BY_REDIRECT } from "../expected.mjs";

export default {
  id: "access-matrix", title: "Restricted logins refused by every Operations GET API",
  timeoutMs: 400_000,
  async run(t, c) {
    const routes = c.getRoutes();
    t.note(`${routes.length} GET API routes in the candidate`);
    const q = `?date=${c.today}&from=${c.lastWeek}&to=${c.today}&week=${c.lastWeek}`;
    for (const [who, key] of [["no login", "NO_LOGIN"], ["TIMESHEETS", "TIMESHEETS"], ["DIRECTOR", "DIRECTOR"], ["ACCOUNTS", "ACCOUNTS"], ["COORDINATOR", "COORDINATOR"], ["YARD", "YARD"]]) {
      // YD-008 (Ilies approved 4 Nov 2026): a restricted role that can't be swept is never a silent pass - the
      // check is BLOCKED (the other roles are still swept, so their results are in the report).
      if (key !== "NO_LOGIN" && !c.users[key]) { t.block(`${who}: no test login (lib/setup.mjs TEST_ROLES) - the matrix can't sweep it`); continue; }
      if (!MAY_ANSWER[key]) { t.block(`${who}: no MAY_ANSWER list in expected.mjs`); continue; }
      const may = MAY_ANSWER[key];
      const leaked = [], open = [];
      let refused = 0;
      for (const r of routes) {
        const res = await c.get(r + q, key === "NO_LOGIN" ? null : key);
        const st = res.status;
        if (may.some((re) => re.test(r))) { open.push(`${r}=${st}`); continue; }
        if (st === 401 || st === 403) { refused++; continue; }
        if (st >= 300 && st < 400 && REFUSE_BY_REDIRECT.some((re) => re.test(r))) {
          const loc = new URL(res.headers.get("location") ?? "", c.base);
          if (loc.origin === c.base || loc.host === "127.0.0.1:" + c.port) { refused++; continue; }
          leaked.push(`${r}=${st} to ${loc.host}`); continue;
        }
        leaked.push(`${r}=${st}`);
      }
      t.ok(leaked.length === 0, `${who}: all ${refused + leaked.length} routes outside its list refuse (401/403, or a same-site redirect where expected)`, leaked.join(", "));
      t.note(`${who} may-answer routes (${open.length}): ${open.join(", ") || "none"}`);
    }
  },
};
