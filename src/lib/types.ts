export type ResourceType =
  | "PERSONNEL"
  | "EQUIPMENT"
  | "ATTACHMENT"
  | "VEHICLE"
  | "HIRE";
export type ShiftType = "DAY" | "NIGHT";
export type BoardColumn = "crew" | "plant" | "hire";

export interface AssignmentJobRef {
  id: string;
  title: string;
  date: string;
  shift: ShiftType;
}

export interface ResourceDTO {
  id: string;
  name: string;
  type: ResourceType;
  category: string | null;
  role: string | null;
  identifier: string | null;
  status: string;
  detail: string | null;
  serviceDue: string | null;
  loadSize: string | null;
  ownership: string;
  payClass: string | null;
  phone: string | null;
  email: string | null;
  tickets: string | null;
  notes: string | null;
  agency: string | null;
  hireStart: string | null;
  hireEnd: string | null;
  rate: string | null;
  dailyRateExGst: number | null;
  // Pay rate (personnel only) - sensitive; the API omits these entirely for
  // a non-Admin caller, so they come through as undefined, not null, for
  // anyone who isn't an Admin.
  payRateBasis?: "HOURLY" | "SALARY" | "DAY_RATE" | null;
  annualSalary?: number | null;
  ordinaryRate?: number | null;
  nightRate?: number | null;
  travelRate?: number | null;
  regionalDayRate?: number | null;
  regionalNightRate?: number | null;
  saturdayRate?: number | null;
  sundayRate?: number | null;
  payRateConfirmed?: boolean;
  payRateNotes?: string | null;
  active: boolean;
  assignments?: { id: string; job: AssignmentJobRef }[];
}

export interface AssignmentDTO {
  id: string;
  jobId: string;
  resourceId: string;
  role: string | null;
  resource: ResourceDTO;
}

export type JobStatus = "INACTIVE" | "ACTIVE" | "COMPLETED";

export interface JobDTO {
  id: string;
  projectId: string | null;
  title: string;
  client: string | null;
  siteCode: string | null;
  siteAddress: string | null;
  date: string; // ISO date
  shift: ShiftType;
  startTime: string | null;
  endTime: string | null;
  status: JobStatus;
  dayBrief: string | null;
  colorTag: string;
  notRunning: boolean;
  sortOrder: number;
  assignments: AssignmentDTO[];
  // Client-only: a placeholder row for an active/inactive project that has no
  // job created yet for the selected date - see Board.tsx. Never sent to the API.
  virtual?: boolean;
}

export interface ProjectDTO {
  id: string;
  name: string;
  client: string | null;
  jobNo: string | null;
  address: string | null;
  startDate: string | null;
  status: "ACTIVE" | "INACTIVE" | "COMPLETED";
  dayStart: string | null;
  dayEnd: string | null;
  nightStart: string | null;
  nightEnd: string | null;
  notes: string | null;
  archived: boolean;
  counts?: { crew: number; plant: number; attach: number; trucks: number; hire: number };
  costToDate?: number; // sum of daily rates (ex GST) across every elapsed day worked
}

export interface BugReportDTO {
  id: string;
  title: string;
  description: string;
  page: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "FIXED" | "WONT_FIX";
  reportedBy: string | null;
  userAgent: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceRecordDTO {
  id: string;
  resourceId: string;
  date: string; // YYYY-MM-DD
  mechanic: string | null;
  invoiceNo: string | null;
  work: string | null;
  amountExGst: number | null;
  gst: number | null;
  total: number | null;
  odometer: number | null;
  notes: string | null;
}

export interface ToolDTO {
  id: string;
  tag: string;
  name: string;
  model: string | null;
  condition: string;
  heldBy: string;
  lastSeen: string | null;
  notes: string | null;
}

// Drag payload carried in the HTML5 DataTransfer object.
// Yard cards carry resourceId; assigned chips also carry assignmentId (=> move).
export interface DragResourcePayload {
  resourceId: string;
  resourceName: string;
  column: BoardColumn;
  assignmentId?: string;
}

export interface CalendarJobDTO {
  id: string;
  projectId: string | null;
  title: string;
  siteCode: string | null;
  date: string; // YYYY-MM-DD
  shift: ShiftType;
  startTime: string | null;
  endTime: string | null;
  dayBrief: string | null;
  notRunning: boolean;
  crew: number;
  plant: number;
  hire: number;
  hasSupervisor: boolean;
  people: string[];
  plantNames: string[];
  hireNames: string[];
  // Detail for the calendar's job panel
  crewList: { name: string; role: string | null }[];
  plantList: { name: string; type: string }[]; // type: EQUIPMENT | ATTACHMENT | VEHICLE
  hireList: { name: string; agency: string | null }[];
}

export interface StartAlertDTO {
  projectId: string;
  name: string;
  jobNo: string | null;
  startDate: string; // YYYY-MM-DD
  daysAway: number;
  shifts: ShiftType[];
  crew: number;
  plant: number;
  hasSupervisor: boolean;
  issues: string[];
  level: "critical" | "warn" | "ok";
  // True when no job has been created yet for the start day - the Command Centre
  // has nothing to show for this project until one exists.
  noJobYet: boolean;
}

// A cost code split: plant (owned equipment), attach (attachments), trucks
// (owned vehicles), hire (anything hired in). Crew never appears here - a
// daily rate only ever applies to gear, never to labour.
export interface CostByCode {
  plant: number;
  attach: number;
  trucks: number;
  hire: number;
}

export interface JobCostDTO {
  id: string;
  date: string; // YYYY-MM-DD
  shift: ShiftType;
  title: string;
  cost: number;
  byCode: CostByCode;
}

// A real invoice line that doesn't fit the assignment/dailyRateExGst model -
// e.g. an agency labour-hire bill, a different $ amount every week. See
// prisma/schema.prisma's InvoicedCost model for why this exists separately.
export interface InvoicedCostDTO {
  id: string;
  vendor: string;
  category: string;
  invoiceNo: string | null;
  weekEnding: string; // YYYY-MM-DD
  shift: ShiftType | null;
  amountExGst: number;
}

export interface ProjectCostDTO {
  id: string;
  name: string;
  client: string | null;
  jobNo: string | null;
  status: "ACTIVE" | "INACTIVE" | "COMPLETED";
  totalCost: number; // byCode + invoicedTotal
  byCode: CostByCode;
  invoicedTotal: number;
  invoiced: InvoicedCostDTO[]; // oldest first
  jobs: JobCostDTO[]; // only jobs that actually cost something, oldest first
}