// How someone signed in, and whether their phone shared its location (Ilies, 11 Nov 2026: "an indicator that shows
// me how they signed in and whether or not they allowed the location permission"). Words only - the Sign-ins page
// (Manager / Admin / the coordinator) shows them on every line. The position itself stays accounts / Admin only;
// only the status (shared / refused / unavailable / not asked) is ever shown here. Plain code, no server imports.

export type HowContext = {
  /** OFFICE | YARD | VEHICLE for a sign-in point's line; null on a site job. */
  place?: string | null;
  /** The supervisor-side action came from a one-day hand-over link (not the supervisor's own). */
  handover?: boolean;
};

const POINT_LABEL: Record<string, string> = { VEHICLE: "Truck QR", OFFICE: "Office QR", YARD: "Yard QR" };

/** How a line was signed in: "Supervisor's QR", "Site poster", "Truck QR", "Office QR", "Supervisor tick", ... */
export function signInHow(method: string, ctx: HowContext = {}): string {
  switch (method) {
    case "SUPERVISOR_QR": return ctx.handover ? "Hand-over QR" : "Supervisor's QR";
    case "POSTER": return "Site poster";
    case "POINT": return POINT_LABEL[ctx.place ?? ""] ?? "Sign-in QR";
    case "MANUAL": return ctx.handover ? "Hand-over tick" : "Supervisor tick";
    case "OFFICE": return "Office - missed sign-in";
    default: return method;
  }
}

const OUT_LABEL: Record<string, string> = {
  SUPERVISOR_QR: "supervisor's QR",
  POSTER: "site poster",
  MANUAL: "supervisor",
  OFFICE: "office",
  MOVED: "moved site",
};

/** How it was signed out, only when that differs from how it was signed in: "out: supervisor". */
export function signOutHow(inMethod: string, outMethod: string | null | undefined, ctx: HowContext = {}): string | null {
  if (!outMethod || outMethod === inMethod) return null;
  if (outMethod === "POINT") return `out: ${signInHow("POINT", ctx)}`;
  if (outMethod === "MANUAL" && ctx.handover) return "out: hand-over";
  return `out: ${OUT_LABEL[outMethod] ?? outMethod.toLowerCase()}`;
}

export type LocationKind = "SHARED" | "REFUSED" | "UNAVAILABLE" | "TIMED_OUT" | "NOT_ASKED";
export const LOCATION_LABEL: Record<LocationKind, string> = {
  SHARED: "Location shared",
  REFUSED: "Location refused",
  UNAVAILABLE: "Location unavailable",
  TIMED_OUT: "Location timed out",
  NOT_ASKED: "Location not asked",
};
/** SiteAttendance.gpsStatus -> what the line shows. null = never asked (office entries, ticks, older sign-ins).
 *  PS-057: a phone slow to get a fix (TIMEOUT) reads differently from one that refused. */
export function locationKind(gpsStatus: string | null | undefined): LocationKind {
  if (gpsStatus === "OK") return "SHARED";
  if (gpsStatus === "DENIED") return "REFUSED";
  if (gpsStatus === "TIMEOUT") return "TIMED_OUT";
  if (gpsStatus === "UNAVAILABLE") return "UNAVAILABLE";
  return "NOT_ASKED";
}
export const locationLabel = (gpsStatus: string | null | undefined) => LOCATION_LABEL[locationKind(gpsStatus)];
