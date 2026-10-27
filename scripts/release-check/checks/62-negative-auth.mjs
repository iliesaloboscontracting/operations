// Negative authorisation for the 27 Oct 2026 security release (SEC-001..013, CH-021..026, DS-014..019), added by the
// Test & Release agent for release ops-20261027 (2026-10-27-release-review.md "Tests to run after applying").
// Covers what 60-docsearch / 61-questions-chat don't: a stranger to a one-to-one can't read, post, edit or delete in
// it; a non-owner Admin can't change or create the Building Agent login or a director's login; the reserved name
// "Operations AI"; unique names; TFN / bank details refused in chat; a Manager can't open a chat about a QUERY
// request; cross-site writes refused (SEC-008); security headers (SEC-009). WRITES a thread and a message to the copy.
export default {
  id: "negative-auth", title: "Negative authorisation: chat strangers, Building Agent / director logins, names, TFN, cross-site, headers",
  writes: true, timeoutMs: 240_000,
  applies: (c) => (c.hasPath("src/app/api/messages/route.ts") && c.hasPath("src/lib/userEdit.ts")) || "needs office chat and the SEC-002 user-edit rules",
  async run(t, c) {
    const U = c.users;
    if (!U.OWNER || !U.OPS_AI) return t.block("the owner / Operations AI logins couldn't be set up on the copy");

    // (1) A one-to-one between MANAGER and ACCOUNTS; strangers can't read, post, edit or delete.
    const st = await c.post("/api/messages", "MANAGER", { toUserId: U.ACCOUNTS.id, body: "Release check negative-auth thread" });
    t.status(st, 201, "a Manager starts a one-to-one with accounts");
    const thread = (await st.json().catch(() => ({}))).id;
    const msg = thread ? (await c.json(`/api/messages/${thread}`, "MANAGER")).body?.messages?.find((m) => m.mine)?.id : null;
    if (thread && msg) {
      for (const who of ["MANAGER_DIRECTOR", "ADMIN", "ADMIN_PLAIN", "DIRECTOR", "OPS_AI"]) {
        t.status(await c.get(`/api/messages/${thread}`, who), 404, `${who} (not in it) GET the thread`);
        t.status(await c.post(`/api/messages/${thread}`, who, { body: "stranger post" }), 404, `${who} (not in it) POST in the thread`);
        t.status(await c.post(`/api/messages/${thread}`, who, { action: "EDIT", messageId: msg, body: "stranger edit" }), [403, 404], `${who} (not in it) EDIT the Manager's message`);
        t.status(await c.post(`/api/messages/${thread}`, who, { action: "DELETE", messageId: msg }), [403, 404], `${who} (not in it) DELETE the Manager's message`);
        t.status(await c.post(`/api/messages/${thread}`, who, { action: "SEEN" }), [403, 404], `${who} (not in it) mark the thread seen`);
      }
      for (const who of ["VIEWER", "TIMESHEETS"]) t.status(await c.get(`/api/messages/${thread}`, who), 403, `${who} GET a thread`);
      t.status(await c.get(`/api/messages/${thread}`, null), 401, "no login GET a thread");
      const still = (await c.json(`/api/messages/${thread}`, "ACCOUNTS")).body?.messages ?? [];
      t.ok(still.length === 1 && still[0].id === msg && !still[0].edited && !still[0].deleted, "the thread is unchanged after the strangers' attempts");
      // CH-022: TFN / bank details refused in a new message and an edit.
      t.status(await c.post(`/api/messages/${thread}`, "MANAGER", { body: "his TFN is 123 456 782" }), 400, "CH-022: a message with a TFN is refused");
      t.status(await c.post(`/api/messages/${thread}`, "MANAGER", { body: "pay to 062-000 12345678" }), 400, "CH-022: a message with a BSB + account is refused");
      t.status(await c.post(`/api/messages/${thread}`, "MANAGER", { action: "EDIT", messageId: msg, body: "new bank details: 062-000 12345678" }), 400, "CH-022: an edit adding bank details is refused");
      t.status(await c.post("/api/messages", "MANAGER", { toUserId: U.ADMIN_PLAIN.id, body: "tax file number 123456782" }), 400, "CH-022: a new thread with a TFN is refused");
    } else t.ok(false, "set up a one-to-one for the stranger tests", `thread ${!!thread}, message ${!!msg}`);

    // (2) CH-024: a Manager can't start a chat about a QUERY request (or an office-kind / director-audience one).
    const q = await c.db.siteRequest.findFirst({ where: { kind: "QUERY" }, select: { id: true } });
    if (q) t.status(await c.post("/api/messages", "MANAGER", { toUserId: U.ACCOUNTS.id, subjectType: "SITE_REQUEST", subjectKey: q.id, body: "about this" }), 403, "CH-024: a Manager chat about a QUERY request is refused (403, not a validation error)");
    else t.note("no QUERY request on the copy - CH-024 route test not exercised");

    // (3) CH-021: the Building Agent login is the owner's to change and create.
    for (const who of ["ADMIN", "ADMIN_PLAIN"]) {
      for (const [field, body] of [["password", { password: "Release-check-x-" + Date.now() }], ["name", { name: "RC renamed agent" }], ["role", { role: "ADMIN" }], ["active", { active: false }]])
        t.status(await c.patch(`/api/users/${U.OPS_AI.id}`, who, body), 403, `CH-021: a non-owner Admin (${who}) changes the Building Agent's ${field}`);
      t.status(await c.post("/api/users", who, { name: "RC agent again", email: U.OPS_AI.email, role: "MANAGER", password: "Release-check-pass-1" }), 403, `CH-021: a non-owner Admin (${who}) creates the Building Agent login`);
    }
    t.status(await c.patch(`/api/users/${U.OPS_AI.id}`, "MANAGER", { name: "x" }), 403, "a Manager can't change any login");
    const agent = await c.db.user.findUnique({ where: { id: U.OPS_AI.id }, select: { name: true, role: true, active: true } });
    t.ok(agent && agent.role === "MANAGER" && agent.active === true && agent.name !== "RC renamed agent", "the Building Agent login is unchanged on the copy");
    t.status(await c.get("/api/auth/me", "OPS_AI"), 200, "the Building Agent session still works (no revocation from refused changes)");

    // (4) SEC-002: a director's login is the owner's to change; only the owner creates DIRECTOR; unique names.
    for (const [field, body] of [["password", { password: "Release-check-y-" + Date.now() }], ["name", { name: "RC renamed director" }], ["active", { active: false }], ["role", { role: "ADMIN" }]])
      t.status(await c.patch(`/api/users/${U.DIRECTOR.id}`, "ADMIN_PLAIN", body), 403, `SEC-002: a non-owner Admin changes a DIRECTOR login's ${field}`);
    t.status(await c.patch(`/api/users/${U.MANAGER_DIRECTOR.id}`, "ADMIN_PLAIN", { password: "Release-check-z-" + Date.now() }), 403, "SEC-002: a non-owner Admin resets a director-access login's password");
    t.status(await c.post("/api/users", "ADMIN_PLAIN", { name: "RC new director " + Date.now(), email: `rc-dir-${Date.now()}@example.test`, role: "DIRECTOR", password: "Release-check-pass-1" }), 403, "a non-owner Admin creates a DIRECTOR login");
    const taken = (await c.db.user.findUnique({ where: { id: U.VIEWER.id }, select: { name: true } }))?.name;
    t.status(await c.post("/api/users", "ADMIN_PLAIN", { name: taken?.toUpperCase(), email: `rc-dup-${Date.now()}@example.test`, role: "VIEWER", password: "Release-check-pass-1" }), 400, "SEC-002: a new login with an active login's name (any case) is refused");
    t.status(await c.patch(`/api/users/${U.TIMESHEETS.id}`, "ADMIN_PLAIN", { name: taken }), 400, "SEC-002: renaming a login to another active login's name is refused");

    // (4b) SEC-002 (d) / R2-POST / SEC-002-R2: an allowed create and edit each write their UserEvent (no password text).
    const cr = await c.post("/api/users", "ADMIN_PLAIN", { name: "RC logged login " + Date.now(), email: `rc-log-${Date.now()}@example.test`, role: "VIEWER", password: "Release-check-pass-1" });
    t.status(cr, 201, "an Admin creates an ordinary VIEWER login");
    const made = (await cr.json().catch(() => ({}))).id;
    if (made) {
      const ev = await c.db.userEvent.findMany({ where: { userId: made }, select: { action: true, byUserId: true, changes: true } });
      t.ok(ev.length === 1 && ev[0].action === "CREATE" && ev[0].byUserId === U.ADMIN_PLAIN.id && !/Release-check-pass-1/.test(ev[0].changes), "R2-POST: the new login has exactly one CREATE UserEvent by the Admin, no password text", JSON.stringify(ev.map((e) => e.action)));
      t.status(await c.patch(`/api/users/${made}`, "ADMIN_PLAIN", { password: "Release-check-pass-2" }), 200, "the Admin resets that login's password");
      const ev2 = await c.db.userEvent.findMany({ where: { userId: made, action: "EDIT" }, select: { changes: true } });
      t.ok(ev2.length === 1 && /"password":"reset"/.test(ev2[0].changes) && !/Release-check-pass-2/.test(ev2[0].changes), "SEC-002-R2: the reset is one EDIT UserEvent saying 'reset', no password text");
    } else t.ok(false, "created login id returned");

    // (5) CH-023: the reserved name "Operations AI", any case.
    t.status(await c.post("/api/users", "ADMIN_PLAIN", { name: "operations ai", email: `rc-ai-${Date.now()}@example.test`, role: "MANAGER", password: "Release-check-pass-1" }), 400, "CH-023: a new login named 'operations ai' is refused");
    t.status(await c.patch(`/api/users/${U.VIEWER.id}`, "ADMIN_PLAIN", { name: "OPERATIONS AI" }), 400, "CH-023: renaming a login to 'OPERATIONS AI' is refused");
    t.status(await c.patch(`/api/users/${U.VIEWER.id}`, "OWNER", { name: "Operations AI" }), 400, "CH-023: even the owner can't use the reserved name");

    // (6) SEC-008: a write from another website is refused; our own origin is not.
    t.status(await c.req("POST", "/api/messages", "MANAGER", { toUserId: U.ACCOUNTS.id, body: "cross-site" }, { origin: "https://evil.example" }), 403, "SEC-008: POST /api/messages with a foreign Origin");
    t.status(await c.req("PATCH", `/api/users/${U.VIEWER.id}`, "ADMIN_PLAIN", { name: "x" }, { origin: "https://evil.example" }), 403, "SEC-008: PATCH /api/users with a foreign Origin");
    t.status(await c.req("POST", "/api/auth/login", null, { email: "x@example.test", password: "x" }, { origin: "null" }), 403, "SEC-008: login POST with Origin null");
    const same = await c.req("GET", "/api/auth/me", "MANAGER", undefined, { origin: "https://evil.example" });
    t.status(same, 200, "SEC-008: a GET is never refused on Origin");
    const own = await c.req("POST", "/api/messages/unread", "MANAGER", {}, { origin: c.base });
    t.ok(own.status !== 403 || !/another website/i.test(await own.text()), "SEC-008: our own Origin is not refused as cross-site", own.status);

    // (7) SEC-009: headers on a page and an API reply; no X-Powered-By.
    for (const pth of ["/login", "/api/auth/me"]) {
      const r = await c.get(pth, null);
      const h = r.headers;
      t.ok(h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "SAMEORIGIN" && h.get("referrer-policy") === "same-origin" && /camera=\(self\)/.test(h.get("permissions-policy") ?? "") && !h.get("x-powered-by"),
        `SEC-009: security headers on ${pth}, no X-Powered-By`, JSON.stringify(Object.fromEntries([...h].filter(([k]) => /x-|referrer|permissions/.test(k)))));
    }
  },
};
