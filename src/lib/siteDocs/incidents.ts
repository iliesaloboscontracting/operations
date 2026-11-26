// Incident reports (Ilies approved 25 Nov 2026, decision 4). Sent from the supervisor's link; read ONLY by the owner
// and DIRECTOR logins (/incidents, /directors/incidents - guardIncidents). After Send the link gets back the number,
// the date and the type, and never the details again. The owner's phone alert names the number, the project and the
// supervisor - never a health detail. Nothing here goes to any AI (the Assistant's tools and LCI never read it).
// Immutable: no update or delete path; the follow-up is IncidentEvent (append-only). Typed words are untrusted data.
import { prisma } from "../prisma";
import type { ResolvedLink } from "../siteLinks";
import { fromSydneyLocal } from "../shiftTimes";
import { pushToUsers } from "../push";
import { OWNER_EMAIL } from "../owner";
import { linkLabel } from "../dailyLog/money";
import { readSignature } from "./checks";
import { crewOf, docJob, jsonList, overCap, serial } from "./store";
import {
  EVENT_LABEL, STATUS_LABEL, alertRecipients, allocateNumber, incidentAlert, incidentEvent, incidentNo, incidentStatus, linkMayUse, parseIncident,
  personKey, pickCrew, safeworkLabel, scrubbedError, siteDocsOn, treatmentLabel, typeLabel, type EventKind, type IncidentStatus,
} from "./rules";

type Fail = { error: string; status: number };
const ID = /^[a-z0-9]{10,40}$/;

// What the link gets back after Send - and all it ever gets about a report: its number, the date and the type.
export type LinkIncidentDTO = { number: string; day: string; type: string; sentAt: string };

export async function sendIncident(link: ResolvedLink, body: Record<string, unknown>, now = new Date()): Promise<{ incident: LinkIncidentDTO } | Fail> {
  if (!linkMayUse(link)) return { error: "This link can't do that.", status: 403 };
  const p = parseIncident(body, now, fromSydneyLocal);
  if ("error" in p) return { error: p.error, status: 400 };
  const job = await docJob(link, p.jobId, now);
  if (!job) return { error: "That job isn't one of yours today.", status: 403 };
  const crew = await crewOf(job.id, null); // the supervisor can be involved too
  const people: { name: string; company: string | null; staff: boolean; key: string }[] = [];
  for (const id of p.people) {
    const c = pickCrew(crew, id);
    if ("error" in c) return { error: c.error, status: 400 };
    people.push({ name: linkLabel(c.workerName, "Crew member"), company: c.resourceId ? null : c.company ? linkLabel(c.company, "") || null : null, staff: !!c.resourceId, key: personKey(c) });
  }
  const sig = readSignature(p.signature, "Supervisor");
  if ("error" in sig) return { error: sig.error, status: 400 };
  if (p.photoIds.length) {
    const rows = await prisma.mediaObject.findMany({ where: { id: { in: p.photoIds } }, select: { id: true, area: true, siteLinkId: true, jobId: true, state: true, kind: true } });
    const ok = p.photoIds.every((id) => { const m = rows.find((x) => x.id === id); return !!m && m.area === "INCIDENT" && m.siteLinkId === link.id && m.jobId === job.id && m.state === "READY" && m.kind === "PHOTO"; });
    if (!ok) return { error: "A photo couldn't be found - add it again.", status: 400 };
  }
  const made = await serial(async (): Promise<{ id: string; number: number } | Fail> => {
    if (await overCap("incidents", link.id, now)) return { error: "That's a lot of reports today - call the office.", status: 429 };
    // SD-003 (Ilies approved 26 Nov 2026): a failed save is rethrown with the database's code only - the error a
    // database gives can quote the row, and nothing typed on the report (health details) may reach a log.
    let made: { number: number; row: { id: string } };
    try {
      made = await allocateNumber(
      async () => (await prisma.incidentReport.aggregate({ _max: { number: true } }))._max.number ?? 0,
      (number) => prisma.incidentReport.create({
        data: {
          number, jobId: job.id, projectId: job.projectId, day: job.day, projectName: job.projectName.slice(0, 200), jobNo: job.jobNo,
          type: p.type, treatment: p.treatment, bodyPart: p.bodyPart, occurredAt: p.occurredAt, location: p.location,
          people: JSON.stringify(people.map(({ key: _k, ...x }) => x)), others: p.others, whatHappened: p.whatHappened, immediateAction: p.immediateAction,
          witnesses: p.witnesses, serious: p.serious, notifiable: p.notifiable, promptShown: p.promptShown, safeworkCalled: p.safeworkCalled,
          photoIds: JSON.stringify(p.photoIds), supervisorName: link.person.name.slice(0, 80), resourceId: link.person.id, siteLinkId: link.id, linkKind: link.kind,
          signature: { create: { png: sig.png, bytes: sig.bytes, sha256: sig.sha256 } },
        },
        select: { id: true, number: true, day: true, type: true, createdAt: true },
      }),
      );
    } catch (e) {
      throw scrubbedError("Saving an incident report", e);
    }
    return { id: made.row.id, number: made.number };
  });
  if ("error" in made) return made;
  // The alert never holds up (or fails) the send.
  void alertIncident(made.id).catch((e) => console.error("incident alert", e instanceof Error ? e.message : "failed"));
  return { incident: { number: incidentNo(made.number), day: job.day, type: p.type, sentAt: now.toISOString() } };
}

