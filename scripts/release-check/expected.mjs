// Release check: the KNOWN-EXPECTED results, in one place, so nobody has to remember them.
//
// ACCESS MATRIX - every GET API route without a [dynamic] segment is called as each restricted login. A route listed
// here for that login MAY answer (its own checks look closer); every other route MUST refuse (401 or 403). A new route
// that should be open to one of these logins has to be added here on purpose - that is the point.
export const MAY_ANSWER = {
  // Middleware lets these through without a session. /api/auth/setup GET only says whether the first Admin exists.
  NO_LOGIN: [/^\/api\/auth\/(login|setup|me)$/],
  // TIMESHEETS (Alex, review-only weekly timesheets): guardTimesheetViewer(); /api/queries is only ever this login's own.
  TIMESHEETS: [/^\/api\/auth\//, /^\/api\/timesheets(\/|$)/, /^\/api\/queries$/],
  // DIRECTOR logins: the Directors screen, plus what it reads (findings, own queries, Xero mirror, info requests,
  // controlled changes to approve, lessons). Everything in Operations refuses them.
  DIRECTOR: [/^\/api\/auth\//, /^\/api\/directors(\/|$)/, /^\/api\/findings(\/|$)/, /^\/api\/queries$/, /^\/api\/xero(\/|$)/,
    /^\/api\/info-requests(\/|$)/, /^\/api\/changes(\/|$)/, /^\/api\/lessons(\/|$)/],
  // ACCOUNTS (Victoria): the Accounts screen and the invoices inbox; compliance records; the Xero mirror; own queries;
  // purchases; her own phone alerts (/api/push, since 26 Oct).
  ACCOUNTS: [/^\/api\/auth\//, /^\/api\/accounts(\/|$)/, /^\/api\/invoice-inbox(\/|$)/, /^\/api\/compliance\/(workers|documents)(\/|$)/,
    /^\/api\/xero(\/|$)/, /^\/api\/queries$/, /^\/api\/purchases$/, /^\/api\/info-requests(\/|$)/, /^\/api\/push$/],
};

// Routes that answer ANY signed-in login with a redirect back into the app: the owner-only Xero connect / callback
// refuse a non-owner by sending them back to Accounts data with the reason. The matrix counts a same-site redirect
// from these as a refusal, and FAILS one that points at any other host (e.g. Xero's sign-in).
export const REFUSE_BY_REDIRECT = [/^\/api\/directors\/xero\/(connect|callback)$/];

// Single results that look like failures but are correct.
export const EXPECTED_NOTES = [
  "/api/users answers 403 to a Manager (only Admins manage logins) - the smoke check expects 403 there, not 200.",
  "/estimating is ADMIN only: a Manager or Director gets 403 (the proxy never forwards the server keys).",
  "Pages are client-gated: a one-page login (TIMESHEETS / ACCOUNTS / DIRECTOR) gets the page shell (200) and is sent home by AppFrame; the DATA behind it is refused by the API (403). The access matrix checks the APIs.",
  "/api/directors/xero/connect and /callback answer a non-owner with a 307 back into the app (refusal by redirect, see REFUSE_BY_REDIRECT).",
  "Xero 'Refresh now' as accounts answers 4xx on the test copy (no Xero keys) - anything but 401/403 is right.",
  "Production benchmarks report estimatingDown on the copy - ESTIMATING_URL points at a closed port on purpose.",
];
