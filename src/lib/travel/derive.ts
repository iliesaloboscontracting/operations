// Crew travel worked out from their driver (Ilies, 24 Nov 2026: "yes build travel as described") - the plain rules, no
// database (./store.ts loads). Only link-holders (a SUPERVISOR or DRIVER link) record travel; crew riding along record
// nothing. Their travel is read from the driver they travelled with every time it's shown, so nothing is stored for
// them and it also covers past days not yet approved; the approved week's snapshot freezes it.
//
// Who counts as crew: a Labour-register person with no such link, signed in on a job of a REGIONAL project that day
// (a sign-in that isn't rejected or removed). For each job they get:
//   OUT  - matched on their site sign-in: a link-holder signed in on the same job within 30 min of it. That person's
//          drive out is either their truck sign-in (truck QR) that ended at their site sign-in (within a few minutes) -
//          truck sign-in to site sign-in - or their own "Start travel" leg to that job.
//   HOME - matched on their site sign-out (a real one - not ended by signing in somewhere else): a link-holder whose
//          sign-out on the same job is within 30 min of it. That person's drive home is either the truck sign-in that
//          starts then (within a few minutes), up to its sign-out, or their own "Travelling home" leg from that job.
// The nearest in time wins, drivers first: a truck or an own car/ute leg; a passenger's leg only when no driver matched
// (it's the same trip). Ties go to the truck. No match = NO_DRIVER (amber, pays nothing, never blocks the week).
// A recorded leg for that person, job and way (the office's own, or an older one from before) is used instead.
// Paid = max(0, hours - 1) each way (paidTravelHours as a passenger). The driver's drive never ended or over 8 h = no
// hours, flagged like any leg; a drive over the crew member's own other sign-ins = SIGNIN_OVERLAP (TP-001).
import { legHours, modeOf, overlapping, pointFixFor, type Direction, type OwnSignIn, type PointFix, type TravelFlag, type TravelMode } from "./rules";

const MIN = 60_000;
export const CREW_MATCH_MINUTES = 30; // a link-holder's sign-in / sign-out this close to the crew member's
export const DRIVE_JOIN_MINUTES = 10; // a truck sign-in ending at (out) / starting at (home) the site sign-in, give or take

export type Att = {
  id: string; resourceId: string; jobId: string | null; date: string; place: string | null; placeLabel: string | null;
  signInAt: Date; signOutAt: Date | null; signOutMethod: string | null;
};
export type LegLite = { id: string; resourceId: string; jobId: string; direction: string; startAt: Date; endAt: Date | null; mode: string | null };
export type Drive = { kind: "TRUCK" | "LEG"; driverId: string; startAt: Date; endAt: Date | null; mode: TravelMode | null; truck: string | null; gapMs: number };
export type CrewLeg = { resourceId: string; jobId: string; date: string; direction: Direction; anchor: Att; anchorAt: Date; drive: Drive | null };

const gap = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime());
// Drivers first (a truck, or a leg driving their own car/ute), then the nearest in time, then the truck.
const isDriving = (d: Drive) => d.kind === "TRUCK" || d.mode === "DRIVER_OWN_VEHICLE";
function best(drives: Drive[]): Drive | null {
  const pool = drives.some(isDriving) ? drives.filter(isDriving) : drives;
  return [...pool].sort((a, b) => a.gapMs - b.gapMs || (a.kind === "TRUCK" ? 0 : 1) - (b.kind === "TRUCK" ? 0 : 1) || a.driverId.localeCompare(b.driverId))[0] ?? null;
}

