// Documents is the one place for documents (Ilies, 26 Nov 2026: "Yes, one place: Documents"; "Keep it on Alex's
// screen"): who sees which part of /documents, which part it opens on, the old /site-documents address redirecting
// there with the project kept, and no "Site documents" top-menu item any more. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanProjectId, documentSearchHref, documentsTabsFor, pickDocumentsTab, siteDocumentsHref } from "./documentsTabs";
import { mayReadSiteDocs } from "./siteDocs/rules";
import { canSearch } from "./docsearch/folders";
import { ROLES, isCoordinatorPage, isYardPage } from "./roles";

const src = (rel: string) => readFileSync(path.join(__dirname, "..", ...rel.split("/")), "utf8");

test("each role sees exactly the parts its API lets in", () => {
  for (const r of ROLES) {
    const tabs = documentsTabsFor(r);
    assert.equal(tabs.includes("search"), canSearch({ role: r }), `${r} search`);
    assert.equal(tabs.includes("site"), mayReadSiteDocs(r), `${r} site documents`);
  }
  for (const r of ["ADMIN", "MANAGER", "COORDINATOR"]) assert.deepEqual(documentsTabsFor(r), ["search", "site"], r);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD", "", null, undefined, "admin"]) assert.deepEqual(documentsTabsFor(r), [], String(r));
});

test("which part it opens on", () => {
  const both = ["search", "site"] as const;
  assert.equal(pickDocumentsTab({ asked: "site", projectId: null, allowed: both, searchConnected: true }), "site", "the address asks for Site documents");
  assert.equal(pickDocumentsTab({ asked: "search", projectId: "abc", allowed: both, searchConnected: false }), "search", "the address asks for Search");
  assert.equal(pickDocumentsTab({ asked: null, projectId: null, allowed: both, searchConnected: false }), "site", "search not connected (today) -> Site documents");
  assert.equal(pickDocumentsTab({ asked: null, projectId: null, allowed: both, searchConnected: true }), "search", "search connected -> Search");
  assert.equal(pickDocumentsTab({ asked: null, projectId: null, allowed: both, searchConnected: null }), null, "waits to hear whether search is connected");
  assert.equal(pickDocumentsTab({ asked: null, projectId: "cmabc123", allowed: both, searchConnected: true }), "site", "a project in the address -> Site documents");
  assert.equal(pickDocumentsTab({ asked: "bogus", projectId: null, allowed: both, searchConnected: true }), "search", "an unknown tab is ignored");
  assert.equal(pickDocumentsTab({ asked: "site", projectId: null, allowed: ["search"], searchConnected: true }), "search", "never a part the login may not see");
  assert.equal(pickDocumentsTab({ asked: "search", projectId: null, allowed: ["site"], searchConnected: null }), "site", "...either way");
  assert.equal(pickDocumentsTab({ asked: "site", projectId: null, allowed: [], searchConnected: false }), null, "nothing for a login with no part");
});

test("the Site documents address keeps the project and stays on this app", () => {
  assert.equal(siteDocumentsHref(), "/documents?tab=site");
  assert.equal(siteDocumentsHref(null), "/documents?tab=site");
  assert.equal(siteDocumentsHref("cmabc_123-x"), "/documents?tab=site&projectId=cmabc_123-x");
  for (const bad of ["../x", "a b", "x&tab=search", "https://evil.example", "a".repeat(65), ""]) assert.equal(siteDocumentsHref(bad), "/documents?tab=site", bad);
  assert.equal(cleanProjectId("x\"><script>"), null);
  assert.equal(documentSearchHref, "/documents?tab=search");
});

