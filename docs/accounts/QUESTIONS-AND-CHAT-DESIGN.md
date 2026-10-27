# Questions to Victoria, questions from the AI, and office chat: design (27 Oct 2026)

Ilies (27 Oct), verbatim:

> "for the request for information to victoria please add a tab to her dashboard that allows me or you to send RFI or questions to victoria.. what would be nice would be a internal chat room between office personnel. and where you as the AI can send questions directly to the people information is required from"

The work is three parts, built in this order with one commit each. Draft defaults are marked **D-Q1 … D-Q12**. Each is a setting or a rule, not data, so each can be reversed.

## Ilies's decisions after the first build (27 Oct 2026, passed on by the lead)

These replace the matching drafts below. Each line under it says where in this note it applies.

1. **"ALLOW EDITING AND CORRECTIONS WITHOUT SAYING A NEW MESSAGE"**
   - The sender edits their own chat message in place, and it shows a small **"edited"** marker.
   - Every earlier text is kept in an append-only history table (`MessageVersion`), shown behind "edited".
   - Correction-as-a-new-message is gone.
2. **"DOLLAR VALUES ARE APPROVED WITHIN THE OFFICE CHATS AND MESSAGES"**
   - Dollar figures are allowed in the Office room and in every one-to-one, Managers and Operations AI included. Questions the AI sends to a Manager may carry them too.
   - It is office-only and in-app: nothing from the chat ever reaches a site, driver or office link, and the link money guard is unchanged everywhere else.
   - The 20-a-day limit stays.
3. **"everyone that sends a message within the office communications should have the ability to allow editing or changes or deletion to the message without directors approval"**
   - The sender can also **delete** their own message at any time, with no approval step.
   - Everyone then sees a "message deleted" line.
   - The text stays in the history table, visible to **the owner only**.
   - Nobody edits or deletes another person's message.
4. **D-Q9 (lead):** the Office room sends no push for now.
5. **D-Q11, Ilies: YES.** The owner (Ilies only, via `isOwner`, not other Admins or the directors) can read **every** one-to-one office conversation, read-only.
   - Messages has a "My conversations / All conversations" switch, shown to the owner only.
   - `GET /api/messages?all=1` lists every one-to-one; anyone else gets 403.
   - When he opens one he isn't in, he isn't added as a participant, and nothing is marked seen for the two people.
   - He can't post, edit, delete or mark it seen (404).
   - He sees the edit history and any deleted text, as everywhere.
6. **D-Q2, Ilies: YES.** The Operations AI may send information-request questions to the owner too, under the same rules: tagged "Operations AI", counted in the 20-a-day limit, and answers never change data. He answers on Directors → My queries.

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
  - ~~D-Q2. Never the owner.~~ **Replaced by Ilies's decision 6:** the owner can be asked too.
- **Tag:** the request's "asked by" is **"Operations AI"**, and `details.askedByAi = "1"`. Every screen shows that name: the recipient's card, Accounts → Questions, and Directors → Info requests, which has a "Sent by Operations AI" badge and an "AI only" filter. The owner sees every one there, since the page already lists every information request.
- **Limits:**
  - **20 a day**, rolling 24 hours, counted from the store. The 21st is refused with a plain message.
  - ~~No dollar figure in a question to a Manager~~ **Replaced by Ilies's decision 2:** amounts are fine in a question to anyone the AI asks.
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

