# LCI phase 6 - document search: plan for Ilies's approval (26 Oct 2026)

Status: PLAN ONLY. Nothing is built until Ilies approves. This is a new outside connection and a new module, so
it goes through the permission gate (CLAUDE.md).

## Current state

- The job documents (SWMS, contracts, scopes, drawings, quotes, inductions, engineering letters) live in
  SharePoint / OneDrive. Operations links to nothing in them. Finding a document means opening SharePoint and
  searching by hand.
- The Assistant (`/assistant`, Managers and up) answers questions from Operations' own data only. It can't
  answer "what does the SWMS for Myer say about night work?" or "what did the contract say about the hoarding?".
- The lead can read SharePoint (read-only) for one-off look-ups, as in the 25 Oct gap search. That's
  the lead working by hand, not something the office can use.

## Problem

Information that already exists can't be found quickly, especially out of hours or from site. The LCI rules
("every conclusion lists its evidence") get weaker when the evidence sits in documents nobody can search.

## Proposed change

1. **A list of approved folders** (decision 7 of the LCI plan). Each folder in the list has a minimum role:
   - SWMS and safety: Managers and up;
   - project scopes, drawings and engineering: Managers and up;
   - contracts and quotes: Admins and directors only.
   HR, payroll, legal, the accounts folders and personal folders are **never** indexed. Anything not on the list
   isn't read at all.
2. **Reading those folders, read-only.** There are two ways (choose one, see the alternatives below):
   - **A (recommended): Microsoft Graph from the server.** An app registration with `Sites.Selected`, granted
     read on the approved sites only. This is the seventh outbound connection (graph.microsoft.com and
     login.microsoftonline.com only, on an allowlist like Xero's). It needs the same Microsoft 365 admin
     session as Accounts stage 2 (emails from accounts@), so both can be done in one sitting.
   - **B: from the laptop's synced OneDrive.** A nightly task pulls text out of the approved folders and sends
     it to the server. There's no new cloud connection, but it needs a new scheduled task (your OK) and only
     runs when the laptop is awake, the same problem the 2am backup copy had.
3. **A search index on the server.** The text is extracted from PDF, Word and Excel files (Excel through exceljs,
   which is already installed; PDF and Word need one small reading library, checked before it's added). It goes
   into a **separate** SQLite full-text index (`/srv/operations/search/search.db`, Node 24's built-in
   SQLite, no new database server). It's kept apart from the main database so `prisma db push` can never touch
   it, and it can be rebuilt from scratch at any time, so it doesn't need backing up. It's refreshed nightly
   after the backup and the Xero read, and only changed files are re-read.
4. **A search page** (`/documents`, Managers and up). You type words and get the matching documents, each
   with a snippet, its folder, date and revision, and a link that opens it in SharePoint. That link still checks
   Microsoft's own permissions, so nobody can open a file they couldn't open before. Results are filtered by
   your role **on the server**, never in the browser.
5. **The Assistant uses it.** One more read-only tool, "search documents", calls the same route with the same
   role filter. Its answers quote the document and give its name and revision. Retrieved text is treated as
   information, never as instructions: a document that says "ignore your rules" is just text.
6. **Never on a link.** Supervisors, drivers and crew links get no document search in this phase.
   (A "SWMS for my site" button is a possible later step, money-free, if you want it.)

## Reason

- Most of the value of "search our documents" comes from keyword search with citations. A vector or AI search
  service (Azure AI Search, roughly US$75 a month and up) isn't needed to start. The LCI plan's rule is to
  revisit only if keyword search proves too weak.
- It stays inside today's server and costs, follows the read-only Microsoft 365 rule, and every answer cites
  its source.

## Impact

- New: `src/lib/docsearch/` (folder list, text reading, index, search, role filter), `/documents`, `/api/documents`,
  the Assistant tool, and a nightly step in `instrumentation.ts`.
- Server: a new folder `/srv/operations/search`, and new `.env` values (Graph app id / secret / tenant, set
  by you through the same hidden helper as Xero; I never see them).
- The main database: no change, or at most a small "documents index last run" status row.
- Microsoft 365: one app registration, read-only, approved sites only. Nothing is ever written to SharePoint.

## Risks

- **A document is shown to someone who shouldn't see it.** Handled by: the folder list with a role per folder;
  sensitive folders never indexed; the filter on the server; the SharePoint link re-checking permissions; and a
  test that runs a search as each role before it goes live.
- **Bad text from scanned PDFs.** Scans with no text layer aren't searchable at first. They're listed as "not
  readable"; reading them with Claude would be a later, separate decision, because it sends documents out.
- **AI data residency** (LCI decision 2, still open). The index itself stays on the server. Only snippets the
  Assistant uses go to Claude, the same as today's Assistant questions.
- **Graph permissions set too wide.** `Sites.Selected` only, never `Sites.Read.All`. The app refuses to start
  with any write permission, the same guard as Xero.

## Alternatives

- **B (laptop sync)**, as above: no Microsoft 365 admin step, but it depends on the laptop and needs a new
  scheduled task.
- **Microsoft 365 Copilot / SharePoint's own search:** already permission-aware, but it's per-user, isn't joined
  to Operations data, and costs a per-user licence.
- **Do nothing yet:** phase 6 is marked optional in the LCI plan. The pilot data from phases 1-5 is arguably more
  urgent.

## Implementation plan

1. You choose the folder list and the role for each folder. I'll draft it from the SharePoint structure (read-only)
   for you to tick.
2. The Microsoft 365 admin session, shared with Accounts stage 2: you create the app registration and grant
   `Sites.Selected` on the approved sites; the secret goes in through the hidden helper.
3. Build on a branch: folder list, reading, index, role filter, unit tests (including "each role sees only its
   folders").
4. Test on a copy, with a search as every role, and on a sample of real documents.
5. Your "go", then deploy. Then the Assistant tool, as a second small release.

Size: Medium-Large, about 2-3 days of build after the admin session.

## Recommendation

Approve **option A** (Graph, `Sites.Selected`, read-only), with the folder list decided by you first. Do it in
the same Microsoft 365 admin session as Accounts stage 2. Until that session happens, nothing in phase 6 can
start, so it doesn't hold up anything else.

## Decisions needed

1. Go ahead with phase 6 now, or after the pilot data comes in?
2. Option A (Graph from the server) or B (laptop sync)?
3. The folder list and its roles (I'll draft it for you to tick).
4. Are snippets sent to the Assistant (Claude) OK, as with today's Assistant? This links to the open AI
   residency question.
