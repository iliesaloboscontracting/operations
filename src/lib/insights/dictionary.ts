// Director Insights KPI dictionary (24 Oct 2026). One place that says what
// each number on /directors means, how it's worked out and where it comes
// from - the "?" on every tile and the /directors/kpis page both read this.
// No server imports - used by pages, the API and the tests.
//
// Thresholds marked draft are Ilies's "use the drafts, mark them draft"
// (24 Oct 2026); change them here and the page and alerts follow.

export const THRESHOLDS = {
  daysNotClosedWarn: 3, // MEDIUM above this many open past days (draft)
  daysNotClosedCritical: 10, // HIGH above this (draft)
  idlePlantBelow: 0.3, // owned plant used on < 30% of working days over 4 weeks = idle (draft)
  plantWindowDays: 28,
  watchAt: 0.8, // Tracking's Watch / Act - Ilies confirmed, not draft
  actAt: 1.0,
  lookaheadDays: 14, // crew demand + supervisor coverage
  startsWindowDays: 30, // starting / completing soon
  wonNoProjectDays: 7, // a won tender with no Operations project after this many days -> finding (draft)
  revenueTiedHighAt: 0.9, // F9 and F14: HIGH confidence when this share of sales is tied to a job (live Xero only)
  claimsMonths: 15, // F15: months in the "claimed by month" chart (draft)
  claimCostGapDays: 31, // F16: a job whose first cost is more than this many days before the Xero sales start has claims we can't see (draft)
  claimsRecentDays: 60, // the claims job table: active jobs plus any with a board day in this many days
} as const;

export type KpiStatus = "READY" | "CONFIRM" | "BLOCKED";
export type KpiDef = {
  id: string;
  name: string;
  meaning: string;
  formula: string;
  units: string;
  source: string;
  refresh: string;
  thresholds?: string;
  draft?: boolean; // threshold not yet confirmed by Ilies
  status: KpiStatus;
  notes?: string;
};

