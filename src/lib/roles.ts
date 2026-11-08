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
// YARD (Ilies, 4 Nov 2026): the dedicated computer downstairs in the yard - organising tools and actioning yard
// requests. Its own page (/yard, the yard jobs) and the Tools pages in YARD_PAGES, working tools exactly as the
// coordinator does (lib/auth.ts guardTools). No money and nothing else of Operations. Same pattern: below VIEWER, so
// every guard() refuses it; only guardOrYard() and guardTools() let it in.
import { RANK as BASE_RANK, rankAtLeast as atLeast } from "./roleRank";

export type Role = "ADMIN" | "MANAGER" | "VIEWER" | "TIMESHEETS" | "ACCOUNTS" | "DIRECTOR" | "COORDINATOR" | "YARD";
export const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "COORDINATOR", "YARD"];
// The ranks are lib/roleRank.ts's, the one table (CO-001: an unknown role ranks below everything).
export const RANK = BASE_RANK as Record<Role, number>;

// The ordinary ladder (VIEWER < MANAGER < ADMIN). An unknown role ranks nowhere.
export const rankAtLeast = (role: string, min: Role) => atLeast(role, min);
// A route open to `min` and up, plus the coordinator - never anyone else below `min`.
export const coordinatorOr = (role: string, min: Role) => role === "COORDINATOR" || rankAtLeast(role, min);
// A route open to `min` and up, plus the yard computer (4 Nov 2026) - never anyone else below `min`.
export const yardOr = (role: string, min: Role) => role === "YARD" || rankAtLeast(role, min);
// The Tools routes (register, toolboxes' contents and checks, faults, photos): `min` and up, plus the coordinator and
// the yard computer, who work tools the same way (Ilies, 2 and 4 Nov 2026). Never anyone else below `min`.
export const toolsWorkerOr = (role: string, min: Role) => role === "COORDINATOR" || role === "YARD" || rankAtLeast(role, min);
// Vehicle & plant faults (/faults, the pre-start checks - Ilies, 8 Nov 2026): Managers and Admins, the coordinator and
// the yard computer - exactly those four. Never Viewer, TIMESHEETS, ACCOUNTS or DIRECTOR.
export const faultsWorker = (role: string) => role === "COORDINATOR" || role === "YARD" || rankAtLeast(role, "MANAGER");

// Logins only the owner gives, takes away or creates: DIRECTOR (25 Oct 2026), COORDINATOR (2 Nov 2026, Ilies: "Only
// you (the owner)") and YARD (4 Nov 2026). True when a change from `from` to `to` (from = null for a new login) touches
// one of them.
export const OWNER_ONLY_ROLES: readonly string[] = ["DIRECTOR", "COORDINATOR", "YARD"];
export const touchesOwnerOnlyRole = (from: string | null, to: string) =>
  OWNER_ONLY_ROLES.some((r) => (from === r) !== (to === r));
// What the owner-only refusal calls the login it is about ("Only Iliesa can change a Yard login.").
const ROLE_NAME: Record<string, string> = { DIRECTOR: "Director", COORDINATOR: "Coordinator", YARD: "Yard" };
export const ownerOnlyRoleName = (from: string | null, to: string) =>
  ROLE_NAME[OWNER_ONLY_ROLES.find((r) => (from === r) !== (to === r)) ?? ""] ?? "protected";
// YD-009 (Ilies approved 4 Nov 2026): a login whose password, name and on/off switch only the owner changes - every
// role in OWNER_ONLY_ROLES (today Director, Coordinator and Yard) and any login with director access (SEC-002).
export const ownerGuardsAccount = (t: { role: string; directorAccess: boolean }) => OWNER_ONLY_ROLES.includes(t.role) || t.directorAccess;
export const ownerGuardedName = (t: { role: string; directorAccess: boolean }) =>
  ROLE_NAME[t.role] ? `${ROLE_NAME[t.role]} login` : t.directorAccess ? "director's login" : "login";

// The one-page logins that never have director access, even if the tick was set by mistake.
export const NO_DIRECTOR_ACCESS_ROLES: readonly string[] = ["TIMESHEETS", "ACCOUNTS", "COORDINATOR", "YARD"];

// Where a role lands after signing in - the limited roles only have their own page.
export function homeFor(role: Role) {
  return role === "TIMESHEETS" ? "/timesheets" : role === "ACCOUNTS" ? "/accounts" : role === "DIRECTOR" ? "/directors"
    : role === "COORDINATOR" ? "/coordinator" : role === "YARD" ? "/yard" : "/command";
}

// The pages a COORDINATOR login may open (AppFrame sends him home from any other; the APIs refuse him anyway).
// /daily-report/<job> is Day Review's daily site report. /tools/site (site links and submissions) is not his.
// /yard/stocktake (Yard Stage B, 4 Nov 2026): the yard stock take is Tools work, which he does like the yard - the
// yard jobs page (/yard) itself stays not his. /yard/inventory (Yard Stage C, 4 Nov 2026): the consumables, Tools access too.
export const COORDINATOR_PAGES = [
  "/coordinator", "/timesheets", "/attendance", "/day-review", "/calendar",
  "/tools", "/tools/toolboxes", "/tools/faults", "/yard/stocktake", "/yard/inventory", "/hire", "/purchases", "/messages", "/documents",
  "/faults", // vehicle & plant faults and the pre-start checks (8 Nov 2026)
] as const;
export function isCoordinatorPage(path: string): boolean {
  const p = (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  return (COORDINATOR_PAGES as readonly string[]).includes(p) || /^\/daily-report\/[^/]+$/.test(p);
}
// A link on one of his pages: kept when it goes to one of them, otherwise null (shown as plain text), as
// directorHref() does for directors.
export const coordinatorHref = (href: string, coordinatorOnly: boolean): string | null =>
  !coordinatorOnly || isCoordinatorPage(href) ? href : null;

// The pages the YARD login may open (Ilies, 4 Nov 2026) - AppFrame sends it home (/yard) from any other; the APIs refuse
// it anyway. /yard and any page under it (the yard jobs); the Tools register, toolboxes and faults - not /tools/site.
// /faults (8 Nov 2026): vehicle & plant faults and the pre-start checks.
export const YARD_PAGES = ["/yard", "/tools", "/tools/toolboxes", "/tools/faults", "/faults"] as const;
export function isYardPage(path: string): boolean {
  const p = (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  return (YARD_PAGES as readonly string[]).includes(p) || p.startsWith("/yard/");
}
// A link on one of its pages: kept when it goes to one of them, otherwise null (shown as plain text).
export const yardHref = (href: string, yardOnly: boolean): string | null =>
  !yardOnly || isYardPage(href) ? href : null;
