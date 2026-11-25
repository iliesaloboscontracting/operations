// LCI Stage 1 (Ilies, 25 Nov 2026: "approve all defaults") - the findings cleanup and the "Needs attention" card.
//   (1) The one-off cleanup ran on the engine's first run (a FindingCleanup row, label 2026-11-25), once.
//   (2) Nothing deleted: every finding and event in the snapshot is still on the copy.
//   (3) Every finding the cleanup closed has one AUTO_RESOLVED event "Closed in the 25 Nov cleanup: <reason>", the
//       count matches the row, and each reason is one of past day / rule retired / the new rule no longer flags it /
//       regrouped by cause / the problem had already gone. A CRITICAL Directors-screen finding was never closed by it.
//   (4) The rule fixes, on the copy: no open DATE_INACTIVE_HAS_JOBS (each snapshot one RETIRED); no open dated finding
//       for a past day; no open NO_SUPERVISOR gap for the Yard / a TEST project or for a solo worker (solo is INFO);
//       no open per-project DATA_UNCOSTED (grouped by cause now); no open DATE_NO_START for the Yard / TEST; every open
//       DATE_START_MISMATCH differs by more than 7 days from the crew's first board day.
//   (5) The card (/api/findings/card): owner / Admin / Manager the Operations card - no Directors-only kind, no INFO in
//       the lines, at most 8 lines; the coordinator only HIRE_OVERDUE, no $ anywhere, no data gaps; VIEWER, ACCOUNTS,
//       TIMESHEETS, YARD and DIRECTOR 403, no login 401. Seeded findings prove the walls and the actions: the
//       coordinator snoozes his own kind (200 ok, no detail back), is refused false alarm / acknowledge (403), another
//       kind (404) and the detail (404); a Manager's Done while still firing stays on the card marked so.
//   (6) The Directors' list: only Directors-screen kinds, never a seeded operational one.
//   (7) The card is on the board under Pre-starts today (Managers / Admins) and on the coordinator page (source).
//   (8) No outbound call.
// WRITES on the test copy: six seeded findings (closed at the end - nothing deleted) and their events.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";

