// Controlled changes (LCI phase 4, A3) - the approved list. One entry per kind
// of change: whether it's on, who approves it, how long a proposal waits and
// who may see it. A new kind is a code change with Ilies's OK (as the A2
// reminder list). Design: docs/lci/PHASE4-5-DESIGN.md §1. No server imports.
//
// Kill switches: `enabled: false` here, CONTROLLED_CHANGES=off in .env (all),
// or CONTROLLED_CHANGES_OFF=<kind>,<kind> (some). Off = nothing is approved
// or proposed by the system; proposals can still be read.
//
// Admin kinds (28 Oct 2026, the lead's task, Ilies "option 2"; design
// docs/lci/ADMIN-CHANGE-KINDS-DESIGN.md): tip rates, removing an invoice,
// resource rates / engagement, worker tickets and compliance documents.
// Operations AI or an Admin proposes; the owner or another Admin approves.

export type ChangeKind =
  | "HIRE_OFF_HIRE_DATE" | "PROJECT_CONTRACT_VALUE" | "PROJECT_JOB_NO" | "PROJECT_QUOTE_NO"
  | "TIP_RATE_ADD" | "TIP_RATE_RETIRE" | "INVOICED_COST_REMOVE" | "RESOURCE_RATE" | "RESOURCE_ENGAGEMENT" | "WORKER_TICKET" | "COMPLIANCE_DOC";

export type KindRule = {
  enabled: boolean;
  label: string;
  recordType: "Resource" | "Project" | "TipRate" | "InvoicedCost" | "WorkerTicket" | "ComplianceDocument";
  field: string; // the one field (or group of fields, e.g. payRate) a proposal changes - part of its one-open key
  // Approvers: logins with one of these roles; the owner too only when ownerMayApprove.
  // aiOwnerMayApprove (admin kinds only): the owner may approve a proposal from Operations AI even though
  // SAME_PERSON pairs the two logins (never his own proposal; never another kind).
  approvers: { roles: string[]; ownerMayApprove: boolean; aiOwnerMayApprove?: boolean };
  expiryDays: number;
  // ADMIN: rates, amounts and HR records - seen by Admins (and Operations AI, its own proposals) only.
  audience: "OPERATIONAL" | "COMMERCIAL" | "ADMIN";
  undoable: boolean; // "Propose undo" puts the old value back as a new proposal
  alsoMoves: string; // shown on the card, so the approver knows what else follows
};

const ADMIN_APPROVERS = { roles: ["ADMIN"], ownerMayApprove: true, aiOwnerMayApprove: true };

export const A3_RULES: Record<ChangeKind, KindRule> = {
  HIRE_OFF_HIRE_DATE: {
    enabled: true, label: "Off-hire date", recordType: "Resource", field: "offHireDate",
    approvers: { roles: ["ADMIN"], ownerMayApprove: true }, expiryDays: 3, audience: "OPERATIONAL", undoable: true,
    alsoMoves: "The hire estimate and Tracking's still-to-come for the job recalculate; the site hire check stops asking if it's more than 3 days out.",
  },
  // Ilies (25 Oct 2026): approved on screen, by Nick and Yoel (their DIRECTOR logins) only -
  // "nick and yoel do the tenders and approve them the budgets". The owner may propose, never approve.
  PROJECT_CONTRACT_VALUE: {
    enabled: true, label: "Contract value", recordType: "Project", field: "contractValue",
    approvers: { roles: ["DIRECTOR"], ownerMayApprove: false }, expiryDays: 14, audience: "COMMERCIAL", undoable: true,
    alsoMoves: "Tracking's Watch / Act status for the job recalculates; the cost-vs-contract and no-contract-value findings follow on their next run.",
  },
  PROJECT_JOB_NO: {
    enabled: true, label: "Job number", recordType: "Project", field: "jobNo",
    approvers: { roles: ["ADMIN"], ownerMayApprove: true }, expiryDays: 14, audience: "OPERATIONAL", undoable: true,
    alsoMoves: "Budget, won-tender, invoice and Xero matching use the job number. (It's also the SharePoint project folder number.)",
  },
  PROJECT_QUOTE_NO: {
    enabled: true, label: "Quote number", recordType: "Project", field: "quoteNo",
    approvers: { roles: ["ADMIN"], ownerMayApprove: true }, expiryDays: 14, audience: "OPERATIONAL", undoable: true,
    alsoMoves: "Budget and won-tender matching use the quote number.",
  },
  // ---- admin kinds (28 Oct 2026) ----
  TIP_RATE_ADD: {
    enabled: true, label: "Tip rate (new)", recordType: "TipRate", field: "rate",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: false,
    alsoMoves: "Tip dockets from the start date with no price on them are costed at this rate on Tracking (estimates, until the tip invoice replaces them). The older rate stays as history.",
  },
  TIP_RATE_RETIRE: {
    enabled: true, label: "Tip rate (retire)", recordType: "TipRate", field: "retired",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: false,
    alsoMoves: "The rate stops counting (kept as history, never deleted). Dockets it priced fall back to an earlier rate, or show as unpriced.",
  },
  INVOICED_COST_REMOVE: {
    enabled: true, label: "Remove supplier invoice", recordType: "InvoicedCost", field: "removed",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: false,
    alsoMoves: "The invoice comes off the job's cost on Tracking. A hire invoice's days go back to the hire estimate; a tip invoice's dockets count as estimates again. To put it back, enter the invoice again.",
  },
  RESOURCE_RATE: {
    enabled: true, label: "Pay / day rate", recordType: "Resource", field: "payRate",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: true,
    alsoMoves: "Labour or plant costs on open (not closed) days recalculate on Tracking; closed days keep their frozen costs.",
  },
  RESOURCE_ENGAGEMENT: {
    enabled: true, label: "Employee / ABN", recordType: "Resource", field: "engagement",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: true,
    alsoMoves: "Decides whether the person is in the pay-run file (employees) or has their invoices checked against approved hours (ABN).",
  },
  WORKER_TICKET: {
    enabled: true, label: "Worker ticket", recordType: "WorkerTicket", field: "ticket",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: false,
    alsoMoves: "The ticket's expiry reminder on Accounts follows (one reminder per ticket), and the board's expired-ticket icon updates.",
  },
  COMPLIANCE_DOC: {
    enabled: true, label: "Compliance document", recordType: "ComplianceDocument", field: "document",
    approvers: ADMIN_APPROVERS, expiryDays: 7, audience: "ADMIN", undoable: false,
    alsoMoves: "The document's expiry / due reminder on Accounts follows (one reminder per document).",
  },
};

// SEC-011: shown to an Admin on a pay / engagement / ticket / document change card.
export const PROPOSER_HINT = "The proposer can't see current values - don't quote them in a reject reason.";

export const isAdminKind = (k: ChangeKind) => A3_RULES[k].audience === "ADMIN";

export const CHANGE_KINDS = Object.keys(A3_RULES) as ChangeKind[];

// Logins that never approve anything, whatever their role: the Building Agent
// (the lead's MANAGER login) - its proposals always go to a person.
export const NEVER_APPROVE = ["iliesa+agent@loboscontracting.com.au"];

// Who may publish a lesson (phase 5a, not built yet): the owner only (Ilies,
// 25 Oct 2026: "thats me"). No separate-reviewer rule - he publishes and
// resolves most findings himself. Directors still read published lessons.
export const LESSON_PUBLISHERS: { owner: boolean; roles: string[] } = { owner: true, roles: [] };
