// LCI phase 6 (27 Oct 2026): which SharePoint folders document search may read, and who may see what came from
// them. Plain rules, no server imports; `npm test` (folders.test.ts). Design: docs/lci/PHASE6-DESIGN.md §4.
//
// Paths are below the library root ("Shared Documents/Lobos Demolition" on the Management site). A pattern segment
// "*" matches any one folder name (each project, each tender). Every folder ships approved: false (D6-2) - nothing
// is read until Ilies ticks it in docs/lci/PHASE6-FOLDERS.md and this list is updated. The deny list always wins.

export type Level = "MANAGER" | "COMMERCIAL";
export type Folder = { id: string; label: string; pattern: string; level: Level; approved: boolean };

export const LIBRARY_ROOT = "Lobos Demolition";
const P = "01_Projects - Live/*";
const HSE = `${P}/22_001_09_HSE & Site Management`;

export const FOLDERS: Folder[] = [
  // SWMS and safety - Managers and up
  { id: "proj-swms", label: "Project SWMS", pattern: `${HSE}/04_SWMS`, level: "MANAGER", approved: false },
  { id: "proj-induction", label: "Project site induction", pattern: `${HSE}/02_Site Induction`, level: "MANAGER", approved: false },
  { id: "proj-toolbox", label: "Project toolbox talks", pattern: `${HSE}/03_Tool box Talks`, level: "MANAGER", approved: false },
  { id: "proj-hotwork", label: "Project hot work permits", pattern: `${HSE}/05_Hot Work Permit`, level: "MANAGER", approved: false },
  { id: "gen-workplans", label: "Demolition work plans", pattern: "03_General/Demolition Work Plans", level: "MANAGER", approved: false },
  { id: "gen-methods", label: "Methodologies", pattern: "03_General/Methodologies", level: "MANAGER", approved: false },
  { id: "gen-checklists", label: "Checklists", pattern: "03_General/Checklists", level: "MANAGER", approved: false },
  { id: "gen-waste", label: "Waste disposal documents", pattern: "03_General/Waste Disposal Documents", level: "MANAGER", approved: false },
  { id: "templates", label: "Templates", pattern: "00_Templates", level: "MANAGER", approved: false },
  // Scopes, drawings, programmes, quality - Managers and up
  { id: "proj-drawings", label: "Project drawings", pattern: `${P}/22_001_04_Drawing Records`, level: "MANAGER", approved: false },
  { id: "proj-programme", label: "Project programme", pattern: `${P}/22_001_07_Programme`, level: "MANAGER", approved: false },
  { id: "proj-minutes", label: "Project meeting minutes", pattern: `${P}/22_001_06_ Meeting Minutes`, level: "MANAGER", approved: false },
  { id: "proj-quality", label: "Project quality management", pattern: `${P}/22_001_13_Quality Management`, level: "MANAGER", approved: false },
  { id: "proj-registers", label: "Project registers (tools & equipment)", pattern: `${P}/22_001_08_Registers (Tools & Equipment)`, level: "MANAGER", approved: false },
  // Contracts, variations, tenders and quotes - Admins and directors
  // DS-019 (security review, Ilies approved 27 Oct): the estimate stage holds the tender build-up and quote, so it's
  // COMMERCIAL, not MANAGER.
  { id: "proj-estimate", label: "Project estimate stage (scope and quote)", pattern: `${P}/ESTIMATE STAGE`, level: "COMMERCIAL", approved: false },
  { id: "proj-contract", label: "Project contract", pattern: `${P}/22_001_05_Contract`, level: "COMMERCIAL", approved: false },
  { id: "proj-variations", label: "Project variations", pattern: `${P}/22_001_15_Variations`, level: "COMMERCIAL", approved: false },
  { id: "proj-eot", label: "Project EOTs & NODs", pattern: `${P}/22_001_17_EOT's & NOD's`, level: "COMMERCIAL", approved: false },
  { id: "proj-client", label: "Project client correspondence", pattern: `${P}/22_001_10_Client Correspondence`, level: "COMMERCIAL", approved: false },
  { id: "tenders-2026", label: "Tenders & quotes 2026", pattern: "02_3 Tenders - Estimates & Quotes (2026)/*", level: "COMMERCIAL", approved: false },
];

// Never read, wherever they sit - even inside an approved folder (D6-7 and the plan's exclusions).
export const DENY: RegExp[] = [
  /(^|\/)05_Employment & HR(\/|$)/i, /(^|\/)08_Finance(\/|$)/i, /(^|\/)09_Legal(\/|$)/i, /(^|\/)07_Progress Claims(\/|$)/i,
  /(^|\/)06_Schedule of Rates(\/|$)/i, /(^|\/)12\. CLAUDE(\/|$)/i, /(^|\/)13\. Estimating workspace(\/|$)/i, /(^|\/)\.claude(\/|$)/i,
  /(^|\/)zz_Redundant/i, /(^|\/)10_Audit & Quality Systems(\/|$)/i,
  /\/22_001_02_Contact Lists(\/|$)/i, /\/22_001_03_Cost Reports/i, /\/22_001_11_Purchase Orders/i, /\/22_001_14_Timesheets & Payroll/i,
  /\/22_001_16_Progress Claims/i, /\/22_001_12_Subcontractors/i, /\/06_Incident Report(\/|$)/i,
  /payroll|timesheet|salar(y|ies)|super(annuation)?\b|tax file|\btfn\b|bank details|password|passport|medical|warning letter|termination|resume|\bcv\b/i,
];

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

// Does a path (below the library root) sit inside this folder pattern? The path may be the folder or anything below it.
export function underPattern(path: string, pattern: string): boolean {
  const a = norm(path).split("/"), b = norm(pattern).split("/");
  if (a.length < b.length) return false;
  return b.every((seg, i) => seg === "*" || seg.toLowerCase() === a[i].toLowerCase());
}

export const denied = (path: string) => DENY.some((re) => re.test(norm(path)));

// The approved folder a file belongs to, or null (not approved, or denied). `approvedIds` overrides the flags - used
// only by the local test source (DOC_SEARCH_TEST_APPROVE); production uses the flags above.
export function folderFor(path: string, approvedIds?: Set<string>): Folder | null {
  if (denied(path)) return null;
  return FOLDERS.find((f) => (approvedIds ? approvedIds.has(f.id) : f.approved) && underPattern(path, f.pattern)) ?? null;
}

// Which levels a login may see. The page itself is Managers and Admins only (D6-1); COMMERCIAL is Admins, and
// Managers with director access.
export function levelsFor(user: { role: string; directorAccess?: boolean }): Level[] {
  if (user.role === "ADMIN") return ["MANAGER", "COMMERCIAL"];
  if (user.role === "MANAGER") return user.directorAccess ? ["MANAGER", "COMMERCIAL"] : ["MANAGER"];
  return [];
}
export const canSearch = (user: { role: string }) => user.role === "ADMIN" || user.role === "MANAGER";

// "Rev C", "Rev.2", "R3", "v4", "Revision B" in a file name -> "Rev C" etc.; null when there's none.
export function revisionOf(name: string): string | null {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const m = base.match(/(?:^|[\s_\-(\[])(?:rev(?:ision)?\.?\s*|r)([A-Z0-9]{1,3})(?=$|[\s_\-)\].])/i) ?? base.match(/(?:^|[\s_\-(\[])v(\d{1,3})(?=$|[\s_\-)\].])/i);
  if (!m) return null;
  return /v\d/i.test(m[0].trim()) && !/rev/i.test(m[0]) ? `v${m[1]}` : `Rev ${m[1].toUpperCase()}`;
}
