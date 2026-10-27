// Accounts -> Questions, questions from the Operations AI, and office chat - runs only when the candidate has
// src/app/api/messages (docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md). WRITES synthetic questions and messages to the
// copy. Uses the OWNER and OPS_AI logins (known by email; their passwords are replaced on the copy only).
export default {
  id: "questions-chat", title: "Questions to accounts, Operations AI questions, office chat (edit/delete, owner read-only)",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/app/api/messages/route.ts") || "the candidate has no office chat (src/app/api/messages)",
  async run(t, c) {
    const U = c.users;
    if (!U.OWNER || !U.OPS_AI) return t.block("the owner / Operations AI logins couldn't be set up on the copy");
    const accountsUser = U.ACCOUNTS, due = c.today;
    const trackingBefore = (await c.text("/api/tracking", "MANAGER")).text;
    const counts = async () => Object.fromEntries(await Promise.all(["project", "job", "invoicedCost", "resource", "assignment"].map(async (m) => [m, await c.db[m].count()])));
    const countsBefore = await counts();

    // (a) Accounts -> Questions.
    for (const [who, want] of [["ACCOUNTS", 200], ["OWNER", 200], ["ADMIN", 200], ["OPS_AI", 200], ["ADMIN_PLAIN", 403], ["MANAGER", 403], ["MANAGER_DIRECTOR", 403], ["VIEWER", 403], ["DIRECTOR", 403], ["TIMESHEETS", 403], [null, 401]])
      t.status(await c.get("/api/accounts/questions", who), want, `GET /api/accounts/questions as ${who ?? "no login"}`);
    const ownerQ = (await c.json("/api/accounts/questions", "OWNER")).body;
    t.ok(ownerQ?.canAsk === true, "the owner may 'Ask Victoria'");
    t.ok((await c.json("/api/accounts/questions", "ACCOUNTS")).body?.canAsk === false, "accounts can't ask themselves");
    const ask = await c.post("/api/info-requests", "OWNER", { toUserId: accountsUser.id, type: "QUESTION", title: "RC owner question", question: "Release check: which bank feed?", need: "a yes or no", dueDate: due });
    t.status(ask, 201, "the owner asks accounts (Ask Victoria)");
    const askId = (await ask.json().catch(() => ({}))).id;
    const accList = JSON.stringify((await c.json("/api/accounts/questions", "ACCOUNTS")).body);
    t.ok(!!askId && accList.includes(askId), "accounts see the owner's question on their tab");
    if (askId) t.status(await c.post(`/api/queries/${askId}`, "OWNER", { answer: "owner tries to answer" }), 404, "the owner can't answer it (read-only - only the assignee answers)");

    // (b) Operations AI questions.
    const targets = [["ACCOUNTS", accountsUser.id], ["DIRECTOR", U.DIRECTOR.id], ["ADMIN", U.ADMIN_PLAIN.id], ["MANAGER", U.MANAGER.id], ["OWNER", U.OWNER.id]];
    const aiIds = {};
    for (const [who, id] of targets) {
      const r = await c.post("/api/info-requests", "OPS_AI", { toUserId: id, type: "QUESTION", title: `RC AI question to ${who}`, question: `Release check question for ${who}: was it $1,250?`, dueDate: due });
      t.status(r, 201, `Operations AI asks a ${who} login (with a $ figure)`);
      aiIds[who] = (await r.json().catch(() => ({}))).id;
    }
    for (const [who, id] of [["VIEWER", U.VIEWER.id], ["TIMESHEETS", U.TIMESHEETS.id], ["itself", U.OPS_AI.id]])
      t.status(await c.post("/api/info-requests", "OPS_AI", { toUserId: id, type: "QUESTION", title: `RC AI to ${who}`, question: "Release check question?" }), 400, `Operations AI can't ask ${who}`);
    t.status(await c.post("/api/info-requests", "MANAGER", { toUserId: accountsUser.id, type: "QUESTION", title: "RC manager question", question: "Release check question?" }), 403, "an ordinary Manager can't send questions");
    const tagged = (await c.json("/api/accounts/questions", "ACCOUNTS")).body?.questions ?? [];
    const mine = tagged.find((q) => q.id === aiIds.ACCOUNTS);
    t.ok(mine && /Operations AI/.test(JSON.stringify(mine)), "the question shows as from 'Operations AI'");
    const aiView = (await c.json("/api/info-requests", "OPS_AI")).body;
    t.ok(aiView && (aiView.requests ?? []).every((r) => /Operations AI/.test(JSON.stringify(r))) && !(aiView.requests ?? []).some((r) => r.id === askId), "Operations AI reads back only the questions it sent");
    // The rolling 20-a-day limit (count what the copy already holds).
    const sentAlready = await c.db.siteRequest.count({ where: { kind: "QUERY", requestedBy: "Operations AI", createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    let ok = 0, refusedAt = null;
    for (let i = sentAlready; i < 21; i++) {
      const r = await c.post("/api/info-requests", "OPS_AI", { toUserId: U.MANAGER_DIRECTOR.id, type: "FYI", title: `RC AI limit ${i + 1}`, question: `Release check limit note ${i + 1}.` });
      if (r.status === 201) ok++; else { refusedAt = { n: i + 1, status: r.status }; break; }
    }
    t.ok(refusedAt?.n === 21 && refusedAt.status === 429, "Operations AI: 20 questions in 24 h, the 21st -> 429", JSON.stringify({ sentAlready, ok, refusedAt }));
    // Answers never change data.
    if (aiIds.ACCOUNTS) t.status(await c.post(`/api/queries/${aiIds.ACCOUNTS}`, "ACCOUNTS", { answer: "Release check answer: $1,250 yes" }), 200, "accounts answer the AI's question");
    if (aiIds.MANAGER) t.status(await c.post(`/api/queries/${aiIds.MANAGER}`, "MANAGER", { answer: "Release check answer from a Manager" }), 200, "a Manager answers on /questions");
    t.status(await c.get("/questions", "MANAGER"), 200, "page /questions as Manager");
    t.ok(trackingBefore === (await c.text("/api/tracking", "MANAGER")).text, "answers changed nothing: Tracking byte-for-byte unchanged");
    t.ok(JSON.stringify(countsBefore) === JSON.stringify(await counts()), "answers changed nothing: projects / jobs / invoiced costs / resources / assignments counts unchanged");

    // (c) Office chat: who, in-app only.
    for (const [who, want] of [["OWNER", 200], ["ADMIN", 200], ["MANAGER", 200], ["ACCOUNTS", 200], ["DIRECTOR", 200], ["OPS_AI", 200], ["VIEWER", 403], ["TIMESHEETS", 403], [null, 401]]) {
      t.status(await c.get("/api/messages", who), want, `GET /api/messages as ${who ?? "no login"}`);
      if (want === 403) {
        t.status(await c.get("/api/messages/directory", who), 403, `directory as ${who}`);
        t.status(await c.post("/api/messages", who, { toUserId: U.MANAGER.id, body: "hi" }), 403, `start a thread as ${who}`);
        t.ok((await c.json("/api/messages/unread", who)).body?.unread === 0, `unread badge for ${who} is a plain 0 (expected, no error)`);
      }
    }
    if (c.links.sup) for (const pth of [c.site(c.links.sup, "/messages"), c.site(c.links.office ?? c.links.sup, "/messages")]) t.status(await c.get(pth, null), [404, 405], "no messages route on a site link");
    t.ok(!c.hasPath("src/app/api/site/[token]/messages"), "no /api/site/*/messages route in the source");
    const room = ((await c.json("/api/messages", "MANAGER")).body?.threads ?? []).find((x) => x.room);
    if (!t.ok(!!room, "the Office room is listed")) return;
    const rp = await c.post(`/api/messages/${room.id}`, "DIRECTOR", { body: "Release check room post - the quote is $4,500" });
    t.status(rp, 201, "a director posts in the room with a $ figure (allowed)");
    const roomMsg = (await rp.json().catch(() => ({}))).id;

    // One-to-one Manager -> accounts with an amount; reply; edit / delete rules.
    const st = await c.post("/api/messages", "MANAGER", { toUserId: accountsUser.id, body: "Release check: the hire was $2,310.50 - right?" });
    t.status(st, 201, "a Manager starts a one-to-one with accounts with a $ figure (allowed)");
    const thread = (await st.json().catch(() => ({}))).id;
    if (!thread) return;
    t.status(await c.post(`/api/messages/${thread}`, "ACCOUNTS", { body: "Release check reply" }), 201, "accounts reply");
    const th = (await c.json(`/api/messages/${thread}`, "MANAGER")).body;
    const first = th?.messages?.find((m) => m.mine), reply = th?.messages?.find((m) => !m.mine);
    t.status(await c.post(`/api/messages/${thread}`, "MANAGER", { action: "EDIT", messageId: first?.id, body: "Release check: the hire was $2,310.00 - right?" }), 200, "the sender edits their own message");
    t.status(await c.post(`/api/messages/${thread}`, "ACCOUNTS", { action: "EDIT", messageId: first?.id, body: "changed by someone else" }), 403, "the other person can't edit it");
    t.status(await c.post(`/api/messages/${thread}`, "ACCOUNTS", { action: "DELETE", messageId: first?.id }), 403, "the other person can't delete it");
    t.status(await c.post(`/api/messages/${thread}`, "OWNER", { action: "EDIT", messageId: first?.id, body: "owner edit" }), [403, 404], "the owner can't edit someone else's one-to-one message");
    if (roomMsg) {
      t.status(await c.post(`/api/messages/${room.id}`, "OWNER", { action: "EDIT", messageId: roomMsg, body: "owner edit" }), 403, "the owner can't edit a director's room message (403)");
      t.status(await c.post(`/api/messages/${room.id}`, "OWNER", { action: "DELETE", messageId: roomMsg }), 403, "the owner can't delete a director's room message (403)");
    }
    for (const m of ["PUT", "PATCH", "DELETE"]) t.status(await c.req(m, `/api/messages/${thread}`, "MANAGER", {}), 405, `${m} /api/messages/:id stays 405`);
    const afterEdit = (await c.json(`/api/messages/${thread}`, "ACCOUNTS")).body?.messages?.find((m) => m.id === first?.id);
    t.ok(afterEdit?.edited === true && afterEdit.history?.some((h) => h.kind === "EDIT" && /2,310\.50/.test(h.text)), "edited marker, earlier text kept in history for the other person");
    t.status(await c.post(`/api/messages/${thread}`, "MANAGER", { action: "DELETE", messageId: first?.id }), 200, "the sender deletes their own message");
    t.status(await c.post(`/api/messages/${thread}`, "MANAGER", { action: "DELETE", messageId: first?.id }), 403, "a deleted message can't be deleted again");
    const accSees = (await c.json(`/api/messages/${thread}`, "ACCOUNTS")).body?.messages?.find((m) => m.id === first?.id);
    t.ok(accSees?.deleted === true && accSees.text === null && (accSees.history ?? []).length === 0, "the other person sees 'message deleted', no text, no history");
    const mgrSees = (await c.json(`/api/messages/${thread}`, "MANAGER")).body?.messages?.find((m) => m.id === first?.id);
    t.ok(mgrSees?.deleted === true && (mgrSees.history ?? []).length === 0, "the sender (not the owner) doesn't see the deleted text either");
    t.ok((await c.db.messageVersion.count({ where: { messageId: first?.id } })) === 2, "history kept: one EDIT and one DELETE version");

    // (f) The owner reads every one-to-one, read-only; reading marks nothing seen.
    const all = await c.json("/api/messages?all=1", "OWNER");
    t.ok(all.status === 200 && (all.body?.threads ?? []).some((x) => x.id === thread), "the owner lists every one-to-one (All conversations)");
    for (const who of ["ADMIN", "ADMIN_PLAIN", "DIRECTOR", "MANAGER", "ACCOUNTS"]) t.status(await c.get("/api/messages?all=1", who), 403, `All conversations as ${who}`);
    const seatsBefore = await c.db.messageParticipant.findMany({ where: { threadId: thread }, select: { id: true, lastSeenAt: true }, orderBy: { id: "asc" } });
    const ownerView = (await c.json(`/api/messages/${thread}`, "OWNER")).body;
    t.ok(ownerView?.readOnly === true, "the owner opens it read-only");
    const ownerDel = ownerView?.messages?.find((m) => m.id === first?.id);
    t.ok(ownerDel?.deleted === true && ownerDel.history?.some((h) => h.kind === "DELETE" && /2,310\.00/.test(h.text)), "the owner (only) sees the deleted text in its history");
    t.status(await c.post(`/api/messages/${thread}`, "OWNER", { body: "owner reply" }), 404, "the owner can't post in someone else's one-to-one");
    t.status(await c.post(`/api/messages/${thread}`, "OWNER", { action: "SEEN" }), 404, "the owner can't mark it seen");
    const seatsAfter = await c.db.messageParticipant.findMany({ where: { threadId: thread }, select: { id: true, lastSeenAt: true }, orderBy: { id: "asc" } });
    t.ok(JSON.stringify(seatsBefore) === JSON.stringify(seatsAfter), "the owner reading added no seat and marked nothing seen");
    t.status(await c.get(`/api/messages/${thread}`, "ADMIN"), 404, "a non-owner Admin (director access) can't open someone else's one-to-one");
    t.status(await c.get(`/api/messages/${thread}`, "DIRECTOR"), 404, "a director can't open someone else's one-to-one");

    // AI in chat: named "Operations AI"; its chat limit is separate (not exercised to 20 here).
    const dir = (await c.json("/api/messages/directory", "MANAGER")).body?.users ?? [];
    t.ok(dir.some((u) => u.id === U.OPS_AI.id && u.name === "Operations AI") && !dir.some((u) => u.id === U.VIEWER.id || u.id === U.TIMESHEETS.id), "the directory names the AI 'Operations AI' and lists no Viewer / Timesheets login");
    t.status(await c.post("/api/messages", "OPS_AI", { toUserId: U.MANAGER.id, body: "Release check from the AI: $99" }), 201, "Operations AI starts a one-to-one (amounts allowed)");
    if (reply) t.ok(true, "reply present");
  },
};
