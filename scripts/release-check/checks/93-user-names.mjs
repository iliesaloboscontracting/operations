// IND-002 (18 Nov 2026, Ilies approved): a login can't take another person's name with a look-alike - an extra "!", an
// invisible character, a look-alike letter - because Estimating and the Tenders board tell quote issuers apart by name.
// WRITES on the test copy: one throwaway VIEWER login, renamed a few times, then switched off.
export default {
  id: "user-names", title: "Users: look-alike and odd-character names refused (IND-002)",
  writes: true, timeoutMs: 60_000,
  applies: (c) => c.hasPath("src/lib/samePerson.ts") || "needs samePerson.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    const owner = await db.user.findFirst({ where: { active: true, role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { name: true } });
    const u = await db.user.create({ data: { email: `rc-names-${tag}@release-check.test`, name: `RC Names ${tag}`, passwordHash: "x", role: "VIEWER" } });
    const rename = (name) => c.patch(`/api/users/${u.id}`, "OWNER", { name });
    for (const [why, name] of [
      ["an existing name plus '!'", `${owner.name}!`],
      ["an existing name plus a zero-width space", `${owner.name}​`],
      ["a full-width look-alike", "ＲＣ Names"],
      ["a Cyrillic look-alike letter", "RC Nаmes"],
      ["a double space", "RC  Names"],
    ]) {
      const r = await rename(name);
      t.ok(r.status === 400, `refused: ${why}`, r.status);
    }
    const dup = await rename(`${owner.name}.`);
    t.ok(dup.status === 400, "an existing person's name with a trailing full stop counts as taken", dup.status);
    const ok = await rename(`RC O'Brien-Smith ${tag}`);
    t.ok(ok.status === 200, "a plain name with an apostrophe and hyphen is fine", ok.status);
    const nu = await c.post("/api/users", "OWNER", { name: `${owner.name}​`, email: `rc-names2-${tag}@release-check.test`, role: "VIEWER", password: "Release-check-0123456789" });
    t.ok(nu.status === 400, "a new login with an invisible character is refused", nu.status);
    await db.user.update({ where: { id: u.id }, data: { active: false } });
  },
};
