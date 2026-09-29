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
  onHireDate: string | null; // YYYY-MM-DD, replaces hireStart's free text once re-entered
  offHireDate: string | null; // YYYY-MM-DD, replaces hireEnd's free text once re-entered
  // Cost fields - the API omits these entirely for a Viewer, so they come
  // through as undefined, not null, for anyone below Manager.
  rate?: string | null;
  dailyRateExGst?: number | null;
  hireRate?: number | null;
  hireRateUnit?: "HOUR" | "DAY" | "WEEK" | null;
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
  unpaidBreakMinutes?: number | null; // D1: deducted from gross shift hours before costing labour, default 30
  notes: string | null;
  archived: boolean;
  // Agreed job value ex GST (the signed quote/contract), and where it came
  // from - null contractValue means either do-and-charge/schedule-of-rates
  // (no single value exists) or not yet researched; contractValueNotes says
  // which.
  contractValue?: number | null;
  contractValueNotes?: string | null;
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

// One of these per costed allocation - so an uncosted one is never silently
// shown as $0. Null on rows from before this concept existed (the historical
// backfill isn't retrofitted). See src/lib/labourCost.ts for what each means.
export type CostStatus = "COSTED" | "RATE_MISSING" | "RATE_UNCONFIRMED" | "EXCLUDED" | "HOURS_UNKNOWN";

// Own-crew labour hours/cost, backfilled from the daily allocation PDFs (see
// prisma/schema.prisma's LabourCost model). rateUsed/cost are null when the
// person's pay rate is still TBC or excluded pending confirmation - hours are
// still recorded so the work itself isn't lost.
export interface LabourCostDTO {
  id: string;
  personName: string;
  date: string; // YYYY-MM-DD
  shift: ShiftType;
  hours: number | null;
  rateTier: string | null;
  rateUsed: number | null;
  cost: number | null;
  status: CostStatus | null;
  notes: string | null;
  // Phase 5: null for a pre-close-and-reopen-concept historical backfill
  // row; "recorded" once its date was closed (from the frozen
  // AllocationCost ledger); "estimated" while the date's still open
  // (recomputed live on every call).
  source: "recorded" | "estimated" | null;
}

// Hired labour (a named agency worker registered as a HIRE/LABOUR resource),
// costed live from a numeric hireRate the same way own crew is - an estimate
// for day-to-day visibility, never summed into totalCost. Compared against
// invoicedTotal (the agency's real bill) for review, not reconciled
// automatically either way (D3).
export interface HireLabourEstimateDTO {
  id: string;
  personName: string;
  date: string;
  shift: ShiftType;
  hours: number | null;
  rateUsed: number | null;
  cost: number | null;
  status: CostStatus;
  source: "recorded" | "estimated"; // Phase 5 - see LabourCostDTO.source
}

// A hired-in item (type = HIRE) sitting on hire that isn't earning its keep -
// on-hire days (since hireStart) minus days it actually appeared on a job.
// Not attributed to any project, since idle time doesn't belong to a site;
// shown as its own company-wide figure.
export interface IdleHireItemDTO {
  id: string;
  name: string;
  agency: string | null;
  hireStart: string | null;
  hireEnd: string | null;
  overdue: boolean; // hireEnd has passed and it's still on the register
  onHireDays: number;
  workedDays: number;
  idleDays: number;
  // The per-day rate idleCost was estimated from - hireRate (DAY, or WEEK/5)
  // when one's set (Phase 2b), else the legacy dailyRateExGst.
  rateUsed: number | null;
  idleCost: number | null; // null when no rate is on file to estimate from
}

export interface IdleHireDTO {
  totalIdleCost: number; // sum of idleCost across items where it's known
  items: IdleHireItemDTO[]; // idleDays > 0 or overdue only, worst first
}

// Day-close status for one calendar date (Phase 3/D2). No row for a date
// means it's open (the default) - see prisma/schema.prisma's DayClose.
export interface DayCloseDTO {
  date: string; // YYYY-MM-DD
  status: "OPEN" | "CLOSED";
  closedBy: string | null;
  closedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

// One person/item on a Day Review job card - a planned Assignment, an actual
// (JobActual) record, or both merged into one row. planned=false means it
// wasn't on the roster (an unplanned addition); attended/actualHours/notes
// are null until a supervisor records them. Never carries a dollar figure -
// Day Review is an operational record, not a cost view (see Project
// Tracking for money).
export interface DayReviewRowDTO {
  resourceId: string;
  name: string;
  role: string | null;
  type: ResourceType;
  planned: boolean;
  attended: boolean | null;
  actualHours: number | null;
  notes: string | null;
  costStatus: CostStatus | null; // from the same live costing Tracking uses - a data-quality signal, not a $ figure
}

export interface DayReviewJobDTO {
  id: string;
  title: string;
  client: string | null;
  siteCode: string | null;
  shift: ShiftType;
  startTime: string | null;
  endTime: string | null;
  dayBrief: string | null;
  rows: DayReviewRowDTO[];
}

export interface DayReviewDTO {
  date: string;
  dayClose: DayCloseDTO;
  jobs: DayReviewJobDTO[];
  uncostedCount: number;
  unconfirmedCount: number;
}

export interface ProjectCostDTO {
  id: string;
  name: string;
  client: string | null;
  jobNo: string | null;
  status: "ACTIVE" | "INACTIVE" | "COMPLETED";
  // The agreed job value ex GST (from the signed quote/contract) and where it
  // came from. Null contractValue means either do-and-charge/schedule-of-
  // rates (no single value exists to compare against) or not yet researched -
  // contractValueNotes says which; never treat a null as "confirmed zero."
  contractValue: number | null;
  contractValueNotes: string | null;
  totalCost: number; // byCode + invoicedTotal + labourTotal
  byCode: CostByCode;
  // Phase 5: how much of totalCost is locked in (closed days, from the
  // frozen AllocationCost ledger) vs still live (open days, recomputed on
  // every call) - recordedCost + estimatedCost is less than totalCost by
  // whatever's in the pre-cutoff historical labour backfill, which predates
  // this split and never moves either way.
  recordedCost: number;
  estimatedCost: number;
  invoicedTotal: number; // every InvoicedCost row, any category - this is what feeds totalCost
  // Just the LABOUR_HIRE slice of invoicedTotal, for the "estimated from
  // allocations vs invoiced" reconciliation below - that comparison is
  // inherently labour-only (hireLabourEstimateTotal has no plant-hire
  // equivalent), so it must not be diluted by a plant-hire invoice.
  labourHireInvoicedTotal: number;
  invoiced: InvoicedCostDTO[]; // oldest first
  labourTotal: number; // sum of labour.cost, excluding null (TBC) rows
  labour: LabourCostDTO[]; // oldest first - empty for Manager, full detail Admin-only
  // D3: an allocation-based estimate for hired labour, shown next to
  // invoicedTotal for review - never added into totalCost (that stays
  // invoicedTotal, the agency's real bill).
  hireLabourEstimateTotal: number;
  hireLabourEstimate: HireLabourEstimateDTO[]; // empty for Manager, full detail Admin-only
  uncostedCount: number; // allocations with RATE_MISSING or HOURS_UNKNOWN
  unconfirmedCount: number; // allocations with RATE_UNCONFIRMED
  jobs: JobCostDTO[]; // only jobs that actually cost something, oldest first
}