test("/site-documents redirects to the Documents page's Site documents, with ?projectId= kept", () => {
  const page = src("app/site-documents/page.tsx");
  assert.doesNotMatch(page, /"use client"/, "a server redirect, not a page");
  assert.match(page, /redirect\(siteDocumentsHref\(pid\)\)/);
  assert.match(page, /typeof sp\.projectId === "string" \? sp\.projectId : null/);
  // The sub-pages stay where they are (alerts and links point at them) and go back to Documents.
  for (const rel of ["app/site-documents/topic/page.tsx", "app/site-documents/records/[id]/page.tsx", "app/site-documents/swms/[id]/page.tsx"]) {
    const s = src(rel);
    assert.match(s, /siteDocumentsHref\(/, rel);
    assert.doesNotMatch(s, /href=\{?["`]\/site-documents["`?]/, `${rel}: no back link to the old address`);
  }
  // The coordinator still opens the old address and its sub-pages (and now /documents); never incidents; not the yard.
  for (const p of ["/documents", "/documents?tab=site&projectId=x", "/site-documents", "/site-documents/topic", "/site-documents/records/a", "/site-documents/swms/a"]) assert.ok(isCoordinatorPage(p), p);
  assert.ok(!isYardPage("/documents") && !isYardPage("/site-documents"));
});

test("no 'Site documents' top-menu item; Documents is there for the same people", () => {
  const nav = src("components/TopNav.tsx");
  assert.doesNotMatch(nav, /href: "\/site-documents"/, "no Site documents tab on any screen");
  assert.doesNotMatch(nav, /label: "Site documents"/);
  const block = (name: string) => nav.slice(nav.indexOf(`const ${name} = [`), nav.indexOf("];", nav.indexOf(`const ${name} = [`)));
  assert.ok(block("OPERATIONS").includes('{ href: "/documents", label: "Documents" }'), "Operations screen (Managers / Admins)");
  assert.ok(block("COORDINATOR").includes('{ href: "/documents", label: "Documents" }'), "the coordinator's screen");
  for (const s of ["DIRECTORS", "ACCOUNTS", "YARD"]) assert.ok(!block(s).includes("/documents"), s);
  // Operations screen: Documents sits in the canEdit-only list (Manager / Admin).
  assert.match(nav, /i\.href !== "\/documents"\) \|\| canEdit\)/);
});

test("the Documents page shows each part only to the roles that may see it; the coordinator keeps his card", () => {
  const page = src("app/documents/page.tsx");
  assert.match(page, /const allowed = documentsTabsFor\(user\?\.role\)/);
  assert.match(page, /DOCUMENTS_TABS\.filter\(\(t\) => allowed\.includes\(t\.id\)\)/);
  assert.match(page, /tab === "site" \? <SiteDocsOffice /);
  assert.match(page, /if \(maySearch\) loadStatus\(\)/, "search status asked only by a login that may search");
  assert.match(page, /pickDocumentsTab\(\{ asked, projectId, allowed, searchConnected: connected \}\)/);
  // The office side is one component (no copy of the old page).
  const office = src("components/siteDocs/SiteDocsOffice.tsx");
  assert.match(office, /<UploadForm projectId=\{projectId\} kind="PLAN"/);
  assert.match(office, /<UploadForm projectId=\{projectId\} kind="SWMS"/);
  assert.match(office, /href="\/site-documents\/topic"/);
  assert.doesNotMatch(office, /["`/]incidents?\b|\/api\/directors/i, "never incidents (no incident address)");
  assert.doesNotMatch(page, /["`/]incidents?\b|\/api\/directors/i, "...on the Documents page either");
  // Alex's dashboard: the card stays, its links go to Documents.
  const coord = src("app/coordinator/page.tsx");
  assert.match(coord, /<SiteDocsCard \/>/);
  assert.match(coord, /href: siteDocumentsHref\(\)/);
  assert.doesNotMatch(coord, /href: "\/site-documents"/);
  const card = src("components/siteDocs/SiteDocsCard.tsx");
  assert.match(card, /href=\{siteDocumentsHref\(\)\}/);
  assert.match(card, /href=\{siteDocumentsHref\(pid\)\}/);
});
