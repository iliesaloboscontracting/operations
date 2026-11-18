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
      ["a new login with an apostrophe in the email (IND-018)", { name: `RC Plain ${tag}`, email: `rc-o'names-${tag}@release-check.test` }],
      ["a new login named 'local' (IND-020)", { name: "Local", email: `rc-names4-${tag}@release-check.test` }],
      ["a new login with no letters (IND-020)", { name: "..", email: `rc-names5-${tag}@release-check.test` }],
    ]) {
      const r = await c.post("/api/users", "OWNER", { ...body, role: "VIEWER", password: "Release-check-0123456789" });
      t.ok(r.status === 400, `refused: ${why}`, r.status);
    }
    // IND-019 (option a): only the owner creates an Admin login or makes a login an Admin.
    const adm = await c.post("/api/users", "ADMIN_PLAIN", { name: `RC Admin ${tag}`, email: `rc-admin-${tag}@release-check.test`, role: "ADMIN", password: "Release-check-0123456789" });
    t.ok(adm.status === 403, "another Admin can't create an Admin login (IND-019)", adm.status);
    const promote = await c.patch(`/api/users/${u.id}`, "ADMIN_PLAIN", { role: "ADMIN" });
    t.ok(promote.status === 403, "another Admin can't make a login an Admin (IND-019)", promote.status);
    const mgr = await c.post("/api/users", "ADMIN_PLAIN", { name: `RC Manager ${tag}`, email: `rc-mgr-${tag}@release-check.test`, role: "MANAGER", password: "Release-check-0123456789" });
    t.ok(mgr.status === 200 || mgr.status === 201, "another Admin can still create a Manager login", mgr.status);
    const ownerAdm = await c.post("/api/users", "OWNER", { name: `RC Owner Admin ${tag}`, email: `rc-oadmin-${tag}@release-check.test`, role: "ADMIN", password: "Release-check-0123456789" });
    t.ok(ownerAdm.status === 200 || ownerAdm.status === 201, "the owner can create an Admin login", ownerAdm.status);
    await db.user.updateMany({ where: { email: { in: [`rc-mgr-${tag}@release-check.test`, `rc-oadmin-${tag}@release-check.test`] } }, data: { active: false } });

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

    // IND-021 (Ilies approved 18 Nov 2026): only the owner renames, resets or switches on / off ANY Admin login.
    const plainAdm = await db.user.create({ data: { email: `rc-padmin-${tag}@release-check.test`, name: `RC Plain Admin ${tag}`, passwordHash: "x", role: "ADMIN", active: true } });
    const offAdm = await db.user.create({ data: { email: `rc-offadmin-${tag}@release-check.test`, name: `RC Off Admin ${tag}`, passwordHash: "x", role: "ADMIN", active: false } });
    for (const [why, id, body] of [
      ["rename", plainAdm.id, { name: `RC Renamed ${tag}` }],
      ["reset the password of", plainAdm.id, { password: "Release-check-0123456789" }],
      ["switch off", plainAdm.id, { active: false }],
      ["switch back on", offAdm.id, { active: true }],
    ]) {
      const r = await c.patch(`/api/users/${id}`, "ADMIN_PLAIN", body);
      t.ok(r.status === 403, `another Admin can't ${why} an Admin login (IND-021)`, r.status);
    }
    const sameAdm = await c.patch(`/api/users/${plainAdm.id}`, "ADMIN_PLAIN", { name: plainAdm.name, active: true, role: "ADMIN" });
    t.ok(sameAdm.status === 200, "an unchanged save of an Admin login by another Admin still works", sameAdm.status);
    const own = await c.patch(`/api/users/${plainAdm.id}`, "OWNER", { name: `RC Renamed ${tag}` });
    t.ok(own.status === 200, "the owner can rename an Admin login", own.status);
    const mgrEdit = await c.patch(`/api/users/${u.id}`, "ADMIN_PLAIN", { name: `RC Viewer Edit ${tag}` });
    t.ok(mgrEdit.status === 200, "another Admin still edits a Viewer login", mgrEdit.status);

    // IND-024 (Ilies approved 18 Nov 2026, option b): another Admin may demote an Admin (to lock it out), but a login
    // that was ever an Admin stays the owner's to reset, rename or switch on.
    const demote = await c.patch(`/api/users/${plainAdm.id}`, "ADMIN_PLAIN", { role: "MANAGER" });
    t.ok(demote.status === 200, "another Admin can still demote an Admin login (to lock it out)", demote.status);
    const resetAfter = await c.patch(`/api/users/${plainAdm.id}`, "ADMIN_PLAIN", { password: "Release-check-0123456789" });
    t.ok(resetAfter.status === 403, "...but can't then reset its password (IND-024)", resetAfter.status);
    const renameAfter = await c.patch(`/api/users/${plainAdm.id}`, "ADMIN_PLAIN", { name: `RC Taken Over ${tag}` });
    t.ok(renameAfter.status === 403, "...or rename it (IND-024)", renameAfter.status);
    const demoteOff = await c.patch(`/api/users/${offAdm.id}`, "ADMIN_PLAIN", { role: "MANAGER" });
    t.ok(demoteOff.status === 200, "a switched-off Admin login can be demoted", demoteOff.status);
    const onAfter = await c.patch(`/api/users/${offAdm.id}`, "ADMIN_PLAIN", { active: true });
    t.ok(onAfter.status === 403, "...but another Admin can't then switch it back on (IND-024)", onAfter.status);
    const ownerReset = await c.patch(`/api/users/${plainAdm.id}`, "OWNER", { password: "Release-check-0123456789" });
    t.ok(ownerReset.status === 200, "the owner can still reset a former Admin login", ownerReset.status);

    await db.user.updateMany({ where: { id: { in: [u.id, old.id, plainAdm.id, offAdm.id] } }, data: { active: false } });
  },
};
