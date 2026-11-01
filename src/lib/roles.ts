// The login roles and the plain rules about them - no server imports, so the pages, lib/auth.ts and `npm test`
// (roles.test.ts) all read the same lists.
//
// TIMESHEETS (22 Oct 2026): review-only access to the weekly timesheets and
// nothing else. It ranks below VIEWER, so every guard() in the app
// refuses it; only guardTimesheetViewer() lets it in.
// ACCOUNTS (24 Oct 2026): the invoices inbox and nothing else - accounts
// upload supplier invoices. Same idea: below VIEWER, only guardInvoiceInbox()
// lets it in.
// DIRECTOR (25 Oct 2026, Ilies: directors get their own screen and no
// Operations access): the Directors pages and nothing else. Same pattern -
// below VIEWER, only guardDirector() lets it in. Only the owner sets it.
// COORDINATOR (2 Nov 2026, Ilies "approve phase 1"): Alex, the project coordinator. His own dashboard (/coordinator)
// and exactly the pages in COORDINATOR_PAGES - timesheets, sign-ins, Day Review and the calendar to look at; tools,
// toolboxes and hire to work in (hire without a dollar figure - lib/coordinatorHire.ts); his own purchase requests,
// office chat and the site & safety documents. Same pattern: below VIEWER, so every guard() refuses it; only
// guardOrCoordinator() and the area guards that name it let it in.
import { RANK as BASE_RANK, rankAtLeast as atLeast } from "./roleRank";

export type Role = "ADMIN" | "MANAGER" | "VIEWER" | "TIMESHEETS" | "ACCOUNTS" | "DIRECTOR" | "COORDINATOR";
export const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "COORDINATOR"];
// The ranks are lib/roleRank.ts's, the one table (CO-001: an unknown role ranks below everything).
export const RANK = BASE_RANK as Record<Role, number>;

// The ordinary ladder (VIEWER < MANAGER < ADMIN). An unknown role ranks nowhere.
export const rankAtLeast = (role: string, min: Role) => atLeast(role, min);
// A route open to `min` and up, plus the coordinator - never anyone else below `min`.
export const coordinatorOr = (role: string, min: Role) => role === "COORDINATOR" || rankAtLeast(role, min);

// The one-page logins that never have director access, even if the tick was set by mistake.
export const NO_DIRECTOR_ACCESS_ROLES: readonly string[] = ["TIMESHEETS", "ACCOUNTS", "COORDINATOR"];

// Where a role lands after signing in - the limited roles only have their own page.
export function homeFor(role: Role) {
  return role === "TIMESHEETS" ? "/timesheets" : role === "ACCOUNTS" ? "/accounts" : role === "DIRECTOR" ? "/directors"
    : role === "COORDINATOR" ? "/coordinator" : "/command";
}

// The pages a COORDINATOR login may open (AppFrame sends him home from any other; the APIs refuse him anyway).
// /daily-report/<job> is Day Review's daily site report. /tools/site (site links and submissions) is not his.
export const COORDINATOR_PAGES = [
  "/coordinator", "/timesheets", "/attendance", "/day-review", "/calendar",
  "/tools", "/tools/toolboxes", "/tools/faults", "/hire", "/purchases", "/messages", "/documents",
] as const;
export function isCoordinatorPage(path: string): boolean {
  const p = (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  return (COORDINATOR_PAGES as readonly string[]).includes(p) || /^\/daily-report\/[^/]+$/.test(p);
}
// A link on one of his pages: kept when it goes to one of them, otherwise null (shown as plain text), as
// directorHref() does for directors.
export const coordinatorHref = (href: string, coordinatorOnly: boolean): string | null =>
  !coordinatorOnly || isCoordinatorPage(href) ? href : null;
