// Shapes of /api/attendance (lib/attendanceView.ts) used by the Sign-ins page.
import type { TravelLine } from "@/lib/travel/store";
import type { TipRunLine } from "@/lib/tipRun/store";
import type { SigninFlagSummary } from "@/lib/signinFlags";
import type { SupervisorJobDay, SupervisorLine } from "@/lib/payroll/store";
export type AttendanceEditRow = { field: string; before: string | null; after: string | null; reason: string; editedBy: string; editedAt: string };
export type AttendanceRow = {
  id: string;
  resourceId: string | null;
  name: string;
  company: string | null;
  slot: string | null; // labour hire: the board tile they fill on this job
  signInAt: string;
  signOutAt: string | null;
  in: string | null;
  out: string | null;
  signInMethod: string;
  signOutMethod: string | null;
  // 11 Nov 2026 (lib/signinHow.ts): how they signed in / out in words, and the phone's location status only - never
  // the position itself (accounts / Admin only).
  how?: string;
  howOut?: string | null;
  shiftAnswer?: string | null; // SAME / NEW - asked just off a night shift (19 Nov 2026)
  gpsStatus?: string | null;
  location?: string;
  status: "CONFIRMED" | "TO_CONFIRM" | "REJECTED";
  confirmedBy: string | null;
  runBy: string | null;
  hours: number | null;
  flags: string[];
  notes?: Record<string, string>; // the words for a flag (10 Nov 2026), e.g. LATE_IN: "Signed in 3:05pm – job starts 7am"
  edits: AttendanceEditRow[];
  breakTaken?: number; // the day's one unpaid break, if it came off this line (2 Nov 2026)
  staffLike?: { id: string; name: string; exact: boolean }[] | null; // fix 4: a hire sign-in that looks like these staff
};
// A job on the board, or a fixed sign-in point (office / yard / truck).
export type AttendanceJob = {
  id: string;
  kind: "JOB" | "POINT";
  place: "OFFICE" | "YARD" | "VEHICLE" | null;
  vehicleId: string | null;
  note: string | null; // truck: the job it's on that day
  label: string;
  projectId: string | null;
  shift: string;
  times: string | null;
  startTime: string | null; // board times as typed - the "sign out selected" default
  endTime: string | null;
  breakMinutes: number | null;
  allocated: { id: string; name: string }[];
  rows: AttendanceRow[];
  // staff: a Lobos (Personnel) no-show; nowhere: no sign-in anywhere that day (10 Nov 2026). Labour hire tiles: neither.
  noShows: { id: string; name: string; staff?: boolean; nowhere?: boolean }[];
};
export type AttendanceData = {
  date: string;
  today: string;
  jobs: AttendanceJob[];
  points: AttendanceJob[];
  posters: { id: string; projectId: string | null; place: string | null; resourceId: string | null; createdAt: string; createdBy: string | null }[];
  handovers: { id: string; jobId: string | null; expiresAt: string; createdBy: string | null; resource: { name: string } | null }[];
  travel?: TravelLine[]; // regional travel legs (2 Nov 2026)
  tipRuns?: TipRunLine[]; // regional tip runs (19 Nov 2026) - worked hours on the shift's day
  summary?: SigninFlagSummary; // the strip at the top (10 Nov 2026)
  // Today's page only (fixes 2c / 5a): yesterday's open sign-ins, crew not signed in an hour after the start.
  gaps?: { noSignOutYesterday: { id: string; name: string; company: string | null; site: string }[]; notSignedIn: { jobId: string; site: string; names: string[] }[] } | null;
  // The supervisors' "Approve hours" (18 Nov 2026) - Managers and Admins only: per job and day ("<jobId>|<date>") and
  // per sign-in line (lib/payroll/store.ts supervisorApprovals).
  supervisor?: { byLine: Record<string, SupervisorLine>; byJobDay: Record<string, SupervisorJobDay> };
};

export const FLAG_LABEL: Record<string, string> = {
  TO_CONFIRM: "Poster - to confirm",
  REJECTED: "Wasn't here",
  NOT_ALLOCATED: "Not allocated here",
  NO_HIRE_TILE: "No labour hire tile here",
  STILL_ON: "On site",
  NO_SIGN_OUT: "No sign-out",
  MOVED: "Moved site",
  SHARED_PHONE: "Phone shared",
  ODD_HOURS: "Odd hours",
  LONG_DAY: "Over 14h",
  OVERLAP: "Overlap - counted once",
  LOOKS_LIKE_STAFF: "Looks like Lobos staff",
  LATE_IN: "Late sign-in",
  LONG_SHIFT: "Long day",
  BULK_OUT: "Signed out together",
  NO_LOCATION: "No location shared",
  FAR_FROM_SITE: "Far from site",
  OVER_DAY_LIMIT: "Over days-a-week limit", // 12 Nov 2026 - the words: "Over 3-day limit (4th day this week)"
  PRESTART_NOT_DONE: "Pre-start not done", // 23 Nov 2026 - a truck QR sign-in with the truck's pre-start not sent (red)
};
export const METHOD_LABEL: Record<string, string> = {
  SUPERVISOR_QR: "Supervisor QR",
  POSTER: "Poster",
  MANUAL: "Ticked by supervisor",
  OFFICE: "Office",
  MOVED: "Moved site",
  POINT: "QR",
};
