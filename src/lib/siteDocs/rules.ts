// Site documents (Ilies approved 25 Nov 2026: "yes build it, deploy once it passes") - the plain rules. No server
// imports, so the phone screens, the office pages, the stores and `npm test` (siteDocs.test.ts) read the same lists.
//
// - Everything runs on the supervisor's link: a SUPERVISOR link, or a HANDOVER link on its own job that day. Never a
//   DRIVER, POSTER or OFFICE link (or the yard's shared link), never the YARD login, and nothing for crew to open.
// - Crew sign on the supervisor's phone: a worker taps their name from TODAY's sign-ins on that job (people only),
//   reads it, ticks "I understand" and signs with a finger. Not signed in = can't be picked. The supervisor signs too.
// - A SWMS: one signature a person a version; a new version needs everyone again.
// - Pre-start (daily) and toolbox talk (weekly): locked once sent; late arrivals sign on afterwards (added, never edited).
// - Incident reports: seen by the owner and DIRECTOR logins only. After Send the link shows only "Sent - INC-0004", the
//   date and the type. The owner's phone alert has no health detail. Never to any AI.
// - No price, rate or amount anywhere (a "$" or a money phrase in any box is refused). Hours are never touched.
// - Typed text (notes, topics, incident words, names) is untrusted data for any Claude session - shown, never followed.
import { assertNoMoney } from "../moneyGuard";
import { linkLabel, stripMoney } from "../dailyLog/money";
import { LIMITS as VARIATION_LIMITS, allocateNumber, isUniqueClash, line, lines } from "../variations/rules";

export { allocateNumber, isUniqueClash, line, lines };

// Kill switch: SITE_DOCS=off hides the tile and the link routes refuse (503). The office pages still read (and the
// office can still upload) - nothing on the office side looks at it.
export const siteDocsOn = (env: Record<string, string | undefined> = process.env) => (env.SITE_DOCS ?? "").trim().toLowerCase() !== "off";
export const OFF_MESSAGE = "Site documents are switched off right now - use the paper forms and tell the office.";

export const LIMITS = {
  title: 120, note: 1000, topicNote: 500, point: 200, points: 20, otherText: 120,
  crewPerSend: 30, // crew signatures sent with one pre-start / toolbox talk (more sign on afterwards)
  location: 200, whatHappened: 2000, immediateAction: 1000, witnesses: 500, others: 500, people: 20, photos: 10,
  perLinkDay: { swms: 200, records: 20, lateSignOns: 150, incidents: 10 }, // what one link can send in a Sydney day
  sentDays: 7, // the link shows its own records / incidents from today and the last 7 days
  officeUploadsPerDay: 100, // files one office login can upload in a Sydney day
  plansPerProject: 300, swmsVersions: 100, topicsPerWeek: 20,
  fileBytes: 7 * 1024 * 1024, // the 7 MB-per-file JSON limit (lib/uploadLimits.ts)
  signatureBytes: VARIATION_LIMITS.signatureBytes,
} as const;

// ---------- who ----------

// The office's Site documents pages (/site-documents, /api/site-documents/*): Managers, Admins (the owner is one) and
// the coordinator - exactly those four, by name. Never VIEWER, ACCOUNTS, TIMESHEETS, YARD or DIRECTOR.
export const SITE_DOC_OFFICE_ROLES: readonly string[] = ["ADMIN", "MANAGER", "COORDINATOR"];
export const mayReadSiteDocs = (role: string) => SITE_DOC_OFFICE_ROLES.includes(role);
// Incident reports (decision 4): the owner (by email) and DIRECTOR logins - nobody else. Not a Manager, not another
// Admin (not even one with the director tick), not the coordinator, accounts, the yard or the Building Agent.
export const mayReadIncidents = (u: { role: string; email: string }, ownerEmail: string) =>
  u.role === "DIRECTOR" || (u.email ?? "").trim().toLowerCase() === ownerEmail.toLowerCase();
