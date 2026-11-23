// Message at sign-in (Ilies, 23 Nov 2026: "yes build it, deploy once passes"). The office writes a short note to one
// person, several (active Labour-register people) or everyone who signs in; it shows on the person's phone after a QR
// sign-in succeeds (after any truck pre-start) and on their own SUPERVISOR / DRIVER link home; "Got it" = seen once.
//   (1) Who: Managers, Admins and the coordinator write, read the office view and archive; VIEWER / TIMESHEETS /
//       ACCOUNTS / DIRECTOR / YARD 403, signed out 401 - nothing written.
//   (2) Text: at most 300 characters, no $ amounts, no TFN / bank (400); people only from the active Labour register.
//   (3) A person sees only their own and "everyone" messages - never another person's; archived and finished ones never.
//       SM-001 B: after a QR sign-in their own show only on a known phone (an earlier-day CONFIRMED, not removed sign-in
//       of theirs on that device id); an unknown phone gets everyone messages only and Got it on their own is 404; their
//       own SUPERVISOR / DRIVER link still shows their own. SM-004: no site-link route touches the office chat.
//   (4) The sign-in succeeds and returns on its own: the IN reply only carries a token (no message in it), the sign-in is
//       saved before any message is read; STATUS carries no token; the truck's required pre-start is unchanged.
//   (5) "Got it" records seen (QR / LINK) and it doesn't show again - once overall across the QR and the link; a hire
//       worker is matched by the typed name + company keys; someone else's message can't be marked.
//   (6) OFFICE links get nothing; no $ in any phone reply; the office view shows seen / not seen yet; 30 a day per login;
//       archive keeps everything - nothing deleted, the text never rewritten.
// WRITES on the test copy: made-up people, a truck, a yard point, a supervisor / driver / office link, sign-ins, messages
// and their "Got it" rows; everyone signed out, links revoked, people switched off and our live messages archived at the end.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const WRITERS = ["MANAGER", "ADMIN", "COORDINATOR"];
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];
const addDays = (iso, n) => new Date(new Date(iso + "T12:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "signin-messages", title: "Message at sign-in: office notes (Manager / Admin / coordinator) shown after a QR sign-in and on the person's own link, own + everyone only, Got it once, archive kept, no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/signinMessages/rules.ts") || "needs lib/signinMessages/rules.ts",
  async run(t, c) {
    // SM-004 (approved by Ilies 23 Nov 2026): no site-link route (src/app/api/site/**) reaches the office chat - it never
    // imports lib/messages/ and never touches the chat tables (Message, MessageThread, MessageParticipant,
    // MessageVersion). Sign-in messages (SigninMessage*) are a separate store and are fine.
    {
      const siteDir = path.join(c.p.appDir, "src", "app", "api", "site");
      const files = [];
      const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(f); } };
      try { walk(siteDir); } catch { /* missing - the count below fails */ }
      const CHAT_IMPORT = /["'](?:@\/|(?:\.\.?\/)+)(?:src\/)?lib\/messages(?:\/|["'])/;
      const CHAT_TABLE = /\b(?:prisma|tx|db)\s*\.\s*(?:message|messageThread|messageParticipant|messageVersion)\b/;
      const bad = files.filter((f) => { const s = readFileSync(f, "utf8"); return CHAT_IMPORT.test(s) || CHAT_TABLE.test(s); }).map((f) => path.relative(c.p.appDir, f));
      t.ok(files.length > 0 && bad.length === 0, `SM-004: none of the ${files.length} site-link route files imports the office chat (lib/messages/) or uses its tables`, bad.join(", ").slice(0, 300));
    }
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const net0 = netLines(c);
    const phone = []; // every reply a phone / link got
    const people = [], links = [], trucks = [], ours = [];
    const keep = async (r, list = null) => { const text = await r.text().catch(() => ""); if (list) list.push(text); let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body, text }; };
    const mkPerson = async (x, extra = {}) => { const r = await db.resource.create({ data: { type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", name: `Rc102${x} Tester ${tag}`, ...extra } }); people.push(r.id); return r; };
    const write = async (who, body) => { const r = await keep(await c.post("/api/attendance/messages", who, body)); if (r.status === 201) ours.push(r.body.id); return r; };
    const archive = async (who, id, body = {}) => keep(await c.post(`/api/attendance/messages/${encodeURIComponent(id)}/archive`, who, body));
    const office = async (who = "MANAGER") => keep(await c.get("/api/attendance/messages", who));
    const scan = async (point) => { const s = await c.json(`/api/site/in/${encodeURIComponent(point.secret)}`, null); phone.push(JSON.stringify(s.body ?? {})); return s.body?.ticket; };
    const sign = async (point, action, who, deviceId) => keep(await c.post("/api/site/in/sign", null, { ticket: await scan(point), jobId: point.id, action, deviceId, gps: { status: "DENIED" }, ...who }), phone);
    const inbox = async (token) => keep(await c.req("GET", "/api/site/in/office-notes", null, undefined, token ? { "x-message-token": token } : {}), phone);
    const gotIt = async (token, messageId, deviceId = `rc102-${tag}`) => keep(await c.post("/api/site/in/office-notes", null, { token, messageId, deviceId }), phone);
    const linkInbox = async (l) => keep(await c.get(c.site(l, "/office-notes"), null), phone);
    const linkGotIt = async (l, messageId) => keep(await c.post(c.site(l, "/office-notes"), null, { messageId, deviceId: `rc102-link-${tag}` }), phone);
    const ids = (r) => (r.body?.messages ?? []).map((m) => m.id);
    const has = (r, ...want) => want.every((id) => ids(r).includes(id));
    const lacks = (r, ...not) => not.every((id) => !ids(r).includes(id));

    // Seed: A, B, C, D (a truck driver), Z (rate-limit target), I (switched off), M (a machine); a yard point; a truck.
    const A = await mkPerson("a"), B = await mkPerson("b"), Cc = await mkPerson("c"), D = await mkPerson("d", { category: "Truck Driver" }), Z = await mkPerson("z"), E = await mkPerson("e");
    const I = await mkPerson("i", { active: false });
    const M = await db.resource.create({ data: { type: "EQUIPMENT", category: "Excavator", name: `RC102 machine ${tag}`, ownership: "OWNED", status: "AVAILABLE" } });
    people.push(M.id);
    const Y = await makeLink(db, "POSTER", null, { place: "YARD" }); links.push(Y.id);
    const T = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC102 truck ${tag}`, identifier: `R2${tag}`.slice(0, 12), ownership: "OWNED", status: "AVAILABLE" } });
    trucks.push(T.id);
    const TP = await makeLink(db, "POSTER", T.id, { place: "VEHICLE" }); links.push(TP.id);
    const count = () => db.signinMessage.count();
    const count0 = await count();
    // SM-001 B: a "known device" = an earlier-day CONFIRMED sign-in by the same person on the same device id (seeded).
    const DAY = 86_400_000;
    const pastSignIn = (r, deviceId, extra = {}) => db.siteAttendance.create({ data: {
      place: "YARD", placeLabel: "Yard", date: addDays(c.today, -3), resourceId: r.id, workerName: r.name, deviceId,
      signInAt: new Date(Date.now() - 3 * DAY), signOutAt: new Date(Date.now() - 3 * DAY + 8 * 3_600_000), signInMethod: "POSTER", signOutMethod: "POSTER", status: "CONFIRMED", ...extra,
    } });

    // (1) Who may.
    for (const who of WRITERS) t.status(await office(who), 200, `the office view: ${who}`);
    for (const who of REFUSED) {
      t.status(await office(who), 403, `the office view: ${who} refused`);
      t.status(await write(who, { text: `RC102 not allowed ${tag}`, audience: "ALL" }), 403, `writing: ${who} refused`);
    }
    t.status(await office(null), 401, "the office view: signed out 401");
    t.status(await write(null, { text: `RC102 not allowed ${tag}`, audience: "ALL" }), 401, "writing: signed out 401");
    t.ok((await count()) === count0, "nothing was written by any of those");

    // (2) Text and people.
    const refusedText = [["$ amount", "Bonus of $50 this week"], ["spaced $", "Bonus $ 50"], ["TFN", "Your TFN 123 456 782 is wrong"], ["bank", "BSB 062-000 account 12345678"], ["301 characters", "a".repeat(301)]];
    for (const [what, text] of refusedText) t.status(await write("MANAGER", { text, audience: "ALL" }), 400, `text with ${what} refused`);
    t.status(await write("MANAGER", { text: `RC102 machine ${tag}`, audience: "PEOPLE", resourceIds: [M.id] }), 400, "a machine as a recipient refused");
    t.status(await write("MANAGER", { text: `RC102 off ${tag}`, audience: "PEOPLE", resourceIds: [I.id] }), 400, "someone switched off on the register refused");
    t.status(await write("MANAGER", { text: `RC102 past ${tag}`, audience: "ALL", showUntil: addDays(c.today, -1) }), 400, "a 'show until' in the past refused");
    t.ok((await count()) === count0, "still nothing written");

    // The messages.
    const TXT = (n) => `RC102 ${n} ${tag} - please do your pre-start`;
    const mAll = (await write("MANAGER", { text: TXT("everyone"), audience: "ALL" })).body?.id;
    const wA = await write("COORDINATOR", { text: TXT("for A"), audience: "PEOPLE", resourceIds: [A.id] });
    t.status(wA, 201, "the coordinator writes to one person");
    const mA = wA.body?.id;
    const mAB = (await write("ADMIN", { text: TXT("for A and B"), audience: "PEOPLE", resourceIds: [A.id, B.id] })).body?.id;
    const mC = (await write("MANAGER", { text: TXT("for C only"), audience: "PEOPLE", resourceIds: [Cc.id] })).body?.id;
    const mArch = (await write("MANAGER", { text: TXT("archived"), audience: "ALL" })).body?.id;
    const mExp = (await db.signinMessage.create({ data: { text: TXT("finished"), audience: "ALL", showUntil: addDays(c.today, -1), createdBy: `RC102 ${tag}` } })).id;
    ours.push(mExp);
    t.ok(![mAll, mA, mAB, mC, mArch].some((x) => !x), "five messages written (Manager, coordinator, Admin)");
    const row = await db.signinMessage.findUnique({ where: { id: mAll ?? "none" } });
    t.ok(row?.showUntil === addDays(c.today, 14) && row.createdById === c.users.MANAGER.id, "'show until' defaults to 14 days; who wrote it is kept");
    t.ok((await db.signinMessageRecipient.count({ where: { messageId: mAB ?? "none" } })) === 2, "A and B are on the A+B message");
    t.status(await archive("COORDINATOR", mArch, { reason: `RC102 archive ${tag}` }), 200, "the coordinator archives one");
    for (const who of REFUSED) t.status(await archive(who, mAll), 403, `archiving: ${who} refused`);
    t.status(await archive(null, mAll), 401, "archiving: signed out 401");
    t.status(await archive("ADMIN", mArch), 409, "archiving twice 409");

    // (4) A signs in at the yard: saved first, the reply only carries a token. A's phone is known (an earlier day).
    const devA = `rc102-a-${tag}`;
    await pastSignIn(A, devA);
    const stA = await sign(Y, "STATUS", { resourceId: A.id }, devA);
    t.ok(stA.status === 200 && stA.body?.messages === undefined, "STATUS carries no message token", stA.status);
    const inA = await sign(Y, "IN", { resourceId: A.id }, devA);
    if (!t.ok(inA.status === 200 && inA.body?.ok === true && typeof inA.body?.messages === "string", "A's yard sign-in goes through, with a message token", `${inA.status} ${inA.text.slice(0, 120)}`)) return;
    t.ok(!inA.text.includes(tag), "the sign-in reply holds no message text");
    const attA = await db.siteAttendance.findFirst({ where: { resourceId: A.id, place: "YARD", signOutAt: null }, orderBy: { signInAt: "desc" } });
    t.ok(!!attA, "A's sign-in is saved before any message is read");
    const boxA = await inbox(inA.body.messages);
    t.ok(boxA.status === 200 && has(boxA, mAll, mA, mAB), "A sees the everyone message and both of their own", JSON.stringify(ids(boxA)));
    t.ok(lacks(boxA, mC, mArch, mExp), "...never C's, the archived one or the finished one");
    t.ok(!boxA.text.includes(Cc.name) && !boxA.text.includes(B.name) && !boxA.text.includes("Release check"), "...and no other person's name, nor who wrote it");
    t.ok((boxA.body?.messages ?? []).every((m) => Object.keys(m).sort().join() === "id,sent,text"), "each message is just its words and day");
    t.status(await inbox(null), 401, "no token: refused");
    t.status(await keep(await c.get(`/api/site/in/office-notes?token=${encodeURIComponent(inA.body.messages)}`, null)), 401, "the token in the address is not accepted");

    // (5) Got it.
    t.status(await gotIt(inA.body.messages, mA), 200, "A: Got it");
    t.status(await gotIt(inA.body.messages, mA), 200, "a second tap is fine");
    t.ok((await db.signinMessageSeen.count({ where: { messageId: mA, personKey: A.id, where: "QR", attendanceId: attA?.id } })) === 1, "seen recorded once, after the QR sign-in, with the sign-in");
    t.ok(lacks(await inbox(inA.body.messages), mA), "it doesn't show again");
    t.status(await gotIt(inA.body.messages, mC), 404, "A can't mark C's message");
    t.status(await gotIt(inA.body.messages, mArch), 404, "...nor an archived one");
    t.ok((await db.signinMessageSeen.count({ where: { messageId: { in: [mC, mArch] } } })) === 0, "...nothing recorded");

    // B: their own SUPERVISOR link home, then a QR sign-in - seen once overall.
    const LB = await makeLink(db, "SUPERVISOR", B.id); links.push(LB.id);
    const lb = await linkInbox(LB);
    t.ok(lb.status === 200 && has(lb, mAll, mAB) && lacks(lb, mA, mC, mArch, mExp), "B's supervisor link: everyone + their own only", JSON.stringify(ids(lb)));
    t.status(await linkGotIt(LB, mAB), 200, "B: Got it on the link");
    t.ok((await db.signinMessageSeen.count({ where: { messageId: mAB, personKey: B.id, where: "LINK", siteLinkId: LB.id } })) === 1, "seen recorded on the link");
    t.status(await linkGotIt(LB, mC), 404, "B's link can't mark C's message");
    await pastSignIn(B, `rc102-b-${tag}`); // B's phone is known too
    const inB = await sign(Y, "IN", { resourceId: B.id }, `rc102-b-${tag}`);
    const boxB = await inbox(inB.body?.messages);
    t.ok(inB.status === 200 && has(boxB, mAll) && lacks(boxB, mAB, mA), "B's QR sign-in: the link's Got it counts - A+B doesn't show again", JSON.stringify(ids(boxB)));

    // SM-001 B: C signs in at the yard on a phone never used by C before - everyone messages only; C's own can't be marked.
    const inC = await sign(Y, "IN", { resourceId: Cc.id }, `rc102-c-new-${tag}`);
    const boxC = await inbox(inC.body?.messages);
    t.ok(inC.status === 200 && has(boxC, mAll) && lacks(boxC, mC, mA, mAB), "SM-001: an unknown phone sees the everyone message only - not C's own", JSON.stringify(ids(boxC)));
    t.status(await gotIt(inC.body?.messages, mC, `rc102-c-new-${tag}`), 404, "SM-001: Got it on C's own message from an unknown phone: 404, as a missing message");
    t.ok((await db.signinMessageSeen.count({ where: { messageId: mC } })) === 0, "...nothing recorded");
    // E: earlier sign-ins that don't count - the same phone but removed (REJECTED), and CONFIRMED on another phone.
    const mE = (await write("MANAGER", { text: TXT("for E"), audience: "PEOPLE", resourceIds: [E.id] })).body?.id;
    const devE = `rc102-e-${tag}`;
    await pastSignIn(E, devE, { status: "REJECTED", removedAt: new Date(), removedBy: `RC102 ${tag}` });
    await pastSignIn(E, `rc102-e-other-${tag}`);
    const inE = await sign(Y, "IN", { resourceId: E.id }, devE);
    const boxE = await inbox(inE.body?.messages);
    t.ok(!!mE && inE.status === 200 && has(boxE, mAll) && lacks(boxE, mE), "SM-001: a removed sign-in on this phone, or a confirmed one on another phone, doesn't make it known", JSON.stringify(ids(boxE)));
    // The person's own link is personal: E's SUPERVISOR link shows E's message.
    const LE = await makeLink(db, "SUPERVISOR", E.id); links.push(LE.id);
    t.ok(has(await linkInbox(LE), mAll, mE), "SM-001: E's own link still shows E's message");

    // C: a DRIVER link; an OFFICE link gets nothing.
    const LC = await makeLink(db, "DRIVER", Cc.id); links.push(LC.id);
    const lc = await linkInbox(LC);
    t.ok(lc.status === 200 && has(lc, mAll, mC) && lacks(lc, mA, mAB), "C's driver link: everyone + C's own", JSON.stringify(ids(lc)));
    const LO = await makeLink(db, "OFFICE", A.id); links.push(LO.id);
    t.status(await linkInbox(LO), 404, "an OFFICE link gets no messages");

    // A hire worker: everyone messages only, matched by name + company keys.
    const devH = `rc102-h-${tag}`;
    const inH = await sign(Y, "IN", { hire: { name: `Sam O'Rc${tag}`, company: "Advanced Labour Hire Pty Ltd" } }, devH);
    const boxH = await inbox(inH.body?.messages);
    t.ok(inH.status === 200 && has(boxH, mAll) && lacks(boxH, mA, mAB, mC), "a hire worker sees the everyone message only", JSON.stringify(ids(boxH)));
    t.status(await gotIt(inH.body?.messages, mAll), 200, "the hire worker: Got it");
    t.status(await sign(Y, "OUT", { hire: { name: `Sam O'Rc${tag}`, company: "Advanced Labour Hire Pty Ltd" } }, devH), 200, "...signs out");
    const inH2 = await sign(Y, "IN", { hire: { name: `  sam   orc${tag} `, company: "advanced" } }, devH);
    t.ok(inH2.status === 200 && lacks(await inbox(inH2.body?.messages), mAll), "...and signing in again typed differently (case, spaces, punctuation, company spelling) it doesn't show again");
    const inH3 = await sign(Y, "IN", { hire: { name: `Sam O'Rc${tag}`, company: "Other Crew Co" } }, `rc102-h3-${tag}`);
    t.ok(inH3.status === 200 && has(await inbox(inH3.body?.messages), mAll), "the same name from another company is another person - it shows");

    // (4) The truck's required pre-start is unchanged; the message token comes alongside, read separately.
    const inD = await sign(TP, "IN", { resourceId: D.id }, `rc102-d-${tag}`);
    t.ok(inD.status === 200 && inD.body?.prestartRequired === true && typeof inD.body?.prestart === "string" && typeof inD.body?.odometer === "string" && typeof inD.body?.messages === "string",
      "a truck's first sign-in: still required pre-start + odometer, plus the message token", inD.status);
    t.status(await keep(await c.post("/api/site/in/odometer", null, { token: inD.body?.odometer, skip: true })), 409, "the odometer skip on the required pre-start is still refused");
    const view = await keep(await c.req("GET", "/api/site/in/prestart", null, undefined, { "x-prestart-token": inD.body?.prestart }));
    t.ok(view.status === 200 && view.body?.required === true, "the pre-start view is still required", view.status);
    t.ok(has(await inbox(inD.body?.messages), mAll), "D's messages read on their own, while the pre-start is pending");
    {
      let page = "";
      try { page = readFileSync(`${c.p.appDir}/src/app/site/in/[code]/page.tsx`, "utf8"); } catch { /* missing */ }
      const doneAt = page.indexOf(") : done ? (");
      t.ok(doneAt > 0 && page.indexOf("<CrewMessages", doneAt) > doneAt && page.indexOf("<CrewMessages") > page.indexOf("<PrestartCheck") && /noSkip=\{prestartRequired\}/.test(page),
        "the phone shows messages only on the final screen - after the odometer and the pre-start (whose no-skip is untouched)");
    }

    // (6) The office view: seen / not seen yet.
    const ov = await office("MANAGER");
    const find = (id) => ov.body?.messages?.find((m) => m.id === id);
    const ab = find(mAB);
    t.ok(ab?.audience === "PEOPLE" && ab.recipients.find((r) => r.name === A.name)?.seenAt === null && !!ab.recipients.find((r) => r.name === B.name)?.seenAt && ab.recipients.find((r) => r.name === B.name)?.where === "LINK",
      "A+B: A not seen yet, B seen on the link", JSON.stringify(ab?.recipients ?? null).slice(0, 200));
    t.ok(!!find(mA)?.recipients?.[0]?.seenAt && find(mA)?.recipients?.[0]?.where === "QR", "A's own: seen after sign-in");
    t.ok(find(mAll)?.seenCount === 1 && /Advanced Labour Hire/.test(JSON.stringify(find(mAll)?.recipients ?? [])), "everyone: seen by 1 so far - the hire worker, named with the company");
    t.ok(find(mArch)?.status === "ARCHIVED" && !!find(mArch)?.archived?.by && find(mExp)?.status === "EXPIRED" && find(mAll)?.status === "LIVE", "statuses: archived (with who), finished, showing");
    t.ok(find(mA)?.by === "Release check COORDINATOR" && find(mAB)?.by === "Release check ADMIN" && typeof find(mA)?.at === "string", "who wrote each one, and when, is shown to the office");
    t.ok(Array.isArray(ov.body?.people) && ov.body.people.some((p) => p.id === A.id) && !ov.body.people.some((p) => p.id === I.id || p.id === M.id), "the picker lists active Labour-register people only");

    // Nothing deleted, nothing rewritten.
    const arch = await db.signinMessage.findUnique({ where: { id: mArch } });
    t.ok(!!arch && arch.text === TXT("archived") && !!arch.archivedAt && arch.archiveReason === `RC102 archive ${tag}`, "the archived message is kept, its text unchanged, with who / why");
    t.ok((await count()) === count0 + 7, "every message is still there", String((await count()) - count0));

    // Rate limit: 30 a day per login (the Admin login with no other writes here).
    let made = 0, limited = null;
    for (let i = 0; i < 31; i++) {
      const r = await write("ADMIN_PLAIN", { text: `RC102 limit ${i} ${tag}`, audience: "PEOPLE", resourceIds: [Z.id] });
      if (r.status === 201) made++; else { limited = r; break; }
    }
    t.ok(made === 30 && limited?.status === 429, "30 messages a day per login, the 31st refused (429)", `${made} then ${limited?.status}`);

    // No money anywhere a phone looked; nothing called outside.
    const leaked = phone.filter((b) => !noMoney(b));
    t.ok(leaked.length === 0, `no $ figure in any of the ${phone.length} phone / link replies`, `${leaked.length} with $`);
    t.ok(netLines(c) === net0, "no outbound connection attempted during this check");

    // Tidy (test copy): our live messages archived, everyone signed out, links revoked, people switched off.
    await db.signinMessage.updateMany({ where: { id: { in: ours }, archivedAt: null }, data: { archivedAt: new Date(), archivedBy: `RC102 ${tag}` } });
    await db.signinMessage.updateMany({ where: { createdById: c.users.ADMIN_PLAIN.id, archivedAt: null, text: { contains: tag } }, data: { archivedAt: new Date(), archivedBy: `RC102 ${tag}` } });
    await db.siteAttendance.updateMany({ where: { OR: [{ resourceId: { in: people } }, { workerName: { contains: tag } }], signOutAt: null }, data: { signOutAt: new Date(), signOutMethod: "OFFICE" } });
    await db.siteLink.updateMany({ where: { id: { in: links } }, data: { revokedAt: new Date() } });
    await db.resource.updateMany({ where: { id: { in: [...people, ...trucks] } }, data: { active: false } });
  },
};
