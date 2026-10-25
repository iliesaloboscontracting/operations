// Controlled changes (LCI phase 4, A3) - the approved list. One entry per kind
// of change: whether it's on, who approves it, how long a proposal waits and
// who may see it. A new kind is a code change with Ilies's OK (as the A2
// reminder list). Design: docs/lci/PHASE4-5-DESIGN.md §1. No server imports.
//
// Kill switches: `enabled: false` here, CONTROLLED_CHANGES=off in .env (all),
// or CONTROLLED_CHANGES_OFF=<kind>,<kind> (some). Off = nothing is approved
// or proposed by the system; proposals can still be read.

export type ChangeKind = "HIRE_OFF_HIRE_DATE" | "PROJECT_CONTRACT_VALUE" | "PROJECT_JOB_NO" | "PROJECT_QUOTE_NO";

export type KindRule = {
  enabled: boolean;
  label: string;
  recordType: "Resource" | "Project";
  field: "offHireDate" | "contractValue" | "jobNo" | "quoteNo";
  // Approvers: logins with one of these roles; the owner too only when ownerMayApprove.
  approvers: { roles: string[]; ownerMayApprove: boolean };
  expiryDays: number;
  audience: "OPERATIONAL" | "COMMERCIAL";
  alsoMoves: string; // shown on the card, so the approver knows what else follows
};

export const A3_RULES: Record<ChangeKind, KindRule> = {
  HIRE_OFF_HIRE_DATE: {
    enabled: true, label: "Off-hire date", recordType: "Resource", field: "offHireDate",
    approvers: { roles: ["ADMIN"], ownerMayApprove: true }, expiryDays: 3, audience: "OPERATIONAL",
    alsoMoves: "The hire estimate and Tracking's still-to-come for the job recalculate; the site hire check stops asking if it's more than 3 days out.",
  },
  // Ilies (25 Oct 2026): approved on screen, by Nick and Yoel (their DIRECTOR logins) only -
  // "nick and yoel do the tenders and approve them the budgets". The owner may propose, never approve.
  PROJECT_CONTRACT_VALUE: {
    enabled: true, label: "Contract value", recordType: "Project", field: "contractValue",
    approvers: { roles: ["DIRECTOR"], ownerMayApprove: false }, expiryDays: 14, audience: "COMMERCIAL",
    alsoMoves: "Tracking's Watch / Act status for the job recalculates; the cost-vs-contract and no-contract-value findings follow on their next run.",
  },
  PROJECT_JOB_NO: {
    enabled: true, label: "Job number", recordType: "Project", field: "jobNo",
    approvers: { roles: ["ADMIN"], ownerMayApprove: true }, expiryDays: 14, audience: "OPERATIONAL",
    alsoMoves: "Budget, won-tender, invoice and Xero matching use the job number. (It's also the SharePoint project folder number.)",
  },
  PROJECT_QUOTE_NO: {
    enabled: true, label: "Quote number", recordType: "Project", field: "quoteNo",
    approvers: { roles: ["ADMIN"], ownerMayApprove: true }, expiryDays: 14, audience: "OPERATIONAL",
    alsoMoves: "Budget and won-tender matching use the quote number.",
  },
};

export const CHANGE_KINDS = Object.keys(A3_RULES) as ChangeKind[];

// Logins that never approve anything, whatever their role: the Building Agent
// (the lead's MANAGER login) - its proposals always go to a person.
export const NEVER_APPROVE = ["iliesa+agent@loboscontracting.com.au"];

// Who may publish a lesson (phase 5a, not built yet): the owner only (Ilies,
// 25 Oct 2026: "thats me"). No separate-reviewer rule - he publishes and
// resolves most findings himself. Directors still read published lessons.
export const LESSON_PUBLISHERS: { owner: boolean; roles: string[] } = { owner: true, roles: [] };
