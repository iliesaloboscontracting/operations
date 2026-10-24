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
  { id: "F4", name: "Cost trend", meaning: "Weekly spend by type, last 12 weeks", formula: "Spend per Monday-Sunday week, split by Own crew / Labour hire / Hired plant / Our plant / Attachments / Trucks / Tip fees / Materials", units: "$ ex GST per week", source: "Project Tracking", refresh: "Live", status: "READY", notes: "This week is 'so far'." },
  // Workload
  { id: "O1", name: "Active projects", meaning: "Current workload", formula: "Projects marked active, not archived, with a job in the last 14 days or booked ahead", units: "count", source: "Projects, board", refresh: "Live", status: "READY", notes: "Trend vs 4 weeks ago once weekly snapshots exist." },
  { id: "O2", name: "Starting in 30 days", meaning: "Incoming work", formula: "Active projects whose start date is in the next 30 days, split confirmed / tentative / not said", units: "count", source: "Projects (start date + confidence)", refresh: "Live", status: "READY", notes: "Tentative starts are labelled, never counted as firm." },
  { id: "O3", name: "Starts not ready", meaning: "Starts at risk", formula: "Starts within 7 days with no Supervisor or Lead on day one (the Calendar alert rule)", units: "count", source: "Projects, board", refresh: "Live", thresholds: "Critical within 2 days, High within 7", status: "READY" },
  { id: "O4", name: "Completing in 30 days", meaning: "Work rolling off, capacity freeing up", formula: "Active projects whose expected completion is in the next 30 days", units: "count", source: "Projects", refresh: "Live", status: "READY" },
  { id: "O5", name: "Days not closed", meaning: "Days whose cost is still moving", formula: "Past dates (after the 26 Sep 2026 history cut-off) with allocations that haven't been closed in Day Review", units: "days", source: "Board, Day Review closes", refresh: "Live", thresholds: "Medium above 3, High above 10", draft: true, status: "CONFIRM" },
  { id: "O6", name: "Open site requests", meaning: "Site bottlenecks", formula: "Requests not done, declined, cancelled or can't-do, by priority; overdue = past its needed-by time", units: "count", source: "Site requests", refresh: "Live", thresholds: "Critical: any Urgent overdue", status: "READY" },
  // People
  { id: "P1", name: "Hours worked per week", meaning: "Labour effort trend", formula: "Signed-in to signed-out, less the site's unpaid break, per Monday-Sunday week, staff vs hire workers", units: "hours", source: "Site sign-ins", refresh: "Live", status: "READY", notes: "Sign-ins started 19 Oct 2026; 19-25 Oct was a trial week, so earlier weeks are incomplete." },
  { id: "P2", name: "Active crew", meaning: "Own people available", formula: "Active Personnel, excluding Office, not on leave", units: "people", source: "Labour register", refresh: "Live", status: "READY", notes: "Leave is today's status, not per date." },
  { id: "P3", name: "Booked crew, next 14 days", meaning: "Do we have enough people?", formula: "Distinct own crew on the board per day (and labour hire separately) vs active crew", units: "people per day", source: "Board allocations", refresh: "Live", status: "CONFIRM", notes: "Only as far ahead as the board is filled - 'booked', not demand." },
  { id: "P4", name: "Supervisor coverage", meaning: "Jobs without someone in charge", formula: "Running jobs in the next 14 days with crew but no Supervisor or Lead", units: "jobs", source: "Board allocations", refresh: "Live", thresholds: "Critical within 2 days", status: "READY" },
  // Plant
  { id: "PL1", name: "Owned plant use", meaning: "Are we using what we own?", formula: "Days on a job ÷ working days, last 28 days (Mon-Fri plus Saturdays worked), per machine and for the fleet", units: "%", source: "Board allocations, plant register", refresh: "Live", thresholds: "Idle below 30%", draft: true, status: "CONFIRM", notes: "Only counts days a machine is on the board. Under 10% across the fleet is shown as low confidence: it usually means plant on site isn't being booked day to day, not that it's idle." },
  { id: "PL2", name: "Plant down", meaning: "Breakdown impact", formula: "Plant marked Down", units: "count", source: "Plant register", refresh: "Live", status: "READY" },
  { id: "PL3", name: "Hire overdue off-hire", meaning: "Hire cost leakage", formula: "Hired items still out past their expected finish (the Hire page alert rule)", units: "count", source: "Hire register", refresh: "Live", thresholds: "High when any", status: "READY" },
  // Data confidence
  { id: "DQ", name: "Data confidence", meaning: "Gaps that make the numbers less certain", formula: "Active jobs with no contract value or dates, uncosted / unconfirmed lines, days not closed, invoices waiting for a person, hire with no finish date or rate", units: "count per check", source: "As listed", refresh: "Live", status: "READY" },
  // Not available yet - shown so a missing number is never read as zero
  { id: "F9", name: "Revenue, gross profit, margin", meaning: "Are we making money?", formula: "-", units: "-", source: "Accounting system (not connected)", refresh: "-", status: "BLOCKED" },
  { id: "F10", name: "Receivables, overdue payments, cash", meaning: "Who owes us, cash pressure", formula: "-", units: "-", source: "Accounting system (not connected)", refresh: "-", status: "BLOCKED" },
  { id: "F11", name: "Variations", meaning: "Approved and pending variations", formula: "-", units: "-", source: "No variation register yet", refresh: "-", status: "BLOCKED" },
  { id: "C1", name: "Pipeline and tenders", meaning: "Work coming, win rate", formula: "-", units: "-", source: "No tender register yet", refresh: "-", status: "BLOCKED" },
  { id: "S2", name: "Incidents and near misses", meaning: "Safety trend", formula: "-", units: "-", source: "No incident register yet", refresh: "-", status: "BLOCKED" },
];

export const kpi = (id: string) => KPIS.find((k) => k.id === id);
export const NOT_YET_AVAILABLE = KPIS.filter((k) => k.status === "BLOCKED").map((k) => k.name);