export const KPIS: KpiDef[] = [
  // Cost (from Project Tracking - lib/trackingData.ts, never recomputed here)
  { id: "F1", name: "Spend", meaning: "What jobs have cost in the period", formula: "Locked + estimated + invoiced, by day, summed over the period (Project Tracking's own figures)", units: "$ ex GST", source: "Operations: closed-day ledger, board allocations, supplier invoices, hire estimates", refresh: "Live; frozen once a day is closed", status: "READY", notes: "Excludes overheads, office salaries and anything not on the board or invoiced. The current month is 'so far' and compared with the same days last month." },
  { id: "F2", name: "Still to come", meaning: "Cost already booked but not spent yet", formula: "Labour hire worked since the agency's last invoice + days booked on the board after today + hired plant to its expected finish", units: "$ ex GST", source: "Project Tracking", refresh: "Live", status: "READY", notes: "Only what's booked - not a cost-to-complete." },
  { id: "F3", name: "Jobs vs contract value", meaning: "How much of each job's agreed value the forecast will use", formula: "(Spent + still to come) ÷ contract value, per active job", units: "jobs by status", source: "Project Tracking", refresh: "Live", thresholds: "Watch from 80%, Act from 100%", status: "READY", notes: "Can't assess without a contract value. Variations aren't included (no register yet). This is cost against contract value - not margin." },
  { id: "F5", name: "Labour hire share", meaning: "How much of labour cost goes to agencies", formula: "Labour hire ÷ (own crew + labour hire), for the last full month", units: "%", source: "Project Tracking categories", refresh: "Live", status: "CONFIRM", notes: "Last full month, because labour hire only counts once the agency invoices (weeks later) - this month so far would always read low. No target set yet, so no colour. Own crew on TBC rates makes this less certain." },
  { id: "F6", name: "Hired plant still out", meaning: "What hired plant still on hire is costing and committing us to", formula: "Estimated cost to date of items not returned (not yet invoiced) + cost to their expected finish", units: "$ ex GST", source: "Hire register, plant-hire invoices", refresh: "Live", status: "READY", notes: "Estimates until invoiced; an invoice replaces the estimate for the days it covers." },
  { id: "F7", name: "Uncosted allocations", meaning: "Cost we know exists but can't price", formula: "Allocations with a missing rate or missing hours", units: "count", source: "Project Tracking", refresh: "Live", thresholds: "Target 0", status: "READY", notes: "Makes spend and forecasts understated." },
  { id: "F8", name: "Unconfirmed rates", meaning: "Cost priced on draft (TBC) pay or hire rates", formula: "Allocations costed on an unconfirmed rate", units: "count", source: "Project Tracking", refresh: "Live", thresholds: "Target 0", status: "READY" },
  { id: "W1", name: "Work in hand", meaning: "How much contracted work is running", formula: "Sum of contract values of active jobs (not overhead buckets), and Project Tracking's forecast cost (spent + still to come) as a share of it", units: "$ ex GST, %", source: "Projects, Project Tracking", refresh: "Live", status: "READY", notes: "Provisional: what's been claimed to date and variations aren't connected, and jobs with no contract value are left out of the total (counted separately)." },
  { id: "F12", name: "Contract headroom (provisional)", meaning: "Room left between contract values and forecast cost", formula: "Sum over active jobs with a contract value of (contract value - forecast cost), where forecast = spent + still to come", units: "$ ex GST", source: "Project Tracking", refresh: "Live", status: "CONFIRM", notes: "Not margin: the forecast is only what's booked (not a cost-to-complete), variations and revenue aren't in, and overheads aren't charged to jobs. Jobs over their contract value pull it down." },
  { id: "F4", name: "Cost trend", meaning: "Weekly spend by type, last 12 weeks", formula: "Spend per Monday-Sunday week, split by Own crew / Labour hire / Hired plant / Our plant / Attachments / Trucks / Tip fees / Materials", units: "$ ex GST per week", source: "Project Tracking", refresh: "Live", status: "READY", notes: "This week is 'so far'." },
  // Workload
  { id: "O1", name: "Active projects", meaning: "Current workload", formula: "Projects marked active, not archived, with a job in the last 14 days or booked ahead", units: "count", source: "Projects, board", refresh: "Live", status: "READY", notes: "Trend vs 4 weeks ago once weekly snapshots exist." },
  { id: "O2", name: "Starting in 30 days", meaning: "Incoming work", formula: "Active projects whose start date is in the next 30 days, split confirmed / tentative / not said", units: "count", source: "Projects (start date + confidence)", refresh: "Live", status: "READY", notes: "Tentative starts are labelled, never counted as firm." },
  { id: "O3", name: "Starts not ready", meaning: "Starts at risk", formula: "Starts within 7 days with no Supervisor or Lead on day one (the Calendar alert rule)", units: "count", source: "Projects, board", refresh: "Live", thresholds: "Critical within 2 days, High within 7", status: "READY" },
  { id: "O4", name: "Completing in 30 days", meaning: "Work rolling off, capacity freeing up", formula: "Active projects whose expected completion is in the next 30 days", units: "count", source: "Projects", refresh: "Live", status: "READY" },
  { id: "O5", name: "Days not closed", meaning: "Days whose cost is still moving", formula: "Past dates (after the 26 Sep 2026 history cut-off) with allocations that haven't been closed in Day Review", units: "days", source: "Board, Day Review closes", refresh: "Live", thresholds: "Medium above 3, High above 10", draft: true, status: "CONFIRM" },
  { id: "O6", name: "Open site requests", meaning: "Site bottlenecks", formula: "Requests not done, declined, cancelled or can't-do, by priority; overdue = past its needed-by time", units: "count", source: "Site requests", refresh: "Live", thresholds: "Critical: any Urgent overdue", status: "READY" },
  { id: "O7", name: "Labour hours vs budget", meaning: "Is a job's labour running ahead of its progress?", formula: "Per activity code: labour hours from the supervisors' daily logs ÷ the approved budget's labour hours, minus the latest weekly % complete (packages sharing a code added together)", units: "points over % complete", source: "Daily site logs (pilot), Estimating's approved budget", refresh: "Live", thresholds: "Watch above 15 points, Act above 30 (Act goes on the Directors box); needs 2 logs and a weekly %", draft: true, status: "CONFIRM", notes: "Hours only, never dollars. Nothing shows until a job has an approved budget and pilot logs." },
  // People
  { id: "P1", name: "Hours worked per week", meaning: "Labour effort trend", formula: "Signed-in to signed-out, less the site's unpaid break, per Monday-Sunday week, staff vs hire workers", units: "hours", source: "Site sign-ins", refresh: "Live", status: "READY", notes: "Sign-ins started 19 Oct 2026; 19-25 Oct was a trial week, so earlier weeks are incomplete." },
  { id: "P2", name: "Active crew", meaning: "Own people available", formula: "Active Personnel, excluding Office, not on leave", units: "people", source: "Labour register", refresh: "Live", status: "READY", notes: "Leave is today's status, not per date." },
  { id: "P3", name: "Booked crew, next 14 days", meaning: "Do we have enough people?", formula: "Distinct own crew on the board per day (and labour hire separately) vs active crew", units: "people per day", source: "Board allocations", refresh: "Live", status: "CONFIRM", notes: "Only as far ahead as the board is filled - 'booked', not demand." },
  { id: "P4", name: "Supervisor coverage", meaning: "Jobs without someone in charge", formula: "Running jobs in the next 14 days with crew but no Supervisor or Lead", units: "jobs", source: "Board allocations", refresh: "Live", thresholds: "Critical within 2 days", status: "READY" },
  // Plant
  { id: "PL1", name: "Owned plant use", meaning: "Are we using what we own?", formula: "Days on a job ÷ working days, last 28 days (Mon-Fri plus Saturdays worked), per machine and for the fleet", units: "%", source: "Board allocations, plant register", refresh: "Live", thresholds: "Idle below 30%", draft: true, status: "CONFIRM", notes: "Only counts days a machine is on the board. Under 10% across the fleet is shown as low confidence: it usually means plant on site isn't being booked day to day, not that it's idle." },
  { id: "PL2", name: "Plant down", meaning: "Breakdown impact", formula: "Plant marked Down", units: "count", source: "Plant register", refresh: "Live", status: "READY" },
  { id: "PL3", name: "Hire overdue off-hire", meaning: "Hire cost leakage", formula: "Hired items still out past their expected finish (the Hire page alert rule)", units: "count", source: "Hire register", refresh: "Live", thresholds: "High when any", status: "READY" },
  // Pipeline (Estimating's tender register, G5)
  { id: "C1", name: "Pipeline and tenders", meaning: "Work coming in, and how much of it we win", formula: "Estimating's pipeline.v1 summary: tenders by status; submitted and waiting on an outcome (value counted once per tender - the same price goes to every builder); won and lost in the last 12 months; win rate = won ÷ (won + lost) decided in the period", units: "count, $ ex GST, %", source: "Lobos Estimating tender register", refresh: "Live, each time the page loads", status: "READY", notes: "Imported tenders that never got an outcome are not counted as open. Pipeline value is never revenue or work in hand. Low confidence while outcomes are missing - the win rate can't be trusted until they're filled in. 'Estimating not reachable' means no figures, never zero." },
  { id: "C2", name: "Won tenders not in Operations", meaning: "Won work that hasn't been set up as a job", formula: "Won tenders (not from the one-off register import) whose job or quote number matches no Operations project's job or quote number", units: "tenders", source: "Estimating won-tenders.v1, Operations projects", refresh: "Live; the finding is checked every 30 minutes", thresholds: "A finding after 7 days with no project", draft: true, status: "READY" },
  // Data confidence
  { id: "DQ", name: "Data confidence", meaning: "Gaps that make the numbers less certain", formula: "Active jobs with no contract value or dates, uncosted / unconfirmed lines, days not closed, invoices waiting for a person, hire with no finish date or rate; from Xero: sales invoices not tied to a job yet, draft sales invoices (never counted), and where the Xero sales start", units: "count per check", source: "As listed", refresh: "Live", status: "READY" },
  // Not available yet - shown so a missing number is never read as zero
  { id: "F9", name: "Revenue and P&L", meaning: "What we've invoiced, and the company P&L as Xero reports it", formula: "Sales invoices less credit notes, ex GST, from 1 July, voided and draft left out; share tied to a job (tracking category, job number in the reference, or a person's choice). P&L account lines and totals exactly as in the uploaded Xero report", units: "$ ex GST", source: "Xero, read-only: the live connection once Iliesa connects it, otherwise exports uploaded by accounts (Directors -> Accounts data)", refresh: "Live: nightly and on \"Refresh now\" (Stale after 36 hours without a read). Manual: each upload, as at the export date", status: "CONFIRM", notes: "Manual uploads are low confidence (only as current as the last upload). Live: high when 90%+ of revenue is tied to a job, else medium. Not margin." },
  { id: "F10", name: "Owed to us and overdue", meaning: "Who owes us, cash pressure", formula: "Xero's amount due on sales invoices (inc GST); overdue = due date before today", units: "$ inc GST", source: "Xero, read-only (live connection or accounts' sales-invoice export)", refresh: "Live nightly / on refresh; manual each upload", status: "CONFIRM", notes: "From a manual export, payments made after the export date aren't in until the next upload." },
  { id: "F14", name: "Claimed (Xero)", meaning: "What each job has been invoiced so far", formula: "Sales invoice lines less credit-note lines, ex GST, tied to the job (a person's decision, the Xero tracking category, or a job number in the invoice), from the start of the Xero sales mirror to today. Voided, deleted, draft and awaiting-approval invoices are left out", units: "$ ex GST", source: "Xero, read-only (the nightly mirror - the same lines and job matches the revenue tile uses)", refresh: "Live: nightly and on \"Refresh now\"", status: "CONFIRM", notes: "Only from the start of the Xero sales mirror (shown as \"Xero sales from <date>\"; the live read starts at a fixed 1 July 2025 - XERO_CONFIG.mirrorFrom) - older claims aren't in. Retention as invoiced: whatever the invoice says, nothing held back is added. Sales not tied to a job yet aren't in any job, so a job can read low until accounts tie them. All figures ex GST. Not margin, not profit." },
  { id: "F15", name: "Claimed by month", meaning: "Company claims month by month", formula: "Sales lines less credit-note lines, ex GST, by invoice month (the invoice date, not the claim period), split into tied to a job / not tied yet / not a job (deposits, recharges - a person's decision). Last 15 months, this month so far", units: "$ ex GST per month", source: "Xero, read-only", refresh: "Live", thresholds: "15 months shown", draft: true, status: "CONFIRM", notes: "\"Not a job\" is its own band and never counted in any job. Months before the Xero sales start show nothing - not zero claims." },
  { id: "F16", name: "Claimed less cost to date", meaning: "What a job has been invoiced against what it has cost so far", formula: "F14 less Project Tracking's total cost to date for the job", units: "$ ex GST", source: "Xero (claims) and Project Tracking (cost)", refresh: "Live", status: "CONFIRM", notes: "No colour and no threshold - a timing difference, not a result: claims run behind or ahead of cost. Low confidence when the job's first cost is more than 31 days (draft) before the Xero sales start, because earlier claims aren't in. Not margin, not profit." },
  { id: "F17", name: "Left to claim", meaning: "How much of the contract value hasn't been invoiced yet", formula: "Operations contract value less F14", units: "$ ex GST", source: "Projects (contract value), Xero (claims)", refresh: "Live", status: "CONFIRM", notes: "Against the Operations contract value only - variations aren't in Operations. Claimed above the contract value says so in words (\"Claimed more than the contract value\"), never a negative amount. No contract value: can't say." },
  { id: "F13", name: "Margin per job", meaning: "Are we making money on each job?", formula: "-", units: "-", source: "Needs revenue per job (Xero) against Tracking cost, and the accountant's revenue basis", refresh: "-", status: "BLOCKED" },
  { id: "F11", name: "Variations", meaning: "Approved and pending variations", formula: "-", units: "-", source: "No variation register yet", refresh: "-", status: "BLOCKED" },
  { id: "S2", name: "Incidents and near misses", meaning: "Safety trend", formula: "-", units: "-", source: "No incident register yet", refresh: "-", status: "BLOCKED" },
];

export const kpi = (id: string) => KPIS.find((k) => k.id === id);
export const NOT_YET_AVAILABLE = KPIS.filter((k) => k.status === "BLOCKED").map((k) => k.name);