**Money (Ilies's decision 2):**
- Dollar figures are allowed in the Office room and in every one-to-one, Managers and Operations AI included.
- There is no "amounts fixed at the start" rule any more. `MessageThread.moneyAllowed` stays in the schema, set true.
- A record label keeps its full detail.
- Chat never reaches a link, so the link money guard elsewhere is untouched.

**Edit and delete (Ilies's decisions 1 and 3):**
- `POST /api/messages/:id` takes `{ action: "EDIT", messageId, body }` or `{ action: "DELETE", messageId }`.
  - Only the sender may use them, at any time, with no approval and no alert. Anyone else gets 403, the owner included.
  - PUT, PATCH and DELETE on the route stay 405.
- **Edit:** the text changes in place and `editedAt` is set. The text before the change is written as an EDIT `MessageVersion`. Everyone in the conversation can open the earlier versions from "edited".
- **Delete:**
  - `deletedAt` is set and the text is cleared from the message row. The row itself stays, so the conversation keeps its order.
  - The text is written as a DELETE `MessageVersion`.
  - Everyone sees "message deleted", and the list preview says the same.
  - Only the owner sees the deleted text and the edits before it, in the conversations he can open.
  - A deleted message can't be edited or deleted again.
- `MessageVersion` is append-only: nothing updates or deletes it. `Message.correctsId` stays in the schema, unused.

**Seen:**
- One-to-one: "Seen" with its time, as in the branch.
- **D-Q6. Room:** no per-message "Seen". It shows "Seen by N" from the participants' last-seen times, and the names on hover.

**Unread badge:**
- A "Messages" tab on the Operations (Manager+), Accounts and Directors lists in TopNav.
- An Admin who opened Messages from the Accounts or Directors screen keeps that screen. It is remembered for the tab, like Invoices. Note for the lead: main 216751d has no SHARED map, so this is the same `lobos-screen` memory the invoices inbox uses.
- **D-Q7.** The room's unread count starts from your first visit. Before that, only the last 7 days count, so a new login doesn't open on hundreds of messages.

**Push:**
- "Message from <name>". The text is never included.
- **D-Q8 (revised for decision 2):** a label can now carry an amount, and an alert shows on a lock screen through Apple's or Google's servers. So the alert body is always "Open Messages to read it", never the label.
- **D-Q9.** The Office room sends **no** push, badge only, so 20 people's phones don't buzz on every message. One-to-one messages do.

**The AI in chat:**
- The Building Agent can post in the room and start or reply to one-to-one threads.
- Its name everywhere is **"Operations AI"**, including the "To" list. People can message it back.
- It may include amounts, like everyone in the chat (decision 2).
- **D-Q10.** Its chat posts share the 20-a-day limit with its questions: 20 questions plus 20 messages, counted separately.

**"Message about this"** on purchases, reimbursements, pay weeks, ABN invoices and site requests is kept from the branch, in-app only. A message never changes the record.

**D-Q11. Privacy:** only the two people read a one-to-one, and the room is open to every office login. **Ilies's decision 5:** the owner alone may also read every one-to-one, read-only ("All conversations"). Other Admins and the directors still can't.

**D-Q12. Export:** none yet. A per-thread print / PDF can follow if wanted.

**Schema (additive):**
- the branch's three tables;
- `MessageThread.kind String @default("DIRECT")` (DIRECT | ROOM) and `roomKey String? @unique`;
- `MessageParticipant.kind` stays (always USER now), and `resourceId` stays nullable and unused, so a later link side needs no migration.
- From the 4th commit: `Message.editedAt`, `Message.deletedAt`, and the append-only `MessageVersion` table (messageId Restrict, kind EDIT | DELETE, body, by, at).

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

### Results after Ilies's decisions (4th commit, 27 Oct 2026, a fresh copy of `cloud-dev-20261027-0130`)

- `tsc` clean; `npm test` 313 / 313.
  - The chat rule tests were rewritten for edit, delete, the history each reader sees, amounts, and an alert with no label.
  - The AI question tests now check that amounts are fine to a Manager.
- End to end: **84 / 84**.
  - Amounts go through in the room, to a Manager, in an AI one-to-one, and in an AI question to a Manager.
  - Edit in place: one message marked edited, the earlier version visible to the other person, two edits keep two versions.
  - Nobody else edits or deletes a message: the director 403, and the owner 403 on someone else's message.
  - Delete: others see "message deleted" with no text and no history, and the list preview hides it. The owner reads the DELETE version. A deleted message can't be edited back. The row is kept.
  - Every earlier check (access per role, only two people read a one-to-one, 405s, the AI as "Operations AI", the 20-a-day limit) still passes.
- `scripts/check-viewer-safety.ts`: 22 / 22. No new GET routes, so there are no new checks; a Viewer still gets 403 on every chat route.
- Browser, as accounts:
  - an edited message with "edited", Edit and Delete, and its two earlier versions;
  - the room showing "message deleted" with no history link.

### Results after Ilies's D-Q11 and D-Q2 answers (5th commit, 27 Oct 2026, a fresh copy of `cloud-dev-20261027-0130`)

- `tsc` clean; `npm test` 314 / 314.
  - New test: only the owner reads every conversation.
  - Updated test: the AI may ask the owner.
- End to end: **100 / 100**.
  - D-Q2: the AI asks the owner, which counts in the daily limit. The owner sees it "from Operations AI" on My queries and answers it. No project record changed.
  - D-Q11:
    - the owner's All conversations lists every one-to-one; Admin, ticked Admin, director, Manager, accounts and the AI get 403;
    - the owner opens one read-only and sees its edit history;
    - he can't mark it seen, post or edit (404), and another Admin still can't read it;
    - the thread keeps exactly two participants with unchanged "seen" times.
  - All earlier checks still pass.
- `scripts/check-viewer-safety.ts`: 22 / 22.
- Browser, as the owner: the switch, the All conversations list ("di-accounts ↔ di-director"), and a conversation opened read-only with no message box.
