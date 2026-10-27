# Questions to Victoria, questions from the AI, and office chat: design (27 Oct 2026)

Ilies (27 Oct), verbatim:

> "for the request for information to victoria please add a tab to her dashboard that allows me or you to send RFI or questions to victoria.. what would be nice would be a internal chat room between office personnel. and where you as the AI can send questions directly to the people information is required from"

The work is three parts, built in this order with one commit each. Draft defaults are marked **D-Q1 … D-Q12**. Each is a setting or a rule, not data, so each can be reversed.

## 0. What is reused

| Need | Already there | Used how |
|---|---|---|
| A question with an answer, files, history and a close | Information requests: `src/lib/infoRequests/`, which are `SiteRequest`s of kind QUERY with no finding, audience DIRECTOR | **The only question store.** Parts 1 and 2 add screens and senders, not a second store. |
| Answering | `POST /api/queries/:id` (the assignee only) and `MyQueries.tsx` | Reused unchanged. Victoria, a director or a Manager answers through the same route. |
| Closing, follow-up, nudge | `POST /api/info-requests/:id` (owner and director access) | Unchanged. **Answers never change data.** Ilies reads them and changes go through propose-then-apply. |
| Chat | The Estimating agent's branch `accounts-messaging` (3c64ff1): `MessageThread` / `MessageParticipant` / `Message`, `/messages`, "Seen", corrections, nothing edited or deleted | Brought in, then **trimmed** (§3). |
| Money off Manager screens | `assertNoMoney` | Used for questions to a Manager, the Office room, and any thread with a Manager. |
| Who the AI is | `BUILDING_AGENT_EMAIL` in `src/lib/session.ts`, which is a constant only | Imported as is. Its user id is never hard-coded. `session.ts` itself is not edited. |

## 1. Accounts → "Questions" (`/accounts/questions`)

- **A new tab on the ACCOUNTS list in TopNav**, after "To do".
- **Victoria (the ACCOUNTS login)** sees every question to her login: open ones first, then answered and closed ones, **all of them, not only the last 14 days.**
  - Each shows who asked, when, by when, the "what we need" note, any follow-up, her answer and its file, and its history (sent, follow-up asked, reminded, answered, closed).
  - She answers there through the existing route, with text and an optional file. An FYI is just marked read.
- **The owner, or an Admin with director access** (the Accounts-screen users who already run Directors → Info requests), see the same list of questions to the accounts login, read-only. DIRECTOR logins can't open the Accounts screen, and they keep Directors → Info requests.
  - Close, follow-up and nudge stay on Directors → Info requests, and the tab links there.
- **D-Q1. An Admin without director access** gets the Accounts screen but sees no question list here. Information requests never open for an Admin without director access (`canSeeAnswerFile`), and this keeps that rule.
- **"Ask Victoria" form** (owner, or an Admin with director access, plus the Building Agent from part 2):
  - QUESTION or FYI, title, question, what we need, due date;
  - it calls `POST /api/info-requests` with the accounts login as the recipient.
- The tab shows, always: **"Answers are reviewed by Ilies before anything changes."**
- **The To do page:** "Questions for you" now links to this tab. The old Invoices → Queries tab keeps working.
- **API:** `GET /api/accounts/questions`.
  - Accounts: their own questions.
  - Owner, or an Admin with director access: all questions to ACCOUNTS logins.
  - Building Agent (part 2): only the questions it sent to accounts.
  - Anyone else: 403.

## 2. The AI sends questions directly

- **Who counts as "Operations AI":** the user whose email is `BUILDING_AGENT_EMAIL` (`isOperationsAi()` in `infoRequests/rules.ts`). It is decided by that constant, never by role. **An ordinary Manager still gets 403.**
- **Who the AI can ask** (`aiTargetError`): an active
  - ACCOUNTS login,
  - DIRECTOR login,
  - or ADMIN / MANAGER login.
  - Never the AI itself, a Viewer or a Timesheets login.
  - **D-Q2. Never the owner.** Ilies reviews the answers; questions for him come in this chat.