// The links that use it: a person's SUPERVISOR link, or a HANDOVER link (its own job - the store's job list).
export const linkMayUse = (link: { kind: string; shared?: boolean; person?: { id: string | null } }) =>
  (link.kind === "SUPERVISOR" || link.kind === "HANDOVER") && !link.shared && !!link.person?.id;
// VD-002's pattern: the Building Agent login (Operations AI) looks at lists and registers only - never a signature,
// never an upload, an archive or a topic. (The email is lib/session.ts BUILDING_AGENT_EMAIL.)
export const isAgentEmail = (email: string | null | undefined, agentEmail: string) => (email ?? "").trim().toLowerCase() === agentEmail.toLowerCase();
export const AGENT_NO_FILES = "The Building Agent login can't open signatures.";
export const AGENT_NO_WRITE = "The Building Agent login can't upload, archive or set the topic.";

// ---------- text ----------

const DOLLAR = /[$＄﹩]/;
export const hasMoney = (s: string) => DOLLAR.test(s) || stripMoney(s).removed || !assertNoMoney(s);
export const MONEY_REFUSED = "Leave prices and amounts off - say what happened, not what it costs.";
// The money guard for everything a link gets back.
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x)) && !DOLLAR.test(JSON.stringify(x));
export const safeLabel = linkLabel;

// ---------- days and weeks (Sydney) ----------

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// The Monday of the week a day is in (a Sydney week runs Monday to Sunday).
export const mondayOf = (day: string) => { const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay(); return addDays(day, -((dow + 6) % 7)); };
export const weekOf = (d: Date) => mondayOf(sydneyDay(d));

// ---------- pre-start topics (decision C) ----------

