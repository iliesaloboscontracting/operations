// Owner-only "Change email" on the Users page (Ilies, 27 Nov 2026: "Add 'change email' to Users" - first use: the yard
// computer's login becomes yard@loboscontracting.com.au). POST /api/users/:id/email, rules in src/lib/userEmail.ts.
// WRITES on the test copy: one throwaway YARD login (its own in-memory password) whose email is changed, then switched off.
import { randomBytes, scryptSync } from "node:crypto";

export default {
  id: "user-email", title: "Users: owner-only Change email (27 Nov 2026)",
  writes: true, timeoutMs: 60_000,
  applies: (c) => c.hasPath("src/app/api/users/[id]/email/route.ts") || "needs the Change email route",
  async run(t, c) {
    const db = c.db, tag = randomBytes(4).toString("hex");
    const password = randomBytes(18).toString("base64url");
    const salt = randomBytes(16);
    const passwordHash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
    const oldEmail = `rc-yard-email-${tag}@loboscontracting.com.au`, newEmail = `rc-yard-new-${tag}@loboscontracting.com.au`;
    const y = await db.user.create({ data: { email: oldEmail, name: `RC Yard Email ${tag}`, passwordHash, role: "YARD" } });
    const signIn = (email) => fetch(c.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const first = await signIn(oldEmail);
    const cookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";
    t.ok(first.status === 200 && cookie, "the throwaway YARD login signs in with its old email", first.status);
    t.status(await fetch(c.base + "/api/auth/me", { headers: { cookie } }), 200, "its session works before the change");
    const change = (id, who, email) => c.post(`/api/users/${id}/email`, who, { email });

    // Who may: the owner only.
    t.status(await change(y.id, "ADMIN_PLAIN", newEmail), 403, "an Admin who isn't the owner can't change an email");
    t.status(await change(y.id, "ADMIN", newEmail), 403, "an Admin with director access can't either");
    t.status(await change(y.id, "MANAGER", newEmail), [401, 403], "a Manager can't");
    t.status(await c.patch(`/api/users/${y.id}`, "ADMIN_PLAIN", { email: newEmail }), 403, "the ordinary edit (PATCH) refuses an email change from a non-owner");
    t.status(await c.patch(`/api/users/${y.id}`, "OWNER", { email: newEmail }), 400, "...and points the owner to Change email");

    // What may: refused addresses.
    const dup = await db.user.create({ data: { email: `rc-yard-dup-${tag}@loboscontracting.com.au`, name: `RC Yard Dup ${tag}`, passwordHash: "x", role: "VIEWER", active: false } });
    t.status(await change(y.id, "OWNER", dup.email.toUpperCase()), 409, "another login's email (any case, even a switched-off one) is refused");
    const outside = await change(y.id, "OWNER", `rc-yard-${tag}@gmail.com`);
    const outsideText = (await outside.json().catch(() => ({}))).error ?? "";
    t.ok(outside.status === 400 && /Cloudflare Access/.test(outsideText), "an address outside @loboscontracting.com.au is refused, saying why", `${outside.status} ${outsideText}`);
    t.status(await change(y.id, "OWNER", "not-an-email"), 400, "a non-email is refused");
    t.status(await change(y.id, "OWNER", c.users.OPS_AI.email), 400, "the Building Agent's email can't go on another login");
    t.status(await change(y.id, "OWNER", c.users.OWNER.email), 400, "the owner's email can't go on another login");
    t.status(await change(c.users.OPS_AI.id, "OWNER", `rc-agent-${tag}@loboscontracting.com.au`), 400, "the Building Agent's own email can't be changed");
    t.status(await change(c.users.OWNER.id, "OWNER", `rc-owner-${tag}@loboscontracting.com.au`), 400, "the owner's own email can't be changed here");
    const still = await db.user.findMany({ where: { id: { in: [y.id, c.users.OWNER.id, c.users.OPS_AI.id] } }, select: { id: true, email: true } });
    t.ok(still.find((u) => u.id === y.id)?.email === oldEmail && still.find((u) => u.id === c.users.OWNER.id)?.email === c.users.OWNER.email
      && still.find((u) => u.id === c.users.OPS_AI.id)?.email === c.users.OPS_AI.email, "every refused change left the emails as they were");
    t.status(await fetch(c.base + "/api/auth/me", { headers: { cookie } }), 200, "refused changes didn't sign the login out");
    t.status(await c.get("/api/auth/me", "OWNER"), 200, "the owner's session still works");
    t.status(await c.get("/api/auth/me", "OPS_AI"), 200, "the Building Agent's session still works");

    // The owner changes it.
    const before = await db.user.findUnique({ where: { id: y.id }, select: { sessionVersion: true } });
    const ok = await change(y.id, "OWNER", `  ${newEmail.toUpperCase()} `);
    const okBody = await ok.json().catch(() => ({}));
    t.ok(ok.status === 200 && okBody.email === newEmail, "the owner changes the YARD login's email (trimmed, lower-cased)", `${ok.status} ${okBody.email ?? okBody.error}`);
    const after = await db.user.findUnique({ where: { id: y.id }, select: { email: true, sessionVersion: true } });
    t.ok(after?.email === newEmail && after.sessionVersion === (before?.sessionVersion ?? 0) + 1, "saved, and sessionVersion went up by one", JSON.stringify(after));
    t.status(await fetch(c.base + "/api/auth/me", { headers: { cookie } }), 401, "the old session no longer works");
    t.status(await signIn(oldEmail), 401, "the old email no longer signs in");
    t.status(await signIn(newEmail), 200, "the new email signs in with the same password");
    const ev = await db.userEvent.findFirst({ where: { userId: y.id }, orderBy: { at: "desc" } });
    let changes = {};
    try { changes = JSON.parse(ev?.changes ?? "{}"); } catch {}
    t.ok(ev?.action === "EDIT" && ev.byUserId === c.users.OWNER.id && JSON.stringify(changes.email) === JSON.stringify([oldEmail, newEmail]),
      "a UserEvent keeps the before and after, by the owner", ev?.changes);
    t.status(await change(y.id, "OWNER", newEmail), 400, "changing to the email it already has is refused");

    await db.user.update({ where: { id: y.id }, data: { active: false } });
  },
};