const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
const OPENISH = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];
const DIRECTOR_KINDS = ["COST_VS_CONTRACT", "DATA_NO_CONTRACT_VALUE", "TENDER_WON_NO_PROJECT", "XERO_UNMATCHED", "XERO_REAUTH", "LABOUR_HOURS_VS_BUDGET"];
const directorsScreen = (f) => DIRECTOR_KINDS.includes(f.ruleCode) || f.audience === "DIRECTOR";
const REASONS = /^Closed in the 25 Nov cleanup: (past day|rule retired|the new rule no longer flags it|regrouped by cause|the problem had already gone) - /;
const NOT_A_SITE = (name) => /^yard$/i.test((name ?? "").trim()) || /^test\b/i.test((name ?? "").trim());
const lines = (card) => [...(card?.top ?? []), ...(card?.more ?? [])].flatMap((e) => (e.kind === "ONE" ? [e.line] : e.items ?? []));
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: "lci-stage1", title: "LCI Stage 1: cleanup once (logged, nothing deleted), rule fixes, Needs attention card per role, coordinator money-free, Directors unchanged, no outbound",
  writes: true, timeoutMs: 420_000,
  applies: (c) => c.hasPath("src/lib/findings/card.ts") || "needs lib/findings/card.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    for (const k of ["OWNER", "ADMIN", "MANAGER", "COORDINATOR", "VIEWER", "ACCOUNTS", "TIMESHEETS", "YARD", "DIRECTOR"]) if (!c.users[k]) return t.block(`no ${k} test login`);
    const net0 = netLines(c);
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const snap = new DatabaseSync(c.options.snapshot, { readOnly: true });
    let before;
    try {
      before = {
        findings: snap.prepare("select id, ruleCode, severity, audience, status, dedupeKey from Finding").all(),
        events: Number(snap.prepare("select count(*) as n from FindingEvent").get().n),
      };
    } finally { snap.close(); }
    const openBefore = before.findings.filter((f) => OPENISH.includes(f.status));
    t.note(`snapshot: ${before.findings.length} findings, ${openBefore.length} open, ${before.events} events`);

    // (1) The engine's first run (the instrumentation tick, about a minute after start) does the cleanup.
    let row = null;
    for (let i = 0; i < 60 && !row; i++) { row = await db.findingCleanup.findUnique({ where: { label: "2026-11-25" } }); if (!row) await sleep(3000); }
    if (!t.ok(!!row, "the cleanup ran on the engine's first run (FindingCleanup 2026-11-25)")) return;
    t.ok((await db.findingCleanup.count()) === 1, "exactly one cleanup row - it never runs twice");
    let byRule = {}; try { byRule = JSON.parse(row.byRule); } catch { /* */ }
    t.note(`cleanup: closed ${row.closed}, left open ${row.left}; by rule ${JSON.stringify(byRule)}`);

    // (2) Nothing deleted.
    const now = await db.finding.findMany({ select: { id: true, ruleCode: true, severity: true, audience: true, status: true, dedupeKey: true, subjectName: true, title: true, currentValue: true, projectId: true, outcomeResult: true } });
    const byId = new Map(now.map((f) => [f.id, f]));
    const missing = before.findings.filter((f) => !byId.has(f.id));
    t.ok(missing.length === 0, "every snapshot finding is still there (nothing deleted)", missing.map((f) => f.id).join(", "));
    t.ok((await db.findingEvent.count()) >= before.events, "every snapshot finding event is still there");

    // (3) Logged reasons.
    const evs = await db.findingEvent.findMany({ where: { note: { startsWith: "Closed in the 25 Nov cleanup" } }, select: { findingId: true, action: true, note: true, toValue: true, by: true } });
    const closedIds = new Set(evs.map((e) => e.findingId));
    t.ok(evs.length === row.closed && closedIds.size === row.closed, `one cleanup event per closed finding (${evs.length} events, ${closedIds.size} findings, row says ${row.closed})`);
    t.ok(evs.every((e) => e.action === "AUTO_RESOLVED" && e.by === "System" && REASONS.test(e.note ?? "")), "each is AUTO_RESOLVED by System with a listed reason", evs.find((e) => !REASONS.test(e.note ?? ""))?.note);
    const notClosedProperly = [...closedIds].filter((id) => byId.get(id)?.status === "OPEN" || byId.get(id)?.status === "ACKNOWLEDGED");
    t.ok(notClosedProperly.length === 0, "and each of them is closed (resolved or verified)", notClosedProperly.join(", "));
    const dirCriticalClosed = openBefore.filter((f) => f.severity === "CRITICAL" && directorsScreen(f) && closedIds.has(f.id));
    t.ok(dirCriticalClosed.length === 0, "no CRITICAL Directors-screen finding was closed by the cleanup (a person decides)");
    t.ok(row.closed <= openBefore.length, `it closed at most the snapshot's open findings (${row.closed} of ${openBefore.length})`);

    // (4) Rule fixes.
    const openNow = now.filter((f) => OPENISH.includes(f.status));
    const retired = before.findings.filter((f) => f.ruleCode === "DATE_INACTIVE_HAS_JOBS" && OPENISH.includes(f.status));
    t.ok(!openNow.some((f) => f.ruleCode === "DATE_INACTIVE_HAS_JOBS"), "no open DATE_INACTIVE_HAS_JOBS (rule retired)");
    t.ok(retired.every((f) => byId.get(f.id)?.outcomeResult === "RETIRED"), `each snapshot one closed as RETIRED (${retired.length})`);
    const pastDated = openNow.filter((f) => { const last = f.dedupeKey.split(":"); const d = last.at(-1); return last.length > 3 && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < c.today; });
    t.ok(pastDated.length === 0, "no open dated finding for a day that has passed", pastDated.map((f) => f.dedupeKey).join(", "));
    const lapsed = now.filter((f) => f.outcomeResult === "LAPSED");
    t.ok(lapsed.every((f) => f.status === "RESOLVED"), `the past days are closed as LAPSED, never "verified" (${lapsed.length})`);
    const sup = openNow.filter((f) => f.ruleCode === "NO_SUPERVISOR");
    t.ok(!sup.some((f) => NOT_A_SITE(f.subjectName)), "no NO_SUPERVISOR for the Yard or a TEST project");
    t.ok(!sup.some((f) => f.dedupeKey.startsWith("NO_SUPERVISOR:JOB:")), "no NO_SUPERVISOR for a one-off job with no project");
    t.ok(sup.every((f) => { let v = {}; try { v = JSON.parse(f.currentValue ?? "{}"); } catch { /* */ } return v.solo ? f.severity === "INFO" : true; }), "a solo worker is INFO only");
    t.ok(!openNow.some((f) => /^DATA_UNCOSTED:PROJECT:[^:]+$/.test(f.dedupeKey)), "no per-project DATA_UNCOSTED left (one per resource with no rate, or per project with no hours)");
    t.ok(openNow.filter((f) => f.ruleCode === "DATA_UNCOSTED").every((f) => /^DATA_UNCOSTED:(RESOURCE:[^:]+|PROJECT:[^:]+:HOURS)$/.test(f.dedupeKey)), "every open DATA_UNCOSTED is grouped by cause");
    t.ok(!openNow.some((f) => f.ruleCode === "DATE_NO_START" && NOT_A_SITE(f.subjectName)), "no DATE_NO_START for the Yard or a TEST project");
    let mismatchOk = true;
    for (const f of openNow.filter((x) => x.ruleCode === "DATE_START_MISMATCH" && x.projectId)) {
      const p = await db.project.findUnique({ where: { id: f.projectId }, select: { startDate: true } });
      const first = await db.job.findFirst({ where: { projectId: f.projectId, notRunning: false, cancelledAt: null, assignments: { some: { resource: { OR: [{ type: "PERSONNEL" }, { type: "HIRE", category: "LABOUR" }] } } } }, orderBy: { date: "asc" }, select: { date: true } });
      if (!p?.startDate || !first || Math.abs(daysBetween(p.startDate, first.date.toISOString().slice(0, 10))) <= 7) { mismatchOk = false; t.note(`DATE_START_MISMATCH within 7 days: ${f.subjectName}`); }
    }
    t.ok(mismatchOk, "every open DATE_START_MISMATCH is more than 7 days out");

    // (5) The card. Seed a few findings (after the cleanup, so it can't close them).
    const tag = Date.now().toString(36).toUpperCase();
    const seed = async (x) => db.finding.create({ data: {
      ruleCode: x.ruleCode, subjectType: "RESOURCE", subjectId: `rc-${tag}-${x.k}`, subjectName: `RC ${x.k}`, dedupeKey: `${x.ruleCode}:RESOURCE:rc-${tag}-${x.k}`, openKey: `${x.ruleCode}:RESOURCE:rc-${tag}-${x.k}`,
      severity: x.severity, audience: x.audience, title: x.title, href: x.href ?? "/hire", status: "OPEN", createdBy: "release-check",
    } });
    const S = {
      hire: await seed({ k: "hire", ruleCode: "HIRE_OVERDUE", severity: "HIGH", audience: "OPERATIONAL", title: `RC ${tag} hook truck is still out past its off-hire date (2026-11-20)` }),
      hireMoney: await seed({ k: "hiremoney", ruleCode: "HIRE_OVERDUE", severity: "HIGH", audience: "OPERATIONAL", title: `RC ${tag} excavator at $360 a day is still out` }),
      idle: await seed({ k: "idle", ruleCode: "HIRE_IDLE", severity: "MEDIUM", audience: "COMMERCIAL", title: `RC ${tag} scissor lift idle, $900 so far` }),
      gap: await seed({ k: "gap", ruleCode: "NO_SUPERVISOR", severity: "CRITICAL", audience: "OPERATIONAL", title: `RC ${tag} crew booked but no supervisor or lead`, href: `/command?date=${c.today}` }),
      dir: await seed({ k: "dir", ruleCode: "COST_VS_CONTRACT", severity: "CRITICAL", audience: "COMMERCIAL", title: `RC ${tag} cost vs contract (Act)`, href: "/tracking" }),
      info: await seed({ k: "info", ruleCode: "DATA_UNCOSTED", severity: "INFO", audience: "COMMERCIAL", title: `RC ${tag} has no rate` }),
    };
    try {
      const seen = [];
      for (const who of ["OWNER", "ADMIN", "MANAGER"]) {
        const r = await c.json("/api/findings/card", who);
        t.status(r.status, 200, `${who}: the card answers`);
        const card = r.body, ls = lines(card);
        t.ok(card?.variant === "OPERATIONS", `${who}: the Operations card`);
        t.ok((card?.top?.length ?? 99) <= 8, `${who}: at most 8 lines`);
        t.ok(!ls.some((l) => DIRECTOR_KINDS.includes(l.rule)) && !ls.some((l) => l.id === S.dir.id), `${who}: no Directors-only item`);
        t.ok(ls.every((l) => l.severity !== "INFO") && (card?.dataGaps ?? []).every((l) => l.severity === "INFO"), `${who}: INFO only under data gaps`);
        t.ok(ls.some((l) => l.id === S.gap.id) && ls.some((l) => l.id === S.hire.id) && ls.some((l) => l.id === S.idle.id), `${who}: operational and commercial items are on it`);
        t.ok((card?.dataGaps ?? []).some((l) => l.id === S.info.id), `${who}: the data gap is in the drawer list`);
        const rank = (e) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2 })[(e.kind === "ONE" ? e.line : e).severity] ?? 9;
        const ranks = [...(card?.top ?? []), ...(card?.more ?? [])].map(rank);
        t.ok(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), `${who}: worst first`, JSON.stringify(ranks));
      }
      const co = await c.text("/api/findings/card", "COORDINATOR");
      seen.push(co.text);
      t.status(co.status, 200, "COORDINATOR: his card answers");
      let cc = null; try { cc = JSON.parse(co.text); } catch { /* */ }
      const cls = lines(cc);
      t.ok(cc?.variant === "COORDINATOR" && cls.every((l) => l.rule === "HIRE_OVERDUE"), "COORDINATOR: only his kind (hire past its off-hire date)", JSON.stringify(cls.map((l) => l.rule)));
      t.ok(cls.some((l) => l.id === S.hire.id) && !cls.some((l) => l.id === S.hireMoney.id), "COORDINATOR: his seeded item, never the one with a $ figure");
      t.ok(noMoney(co.text) && (cc?.dataGaps ?? []).length === 0, "COORDINATOR: no $ anywhere on his card, no data gaps");
      for (const who of ["VIEWER", "ACCOUNTS", "TIMESHEETS", "YARD", "DIRECTOR"]) t.status(await c.get("/api/findings/card", who), 403, `${who}: no card`);
      t.status(await c.get("/api/findings/card", null), 401, "no login: no card");

      // Actions.
      const post = (id, who, body) => c.post(`/api/findings/${id}`, who, body);
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      t.status(await post(S.hire.id, "COORDINATOR", { action: "DISMISS", kind: "FALSE_ALARM", reason: "rc" }), 403, "COORDINATOR: false alarm refused");
      t.status(await post(S.hire.id, "COORDINATOR", { action: "ACKNOWLEDGE" }), 403, "COORDINATOR: acknowledge refused");
      t.status(await post(S.gap.id, "COORDINATOR", { action: "RESOLVE", note: "rc" }), 404, "COORDINATOR: another kind - not found");
      t.status(await post(S.idle.id, "COORDINATOR", { action: "RESOLVE", note: "rc" }), 404, "COORDINATOR: a commercial one - not found");
      t.status(await c.get(`/api/findings/${S.hire.id}`, "COORDINATOR"), 404, "COORDINATOR: no detail view");
      const snooze = await post(S.hire.id, "COORDINATOR", { action: "DISMISS", kind: "ACCEPTED_RISK", until, reason: "Supplier collecting Friday" });
      const sj = await snooze.json().catch(() => null);
      t.ok(snooze.status === 200 && sj?.ok === true && Object.keys(sj).length === 1, "COORDINATOR: snooze to a date with a reason -> 200, just ok (no detail back)", JSON.stringify(sj));
      const h = await db.finding.findUnique({ where: { id: S.hire.id }, select: { status: true, dismissKind: true, suppressUntil: true } });
      t.ok(h?.status === "DISMISSED" && h.dismissKind === "ACCEPTED_RISK" && h.suppressUntil === until, "snoozed until that date");
      const he = await db.findingEvent.findFirst({ where: { findingId: S.hire.id, action: "DISMISSED" } });
      t.ok(he?.byUserId === c.users.COORDINATOR.id && /Supplier collecting Friday/.test(he.note ?? ""), "the snooze is logged with who and why");
      t.ok(!lines((await c.json("/api/findings/card", "COORDINATOR")).body).some((l) => l.id === S.hire.id), "a snoozed item leaves his card");
      t.status(await post(S.gap.id, "MANAGER", { action: "RESOLVE", note: "" }), 400, "MANAGER: Done needs a reason");
      t.status(await post(S.gap.id, "MANAGER", { action: "RESOLVE", note: "Pol is leading" }), 200, "MANAGER: Done with a reason");
      const after = lines((await c.json("/api/findings/card", "MANAGER")).body).find((l) => l.id === S.gap.id);
      t.ok(after?.doneButStillShowing === true, "Done while the rule still fires: it stays on the card, marked so");
      t.status(await post(S.dir.id, "MANAGER", { action: "RESOLVE", note: "rc" }), 403, "MANAGER: a Directors-screen finding is still not theirs to close");

      // (6) Directors' list: Directors-screen kinds only, never the seeded operational ones.
      const ov = await c.json("/api/directors/overview", "OWNER");
      t.status(ov.status, 200, "Directors overview answers the owner");
      const df = ov.body?.findings ?? [];
      t.ok(df.every((f) => directorsScreen(f)), "the Directors' findings are Directors-screen kinds only", JSON.stringify(df.filter((f) => !directorsScreen(f)).map((f) => f.ruleCode)));
      t.ok(!df.some((f) => [S.gap.id, S.hire.id, S.idle.id, S.info.id].includes(f.id)) && df.some((f) => f.id === S.dir.id), "the seeded Directors kind is there, no operational one");
    } finally {
      // Close the seeded ones (nothing deleted).
      await db.finding.updateMany({ where: { id: { in: Object.values(S).map((x) => x.id) }, status: { in: [...OPENISH, "DISMISSED"] } }, data: { status: "RESOLVED", openKey: null, resolvedBy: "release-check", resolution: "seeded by the release check" } }).catch(() => {});
    }

    // (7) Where it sits (source).
    const read = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    const board = read("src/components/Board.tsx"), coord = read("src/app/coordinator/page.tsx");
    t.ok(/<PrestartToday enabled=\{canEdit\} \/>[\s\S]{0,400}\{canEdit && \([\s\S]{0,120}<NeedsAttentionCard variant="board" \/>/.test(board), "the board: under Pre-starts today, Managers / Admins only (source)");
    t.ok(/coordinatorOnly && <div[^>]*><NeedsAttentionCard variant="coordinator" \/>/.test(coord), "the coordinator page: his For you card (source)");
    // (8)
    t.ok(netLines(c) === net0, "no outbound call during the check");
    t.ok(netLines(c) === 0, "and none at all on this run (the engine's cleanup run included)");
  },
};
