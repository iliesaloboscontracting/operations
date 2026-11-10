// Keep forever (Ilies, 10 Nov 2026: "ALL information is kept forever"). Every former delete path keeps its row - hidden,
// cancelled, retired or superseded, with who and why - and a hidden / cancelled / superseded record is never counted:
//   - Tracking (an open and a closed day), the Directors overview and accounts' hire invoice checks change by exactly the
//     hidden invoice line and nothing else; Admin remove, the inbox's "Take off the job" and a failed upload read again;
//   - a day closed, re-opened and closed again keeps every ledger row, only the current set counts (once), and each
//     close / re-open is in the day's history;
//   - a cancelled job leaves the board, the calendar and Tracking's booked days but is kept (who / why), its allocation
//     snapshotted; adding the same project / day / shift again brings the same job back;
//   - remove, a move onto a job it's already on, and Clear board write a FULL snapshot (allocations + day briefs);
//   - service records, contacts, invoice wordings, Day Review rows, bug reports are hidden; a tool is retired;
//   - a Resource rate edit is in RecordChange, visible to an Admin, not to a Manager (pay) or a Viewer, refused for
//     the one-page logins; the Project DELETE is refused (405);
//   - no automatic deletion is left in the code (the pre-start photo cleanups are gone; every remaining delete is on
//     the allowed list).
// WRITES on the test copy: a project, four resources, jobs on two past days (one closed, re-opened and closed again -
// with the copy's own jobs that day) and two months ahead, allocations, invoices, an upload + drafts, a service record, a contact, a wording,
// a bug report, a tool. Prints no figure from the copy's own data - only this check's own test amounts.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const near = (a, b) => Math.abs(a - b) < 0.02;
const body = async (r) => r.json().catch(() => null);