- **Tag:** the request's "asked by" is **"Operations AI"**, and `details.askedByAi = "1"`. Every screen shows that name: the recipient's card, Accounts → Questions, and Directors → Info requests, which has a "Sent by Operations AI" badge and an "AI only" filter. The owner sees every one there, since the page already lists every information request.
- **Limits:**
  - **20 a day**, rolling 24 hours, counted from the store. The 21st is refused with a plain message.
  - **No dollar figure in a question to a Manager**: title, question, need and why are all checked. Questions to accounts, directors and Admins may carry amounts, as today.
- **Where Admins and Managers answer.** Today only accounts and directors have a "My queries" screen, so this adds:
  - **`/questions` "Questions for me"** (the same `MyQueries` component);
  - an Operations tab "My questions" with a badge, **shown only when this login has any question** (**D-Q3**), so the nav doesn't grow for everyone;
  - the floating "Questions for you" pill on the board, which now links there for an Operations login and to `/accounts/questions` for accounts.
- **D-Q4. No phone alert for a new question**, same as today (Ilies: no director alerts). The badge and the banner are the signal.
- **D-Q5. What the AI can read back:** `GET /api/info-requests` as the Building Agent returns **only the questions it sent**, with their answers and files, plus who it can ask.
  - It does not get the full tracker. Directors' questions from Ilies stay with Ilies and the directors.
  - Answers to its own questions can carry amounts from accounts or a director. That is Claude acting for Ilies, and he reviews them anyway.
- **Unchanged:** the AI can't close, follow up, nudge, batch-send or decline (owner and director access only), and an answer changes nothing.

## 3. Office chat (in the app only)

**Removed from the messaging branch:**
- all of the site-link side: link threads, the DRIVER / SUPERVISOR / OFFICE link screens, `linkViewer`, `/api/site/[token]/messages*`, `LinkMessages`, the PERSON participant kind in use, and the 60-a-day link limit. Ilies scrapped messaging to workers.

**Who:**
- **Office logins:** the owner, ADMIN, MANAGER, ACCOUNTS and DIRECTOR. Not VIEWER or TIMESHEETS (403).
- **The "Office" room:** one shared group room that every office login reads and posts in.
  - It is one `MessageThread` with `kind ROOM` and `roomKey "OFFICE"`, created on first use.
  - A participant row is made the first time a person opens it, and holds their "seen".
- **One-to-one threads** between any two office logins. The branch blocked directors ↔ office; that block is lifted, because Ilies asked for chat between office personnel.

**Money:**
- The Office room refuses `$` figures, because Managers are in it.
- A one-to-one thread may carry amounts only when **both** people are owner / ADMIN / ACCOUNTS / DIRECTOR. It is fixed when the thread starts.
- A thread with a Manager refuses `$`. That includes the AI, which is a Manager login.

**Kept forever:** no edit or delete route (405). A correction is a new message, and the original stays and shows as corrected.

**Seen:**
- One-to-one: "Seen" with its time, as in the branch.
- **D-Q6. Room:** no per-message "Seen". It shows "Seen by N" from the participants' last-seen times, and the names on hover.

**Unread badge:**
- A "Messages" tab on the Operations (Manager+), Accounts and Directors lists in TopNav.
- An Admin who opened Messages from the Accounts or Directors screen keeps that screen. It is remembered for the tab, like Invoices. Note for the lead: main 216751d has no SHARED map, so this is the same `lobos-screen` memory the invoices inbox uses.
- **D-Q7.** The room's unread count starts from your first visit. Before that, only the last 7 days count, so a new login doesn't open on hundreds of messages.

**Push:**
- "Message from <name>". The text is never included.
- **D-Q8.** The body is the record label only in a thread without amounts; otherwise "Open Messages to read it".
- **D-Q9.** The Office room sends **no** push, badge only, so 20 people's phones don't buzz on every message. One-to-one messages do.

**The AI in chat:**
- The Building Agent can post in the room and start or reply to one-to-one threads.
- Its name everywhere is **"Operations AI"**, including the "To" list. People can message it back.
- It follows the same money rules as a Manager.
- **D-Q10.** Its chat posts share the 20-a-day limit with its questions: 20 questions plus 20 messages, counted separately.

**"Message about this"** on purchases, reimbursements, pay weeks, ABN invoices and site requests is kept from the branch, in-app only. A message never changes the record.

