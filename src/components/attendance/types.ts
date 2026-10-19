// Shapes of /api/attendance (lib/attendanceView.ts) used by the Sign-ins page.
export type AttendanceEditRow = { field: string; before: string | null; after: string | null; reason: string; editedBy: string; editedAt: string };
export type AttendanceRow = {
  id: string;
  resourceId: string | null;
  name: string;
  company: string | null;
  signInAt: string;
  signOutAt: string | null;
  in: string | null;
  out: string | null;
  signInMethod: string;
  signOutMethod: string | null;
  status: "CONFIRMED" | "TO_CONFIRM" | "REJECTED";
  confirmedBy: string | null;
  runBy: string | null;
  hours: number | null;
  flags: string[];
  edits: AttendanceEditRow[];
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
  breakMinutes: number | null;
  allocated: { id: string; name: string }[];
  rows: AttendanceRow[];
  noShows: { id: string; name: string }[];
};
export type AttendanceData = {
  date: string;
  today: string;
  jobs: AttendanceJob[];
  points: AttendanceJob[];
  posters: { id: string; projectId: string | null; place: string | null; resourceId: string | null; createdAt: string; createdBy: string | null }[];
  handovers: { id: string; jobId: string | null; expiresAt: string; createdBy: string | null; resource: { name: string } | null }[];
};

export const FLAG_LABEL: Record<string, string> = {
  TO_CONFIRM: "Poster - to confirm",
  REJECTED: "Wasn't here",
  NOT_ALLOCATED: "Not allocated here",
  STILL_ON: "On site",
  NO_SIGN_OUT: "No sign-out",
  MOVED: "Moved site",
  SHARED_PHONE: "Phone shared",
  ODD_HOURS: "Odd hours",
  LONG_DAY: "Over 14h",
};
export const METHOD_LABEL: Record<string, string> = {
  SUPERVISOR_QR: "Supervisor QR",
  POSTER: "Poster",
  MANUAL: "Ticked by supervisor",
  OFFICE: "Office",
  MOVED: "Moved site",
  POINT: "QR",
};