// "Incident report INC-0004 sent - <project> (<supervisor>)" to the owner's own phones only. -> devices reached.
export async function alertIncident(id: string): Promise<number> {
  if (!siteDocsOn()) return 0;
  const d = await prisma.incidentReport.findUnique({ where: { id }, select: { id: true, number: true, projectName: true, supervisorName: true } });
  if (!d) return 0;
  const msg = incidentAlert({ id: d.id, number: d.number, projectName: d.projectName, supervisor: d.supervisorName });
  if (!msg) return 0;
  const users = await prisma.user.findMany({ where: { active: true, email: OWNER_EMAIL }, select: { id: true, email: true, active: true } });
  const to = alertRecipients(users, OWNER_EMAIL);
  return to.length ? pushToUsers(to, msg, "high") : 0;
}

// ---------- the owner / DIRECTOR views ----------

export type IncidentRowDTO = {
  id: string; number: string; day: string; occurredAt: string; project: string; jobNo: string | null; type: string; typeLabel: string;
  treatment: string; treatmentLabel: string; notifiable: boolean; safework: string; supervisor: string; sentAt: string; status: IncidentStatus; statusLabel: string;
};
export type IncidentDetailDTO = IncidentRowDTO & {
  bodyPart: string; location: string; people: { name: string; company: string | null; staff: boolean }[]; others: string | null;
  whatHappened: string; immediateAction: string; witnesses: string | null; serious: boolean;
  phoneReportedPromptShown: boolean; // SD-006: what the phone said - the red SafeWork box was on its screen before Send
  photoIds: string[];
  linkKind: string; hasSignature: boolean;
  events: { kind: string; label: string; status: string; note: string; by: string; at: string }[];
};
const ROW = { id: true, number: true, day: true, occurredAt: true, projectName: true, jobNo: true, type: true, treatment: true, notifiable: true, safeworkCalled: true, supervisorName: true, createdAt: true } as const;
type Row = { id: string; number: number; day: string; occurredAt: Date; projectName: string; jobNo: string | null; type: string; treatment: string; notifiable: boolean; safeworkCalled: string | null; supervisorName: string; createdAt: Date };
const row = (r: Row, status: IncidentStatus): IncidentRowDTO => ({
  id: r.id, number: incidentNo(r.number), day: r.day, occurredAt: r.occurredAt.toISOString(), project: r.projectName, jobNo: r.jobNo, type: r.type, typeLabel: typeLabel(r.type),
  treatment: r.treatment, treatmentLabel: treatmentLabel(r.treatment), notifiable: r.notifiable, safework: r.notifiable ? safeworkLabel(r.safeworkCalled) : "-",
  supervisor: r.supervisorName, sentAt: r.createdAt.toISOString(), status, statusLabel: STATUS_LABEL[status],
});
async function statusesOf(ids: string[]) {
  const ev = ids.length ? await prisma.incidentEvent.findMany({ where: { incidentId: { in: ids } }, select: { id: true, incidentId: true, status: true, createdAt: true } }) : [];
  const by = new Map<string, { id: string; status: string; createdAt: Date }[]>();
  for (const e of ev) by.set(e.incidentId, [...(by.get(e.incidentId) ?? []), e]);
  return new Map(ids.map((id) => [id, incidentStatus(by.get(id) ?? [])]));
}
export async function incidentList(): Promise<{ rows: IncidentRowDTO[] }> {
  const rows = await prisma.incidentReport.findMany({ orderBy: { number: "desc" }, take: 500, select: ROW });
  const st = await statusesOf(rows.map((r) => r.id));
  return { rows: rows.map((r) => row(r, st.get(r.id) ?? "OPEN")) };
}
export async function incidentDetail(id: string): Promise<IncidentDetailDTO | null> {
  if (typeof id !== "string" || !ID.test(id)) return null;
  const d = await prisma.incidentReport.findUnique({
    where: { id },
    select: { ...ROW, bodyPart: true, location: true, people: true, others: true, whatHappened: true, immediateAction: true, witnesses: true, serious: true, promptShown: true, photoIds: true, linkKind: true, signature: { select: { id: true } } },
  });
  if (!d) return null;
  const events = await prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let people: IncidentDetailDTO["people"] = [];
  try { const v = JSON.parse(d.people); if (Array.isArray(v)) people = v.filter((x) => x && typeof x.name === "string").map((x) => ({ name: String(x.name), company: typeof x.company === "string" ? x.company : null, staff: !!x.staff })); } catch { /* none */ }
  return {
    ...row(d, incidentStatus(events)),
    bodyPart: d.bodyPart, location: d.location, people, others: d.others, whatHappened: d.whatHappened, immediateAction: d.immediateAction, witnesses: d.witnesses,
    serious: d.serious, phoneReportedPromptShown: d.promptShown, photoIds: jsonList(d.photoIds), linkKind: d.linkKind, hasSignature: !!d.signature,
    events: events.map((e) => ({ kind: e.kind, label: EVENT_LABEL[e.kind as EventKind] ?? e.kind, status: STATUS_LABEL[e.status as IncidentStatus] ?? e.status, note: e.note, by: e.byName, at: e.createdAt.toISOString() })),
  };
}
// A follow-up note (append-only), one at a time; the report itself is never touched.
export async function addIncidentEvent(id: string, who: { id: string; name: string }, body: Record<string, unknown>): Promise<{ status: IncidentStatus } | Fail> {
  if (typeof id !== "string" || !ID.test(id)) return { error: "not found", status: 404 };
  return serial(async () => {
    const d = await prisma.incidentReport.findUnique({ where: { id }, select: { id: true } });
    if (!d) return { error: "not found", status: 404 };
    const current = incidentStatus(await prisma.incidentEvent.findMany({ where: { incidentId: id }, select: { id: true, status: true, createdAt: true } }));
    const e = incidentEvent(current, body);
    if ("error" in e) return { error: e.error, status: body.from !== undefined && body.from !== current ? 409 : 400 };
    // SD-012 (Ilies approved 26 Nov 2026): a failed save never carries the typed note into a log - the code only.
    try {
      await prisma.incidentEvent.create({ data: { incidentId: id, kind: e.kind, status: e.status, note: e.note, byUserId: who.id, byName: who.name.slice(0, 80) } });
    } catch (err) {
      throw scrubbedError("Saving a follow-up note", err);
    }
    return { status: e.status };
  });
}
export async function incidentSignature(id: string): Promise<Buffer | null> {
  if (!ID.test(id)) return null;
  const s = await prisma.incidentSignature.findUnique({ where: { incidentId: id }, select: { png: true } });
  return s ? Buffer.from(s.png) : null;
}
export async function incidentHasPhoto(id: string, mediaId: string): Promise<boolean> {
  if (!ID.test(id) || !ID.test(mediaId)) return false;
  const d = await prisma.incidentReport.findUnique({ where: { id }, select: { photoIds: true } });
  return !!d && jsonList(d.photoIds).includes(mediaId);
}
// Is this upload already on a sent report? (Then the link can't read it back.)
export async function photoOnAReport(mediaId: string): Promise<boolean> {
  return (await prisma.incidentReport.count({ where: { photoIds: { contains: `"${mediaId}"` } } })) > 0;
}