**D-Q11. Privacy:** only the two people read a one-to-one thread; not even an Admin does. The room is open to every office login. Should Ilies be able to read every one-to-one thread? That is a question for him (same as the branch's D-M4).

**D-Q12. Export:** none yet. A per-thread print / PDF can follow if wanted.

**Schema (additive):**
- the branch's three tables;
- `MessageThread.kind String @default("DIRECT")` (DIRECT | ROOM) and `roomKey String? @unique`;
- `MessageParticipant.kind` stays (always USER now), and `resourceId` stays nullable and unused, so a later link side needs no migration.

## 4. Files not touched

`src/lib/session.ts` (constant imported only), `src/lib/auth.ts`, `src/middleware.ts`, `next.config.js` and `src/app/api/users/**` are left alone, so they don't collide with the security fixes in progress. The client-side gate in `AppFrame.tsx` gets one line, which lets ACCOUNTS / DIRECTOR logins open `/messages`.

## 5. Tests

- **Unit:**
  - who the AI can ask, and that an ordinary Manager can't send;
  - the 20-a-day arithmetic;
  - `$` refused to a Manager;
  - who can start a thread, and who may read the room;
  - when money is allowed (room never; one-to-one by roles; the AI never);
  - push text carries no message;
  - unread for the room (first-visit window), "Seen by N".
- **Copy (port 3002):**
  - part 1:
    - accounts sees and answers on the tab;
    - the owner sees it read-only and asks from the form;
    - Manager / Viewer / DIRECTOR get 403 on `/api/accounts/questions`;
    - an Admin without the tick gets no list;
  - part 2:
    - the Building Agent asks accounts, a director, an Admin and a Manager;
    - an ordinary Manager gets 403;
    - the 21st is refused;
    - `$` is refused to a Manager and allowed to accounts;
    - "Operations AI" shows on the recipient's card and on the owner's Info requests;
    - the Building Agent reads back only its own questions;
    - a Manager answers on `/questions`, and nothing else changed;
  - part 3:
    - every office role can open the room, and Viewer / Timesheets get 403;
    - one-to-one between any office pair;
    - `$` refused in the room and with a Manager, allowed between accounts and a director;
    - corrections, "Seen", unread;
    - PUT / PATCH / DELETE give 405;
    - the AI posts as "Operations AI";
    - no `/api/site/*/messages` route exists.
- **Viewer-safety:** add `/api/accounts/questions`, `/api/messages` and `/api/messages/directory` as denied.
- **Browser:** the three screens, and the Accounts and Directors navs with the Messages badge, at phone width.

### Results (27 Oct 2026, on a copy of the server backup `cloud-dev-20261027-0130`)

- `tsc` clean; `npm test` 312 / 312 (+5 Operations AI rules, +10 chat rules).
- End to end on port 3002: **77 / 77**.
  - Part 1: who opens `/api/accounts/questions` (accounts, owner, ticked Admin yes; plain Admin, Manager, Viewer, DIRECTOR, Timesheets 403; none 401); the owner asks, accounts answer, the owner sees it read-only with history.
  - Part 2: the AI asks accounts, a director, an Admin and a Manager; an ordinary Manager gets 403; `$` refused to a Manager in question and in "what we need", fine to accounts; never the owner or a Viewer; "Operations AI" on the cards and on Info requests; the AI reads back only its own; it can't close or batch-send; the 21st in 24 hours is 429.
  - Part 3: every office role opens Messages with the room first; Viewer and Timesheets 403; room posts with names, `$` refused; unread and "Seen by"; one-to-ones (accounts ↔ director with amounts, accounts ↔ Manager without, Manager ↔ director); only the two people read one, not an Admin or the owner; corrections; PUT / PATCH / DELETE 405; the AI as "Operations AI" in the room, the To list and a one-to-one, with no `$`; no site-link messages route.
- Found and fixed while testing: a room message refused for a `$` figure marked the room read for its sender. A first room seat now starts unseen, and only a sent message marks it read.
- `scripts/check-viewer-safety.ts`: 22 / 22 (+3).
- Browser:
  - Accounts → Questions with "from Operations AI";
  - Messages as accounts (the Accounts nav stays), the room open, at phone width. Long lines in the list now shorten instead of overflowing;
  - a Manager's "Questions for me", with the "My questions" and "Messages" tabs.
- Not covered: push delivery (the copy has no push keys). The alert text is unit-tested to carry no message.
