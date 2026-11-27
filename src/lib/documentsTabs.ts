// The Documents page (/documents) is the one place for documents (Ilies, 26 Nov 2026: "the documents should have never
// have been put here. there is already a documents tab which is where the new feature should have been put" - then
// "Yes, one place: Documents"). Two parts, each with its own existing access rule:
//   - "Search": document search over the approved SharePoint folders (LCI phase 6, docsearch/folders.ts canSearch);
//   - "Site documents": the office side of the supervisors' site documents - plans, SWMS + register, pre-starts,
//     toolbox talks, the topic of the week (siteDocs/rules.ts mayReadSiteDocs; never incidents).
// A login sees only the parts it may see. The old address /site-documents redirects here (siteDocumentsHref). Plain
// rules, no server imports - the page, the redirect, the coordinator's screen and `npm test` (documentsTabs.test.ts).
import { mayReadSiteDocs } from "./siteDocs/rules";
import { canSearch } from "./docsearch/folders";

export type DocumentsTab = "search" | "site";
export const DOCUMENTS_TABS: readonly { id: DocumentsTab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "site", label: "Site documents" },
];

// Which parts of /documents this role may see - the same rules the APIs apply (guardDocuments / guardSiteDocs).
export function documentsTabsFor(role: string | null | undefined): DocumentsTab[] {
  const r = role ?? "";
  return DOCUMENTS_TABS.filter((t) => (t.id === "search" ? canSearch({ role: r }) : mayReadSiteDocs(r))).map((t) => t.id);
}

// A project id from an address: ids only (letters, digits, - and _), anything else is dropped.
export const cleanProjectId = (v: string | null | undefined): string | null => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

// The Site documents part of /documents, optionally opened on one project. Always a path on this app.
export function siteDocumentsHref(projectId?: string | null): string {
  const pid = cleanProjectId(projectId);
  return `/documents?tab=site${pid ? `&projectId=${encodeURIComponent(pid)}` : ""}`;
}
export const documentSearchHref = "/documents?tab=search";

// The part to show: the one the address asks for (if this login may see it); else the only one it may see; else Site
// documents when the address names a project; else Search when search is connected and Site documents when it isn't
// ("not connected" today, waiting on the Microsoft 365 keys). null = still waiting to hear whether search is
// connected (or nothing to show).
export function pickDocumentsTab(o: { asked: string | null; projectId: string | null; allowed: readonly DocumentsTab[]; searchConnected: boolean | null }): DocumentsTab | null {
  const { allowed } = o;
  if (allowed.length === 0) return null;
  if (o.asked && (allowed as readonly string[]).includes(o.asked)) return o.asked as DocumentsTab;
  if (allowed.length === 1) return allowed[0];
  if (cleanProjectId(o.projectId)) return "site";
  if (o.searchConnected === null) return null;
  return o.searchConnected ? "search" : "site";
}