// The drive a crew member travelled on, or null. holderAtts: the link-holders' sign-ins (site and truck); holderLegs:
// their travel legs.
export function findDrive(direction: Direction, jobId: string, anchorAt: Date, holderAtts: Att[], holderLegs: LegLite[]): Drive | null {
  const W = CREW_MATCH_MINUTES * MIN, J = DRIVE_JOIN_MINUTES * MIN;
  const drives: Drive[] = [];
  const trucks = holderAtts.filter((a) => a.place === "VEHICLE");
  for (const c of holderAtts) {
    if (c.jobId !== jobId) continue;
    const at = direction === "OUT" ? c.signInAt : c.signOutAt;
    if (!at || gap(at, anchorAt) > W) continue;
    const gapMs = gap(at, anchorAt);
    const truck = trucks
      .filter((v) => v.resourceId === c.resourceId && (direction === "OUT" ? v.signOutAt && gap(v.signOutAt, at) <= J : gap(v.signInAt, at) <= J))
      .sort((a, b) => gap(direction === "OUT" ? a.signOutAt! : a.signInAt, at) - gap(direction === "OUT" ? b.signOutAt! : b.signInAt, at))[0];
    if (truck) {
      drives.push(direction === "OUT"
        ? { kind: "TRUCK", driverId: c.resourceId, startAt: truck.signInAt, endAt: at, mode: null, truck: truck.placeLabel, gapMs }
        : { kind: "TRUCK", driverId: c.resourceId, startAt: truck.signInAt, endAt: truck.signOutAt, mode: null, truck: truck.placeLabel, gapMs });
      continue;
    }
    const leg = holderLegs.find((l) => l.resourceId === c.resourceId && l.jobId === jobId && l.direction === direction);
    if (leg) drives.push({ kind: "LEG", driverId: c.resourceId, startAt: leg.startAt, endAt: leg.endAt, mode: modeOf(leg.mode), truck: null, gapMs });
  }
  return best(drives);
}

// Every crew member's legs for the jobs they signed in on. crewAtts: crew sign-ins on regional jobs only.
export function deriveCrewLegs(crewAtts: Att[], holderAtts: Att[], holderLegs: LegLite[]): CrewLeg[] {
  const groups = new Map<string, Att[]>();
  for (const a of crewAtts) {
    if (!a.jobId) continue;
    const k = `${a.resourceId}|${a.jobId}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out: CrewLeg[] = [];
  for (const atts of groups.values()) {
    const first = [...atts].sort((a, b) => a.signInAt.getTime() - b.signInAt.getTime())[0];
    const jobId = first.jobId!;
    out.push({ resourceId: first.resourceId, jobId, date: first.date, direction: "OUT", anchor: first, anchorAt: first.signInAt, drive: findDrive("OUT", jobId, first.signInAt, holderAtts, holderLegs) });
    // A real sign-out (not ended by signing in somewhere else - that's not going home).
    const last = atts.filter((a) => a.signOutAt && a.signOutMethod !== "MOVED").sort((a, b) => b.signOutAt!.getTime() - a.signOutAt!.getTime())[0];
    if (last) out.push({ resourceId: last.resourceId, jobId, date: last.date, direction: "HOME", anchor: last, anchorAt: last.signOutAt!, drive: findDrive("HOME", jobId, last.signOutAt!, holderAtts, holderLegs) });
  }
  return out;
}

// A crew leg as it counts: no driver = NO_DRIVER; the driver's drive never ended / over 8 h = no hours, flagged; over
// one of the crew member's own sign-ins (other than the one it's matched on) = SIGNIN_OVERLAP, with the one-tap office
// fix when that's a Yard / Office sign-in left open into the drive out (option A).
export function crewLegVerdict(
  c: CrewLeg, own: OwnSignIn[], now = new Date(), ctx: { site: string; driver: string | null } = { site: "the job", driver: null },
): { hours: number | null; flag: TravelFlag | null; pointFix: PointFix | null } {
  if (!c.drive) return { hours: null, flag: "NO_DRIVER", pointFix: null };
  const v = legHours(c.drive.startAt, c.drive.endAt, now);
  if (v.hours == null) return { ...v, pointFix: null };
  const over = overlapping(c.drive.startAt, c.drive.endAt, own, now, [c.anchor.id]);
  if (!over.length) return { ...v, pointFix: null };
  return { hours: null, flag: "SIGNIN_OVERLAP", pointFix: pointFixFor(c.direction, over, c.drive.startAt, { ...ctx, truck: c.drive.kind === "TRUCK" }) };
}

// "with Turori Smith's truck (Tipper - CN03RK)" / "with Turori Smith (own car/ute)" / "with Turori Smith".
export function viaText(d: Drive, driverName: string): string {
  if (d.kind === "TRUCK") return `with ${driverName}'s truck${d.truck ? ` (${d.truck})` : ""}`;
  return d.mode === "DRIVER_OWN_VEHICLE" ? `with ${driverName} (own car/ute)` : `with ${driverName}`;
}