export const PRESTART_TOPICS = [
  { key: "SAFETY", label: "Safety" },
  { key: "ENVIRONMENT", label: "Environment changes (weather, dust, noise)" },
  { key: "EXCLUSION_ZONES", label: "Exclusion zones" },
  { key: "PPE", label: "PPE required" },
  { key: "HRW_LOBOS", label: "High-risk work by Lobos" },
  { key: "HRW_OTHERS", label: "High-risk work by other trades" },
  { key: "PLANT", label: "Plant movements" },
  { key: "ASBESTOS", label: "Asbestos / hazardous materials" },
  { key: "ACCESS", label: "Access and exits" },
  { key: "EMERGENCY", label: "Emergency procedures" },
  { key: "OTHER", label: "Other" },
] as const;
export const topicLabel = (k: string) => PRESTART_TOPICS.find((t) => t.key === k)?.label ?? k;
export const RECORD_KINDS = ["PRESTART", "TOOLBOX"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const isRecordKind = (x: unknown): x is RecordKind => x === "PRESTART" || x === "TOOLBOX";
export const recordLabel = (kind: string, seq: number) => (kind === "TOOLBOX" ? "Toolbox talk" : "Pre-start") + (seq > 1 ? ` ${seq}` : "");

// ---------- incident lists (decision E) ----------

export const INCIDENT_TYPES = [
  { key: "INJURY", label: "Injury" },
  { key: "NEAR_MISS", label: "Near miss" },
  { key: "HAZARD", label: "Hazard" },
  { key: "PROPERTY_DAMAGE", label: "Property damage" },
  { key: "ENVIRONMENTAL", label: "Environmental" },
  { key: "DANGEROUS", label: "Dangerous incident" },
] as const;
export const TREATMENTS = [
  { key: "NONE", label: "None" },
  { key: "FIRST_AID", label: "First aid" },
  { key: "MEDICAL", label: "Medical treatment" },
  { key: "LOST_TIME", label: "Lost time" },
] as const;
export const BODY_PARTS = [
  "Not applicable", "Head", "Face", "Eye(s)", "Ear(s)", "Neck", "Shoulder", "Upper arm", "Elbow", "Forearm", "Wrist", "Hand",
  "Finger(s)", "Chest", "Upper back", "Lower back", "Abdomen", "Hip / groin", "Thigh", "Knee", "Lower leg", "Ankle", "Foot",
  "Toe(s)", "Several parts", "Internal / illness", "Other",
] as const;
export const SAFEWORK_ANSWERS = [
  { key: "YES", label: "Yes - SafeWork has been called" },
  { key: "NOT_YET", label: "Not yet" },
  { key: "NOT_NEEDED", label: "Not needed" },
] as const;
export const typeLabel = (k: string) => INCIDENT_TYPES.find((t) => t.key === k)?.label ?? k;
export const treatmentLabel = (k: string) => TREATMENTS.find((t) => t.key === k)?.label ?? k;
export const safeworkLabel = (k: string | null) => (k ? SAFEWORK_ANSWERS.find((t) => t.key === k)?.label ?? k : "-");
export const SAFEWORK_PROMPT = "This may need to be reported to SafeWork NSW straight away. Call SafeWork NSW and don't disturb the site unless it's needed to make it safe or help someone. Then tell the office.";
// The red SafeWork box (decision E): a dangerous incident, medical treatment or lost time, or "serious injury or
// illness" ticked. Nobody is ever contacted automatically - the phone shows the box and records the answer.
export const isNotifiable = (x: { type?: unknown; treatment?: unknown; serious?: unknown }) =>
  x.type === "DANGEROUS" || x.treatment === "MEDICAL" || x.treatment === "LOST_TIME" || x.serious === true;

export const incidentNo = (n: number) => `INC-${String(n).padStart(4, "0")}`;

// ---------- incident follow-up status ----------

export const INCIDENT_STATUS = ["OPEN", "INVESTIGATING", "CLOSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUS)[number];
export const STATUS_LABEL: Record<IncidentStatus, string> = { OPEN: "Open", INVESTIGATING: "Investigating", CLOSED: "Closed" };
export const EVENT_KINDS = ["INVESTIGATION", "ACTION", "CLOSED", "REOPENED"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_LABEL: Record<EventKind, string> = { INVESTIGATION: "Investigation note", ACTION: "Action taken", CLOSED: "Closed", REOPENED: "Reopened" };
// The status now: the newest event's (by time, then id), or Open with none.
export const incidentStatus = (events: { id?: string; status: string; createdAt: Date }[]): IncidentStatus => {
  const last = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || ((b.id ?? "") > (a.id ?? "") ? 1 : (b.id ?? "") < (a.id ?? "") ? -1 : 0))[0];
  return last && (INCIDENT_STATUS as readonly string[]).includes(last.status) ? (last.status as IncidentStatus) : "OPEN";
};
// A follow-up note: always a note (3+ characters); INVESTIGATION / ACTION move an open one to Investigating and are
// refused on a closed one (reopen it first); CLOSED closes it; REOPENED only from Closed. The page that saw `from` must
// still be right.
export function incidentEvent(current: IncidentStatus, b: Record<string, unknown>): { kind: EventKind; status: IncidentStatus; note: string } | { error: string } {
  if (!(EVENT_KINDS as readonly unknown[]).includes(b.kind)) return { error: "Investigation note, action, close or reopen?" };
  const kind = b.kind as EventKind;
  if (b.from !== undefined && b.from !== current) return { error: `Someone changed it to "${STATUS_LABEL[current]}" - have a look and try again.` };
  const note = lines(b.note, LIMITS.note + 1);
  if (note.length < 3) return { error: "Write the note." };
  if (note.length > LIMITS.note) return { error: `The note - at most ${LIMITS.note} characters.` };
  if (hasMoney(note)) return { error: MONEY_REFUSED };
  if (kind === "REOPENED") return current === "CLOSED" ? { kind, status: "INVESTIGATING", note } : { error: "Only a closed report can be reopened." };
  if (current === "CLOSED") return { error: "It's closed - reopen it first (with why)." };
  if (kind === "CLOSED") return { kind, status: "CLOSED", note };
  return { kind, status: "INVESTIGATING", note };
}

// ---------- people ----------

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Who a sign-on is for: the Labour-register person, or a hire worker by name + company (as they signed in).
export const personKey = (a: { resourceId: string | null; workerName: string; company?: string | null }) =>
  a.resourceId ? `R:${a.resourceId}` : `W:${norm(a.workerName)}|${norm(a.company)}`;
export type CrewRow = { id: string; jobId: string | null; resourceId: string | null; workerName: string; company: string | null; place: string | null; status: string; removedAt: Date | null };
// A sign-in that may be picked for a sign-on on this job: that job's own, a person's (not a truck / office / yard
// point), not removed by an Admin, not REJECTED. (The store only ever loads that job's sign-ins.)
export const pickable = (a: CrewRow, jobId: string) => a.jobId === jobId && !a.place && !a.removedAt && a.status !== "REJECTED";
// The crew list for a job: one row a person (their first sign-in), never the link's own person (they sign as the
// supervisor).
export function crewList<T extends CrewRow>(rows: T[], jobId: string, selfResourceId: string | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (!pickable(r, jobId)) continue;
    if (selfResourceId && r.resourceId === selfResourceId) continue;
    const k = personKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
// The crew member a phone picked: one of the job's own sign-ins today -> that row, or the plain refusal.
export function pickCrew<T extends CrewRow>(crew: T[], attendanceId: unknown): T | { error: string } {
  if (typeof attendanceId !== "string" || !/^[a-z0-9]{10,40}$/.test(attendanceId)) return { error: "Pick the person from today's crew." };
  const r = crew.find((c) => c.id === attendanceId);
  return r ?? { error: "They're not signed in on this job today - sign them in first, then they can sign on." };
}

// ---------- signatures ----------

// The bytes are checked server side (./checks.ts readSignature - the variation docket's PNG checks).
export const SAME_SIGNATURE = "Two signatures are exactly the same - each person signs for themselves.";
export const allDifferent = (sigs: { sha256: string }[]) => new Set(sigs.map((s) => s.sha256)).size === sigs.length;

// ---------- what a phone sends ----------

const ID = /^[a-z0-9]{10,40}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
type Err = { error: string };
export type CrewSignIn = { attendanceId: string; understood: boolean; signature: string };
function crewSignOns(raw: unknown, max: number): CrewSignIn[] | Err {
  const xs = Array.isArray(raw) ? raw : [];
  if (xs.length > max) return { error: `At most ${max} crew sign-ons at once - send it, then the rest sign on after.` };
  const out: CrewSignIn[] = [];
  for (const x of xs) {
    const t = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    if (!isId(t.attendanceId)) return { error: "Pick each person from today's crew." };
    if (t.understood !== true) return { error: "Each person ticks \"I understand\" before they sign." };
    if (typeof t.signature !== "string") return { error: "Each person signs in the white box." };
    out.push({ attendanceId: t.attendanceId, understood: true, signature: t.signature });
  }
  if (new Set(out.map((c) => c.attendanceId)).size !== out.length) return { error: "Someone is on the list twice." };
  return out;
}

export type PrestartInput = { kind: "PRESTART"; jobId: string; topics: { key: string; label: string; notes: string | null }[]; notes: string | null; crew: CrewSignIn[]; supervisorSignature: string };
export type ToolboxInput = {
  kind: "TOOLBOX"; jobId: string; source: "OFFICE" | "OWN"; topicId: string | null; title: string; points: string; sitePoints: string | null;
  notes: string | null; crew: CrewSignIn[]; supervisorSignature: string;
};
// A pre-start meeting or a toolbox talk from the phone, checked: lengths, the ticked topics, no amounts anywhere, the
// crew list's shape. Whether the job, the crew and the topic are real (and this link's) is the store's job.
export function parseRecord(b: Record<string, unknown>): PrestartInput | ToolboxInput | Err {
  if (!isRecordKind(b.kind)) return { error: "Pre-start or toolbox talk?" };
  if (!isId(b.jobId)) return { error: "Which job is it for?" };
  const notes = lines(b.notes, LIMITS.note + 1);
  if (notes.length > LIMITS.note) return { error: `The notes - at most ${LIMITS.note} characters.` };
  const crew = crewSignOns(b.crew, LIMITS.crewPerSend);
  if ("error" in crew) return crew;
  if (typeof b.supervisorSignature !== "string") return { error: "Sign it yourself as the supervisor." };
  if (b.kind === "PRESTART") {
    const raw = Array.isArray(b.topics) ? b.topics : [];
    const topics: PrestartInput["topics"] = [];
    for (const x of raw) {
      const t = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      const def = PRESTART_TOPICS.find((p) => p.key === t.key);
      if (!def) return { error: "Tick topics from the list." };
      if (topics.some((y) => y.key === def.key)) continue;
      const n = lines(t.notes, LIMITS.topicNote + 1);
      if (n.length > LIMITS.topicNote) return { error: `${def.label}: at most ${LIMITS.topicNote} characters.` };
      if (def.key === "OTHER" && n.length < 2) return { error: "Other: say what it was." };
      topics.push({ key: def.key, label: def.label, notes: n || null });
    }
    if (!topics.length) return { error: "Tick what was covered." };
    topics.sort((a, b2) => PRESTART_TOPICS.findIndex((p) => p.key === a.key) - PRESTART_TOPICS.findIndex((p) => p.key === b2.key));
    const typed = [notes, ...topics.map((t) => t.notes ?? "")];
    if (typed.some(hasMoney)) return { error: MONEY_REFUSED };
    return { kind: "PRESTART", jobId: b.jobId, topics, notes: notes || null, crew, supervisorSignature: b.supervisorSignature };
  }
  const source = b.source === "OFFICE" ? "OFFICE" : b.source === "OWN" ? "OWN" : null;
  if (!source) return { error: "The office's topic of the week, or your own?" };
  const topicId = source === "OFFICE" ? (isId(b.topicId) ? b.topicId : null) : null;
  if (source === "OFFICE" && !topicId) return { error: "There's no topic of the week to use - pick your own topic." };
  const title = line(b.title, LIMITS.title + 1);
  if (source === "OWN" && title.length < 3) return { error: "What's the topic?" };
  if (title.length > LIMITS.title) return { error: `The topic - at most ${LIMITS.title} characters.` };
  const points = lines(b.points, LIMITS.note + 1);
  if (points.length < 3) return { error: "Write the points you went through." };
  if (points.length > LIMITS.note) return { error: `The points - at most ${LIMITS.note} characters.` };
  const sitePoints = lines(b.sitePoints, LIMITS.note + 1);
  if (sitePoints.length > LIMITS.note) return { error: `Site-specific points - at most ${LIMITS.note} characters.` };
  if ([notes, title, points, sitePoints].some(hasMoney)) return { error: MONEY_REFUSED };
  return { kind: "TOOLBOX", jobId: b.jobId, source, topicId, title, points, sitePoints: sitePoints || null, notes: notes || null, crew, supervisorSignature: b.supervisorSignature };
}

// One sign-on (a SWMS, or a late arrival on a sent pre-start / toolbox talk): the crew member picked, ticked, signed -
// or, for a SWMS, the supervisor themselves (`supervisor: true`).
export type SignOnInput = { attendanceId: string | null; supervisor: boolean; understood: true; signature: string };
export function parseSignOn(b: Record<string, unknown>, o: { allowSupervisor: boolean }): SignOnInput | Err {
  const supervisor = b.supervisor === true;
  if (supervisor && !o.allowSupervisor) return { error: "Pick the person from today's crew." };
  if (!supervisor && !isId(b.attendanceId)) return { error: "Pick the person from today's crew." };
  if (b.understood !== true) return { error: "Tick \"I've read and understand\" before signing." };
  if (typeof b.signature !== "string") return { error: "Sign in the white box." };
  return { attendanceId: supervisor ? null : (b.attendanceId as string), supervisor, understood: true, signature: b.signature };
}

export type IncidentInput = {
  jobId: string; type: string; treatment: string; bodyPart: string; occurredAt: Date; location: string;
  people: string[]; others: string | null; whatHappened: string; immediateAction: string; witnesses: string | null;
  serious: boolean; notifiable: boolean; promptShown: boolean; safeworkCalled: string | null; photoIds: string[]; signature: string;
};
// "2026-11-25T14:30" (Sydney) -> a Date, via the caller's converter (lib/shiftTimes.ts fromSydneyLocal on the server).
export function parseIncident(b: Record<string, unknown>, now: Date, fromLocal: (s: string) => Date | null): IncidentInput | Err {
  if (!isId(b.jobId)) return { error: "Which job is it for?" };
  if (!INCIDENT_TYPES.some((t) => t.key === b.type)) return { error: "Pick the type." };
  if (!TREATMENTS.some((t) => t.key === b.treatment)) return { error: "Pick the treatment (None if there was none)." };
  if (!(BODY_PARTS as readonly unknown[]).includes(b.bodyPart)) return { error: "Pick the body part (Not applicable if none)." };
  const when = typeof b.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.occurredAt) ? fromLocal(b.occurredAt) : null;
  if (!when) return { error: "When did it happen? (date and time)" };
  if (when.getTime() > now.getTime() + 10 * 60_000) return { error: "That time is in the future." };
  if (when.getTime() < now.getTime() - 30 * 24 * 3600_000) return { error: "That's more than 30 days ago - tell the office." };
  const location = line(b.location, LIMITS.location + 1);
  if (location.length < 2) return { error: "Where on site?" };
  if (location.length > LIMITS.location) return { error: `Where on site - at most ${LIMITS.location} characters.` };
  const rawPeople = Array.isArray(b.people) ? b.people : [];
  if (rawPeople.length > LIMITS.people) return { error: `At most ${LIMITS.people} people picked.` };
  if (rawPeople.some((p) => !isId(p))) return { error: "Pick people from today's crew." };
  const people = [...new Set(rawPeople as string[])];
  const others = lines(b.others, LIMITS.others + 1);
  if (others.length > LIMITS.others) return { error: `Others involved - at most ${LIMITS.others} characters.` };
  const whatHappened = lines(b.whatHappened, LIMITS.whatHappened + 1);
  if (whatHappened.length < 10) return { error: "What happened? A few words at least." };
  if (whatHappened.length > LIMITS.whatHappened) return { error: `What happened - at most ${LIMITS.whatHappened} characters.` };
  const immediateAction = lines(b.immediateAction, LIMITS.immediateAction + 1);
  if (immediateAction.length < 2) return { error: "What was done straight away?" };
  if (immediateAction.length > LIMITS.immediateAction) return { error: `What was done - at most ${LIMITS.immediateAction} characters.` };
  const witnesses = lines(b.witnesses, LIMITS.witnesses + 1);
  if (witnesses.length > LIMITS.witnesses) return { error: `Witnesses - at most ${LIMITS.witnesses} characters.` };
  const serious = b.serious === true;
  const notifiable = isNotifiable({ type: b.type, treatment: b.treatment, serious });
  const promptShown = b.promptShown === true;
  let safeworkCalled: string | null = null;
  if (notifiable) {
    if (!promptShown) return { error: "Read the SafeWork box first." };
    if (!SAFEWORK_ANSWERS.some((a) => a.key === b.safeworkCalled)) return { error: "Has SafeWork been called? Yes, Not yet or Not needed." };
    safeworkCalled = b.safeworkCalled as string;
  }
  const rawPhotos = Array.isArray(b.photoIds) ? b.photoIds : [];
  if (rawPhotos.some((p) => !isId(p))) return { error: "A photo couldn't be found - add it again." };
  const photoIds = [...new Set(rawPhotos as string[])];
  if (photoIds.length > LIMITS.photos) return { error: `At most ${LIMITS.photos} photos.` };
  if (typeof b.signature !== "string") return { error: "Sign it as the supervisor." };
  if ([location, others, whatHappened, immediateAction, witnesses].some(hasMoney)) return { error: MONEY_REFUSED };
  return {
    jobId: b.jobId, type: b.type as string, treatment: b.treatment as string, bodyPart: b.bodyPart as string, occurredAt: when, location,
    people, others: others || null, whatHappened, immediateAction, witnesses: witnesses || null, serious, notifiable, promptShown, safeworkCalled, photoIds, signature: b.signature,
  };
}

// ---------- the owner's phone alert (decision 4) ----------

export type IncidentAlert = { title: string; body: string; url: string; tag: string };
// "Incident report INC-0004 sent - <project> (<supervisor>)", opening /incidents/<id>. The number, the project and the
// supervisor only - never the type, the treatment, a body part, a name involved or any of the typed words.
export function incidentAlert(d: { id: string; number: number; projectName: string; supervisor: string }): IncidentAlert | null {
  const msg = {
    title: "Incident report sent",
    body: `Incident report ${incidentNo(d.number)} sent - ${linkLabel(d.projectName, "a job")} (${linkLabel(d.supervisor, "the supervisor")})`.slice(0, 160),
    url: `/incidents/${d.id}`,
    tag: `incident-${d.id}`.slice(0, 40),
  };
  return linkSafe(msg) ? msg : null;
}
// Who gets it: the owner (Ilies) only, when their login is active.
export const alertRecipients = (users: { id: string; email: string; active: boolean }[], ownerEmail: string) =>
  users.filter((u) => u.active && u.email.toLowerCase() === ownerEmail.toLowerCase()).map((u) => u.id);

// ---------- office files ----------

export const FILE_KINDS = ["PLAN", "SWMS", "TOPIC"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_TYPES: Record<string, { ext: "pdf" | "jpg" | "png" }> = { "application/pdf": { ext: "pdf" }, "image/jpeg": { ext: "jpg" }, "image/png": { ext: "png" } };
// A filename safe for Content-Disposition: letters, digits, spaces, dots, dashes, underscores and brackets only.
export function safeFileName(title: string, ext: string) {
  const base = title.normalize("NFKD").replace(/[^\w .()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}
// The headers every served file gets: its real type (from its bytes), nosniff, inline with a safe name, never cached by
// anything shared, and a CSP that loads and runs nothing. An image also gets `sandbox`; a PDF can't (Chrome refuses to
// show a sandboxed PDF), so it gets default-src 'none' and frame-ancestors 'self' - the browser's own PDF viewer.
export function fileHeaders(mime: string, name: string): Record<string, string> {
  const csp = mime === "application/pdf" ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; frame-ancestors 'self'; sandbox";
  return {
    "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
    "Content-Security-Policy": csp, "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer",
  };
}
export const SIGNATURE_HEADERS: Record<string, string> = {
  "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

// The office's topic of the week (title, points, optional PDF).
export function parseTopic(b: Record<string, unknown>): { week: string; title: string; points: string[] } | Err {
  if (!isDay(b.week) || mondayOf(b.week) !== b.week) return { error: "Pick the week (its Monday)." };
  const title = line(b.title, LIMITS.title + 1);
  if (title.length < 3) return { error: "The topic's title." };
  if (title.length > LIMITS.title) return { error: `The title - at most ${LIMITS.title} characters.` };
  const raw = Array.isArray(b.points) ? b.points : typeof b.points === "string" ? b.points.split(/\r?\n/) : [];
  const points = raw.map((p) => line(p, LIMITS.point + 1)).filter(Boolean);
  if (points.length > LIMITS.points) return { error: `At most ${LIMITS.points} points.` };
  if (points.some((p) => p.length > LIMITS.point)) return { error: `Each point - at most ${LIMITS.point} characters.` };
  if ([title, ...points].some(hasMoney)) return { error: MONEY_REFUSED };
  return { week: b.week, title, points };
}
export function parseFileMeta(b: Record<string, unknown>): { projectId: string; kind: "PLAN" | "SWMS"; title: string } | Err {
  if (!isId(b.projectId)) return { error: "Which project?" };
  if (b.kind !== "PLAN" && b.kind !== "SWMS") return { error: "A plan / drawing or a SWMS?" };
  const title = line(b.title, LIMITS.title + 1);
  if (title.length < 2) return { error: "Give it a title (e.g. Level 2 demolition plan)." };
  if (title.length > LIMITS.title) return { error: `The title - at most ${LIMITS.title} characters.` };
  if (hasMoney(title)) return { error: MONEY_REFUSED };
  return { projectId: b.projectId, kind: b.kind, title };
}
export function parseArchive(b: Record<string, unknown>): { note: string } | Err {
  const note = line(b.note, 301);
  if (note.length < 3) return { error: "Say why it's being archived." };
  if (note.length > 300) return { error: "The reason - at most 300 characters." };
  if (hasMoney(note)) return { error: MONEY_REFUSED };
  return { note };
}
// The SWMS in use: the highest version that isn't archived (an archived newest one - e.g. the wrong file - leaves the
// one before it current again). The others are superseded.
export function currentSwms<T extends { id: string; version: number | null }>(versions: T[], archived: Set<string>): T | null {
  return [...versions].filter((v) => !archived.has(v.id) && v.version != null).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
}

// ---------- late sign-ons (SD-010, Ilies 26 Nov 2026) ----------

// The link's jobs today a late sign-on may use for a sent record: a pre-start - its own job only (same day); a toolbox
// talk - any of the link's jobs that day on the same project (or the same job, with no project) in the record's Sydney
// week (Monday to Sunday).
export function lateSignOnJobs<J extends { id: string; projectId: string | null; day: string }>(
  rec: { kind: string; jobId: string; projectId: string | null; week: string }, jobs: J[],
): J[] {
  if (rec.kind !== "TOOLBOX") return jobs.filter((j) => j.id === rec.jobId);
  return jobs.filter((j) => (rec.projectId ? j.projectId === rec.projectId : j.id === rec.jobId) && mondayOf(j.day) === rec.week);
}

// ---------- signed after signing out (SD-005, detective only) ----------

// A signature made after the person's sign-in on the job was signed out - flagged on the office's register and record
// (someone may have signed for them). Nothing is stored or refused.
export const signedAfterSignOut = (signedAt: Date, signOutAt: Date | null | undefined) => !!signOutAt && signedAt.getTime() > signOutAt.getTime();

// ---------- the new SWMS alert (Ilies, 26 Nov 2026) ----------

// "New SWMS for <project> (v3) - get the crew to sign it at the next pre-start." to the supervisors' links booked on
// the project today and the next 7 days. Words only, no money; opens the link's Site documents.
export function newSwmsAlert(projectName: string, version: number) {
  const msg = {
    title: "New SWMS",
    body: `New SWMS for ${linkLabel(projectName, "your job")} (v${version}) - get the crew to sign it at the next pre-start.`.slice(0, 160),
    url: "?go=docs",
    tag: `swms-${version}`,
  };
  return linkSafe(msg) ? msg : null;
}
// Which links: a SUPERVISOR link of someone booked on one of those jobs, or a HANDOVER link for one of them - live ones
// only (the caller loads them with lib/pushLinks.ts liveLinks). One each.
export function newSwmsRecipients(jobs: { id: string; crewIds: string[] }[], links: { id: string; kind: string; resourceId: string | null; jobId: string | null }[]): string[] {
  const crew = new Set(jobs.flatMap((j) => j.crewIds));
  const jobIds = new Set(jobs.map((j) => j.id));
  return [...new Set(links.filter((l) => (l.kind === "SUPERVISOR" && !!l.resourceId && crew.has(l.resourceId)) || (l.kind === "HANDOVER" && !!l.jobId && jobIds.has(l.jobId))).map((l) => l.id))];
}

// ---------- scrubbed errors (SD-003) ----------

// A failed save never carries what was typed into a log: only the database's error code or the error's name.
export function scrubbedError(what: string, e: unknown): Error {
  const code = (e as { code?: unknown } | null)?.code;
  const name = e instanceof Error ? e.name : typeof e;
  return new Error(`${what} failed (${typeof code === "string" && /^[A-Z0-9_]{1,12}$/.test(code) ? code : /^[A-Za-z]{1,40}$/.test(name) ? name : "error"})`);
}