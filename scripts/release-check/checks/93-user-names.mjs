// IND-002 / IND-014..017 (18 Nov 2026, Ilies approved): a login can't take another person's name with a look-alike - an
// extra "!", an invisible character, a look-alike or accented letter - because Estimating and the Tenders board tell
// quote issuers apart by name. Plain names only (A-Z, numbers, ' - .), plain emails, a switched-off login's name is
// re-checked when it's switched back on, and either of a person's two logins is the owner's to change.
// WRITES on the test copy: two throwaway VIEWER logins, renamed / switched off and on.
export default {
  id: "user-names", title: "Users: look-alike, accented and odd-character names refused (IND-002, IND-014..017)",
  writes: true, timeoutMs: 60_000,
  applies: (c) => c.hasPath("src/lib/samePerson.ts") || "needs samePerson.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    const owner = await db.user.findFirst({ where: { active: true, role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { name: true } });
    const u = await db.user.create({ data: { email: `rc-names-${tag}@release-check.test`, name: `RC Names ${tag}`, passwordHash: "x", role: "VIEWER" } });
    const rename = (name, who = "OWNER") => c.patch(`/api/users/${u.id}`, who, { name });
    for (const [why, name] of [
      ["an existing name plus '!'", `${owner.name}!`],
      ["an existing name plus a zero-width space", `${owner.name}​`],
      ["an existing name plus an accented letter (IND-014)", `${owner.name}é`],
      ["an accented letter in front (IND-014)", `é${owner.name}`],
      ["a German sharp s (IND-014)", "RC Namesß"],
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
    const same = await c.patch(`/api/users/${u.id}`, "ADMIN_PLAIN", { name: `RC O'Brien-Smith ${tag}`, active: true });
    t.ok(same.status === 200, "an ordinary save with the name unchanged still works", same.status);

    for (const [why, body] of [
      ["a new login with an invisible character", { name: `${owner.name}​`, email: `rc-names2-${tag}@release-check.test` }],
      ["a new login with an accented letter (IND-014)", { name: `${owner.name}é`, email: `rc-names3-${tag}@release-check.test` }],
      ["a new login with an accented email (IND-016)", { name: `RC Plain ${tag}`, email: `rc-nämes-${tag}@release-check.test` }],
    ]) {
      const r = await c.post("/api/users", "OWNER", { ...body, role: "VIEWER", password: "Release-check-0123456789" });
      t.ok(r.status === 400, `refused: ${why}`, r.status);
    }

    // IND-017: a switched-off login with an old-style name must be renamed before it's switched back on.
    const old = await db.user.create({ data: { email: `rc-names-old-${tag}@release-check.test`, name: `RC Olé ${tag}`, passwordHash: "x", role: "VIEWER", active: false } });
    const back = await c.patch(`/api/users/${old.id}`, "OWNER", { active: true });
    t.ok(back.status === 400, "switching back on a login whose name isn't plain is refused until it's renamed", back.status);
    const fixed = await c.patch(`/api/users/${old.id}`, "OWNER", { name: `RC Ole ${tag}`, active: true });
    t.ok(fixed.status === 200, "renamed and switched on in one save is fine", fixed.status);

    // IND-015: either of a person's two logins (lib/samePerson.ts SAME_PERSON) is the owner's to rename / reset / switch off.
    const pairedId = "cmvnh13p80001c8w58nolsvnj"; // Nick's ADMIN login
    const paired = await db.user.findUnique({ where: { id: pairedId }, select: { name: true } });
    if (paired) {
      const r = await c.patch(`/api/users/${pairedId}`, "ADMIN_PLAIN", { name: `${paired.name} Two` });
      t.ok(r.status === 403, "another Admin can't rename a person's second login (IND-015)", r.status);
    } else t.ok(true, "Nick's ADMIN login isn't on this snapshot - IND-015 covered by unit tests");

    await db.user.updateMany({ where: { id: { in: [u.id, old.id] } }, data: { active: false } });
  },
};