export default {
  id: "keep-forever", title: "Keep forever: nothing deleted, hidden records never counted, full snapshots, change history",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/history/store.ts") || "the candidate has no change history (keep forever)",
  async run(t, c) {
    const db = c.db;
    if (!db?.recordChange) return t.block("no test database handle with RecordChange");
    const tag = randomBytes(3).toString("hex");
    const D1 = addDays(c.today, 60), D2 = addDays(c.today, 61); // far enough ahead to be empty on the copy
    const note = "release check (keep forever)";

    // ---------- setup: a project, a person, a machine, a hire item ----------
    const project = await db.project.create({ data: { name: `RC keep forever ${tag}`, status: "ACTIVE" } });
    const pid = project.id;
    const person = await db.resource.create({ data: { name: `RC KF person ${tag}`, type: "PERSONNEL", role: "Labourer", payRateBasis: "HOURLY", ordinaryRate: 40 } });
    const person2 = await db.resource.create({ data: { name: `RC KF person2 ${tag}`, type: "PERSONNEL", role: "Labourer" } });
    const machine = await db.resource.create({ data: { name: `RC KF excavator ${tag}`, type: "EQUIPMENT", ownership: "OWNED", dailyRateExGst: 800 } });
    const hire = await db.resource.create({ data: { name: `RC KF hire ${tag}`, type: "HIRE", category: "PLANT", ownership: "HIRED", hireProjectId: pid, onHireDate: addDays(c.today, -20), offHireDate: addDays(c.today, -10), hireRate: 100, hireRateUnit: "DAY", hireStatus: "ON_HIRE" } });

    const tracking = async () => (await c.json("/api/tracking", "MANAGER")).body;
    const projOf = (tr, id = pid) => (tr?.projects ?? []).find((p) => p.id === id);
    const otherTotals = (tr) => new Map((tr?.projects ?? []).filter((p) => p.id !== pid).map((p) => [p.id, p.totalCost]));
    const sameOthers = (a, b) => { const x = otherTotals(a), y = otherTotals(b); if (x.size !== y.size) return false; for (const [k, v] of x) if (!near(v, y.get(k) ?? NaN)) return false; return true; };

    // ---------- (1) frozen ledger: close, re-open, close again - superseded rows kept, the current set counted once ----------
    // Two past days after the labour backfill cut-off (Tracking only reads the ledger for those) that aren't closed on
    // the copy: the first is closed here, the second stays open.
    const closedOnCopy = new Set((await db.dayClose.findMany({ where: { status: "CLOSED" }, select: { date: true } })).map((d) => d.date));
    const free = [];
    for (let n = 35; n <= 44 && free.length < 2; n++) { const d = addDays(c.today, -n); if (d > "2026-09-26" && !closedOnCopy.has(d)) free.push(d); }
    if (free.length < 2) return t.block("no two open past days after the backfill cut-off on the copy");
    const [CLOSED, OPEN] = free;
    const jClosed = await db.job.create({ data: { projectId: pid, title: project.name, date: new Date(`${CLOSED}T00:00:00.000Z`), shift: "DAY", startTime: "7am", endTime: "3pm" } });
    const jOpen = await db.job.create({ data: { projectId: pid, title: project.name, date: new Date(`${OPEN}T00:00:00.000Z`), shift: "DAY", startTime: "7am", endTime: "3pm" } });
    await db.assignment.create({ data: { jobId: jClosed.id, resourceId: machine.id } });
    await db.assignment.create({ data: { jobId: jOpen.id, resourceId: machine.id } });
    t.status(await c.post("/api/day-close", "MANAGER", { date: CLOSED, action: "close" }), 200, "a Manager closes a past test day");
    const rows1 = await db.allocationCost.findMany({ where: { date: CLOSED, jobId: jClosed.id } });
    t.ok(rows1.length >= 1 && rows1.every((r) => !r.supersededAt), "the close writes the frozen ledger", rows1.length);
    t.status(await c.post("/api/day-close", "ADMIN", { date: CLOSED, action: "reopen", reason: note }), 200, "an Admin re-opens it with a reason");
    const rows2 = await db.allocationCost.findMany({ where: { date: CLOSED, jobId: jClosed.id } });
    t.ok(rows2.length === rows1.length && rows2.every((r) => r.supersededAt && r.supersededBy), "re-open: the ledger rows are KEPT, marked superseded (when, by whom) - none deleted", `${rows2.length} rows`);
    t.status(await c.post("/api/day-close", "MANAGER", { date: CLOSED, action: "close" }), 200, "closed again");
    const all = await db.allocationCost.findMany({ where: { date: CLOSED, jobId: jClosed.id } });
    const current = all.filter((r) => !r.supersededAt);
    t.ok(all.length === rows1.length * 2 && current.length === rows1.length, "after re-open + close: the old rows remain, only the new set is current", `${all.length} total, ${current.length} current`);
    const closeRow = await db.dayClose.findUnique({ where: { date: CLOSED } });
    const mine = await db.recordChange.findMany({ where: { model: "DayClose", recordId: closeRow?.id ?? "-", field: "status" }, orderBy: { changedAt: "asc" } });
    t.ok(mine.map((h) => h.after).join(",").endsWith("CLOSED,OPEN,CLOSED") && mine.some((h) => h.reason === note), "each close / re-open is kept in the day's history (with the re-open reason)", mine.map((h) => h.after).join(","));
    const tr0 = await tracking();
    const p0 = projOf(tr0);
    const dayCost = (p, d) => (p?.daily ?? []).filter((x) => x.date === d).reduce((n, x) => n + x.locked + x.estimated + x.invoiced, 0);
    t.ok(p0 && near(dayCost(p0, CLOSED), 800) && near(dayCost(p0, OPEN), 800), "Tracking: the closed day counts its current ledger once (800), the open day costs live (800)", p0 ? `${dayCost(p0, CLOSED)} / ${dayCost(p0, OPEN)}` : "project missing");

    // ---------- (2) an invoice line hidden: Tracking, Directors and accounts change by exactly that line ----------
    const addInv = async (b) => { const r = await c.post("/api/invoiced-costs", "MANAGER", { projectId: pid, ...b }); return { status: r.status, body: await body(r) }; };
    const A = await addInv({ category: "MATERIALS", vendor: `RC KF supplier ${tag}`, invoiceNo: `RC-A-${tag}`, weekEnding: c.today, amountExGst: 1234.5 });
    const B = await addInv({ category: "PLANT_HIRE", vendor: `RC KF hire co ${tag}`, invoiceNo: `RC-B-${tag}`, weekEnding: c.today, amountExGst: 700, hireResourceId: hire.id, periodFrom: addDays(c.today, -20), periodTo: addDays(c.today, -14) });
    const C = await addInv({ category: "MATERIALS", vendor: `RC KF supplier ${tag}`, invoiceNo: `RC-C-${tag}`, weekEnding: c.today, amountExGst: 99 });
    t.ok(A.status === 201 && B.status === 201 && C.status === 201, "three test invoice lines added", `${A.status}/${B.status}/${C.status}`);
    const before = await tracking();
    const dirBefore = (await c.json("/api/directors/overview", "ADMIN")).body;
    const hireBefore = (await c.json("/api/accounts/invoice-checks?tab=hire", "ACCOUNTS")).body;
    t.status(await c.del(`/api/invoiced-costs/${A.body?.id}`, "MANAGER", { reason: note }), 403, "a Manager can't remove an invoice (Admin only, as before)");
    t.status(await c.del(`/api/invoiced-costs/${A.body?.id}`, "ADMIN", { reason: note }), 200, "an Admin removes invoice A");
    const a = await db.invoicedCost.findUnique({ where: { id: A.body?.id } });
    t.ok(a && a.removedAt && a.removedBy && a.removeReason === note, "...it is KEPT, hidden, with who and why");
    t.status(await c.del(`/api/invoiced-costs/${A.body?.id}`, "ADMIN", { reason: note }), 404, "removing it twice is refused (404)");
    const after = await tracking();
    const pb = projOf(before), pa = projOf(after);
    t.ok(pb && pa && near(pb.totalCost - pa.totalCost, 1234.5) && near(pb.invoicedTotal - pa.invoicedTotal, 1234.5), "Tracking: the project's total and invoiced drop by exactly the hidden line", pb && pa ? `${(pb.totalCost - pa.totalCost).toFixed(2)}` : "missing");
    t.ok(pb && pa && near(dayCost(pa, CLOSED), dayCost(pb, CLOSED)) && near(dayCost(pa, OPEN), dayCost(pb, OPEN)), "Tracking: the closed and the open day are unchanged");
    t.ok(sameOthers(before, after), "Tracking: every other project unchanged");
    const dirAfter = (await c.json("/api/directors/overview", "ADMIN")).body;
    const mBefore = dirBefore?.cost?.monthSoFar?.total, mAfter = dirAfter?.cost?.monthSoFar?.total;
    t.ok(typeof mBefore === "number" && near(mBefore - mAfter, 1234.5), "Directors: this month's cost drops by exactly the hidden line", typeof mBefore === "number" ? (mBefore - mAfter).toFixed(2) : "no cost block");
    // B (a hire invoice): gone from accounts' hire invoice checks once hidden; Tracking's invoiced drops by it.
    const listed = (hb, id) => JSON.stringify(hb?.items ?? []).includes(id);
    t.ok(listed(hireBefore, B.body?.id), "accounts: the hire invoice is in the hire checks before");
    t.status(await c.del(`/api/invoiced-costs/${B.body?.id}`, "ADMIN", { reason: note }), 200, "an Admin removes the hire invoice B");
    const hireAfter = (await c.json("/api/accounts/invoice-checks?tab=hire", "ACCOUNTS")).body;
    t.ok(!listed(hireAfter, B.body?.id), "accounts: the hidden hire invoice is no longer checked");
    const after2 = await tracking();
    t.ok(near(projOf(after)?.invoicedTotal - projOf(after2)?.invoicedTotal, 700), "Tracking: invoiced drops by exactly B (its hire days go back to the estimate)");
    t.ok(sameOthers(after, after2), "Tracking: every other project still unchanged");
    // The same supplier + number can be entered again once the first is hidden (it no longer counts as a duplicate).
    const again = await addInv({ category: "MATERIALS", vendor: `RC KF supplier ${tag}`, invoiceNo: `RC-A-${tag}`, weekEnding: c.today, amountExGst: 1 });
    t.status(again.status, 201, "a hidden line isn't a duplicate - the same invoice number can be entered again");

    // The invoices inbox: "Take off the job" (UNDO) hides the Tracking line; "Read again" hides the failed read's lines.
    const up = await db.invoiceUpload.create({ data: { fileName: `rc-kf-${tag}.pdf`, originalName: `rc-kf-${tag}.pdf`, kind: "PDF", status: "DONE", uploadedBy: "RC" } });
    const dr = await db.invoiceDraft.create({ data: { uploadId: up.id, supplier: `RC KF supplier ${tag}`, invoiceNo: `RC-C-${tag}`, amountExGst: 99, projectId: pid, status: "ADDED", invoicedCostId: C.body?.id } });
    t.status(await c.patch(`/api/invoice-inbox/drafts/${dr.id}`, "ACCOUNTS", { action: "UNDO" }), 200, "accounts take an added invoice back off its job");
    const cRow = await db.invoicedCost.findUnique({ where: { id: C.body?.id } });
    t.ok(cRow && cRow.removedAt && cRow.removedBy && cRow.removeReason, "...the Tracking line is KEPT, hidden, with who and why");
    const failed = await db.invoiceUpload.create({ data: { fileName: `rc-kf-missing-${tag}.pdf`, originalName: `rc-kf-missing-${tag}.pdf`, kind: "PDF", status: "FAILED", uploadedBy: "RC" } });
    const partial = await db.invoiceDraft.create({ data: { uploadId: failed.id, supplier: "RC partial", status: "NEEDS_REVIEW" } });
    t.status(await c.patch(`/api/invoice-inbox/uploads/${failed.id}`, "ACCOUNTS", { action: "RETRY" }), 200, "a failed upload is read again");
    const pRow = await db.invoiceDraft.findUnique({ where: { id: partial.id } });
    t.ok(pRow && pRow.removedAt && pRow.removedBy && pRow.removeReason, "...its earlier partial line is KEPT, hidden, with who and why");
    const inbox = (await c.json("/api/invoice-inbox", "ACCOUNTS")).body;
    t.ok(!JSON.stringify(inbox ?? {}).includes(partial.id), "...and no longer listed in the inbox");

    // ---------- (3) a job cancelled: off the board, the calendar and Tracking's booked days - but kept ----------
    const mkJob = async (date, extra = {}) => { const r = await c.post("/api/jobs", "MANAGER", { projectId: pid, title: project.name, date, shift: "DAY", startTime: "7am", endTime: "3pm", dateCheckNote: note, ...extra }); return { status: r.status, body: await body(r) }; };
    const j1 = await mkJob(D1, { dayBrief: "RC brief to cancel" });
    t.status(j1.status, 201, "a job two months ahead");
    const as1 = await body(await c.post("/api/assignments", "MANAGER", { jobId: j1.body?.id, resourceId: machine.id }));
    const fBefore = projOf(await tracking())?.forecastCost;
    const onBoard = async (date, id) => ((await c.json(`/api/jobs?date=${date}`, "MANAGER")).body ?? []).some((j) => j.id === id);
    const onCal = async (date, id) => JSON.stringify((await c.json(`/api/calendar?from=${date}&to=${date}`, "MANAGER")).body ?? {}).includes(id);
    t.ok(await onBoard(D1, j1.body?.id) && await onCal(D1, j1.body?.id), "it's on the board and the calendar");
    t.status(await c.del(`/api/jobs/${j1.body?.id}`, "MANAGER", {}), 400, "cancel without a reason is refused");
    t.status(await c.del(`/api/jobs/${j1.body?.id}`, "VIEWER", { reason: note }), 403, "a Viewer can't cancel a job");
    t.status(await c.del(`/api/jobs/${j1.body?.id}`, "MANAGER", { reason: note }), 200, "a Manager cancels it with a reason");
    const jr = await db.job.findUnique({ where: { id: j1.body?.id } });
    t.ok(jr && jr.status === "CANCELLED" && jr.cancelledAt && jr.cancelledBy && jr.cancelReason === note, "the job is KEPT - CANCELLED with when, who and why");
    t.ok(!(await onBoard(D1, j1.body?.id)) && !(await onCal(D1, j1.body?.id)), "it's off the board and the calendar");
    const fAfter = projOf(await tracking())?.forecastCost;
    t.ok(typeof fBefore === "number" && near(fBefore - fAfter, 800), "Tracking: its booked day no longer counts in the forecast", typeof fBefore === "number" ? (fBefore - fAfter).toFixed(2) : "no forecast");
    t.ok(!(await db.assignment.findUnique({ where: { id: as1?.id ?? "-" } })), "its allocation is off the board");
    const ce = await db.boardEdit.findFirst({ where: { date: D1, action: "JOB_CANCEL" }, orderBy: { at: "desc" } });
    const cs = ce?.snapshot ? JSON.parse(ce.snapshot) : null;
    t.ok(cs?.job?.jobId === j1.body?.id && cs.job.dayBrief === "RC brief to cancel" && cs.allocations?.some((x) => x.assignmentId === as1?.id && x.resourceId === machine.id && x.resourceName === machine.name), "BoardEdit JOB_CANCEL holds the full job and its allocation (resource id + name, times)");
    t.status(await c.patch(`/api/jobs/${j1.body?.id}`, "MANAGER", { startTime: "8am" }), 404, "a cancelled job can't be edited");
    t.status(await c.post("/api/assignments", "MANAGER", { jobId: j1.body?.id, resourceId: person.id }), 404, "nothing can be put on a cancelled job");
    const back = await mkJob(D1);
    t.ok(back.status === 201 && back.body?.id === j1.body?.id && await onBoard(D1, j1.body?.id), "adding the same project / day / shift brings the SAME job back (no second row)", back.status);
    t.ok((await db.recordChange.count({ where: { model: "Job", recordId: j1.body?.id, field: "cancelledAt" } })) >= 2, "the cancel and the return are both in the job's history");
    await c.del(`/api/jobs/${j1.body?.id}`, "MANAGER", { reason: note }); // leave it cancelled

    // ---------- (4) board snapshots: remove, move onto a job it's already on, Clear board ----------
    const j2 = await mkJob(D2, { dayBrief: `RC brief ${tag}` });
    const oneOff = await body(await c.post("/api/jobs", "MANAGER", { title: `RC one-off ${tag}`, date: D2, shift: "DAY", dateCheckNote: note }));
    const put = async (jobId, resourceId) => body(await c.post("/api/assignments", "MANAGER", { jobId, resourceId, role: "Operator" }));
    const r1 = await put(j2.body?.id, person.id);
    t.status(await c.del(`/api/assignments/${r1?.id}`, "MANAGER"), 200, "an allocation removed");
    const re = await db.boardEdit.findFirst({ where: { date: D2, action: "REMOVE" }, orderBy: { at: "desc" } });
    const rs = re?.snapshot ? JSON.parse(re.snapshot) : null;
    const full = (x, id, res) => x && x.assignmentId === id && x.resourceId === res.id && x.resourceName === res.name && x.role === "Operator" && x.jobId && x.jobTitle && x.jobDate === D2 && x.shift === "DAY" && "startTime" in x && x.createdAt;
    t.ok(full(rs?.allocations?.[0], r1?.id, person), "REMOVE: BoardEdit holds the full row (resource id + name, job id / title / date / shift / times, role)");
    const m1 = await put(j2.body?.id, person2.id), m2 = await put(oneOff?.id, person2.id);
    t.status(await c.patch(`/api/assignments/${m1?.id}`, "MANAGER", { jobId: oneOff?.id }), 200, "a tile moved onto a job it's already on");
    const me = await db.boardEdit.findFirst({ where: { date: D2, action: "MOVE" }, orderBy: { at: "desc" } });
    const ms = me?.snapshot ? JSON.parse(me.snapshot) : null;
    t.ok(ms?.kind === "MOVE_DUPLICATE" && full(ms.allocations?.[0], m1?.id, person2) && !!m2?.id, "MOVE (already there): the removed tile's full row is in the snapshot");
    const k1 = await put(j2.body?.id, person.id), k2 = await put(j2.body?.id, machine.id);
    t.status(await c.post("/api/jobs/clear", "MANAGER", { date: D2 }), 200, "Clear board");
    const ke = await db.boardEdit.findFirst({ where: { date: D2, action: "CLEAR" }, orderBy: { at: "desc" } });
    const ks = ke?.snapshot ? JSON.parse(ke.snapshot) : null;
    const ids = new Set((ks?.allocations ?? []).map((x) => x.assignmentId));
    t.ok(ks?.kind === "CLEAR" && [k1?.id, k2?.id, m2?.id].every((id) => ids.has(id)) && full(ks.allocations.find((x) => x.assignmentId === k1?.id), k1?.id, person), "CLEAR: every allocation removed is in the snapshot, in full");
    t.ok((ks?.briefs ?? []).some((b) => b.jobId === j2.body?.id && b.dayBrief === `RC brief ${tag}`), "CLEAR: the old day brief is kept in the snapshot");

    // ---------- (5) remove = hide, with who / why: Day Review row, service record, contact, wording, bug report, tool ----------
    t.status(await c.post("/api/day-review/actual", "MANAGER", { jobId: oneOff?.id, resourceId: person.id, actualHours: 5 }), 200, "a Day Review row added");
    t.status(await c.del(`/api/day-review/actual?jobId=${oneOff?.id}&resourceId=${person.id}&reason=${encodeURIComponent(note)}`, "MANAGER"), 200, "...and removed");
    const ja = await db.jobActual.findUnique({ where: { jobId_resourceId: { jobId: oneOff?.id, resourceId: person.id } } });
    t.ok(ja && ja.removedAt && ja.removedBy && ja.removeReason === note, "Day Review row: KEPT, hidden, with who and why");
    const drv = (await c.json(`/api/day-review?date=${D2}`, "MANAGER")).body;
    t.ok(!JSON.stringify(drv ?? {}).includes(ja?.id ?? "-"), "...and not on Day Review");
    t.status(await c.post("/api/day-review/actual", "MANAGER", { jobId: oneOff?.id, resourceId: person.id, actualHours: 6 }), 200, "saving the same person again brings the row back");
    const ja2 = await db.jobActual.findUnique({ where: { jobId_resourceId: { jobId: oneOff?.id, resourceId: person.id } } });
    t.ok(ja2?.id === ja?.id && !ja2.removedAt && ja2.actualHours === 6 && (await db.recordChange.count({ where: { model: "JobActual", recordId: ja?.id } })) >= 2, "...the same row, its removal and return in its history");

    const sr = await body(await c.post(`/api/resources/${machine.id}/service`, "MANAGER", { date: c.today, work: "RC service" }));
    t.status(await c.del(`/api/service/${sr?.id}`, "MANAGER", { reason: note }), 200, "a service record removed");
    const srRow = await db.serviceRecord.findUnique({ where: { id: sr?.id ?? "-" } });
    t.ok(srRow && srRow.removedAt && srRow.removedBy && srRow.removeReason === note, "service record: KEPT, hidden, with who and why");
    t.ok(!((await c.json(`/api/resources/${machine.id}/service`, "MANAGER")).body ?? []).some((x) => x.id === sr?.id), "...and not in the service history");

    const ct = await body(await c.post(`/api/projects/${pid}/contacts`, "MANAGER", { name: `RC contact ${tag}` }));
    t.status(await c.del(`/api/projects/${pid}/contacts/${ct?.id}`, "MANAGER", { reason: note }), 200, "a project contact removed");
    const ctRow = await db.projectContact.findUnique({ where: { id: ct?.id ?? "-" } });
    t.ok(ctRow && ctRow.removedAt && ctRow.removedBy && ctRow.removeReason === note, "contact: KEPT, hidden, with who and why");
    t.ok(!((await c.json(`/api/projects/${pid}`, "MANAGER")).body?.contacts ?? []).some((x) => x.id === ct?.id), "...and not on the project");

    const word = `rc kf wording ${tag}`;
    t.status(await c.post(`/api/projects/${pid}/aliases`, "MANAGER", { text: word }), 201, "an invoice wording added");
    t.status(await c.del(`/api/projects/${pid}/aliases?text=${encodeURIComponent(word)}&reason=${encodeURIComponent(note)}`, "MANAGER"), 200, "...and removed");
    const al = await db.siteAlias.findUnique({ where: { text: word } });
    t.ok(al && al.removedAt && al.removedBy && al.removeReason === note, "wording: KEPT, hidden, with who and why");
    t.ok(!((await c.json(`/api/projects/${pid}/aliases`, "MANAGER")).body?.aliases ?? []).some((x) => x.text === word), "...and not listed");
    t.status(await c.post(`/api/projects/${pid}/aliases`, "MANAGER", { text: word }), 201, "adding it again");
    const al2 = await db.siteAlias.findUnique({ where: { text: word } });
    t.ok(al2?.id === al?.id && !al2.removedAt, "...brings the same row back");

    const bug = await body(await c.post("/api/bugs", "MANAGER", { title: `RC bug ${tag}`, description: "release check" }));
    t.status(await c.del(`/api/bugs/${bug?.id}`, "MANAGER", { reason: note }), 200, "a bug report removed");
    const bugRow = await db.bugReport.findUnique({ where: { id: bug?.id ?? "-" } });
    t.ok(bugRow && bugRow.removedAt && bugRow.removedBy && bugRow.removeReason === note, "bug report: KEPT, hidden, with who and why");
    t.ok(!((await c.json("/api/bugs", "MANAGER")).body ?? []).some((x) => x.id === bug?.id), "...and not listed");

    const tool = await body(await c.post("/api/tools", "MANAGER", { name: `RC KF drill ${tag}`, serialNumber: `RC-KF-${tag}`, condition: "Good", ownership: "OWNED", heldBy: "Yard" }));
    t.status(await c.del(`/api/tools/${tool?.id}`, "MANAGER", { reason: "Broken beyond repair" }), 200, "a tool retired (the Delete route)");
    const toolRow = await db.tool.findUnique({ where: { id: tool?.id ?? "-" } });
    t.ok(toolRow && toolRow.retiredAt && toolRow.retiredBy && toolRow.retireReason === "Broken beyond repair", "tool: KEPT, retired, with who and why");
    t.ok(!((await c.json("/api/tools", "MANAGER")).body ?? []).some((x) => x.id === tool?.id), "...and off the register");
    t.status(await c.get(`/api/tools/${tool?.id}`, "MANAGER"), 200, "...its record and history still open");

    // ---------- (6) the change history: a Resource rate edit - Admin sees it, a Manager (pay) and a Viewer don't ----------
    t.status(await c.patch(`/api/resources/${person.id}`, "ADMIN", { ordinaryRate: 45 }), 200, "an Admin changes a pay rate");
    t.status(await c.patch(`/api/resources/${machine.id}`, "MANAGER", { dailyRateExGst: 850 }), 200, "a Manager changes a day rate");
    const rc = await db.recordChange.findFirst({ where: { model: "Resource", recordId: person.id, field: "ordinaryRate" } });
    t.ok(rc && rc.before === "40" && rc.after === "45" && rc.changedById === c.users.ADMIN.id, "RecordChange: model, record, field, before -> after, who (id)");
    const hist = async (id, who) => { const r = await c.json(`/api/history?model=Resource&id=${id}`, who); return { status: r.status, fields: (r.body?.changes ?? []).map((x) => x.field) }; };
    const hA = await hist(person.id, "ADMIN"), hM = await hist(person.id, "MANAGER"), hV = await hist(person.id, "VIEWER");
    t.ok(hA.status === 200 && hA.fields.includes("ordinaryRate"), "an Admin sees the pay-rate change in its history");
    t.ok(hM.status === 200 && !hM.fields.includes("ordinaryRate"), "a Manager doesn't see the pay-rate change");
    t.ok(hV.status === 200 && !hV.fields.includes("ordinaryRate"), "a Viewer doesn't see the pay-rate change");
    const mV = await hist(machine.id, "VIEWER"), mM = await hist(machine.id, "MANAGER");
    t.ok(mM.fields.includes("dailyRateExGst") && !mV.fields.includes("dailyRateExGst"), "a day rate: Manager yes, Viewer no");
    for (const [who, want] of [["COORDINATOR", 403], ["YARD", 403], ["TIMESHEETS", 403], ["DIRECTOR", 403], [null, 401]]) t.status(await c.get(`/api/history?model=Resource&id=${person.id}`, who), want, `history as ${who ?? "no login"}`);
    t.status(await c.get(`/api/history?model=User&id=${c.users.ADMIN.id}`, "ADMIN"), 400, "a login's record never has a history");
    t.ok(!(await db.recordChange.count({ where: { model: "User" } })), "no User row in the history");
    t.ok(!(await db.recordChange.count({ where: { field: { in: ["passwordHash", "sessionVersion", "tokenHash"] } } })), "no password / session / token field in the history");

    // ---------- (7) the Project DELETE is refused ----------
    for (const who of ["MANAGER", "ADMIN"]) t.status(await c.del(`/api/projects/${pid}`, who), 405, `DELETE /api/projects/:id as ${who} -> 405`);
    t.ok(!!(await db.project.findUnique({ where: { id: pid } })), "the project is still there");

    // ---------- (8) no automatic deletion is left ----------
    const src = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    t.ok(!/cleanupUnattachedMedia|cleanupOldWalkaround|faultPhotoCleanupTick/.test(src("src/lib/prestart/store.ts") + src("src/instrumentation.ts")), "the pre-start photo cleanups and their tick are gone");
    // Every delete left in the app is on the allowed list: board allocations (with a snapshot), push devices that are
    // gone or switched off, and a photo row whose file failed to write.
    const ALLOWED = new Set(["assignment", "pushDevice", "siteLinkPushDevice", "assetFaultMedia"]);
    const found = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) {
          for (const m of readFileSync(full, "utf8").matchAll(/\b(?:prisma|tx|db|t)\.(\w+)\.(delete|deleteMany)\(/g)) if (!ALLOWED.has(m[1])) found.push(`${path.relative(c.p.appDir, full)}: ${m[1]}.${m[2]}`);
        }
      }
    };
    walk(path.join(c.p.appDir, "src"));
    t.ok(found.length === 0, "no delete of a business record anywhere in src (only the allowed list)", found.join("; "));
  },
};
